-- imap_accounts table
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New query)

create table if not exists public.imap_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  host         text not null,
  port         integer not null default 993,
  username     text not null,
  password     text not null,
  use_tls      boolean not null default true,
  mailbox      text not null default 'INBOX',
  unread_only  boolean not null default true,
  mark_read    boolean not null default false,
  label        text,
  status       text not null default 'Ready',
  last_synced_at timestamptz,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- If the table already exists, add any missing columns:
alter table public.imap_accounts
  add column if not exists label        text,
  add column if not exists status       text not null default 'Ready',
  add column if not exists last_synced_at timestamptz,
  add column if not exists is_active    boolean not null default true,
  add column if not exists use_tls      boolean not null default true,
  add column if not exists mailbox      text not null default 'INBOX',
  add column if not exists unread_only  boolean not null default true,
  add column if not exists mark_read    boolean not null default false,
  add column if not exists created_at   timestamptz not null default now(),
  add column if not exists updated_at   timestamptz not null default now();

-- RLS
alter table public.imap_accounts enable row level security;

drop policy if exists "Users manage own imap accounts" on public.imap_accounts;
create policy "Users manage own imap accounts"
  on public.imap_accounts
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role needs SELECT for cron scan (bypasses RLS by default with service role key)
