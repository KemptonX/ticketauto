-- Account Manager — platform account records (Ticketmaster, AXS, etc.).
-- NOT YET APPLIED.
--
-- Deliberately does NOT add a column/FK to orders — that table predates
-- this project's migration history entirely and is used everywhere; the
-- link to purchase history is computed instead, by matching
-- lower(orders.account_email) = lower(ticket_accounts.email) for the
-- same user, at query time (see app/api/account-manager/route.ts). This
-- stays correct automatically as new orders arrive, needs no backfill,
-- and touches zero existing rows or columns.
--
-- Safe/additive: one new table, RLS enabled, one unique index (prevents
-- the same account existing twice for one user) and one lookup index.

-- platform is free text (not a DB enum/check constraint) so future
-- providers (See Tickets, Eventim, DICE, Gigantic, ...) need zero schema
-- change — only an addition to the app-level PLATFORM_LABELS map.
create table if not exists public.ticket_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'other', -- 'ticketmaster' | 'axs' | 'other' (extensible)
  account_name text,
  email text,
  phone text,
  browser_profile_number text,
  browser_profile_tool text,
  proxy_reference text,
  country text,
  status text not null default 'active', -- 'active' | 'needs_attention' | 'inactive' | 'archived'
  notes text,
  tags text[] not null default '{}',
  source text not null default 'manual', -- 'manual' | 'auto_discovered'
  account_created_at date, -- when the ticketing account itself was created, if known (distinct from created_at = when this record was added to TixTracker)
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ticket_accounts enable row level security;

drop policy if exists ticket_accounts_owner on public.ticket_accounts;
create policy ticket_accounts_owner on public.ticket_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Prevents the same (platform, email) pair being added twice for the
-- same user — the actual duplicate-prevention mechanism, enforced in the
-- database, not just the UI. Keyed on platform+email (not email alone)
-- because the same email legitimately exists as a separate account
-- identity on two different platforms (e.g. Ticketmaster and AXS).
-- Partial index so accounts with no email (e.g. browser-profile-only
-- placeholders) are never blocked by this.
create unique index if not exists idx_ticket_accounts_user_platform_email
  on public.ticket_accounts (user_id, lower(platform), lower(email))
  where email is not null;

create index if not exists idx_ticket_accounts_user_platform
  on public.ticket_accounts (user_id, platform);
