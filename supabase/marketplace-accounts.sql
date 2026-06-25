-- marketplace_accounts: one row per connected external marketplace account per user
-- Run in Supabase SQL Editor

create table if not exists public.marketplace_accounts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  marketplace               text not null,                          -- 'viagogo', future: 'stubhub' etc.
  display_email             text,                                   -- shown in UI, never the password
  encrypted_credentials     text,                                   -- AES-256-GCM: iv:tag:ciphertext
  encrypted_session_data    text,                                   -- AES-256-GCM: browser session/cookies after login
  status                    text not null default 'needs_reconnect',
    -- connected | disconnected | needs_reconnect | verification_required | login_failed | error
  can_list                  boolean not null default false,
  last_login_at             timestamptz,
  last_checked_at           timestamptz,
  last_successful_action_at timestamptz,
  last_error_code           text,
  last_error_message        text,
  pending_2fa_since         timestamptz,                           -- set when worker detects 2FA prompt
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  disconnected_at           timestamptz,

  -- One active account per marketplace per user (allow re-add after disconnect)
  constraint marketplace_accounts_user_marketplace_unique
    unique (user_id, marketplace)
);

alter table public.marketplace_accounts enable row level security;

drop policy if exists "marketplace_accounts_own" on public.marketplace_accounts;
create policy "marketplace_accounts_own"
  on public.marketplace_accounts for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Logs ────────────────────────────────────────────────────────────────────

create table if not exists public.marketplace_account_logs (
  id                     bigint generated always as identity primary key,
  user_id                uuid not null references auth.users(id) on delete cascade,
  marketplace_account_id uuid references public.marketplace_accounts(id) on delete set null,
  action                 text not null,
    -- connect | login_success | login_failed | reconnect | disconnect |
    -- can_list_check | verification_required | 2fa_requested | 2fa_submitted | error
  status                 text,
  message                text,
  error_code             text,
  created_at             timestamptz not null default now()
);

alter table public.marketplace_account_logs enable row level security;

drop policy if exists "marketplace_account_logs_own" on public.marketplace_account_logs;
create policy "marketplace_account_logs_own"
  on public.marketplace_account_logs for select
  using (auth.uid() = user_id);

drop policy if exists "marketplace_account_logs_insert_own" on public.marketplace_account_logs;
create policy "marketplace_account_logs_insert_own"
  on public.marketplace_account_logs for insert
  with check (auth.uid() = user_id);

create index if not exists marketplace_account_logs_account_idx
  on public.marketplace_account_logs(marketplace_account_id, created_at desc);
