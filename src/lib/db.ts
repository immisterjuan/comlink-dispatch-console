import { supabase } from '../supabaseClient';
import type { MarkerData, UserStatus } from '../types';

// Postgres access for the normalized schema (refactor.md §1):
//   users           -> registration allowlist (managed by this console)
//   connected_users -> live telemetry written by the mobile app

export interface FleetUser {
  id: string;
  badge_number: string;
  name: string;
  type: string;
  tsCreated: string | null;
}

// One-time self-registration invite created by the logged-in console.
// Badge is reserved at creation (shown in the QR dialog) and expires in 1 hour.
export interface RegistrationToken {
  token: string;
  badge_number: string;
  expires_at: string;
  created_at: string;
  claimed_at: string | null;
}

export const STATUS_VALUES: UserStatus[] = ['connecting', 'active', 'stop', 'sos', 'idle', 'away'];

export const normalizeStatus = (raw: unknown): UserStatus | null => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (STATUS_VALUES as string[]).includes(value) ? (value as UserStatus) : null;
};

const USER_COLUMNS = 'id, badge_number, name, type, tsCreated';
const REGISTRATION_TOKEN_COLUMNS = 'token, badge_number, expires_at, created_at, claimed_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const throwIfRls = (error: { code?: string }): void => {
  if (error.code === '42501') {
    throw new Error(
      'Supabase row-level security blocked the write — run the SQL files in supabase/migrations/ in the SQL editor.'
    );
  }
};

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : NaN;
};

// Flattened inner JOIN of connected_users + users (the mobile app's local
// SQLite table mirrors the same shape).
export const fetchLiveMarkers = async (): Promise<MarkerData[]> => {
  if (!supabase) return [];
  const join = 'userUUID, lat, lng, status, tsUpdated, users!inner(badge_number, name, type)';
  const fallbackJoin = 'userUUID, lat, lng, status, tsUpdated, users(badge_number, name, type)';
  let result = await supabase
    .from('connected_users')
    .select(join)
    .order('tsUpdated', { ascending: false });
  if (result.error) {
    // Some setups reject the !inner hint — retry as a plain (left) join;
    // rows without a matching allowlist entry are skipped below anyway.
    result = await supabase
      .from('connected_users')
      .select(fallbackJoin)
      .order('tsUpdated', { ascending: false });
  }
  if (result.error) throw result.error;
  const data = result.data;

  const markers: MarkerData[] = [];
  for (const row of data ?? []) {
    const uuid = row.userUUID;
    const rawUser = row.users;
    const user = Array.isArray(rawUser) ? rawUser[0] : rawUser;
    if (!uuid || !user) continue;
    const lat = toNumber(row.lat);
    const lng = toNumber(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const status = normalizeStatus(row.status);
    const ts = row.tsUpdated ? Date.parse(String(row.tsUpdated)) : NaN;
    markers.push({
      id: String(uuid),
      lat,
      lng,
      title: user.name || 'Connected User',
      badgeNumber: user.badge_number,
      type: user.type,
      status,
      isSOS: status === 'sos',
      isMoving: status === 'active',
      updatedAt: Number.isNaN(ts) ? undefined : ts,
    });
  }
  return markers;
};

export const listUsers = async (): Promise<FleetUser[]> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  const { data, error } = await supabase
    .from('users')
    .select(USER_COLUMNS)
    .order('tsCreated', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FleetUser[];
};

// Badge is assigned by Postgres (generate_badge_number trigger ->
// comlink_next_badge), the same allocator every writer uses, so concurrent
// creates can never produce duplicates; users.badge_number UNIQUE is the
// backstop. Self-registration passes the badge reserved by its invite token.
export const createUser = async (input: {
  name: string;
  type: string;
  badgeNumber?: string;
}): Promise<FleetUser> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const { data, error } = await supabase
    .from('users')
    .insert({
      id: crypto.randomUUID(),
      ...(input.badgeNumber ? { badge_number: input.badgeNumber } : {}),
      name,
      type: input.type,
      tsCreated: new Date().toISOString(),
    })
    .select(USER_COLUMNS)
    .single();
  if (error) {
    throwIfRls(error);
    throw error;
  }
  return data as FleetUser;
};

export const updateUser = async (
  id: string,
  patch: { name?: string; type?: string }
): Promise<FleetUser> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  const payload: Record<string, string> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('Name is required');
    payload.name = name;
  }
  if (patch.type !== undefined) payload.type = patch.type;
  if (Object.keys(payload).length === 0) throw new Error('Nothing to update');
  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .select(USER_COLUMNS)
    .single();
  if (error) {
    throwIfRls(error);
    throw error;
  }
  return data as FleetUser;
};

// Revocation: remove the live telemetry row, then drop the identity from the
// allowlist so the registration UUID can no longer activate a device.
export const deleteUser = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  await supabase.from('connected_users').delete().eq('userUUID', id);
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) {
    throwIfRls(error);
    throw error;
  }
};

// --- Self-registration invites -------------------------------------------
// Created from the logged-in console; the QR encodes
// `${origin}/register/${token}`. The public page claims the token first
// (atomic one-time UPDATE), then creates the user with the reserved badge.

export const createRegistrationToken = async (): Promise<RegistrationToken> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  const { data, error } = await supabase
    .from('registration_tokens')
    .insert({})
    .select(REGISTRATION_TOKEN_COLUMNS)
    .single();
  if (error) {
    throwIfRls(error);
    throw error;
  }
  return data as RegistrationToken;
};

export const getRegistrationToken = async (token: string): Promise<RegistrationToken | null> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await supabase
    .from('registration_tokens')
    .select(REGISTRATION_TOKEN_COLUMNS)
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data as RegistrationToken | null;
};

// One-time claim: the conditional UPDATE only matches an unexpired, unused
// token, so two concurrent submits can never both win.
export const registerSelf = async (input: {
  token: string;
  name: string;
  type: string;
}): Promise<FleetUser> => {
  if (!supabase) throw new Error('Supabase is not initialized');
  if (!UUID_RE.test(input.token)) throw new Error('This registration link is invalid.');
  const now = new Date().toISOString();
  const { data: claimed, error } = await supabase
    .from('registration_tokens')
    .update({ claimed_at: now })
    .eq('token', input.token)
    .is('claimed_at', null)
    .gt('expires_at', now)
    .select(REGISTRATION_TOKEN_COLUMNS)
    .maybeSingle();
  if (error) {
    throwIfRls(error);
    throw error;
  }
  if (!claimed) {
    const row = await getRegistrationToken(input.token);
    if (!row) throw new Error('This registration link is invalid.');
    if (row.claimed_at) throw new Error('This registration link has already been used.');
    throw new Error('This registration link has expired. Ask the console to create a new one.');
  }
  return createUser({ name: input.name, type: input.type, badgeNumber: claimed.badge_number });
};

// Event QR payload (refactor.md §3 step 1): tells the mobile app how to
// reach the database. The Registration QR is just the raw user UUID.
export const eventQrPayload = (): string =>
  JSON.stringify({
    supabase_url: import.meta.env.VITE_SUPABASE_URL || '',
    supabase_anon_key: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    supabase_channel: import.meta.env.VITE_SUPABASE_CHANNEL || 'map-sync',
  });
