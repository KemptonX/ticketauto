-- Rate limiting for /account-access. NOT YET APPLIED.
--
-- /account-access is the owner-approved, permanent (not temporary —
-- see the final authentication decision) private email/password
-- sign-in path for the explicitly authorised legacy accounts listed in
-- migration 0011. It had no brute-force protection at all. This is a
-- minimal, internal-only bookkeeping table — never read or written
-- directly by any client, only by the server route at
-- app/api/auth/account-access/route.ts using the service-role key, the
-- same pattern already used for whop_entitlements.
--
-- Tracks both email and IP per attempt: email-only tracking misses a
-- credential-stuffing pattern (many different emails, same guessed
-- password, from one source) that stays under the per-email threshold
-- indefinitely. The application layer rate-limits on whichever of the
-- two trips first.
--
-- Safe/additive: one new table, RLS enabled with no policies at all
-- (default-deny for both anon and authenticated roles — only the
-- service role, which bypasses RLS entirely, can touch it).

create table if not exists public.account_access_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

alter table public.account_access_attempts enable row level security;

create index if not exists idx_account_access_attempts_email_time
  on public.account_access_attempts (email, attempted_at desc);
create index if not exists idx_account_access_attempts_ip_time
  on public.account_access_attempts (ip, attempted_at desc);

-- Housekeeping: rows older than a day are useless for rate limiting and
-- can be removed. No automatic cron for this yet — cheap enough to leave
-- for a manual cleanup query occasionally rather than a scheduled job.
