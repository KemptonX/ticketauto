create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scan_type text not null,
  scanned integer not null default 0,
  inserted integer not null default 0,
  updated integer,
  matched integer,
  accounts_scanned integer,
  error text,
  created_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists sync_log_user_id_idx on public.sync_log(user_id);
create index if not exists sync_log_created_at_idx on public.sync_log(created_at desc);

alter table public.sync_log enable row level security;

drop policy if exists "sync_log_select_own" on public.sync_log;
create policy "sync_log_select_own"
on public.sync_log for select
using (auth.uid() = user_id);

drop policy if exists "sync_log_insert_own" on public.sync_log;
create policy "sync_log_insert_own"
on public.sync_log for insert
with check (auth.uid() = user_id);
