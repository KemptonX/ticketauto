-- Explicit allowlist of pre-existing email/password accounts permitted
-- to use /account-access. NOT YET APPLIED.
--
-- Why this exists: the owner's final decision keeps /account-access
-- available indefinitely for existing customers, without requiring
-- Discord migration. But requireActiveAccess() granting access to ANY
-- non-Discord session (the previous emergency-rollback state) is not
-- that policy — it's "any email/password session at all," which is
-- also what anyone who found a way to call Supabase's signUp() API
-- directly would get. This table is the actual boundary: only a
-- user_id present here is "an explicitly authorised legacy account."
--
-- This is a ONE-TIME, FROZEN snapshot taken at migration time — it is
-- intentionally not kept in sync automatically. A user_id should only
-- ever be added here by a deliberate, manual, owner-approved action in
-- the future (e.g. a genuine support exception), never automatically,
-- since automatic growth of this table is exactly the "new email
-- accounts gaining access" outcome this exists to prevent.
--
-- Confirmed via a live, read-only query immediately before writing this
-- migration: exactly 13 accounts have no Discord identity at all. That
-- number, and the exact accounts, matches every prior audit this
-- engagement — nothing has changed.

create table if not exists public.legacy_authorized_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  authorized_at timestamptz not null default now(),
  note text
);

alter table public.legacy_authorized_accounts enable row level security;
-- No policies at all — default-deny for anon/authenticated. Only the
-- service role (which bypasses RLS) and, via SECURITY INVOKER through
-- requireActiveAccess()'s use of the user's own session, a plain
-- `select` the user's own session is allowed to run against it, is
-- actually needed — add a narrow read-only self-check policy so the
-- normal authenticated client (not just the service role) can check
-- "is my own user_id in here" from requireActiveAccess()/account-access.
drop policy if exists legacy_authorized_accounts_self_read on public.legacy_authorized_accounts;
create policy legacy_authorized_accounts_self_read on public.legacy_authorized_accounts
  for select using (auth.uid() = user_id);

insert into public.legacy_authorized_accounts (user_id, note)
select u.id, 'Backfilled at migration time — pre-existing email/password account, no Discord identity'
from auth.users u
where not (coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) @> '["discord"]'::jsonb)
  and (coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) @> '["email"]'::jsonb)
on conflict (user_id) do nothing;
