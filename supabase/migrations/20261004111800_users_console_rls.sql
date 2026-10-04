-- RLS policies for ComLink (matches com.boredengineer.comlink/supabase_schema.sql).
--
-- That schema enables ROW LEVEL SECURITY on both tables but leaves the
-- policies commented out, so the anon role has no write access:
--   42501 "new row violates row-level security policy for table \"users\""
--
-- The console authenticates only with the anon key (auth is localStorage-based,
-- no Supabase Auth), same as the mobile app, so `anon` needs explicit policies.
--
-- Run in the Supabase SQL Editor (or `supabase db push`).
-- Verify afterwards: POST /rest/v1/users with the anon key should return 201.

-- Console inserts provide tsCreated explicitly, but make the schema default
-- authoritative (it may be missing on a hand-created table).
ALTER TABLE public.users
  ALTER COLUMN "tsCreated" SET DEFAULT NOW();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_users ENABLE ROW LEVEL SECURITY;

-- users: console CRUD + mobile registration lookup
DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_insert" ON public.users;
DROP POLICY IF EXISTS "users_update" ON public.users;
DROP POLICY IF EXISTS "users_delete" ON public.users;

CREATE POLICY "users_select" ON public.users
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "users_insert" ON public.users
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "users_update" ON public.users
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users_delete" ON public.users
  FOR DELETE TO anon, authenticated
  USING (true);

-- connected_users: mobile upserts telemetry, console reads for the map
DROP POLICY IF EXISTS "connected_users_all" ON public.connected_users;

CREATE POLICY "connected_users_all" ON public.connected_users
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);
