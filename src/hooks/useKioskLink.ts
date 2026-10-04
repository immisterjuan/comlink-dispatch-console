import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseInitialized } from '../supabaseClient';

// Dedicated console <-> kiosk link, separate from the mobile map-sync channel.
// Protocol: dispatch connects -> sends 'kiosk-cmd' -> kiosk replies 'kiosk-ack'
// (app-level receipt) -> dispatch may disconnect at any time. The kiosk is the
// persistent listener; the console owns the connection lifecycle.
const LINK_CHANNEL = 'kiosk-link';
const ACK_TIMEOUT_MS = 3000;

export interface KioskCommandPayload {
  seq: number;
  action: string;
  data?: unknown;
}

export interface CommandResult {
  delivered: boolean;
  rttMs?: number;
  error?: string;
}

export interface KioskLink {
  linkAvailable: boolean;
  connected: boolean;
  kioskOnline: boolean;
  lastRttMs: number | null;
  sendCommand: (action: string, data?: unknown) => Promise<CommandResult>;
  disconnect: () => void;
}

export const useKioskLink = (
  role: 'dispatch' | 'kiosk',
  onCommand?: (action: string, data: unknown) => void
): KioskLink => {
  const [connected, setConnected] = useState(false);
  const [kioskOnline, setKioskOnline] = useState(false);
  const [lastRttMs, setLastRttMs] = useState<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pendingRef = useRef(
    new Map<number, { resolve: (r: CommandResult) => void; timer: ReturnType<typeof setTimeout>; sentAt: number }>()
  );
  const seqRef = useRef(0);
  const onCommandRef = useRef(onCommand);

  useEffect(() => {
    onCommandRef.current = onCommand;
  });

  const failPending = useCallback((error: string) => {
    pendingRef.current.forEach(p => {
      clearTimeout(p.timer);
      p.resolve({ delivered: false, error });
    });
    pendingRef.current.clear();
  }, []);

  const sendCommand = useCallback(
    async (action: string, data?: unknown): Promise<CommandResult> => {
      const channel = channelRef.current;
      if (!channel || channel.state !== 'joined') {
        return { delivered: false, error: 'not connected' };
      }
      const seq = ++seqRef.current;
      const sentAt = Date.now();
      const result = await new Promise<CommandResult>(resolve => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(seq);
          resolve({ delivered: false, error: 'ack timeout' });
        }, ACK_TIMEOUT_MS);
        pendingRef.current.set(seq, { resolve, timer, sentAt });
        void Promise.resolve(
          channel.send({ type: 'broadcast', event: 'kiosk-cmd', payload: { seq, action, data } satisfies KioskCommandPayload })
        ).then(status => {
          if (status !== 'ok') {
            const pending = pendingRef.current.get(seq);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(seq);
            }
            resolve({ delivered: false, error: String(status) });
          }
        });
      });
      if (result.delivered) setLastRttMs(result.rttMs ?? null);
      return result;
    },
    []
  );

  const disconnect = useCallback(() => {
    const channel = channelRef.current;
    channelRef.current = null;
    setConnected(false);
    setKioskOnline(false);
    failPending('link closed');
    if (channel && supabase) void supabase.removeChannel(channel);
  }, [failPending]);

  // Kiosk side: persistent listener that acks every command.
  useEffect(() => {
    if (role !== 'kiosk' || !supabase) return;

    const channel = supabase.channel(LINK_CHANNEL, {
      config: { presence: { key: `kiosk-${Math.random().toString(36).slice(2)}` } }
    });
    channel
      .on('broadcast', { event: 'kiosk-cmd' }, ({ payload }) => {
        const { seq, action, data } = payload as KioskCommandPayload;
        void channel.send({ type: 'broadcast', event: 'kiosk-ack', payload: { seq } });
        onCommandRef.current?.(action, data);
      })
      .subscribe(status => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void channel.track({ role: 'kiosk' });
      });
    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      setConnected(false);
      void supabase?.removeChannel(channel);
    };
  }, [role]);

  // Dispatch side: owns the link, sees the kiosk via presence, pings on connect.
  useEffect(() => {
    if (role !== 'dispatch' || !supabase) return;

    const channel = supabase.channel(LINK_CHANNEL, {
      config: { presence: { key: `console-${Math.random().toString(36).slice(2)}` } }
    });
    channel
      .on('broadcast', { event: 'kiosk-ack' }, ({ payload }) => {
        const pending = pendingRef.current.get((payload as { seq: number }).seq);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingRef.current.delete((payload as { seq: number }).seq);
        pending.resolve({ delivered: true, rttMs: Date.now() - pending.sentAt });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Record<string, unknown>>();
        setKioskOnline(
          Object.values(state).some(list => list.some(p => (p as { role?: string })?.role === 'kiosk'))
        );
      })
      .subscribe(status => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void sendCommand('ping');
      });
    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      setConnected(false);
      setKioskOnline(false);
      failPending('link closed');
      void supabase?.removeChannel(channel);
    };
  }, [role, sendCommand, failPending]);

  return {
    linkAvailable: isSupabaseInitialized,
    connected,
    kioskOnline,
    lastRttMs,
    sendCommand,
    disconnect
  };
};
