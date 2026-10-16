-- Whop entitlement lifecycle (SEC-001 remediation).
-- NOT YET APPLIED — run manually in the Supabase SQL editor after review.
--
-- Problem being fixed: Whop membership was previously checked exactly once,
-- inline in the OAuth callback (app/auth/callback/route.ts), and never
-- again. A cancelled/lapsed Discord-login user kept full access for as
-- long as their Supabase session stayed alive (which can be indefinite,
-- since Supabase sessions auto-refresh unless the user explicitly logs
-- out). This table makes entitlement a real, periodically-refreshed,
-- stored fact instead of a one-time check — it's deliberately NOT stored
-- in user-editable auth metadata (which a client could in principle
-- tamper with), and only ever written by server-side code using the
-- service-role key (the cron refresh job and the OAuth callback).
--
-- Policy this encodes (confirm with the business owner before relying on
-- the exact numbers — see the accompanying report):
--   - Re-check cadence: every 6 hours (set by the cron schedule in
--     vercel.json, added alongside this migration).
--   - Maximum revocation delay: ~6 hours after Whop itself reports the
--     membership as no longer active (bounded by the re-check cadence).
--   - Outage grace: if a re-check FAILS (Whop unreachable/erroring), the
--     previous is_entitled value is preserved for up to 48 hours
--     (grace_until) rather than immediately revoking access because of a
--     transient third-party outage. Only if Whop is still unreachable
--     after the full grace window does the row fall back to NOT entitled
--     on the next check.

create table if not exists whop_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discord_id text,
  status text not null default 'unknown',       -- raw Whop membership status at last successful check
  is_entitled boolean not null default true,    -- the resolved access decision; defaults true so a row with no check yet never accidentally locks someone out
  last_checked_at timestamptz,
  last_check_succeeded boolean,
  last_check_error text,
  grace_until timestamptz,                      -- set when a check fails; access is preserved until this passes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whop_entitlements_grace_idx on whop_entitlements (grace_until);

alter table whop_entitlements enable row level security;

-- Users may read their OWN row (so the app can show "subscription expired"
-- messaging client-side if ever needed) but never write it — only
-- server-side code using the service-role key writes this table.
drop policy if exists "whop_entitlements_owner_read" on whop_entitlements;
create policy "whop_entitlements_owner_read" on whop_entitlements
  for select using (auth.uid() = user_id);

-- Deliberately no insert/update/delete policy for the authenticated role —
-- this means ordinary users get a permission-denied error if they ever
-- attempt to write this table directly, which is the desired behaviour.
