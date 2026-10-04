-- Self-registration invites + race-safe badge allocation.
--
-- Run in the Supabase SQL Editor after 20261004111800_users_console_rls.sql.
--
-- 1) `registration_tokens`: one-time invite links created by the logged-in
--    console. Each token reserves a badge and expires 1 hour after creation.
--    The public page /register/:token claims it atomically
--    (claimed_at IS NULL AND expires_at > now()), then inserts the user with
--    the reserved badge.
--
-- 2) Badge allocation moves fully into Postgres so every writer (console
--    Add User, self-registration) shares one allocator:
--    - per-day sequence like 2026-10-04-00001,
--    - serialized by an advisory lock (no duplicate max+1 races),
--    - counts today's badges in BOTH users and registration_tokens so a
--      reserved badge is never re-issued,
--    - UNIQUE constraint on users.badge_number remains the final backstop.
--    (user_badge_seq / the old sequence-based trigger body are left in place
--    but unused.)

-- ==========================================
-- 1. Invite tokens
-- ==========================================
CREATE TABLE IF NOT EXISTS public.registration_tokens (
  "token" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "badge_number" TEXT UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "claimed_at" TIMESTAMPTZ
);

ALTER TABLE public.registration_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "registration_tokens_select" ON public.registration_tokens;
DROP POLICY IF EXISTS "registration_tokens_insert" ON public.registration_tokens;
DROP POLICY IF EXISTS "registration_tokens_claim" ON public.registration_tokens;
DROP POLICY IF EXISTS "registration_tokens_delete" ON public.registration_tokens;

-- Public register page reads the token; console reads it back after insert.
CREATE POLICY "registration_tokens_select" ON public.registration_tokens
  FOR SELECT TO anon, authenticated
  USING (true);

-- Console creates invites with the anon key (no Supabase Auth).
CREATE POLICY "registration_tokens_insert" ON public.registration_tokens
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Claim: consume a token exactly once. WITH CHECK forbids clearing
-- claimed_at afterwards (un-claiming).
CREATE POLICY "registration_tokens_claim" ON public.registration_tokens
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK ("claimed_at" IS NOT NULL);

-- Lets the console prune expired/used tokens later.
CREATE POLICY "registration_tokens_delete" ON public.registration_tokens
  FOR DELETE TO anon, authenticated
  USING (true);

-- ==========================================
-- 2. Shared race-safe badge allocator
-- ==========================================
CREATE OR REPLACE FUNCTION public.comlink_next_badge()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT := TO_CHAR(NOW(), 'YYYY-MM-DD');
  v_next BIGINT;
BEGIN
  -- Serialize concurrent allocators for this day only.
  PERFORM pg_advisory_xact_lock(hashtext('comlink-badge:' || v_prefix));
  SELECT COALESCE(MAX(n), 0) + 1 INTO v_next FROM (
    SELECT split_part("badge_number", '-', 4)::BIGINT AS n
      FROM public.users
     WHERE "badge_number" ~ ('^' || v_prefix || '-[0-9]+$')
    UNION ALL
    SELECT split_part("badge_number", '-', 4)::BIGINT
      FROM public.registration_tokens
     WHERE "badge_number" ~ ('^' || v_prefix || '-[0-9]+$')
  ) AS today;
  RETURN v_prefix || '-' || LPAD(v_next::TEXT, 5, '0');
END;
$$;

-- users trigger: replace the old sequence-based body with the shared
-- allocator (same signature, so CREATE OR REPLACE keeps trigger_generate_badge).
CREATE OR REPLACE FUNCTION public.generate_badge_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."badge_number" IS NULL THEN
    NEW."badge_number" := public.comlink_next_badge();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- registration_tokens trigger: reserve a badge at invite creation so the
-- console QR can show it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_generate_badge_invite'
      AND tgrelid = 'public.registration_tokens'::regclass
  ) THEN
    CREATE TRIGGER trigger_generate_badge_invite
    BEFORE INSERT ON public.registration_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_badge_number();
  END IF;
END $$;
