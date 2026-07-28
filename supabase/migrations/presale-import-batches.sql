-- presale-import-batches.sql
-- Run once in Supabase SQL editor.
-- Tracks each manual import batch and links presale entries back to their source.

create table if not exists import_batches (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  created_at  timestamptz default now() not null,
  method      text        not null,
  file_names  text[]      not null default '{}',
  total_rows  int         not null default 0,
  imported    int         not null default 0,
  skipped     int         not null default 0,
  failed      int         not null default 0,
  status      text        not null default 'completed'
);

alter table import_batches enable row level security;

create policy "users manage own import batches"
  on import_batches for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Link presale entries back to their import batch (null for manually-added/inbound entries)
alter table presale_entries
  add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
