create table if not exists presale_entries (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  campaign text not null,           -- e.g. "la28_olympics", "taylor_swift_eras"
  account_email text not null,
  presale_code text,                -- null when account-bound (e.g. Olympics)
  slot_start timestamptz,           -- presale window start (if applicable)
  slot_end timestamptz,             -- presale window end (if applicable)
  notes text,
  source_message_id text,           -- dedup: email Message-ID that created this row
  created_at timestamptz default now() not null
);

alter table presale_entries enable row level security;

create policy "users can manage own presale entries"
  on presale_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create unique index if not exists presale_entries_dedup
  on presale_entries (user_id, campaign, account_email, source_message_id)
  where source_message_id is not null;
