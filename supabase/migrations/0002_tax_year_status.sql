-- Tax & Accounts — Phase 2: tax year status tracking
-- Run in the Supabase SQL editor, after 0001_tax_accounts.sql.

create table if not exists tax_year_status (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_kind text not null, -- 'uk_tax_year' | 'company_fy'
  period_start date not null,
  period_end date not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'needs_review', 'ready_for_accountant', 'sent_to_accountant', 'filed')),
  updated_at timestamptz not null default now(),
  unique (user_id, period_start, period_end)
);

alter table tax_year_status enable row level security;

drop policy if exists "tax_year_status_owner" on tax_year_status;
create policy "tax_year_status_owner" on tax_year_status
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
