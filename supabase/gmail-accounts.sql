create extension if not exists pgcrypto;

create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  provider text not null default 'gmail',
  status text not null default 'Needs OAuth',
  sync_mode text not null default 'manual',
  is_primary boolean not null default false,
  is_active boolean not null default true,
  access_token text,
  refresh_token text,
  token_expiry timestamp with time zone,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now()),
  unique (user_id, email)
);

create index if not exists gmail_accounts_user_id_idx on public.gmail_accounts(user_id);
create index if not exists gmail_accounts_email_idx on public.gmail_accounts(email);

create or replace function public.set_gmail_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_gmail_accounts_updated_at on public.gmail_accounts;
create trigger set_gmail_accounts_updated_at
before update on public.gmail_accounts
for each row
execute function public.set_gmail_accounts_updated_at();

alter table public.gmail_accounts enable row level security;

drop policy if exists "gmail_accounts_select_own" on public.gmail_accounts;
create policy "gmail_accounts_select_own"
on public.gmail_accounts for select
using (auth.uid() = user_id);

drop policy if exists "gmail_accounts_insert_own" on public.gmail_accounts;
create policy "gmail_accounts_insert_own"
on public.gmail_accounts for insert
with check (auth.uid() = user_id);

drop policy if exists "gmail_accounts_update_own" on public.gmail_accounts;
create policy "gmail_accounts_update_own"
on public.gmail_accounts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "gmail_accounts_delete_own" on public.gmail_accounts;
create policy "gmail_accounts_delete_own"
on public.gmail_accounts for delete
using (auth.uid() = user_id);

alter table public.gmail_accounts add column if not exists scope text;
alter table public.gmail_accounts add column if not exists google_subject text;
create unique index if not exists gmail_accounts_user_subject_idx on public.gmail_accounts(user_id, google_subject) where google_subject is not null;

