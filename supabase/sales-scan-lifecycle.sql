-- Sales lifecycle scanning — transfer complete and payout email processing
-- Run after: sales-lifecycle-v3.sql

-- One row per email processed (dedup gate)
create table if not exists public.sales_scan_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id text not null,
  x_vg_id text,
  email_type text not null,       -- 'transfer_complete' | 'payout'
  platform text not null default 'viagogo',
  subject text,
  received_at timestamp with time zone,
  processed_at timestamp with time zone not null default timezone('utc', now()),
  status text not null default 'ok',   -- 'ok' | 'error' | 'partial'
  account_email text,
  raw_extracted jsonb,
  notes text,
  unique (user_id, message_id)
);

create index if not exists sales_scan_log_user_idx on public.sales_scan_log(user_id);
create index if not exists sales_scan_log_type_idx on public.sales_scan_log(user_id, email_type);
create index if not exists sales_scan_log_processed_idx on public.sales_scan_log(processed_at desc);

alter table public.sales_scan_log enable row level security;

drop policy if exists "ssl_select_own" on public.sales_scan_log;
create policy "ssl_select_own" on public.sales_scan_log for select using (auth.uid() = user_id);

drop policy if exists "ssl_insert_own" on public.sales_scan_log;
create policy "ssl_insert_own" on public.sales_scan_log for insert with check (auth.uid() = user_id);

drop policy if exists "ssl_update_own" on public.sales_scan_log;
create policy "ssl_update_own" on public.sales_scan_log for update using (auth.uid() = user_id);

drop policy if exists "ssl_delete_own" on public.sales_scan_log;
create policy "ssl_delete_own" on public.sales_scan_log for delete using (auth.uid() = user_id);

-- One row per order line extracted from an email (payout emails have multiple)
create table if not exists public.sales_scan_results (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scan_log_id bigint not null references public.sales_scan_log(id) on delete cascade,
  platform text not null default 'viagogo',
  email_type text not null,           -- 'transfer_complete' | 'payout'
  order_id text,                      -- external order / sale ID
  payment_reference text,             -- payout batch reference
  event_name text,
  event_date text,
  order_date text,
  amount numeric(10,2),
  qty integer,
  sale_id bigint references public.sales(id) on delete set null,
  match_status text not null default 'unmatched',
    -- 'matched' | 'unmatched' | 'already_processed' | 'needs_review' | 'error'
  action_taken text,
    -- 'updated_transfer' | 'updated_payment' | 'archived' | 'no_change' | null
  confidence text,                    -- 'exact' | 'fuzzy' | null
  notes text,
  created_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists ssr_user_idx on public.sales_scan_results(user_id);
create index if not exists ssr_log_idx on public.sales_scan_results(scan_log_id);
create index if not exists ssr_sale_idx on public.sales_scan_results(sale_id);
create index if not exists ssr_match_idx on public.sales_scan_results(user_id, match_status);
create index if not exists ssr_created_idx on public.sales_scan_results(created_at desc);

alter table public.sales_scan_results enable row level security;

drop policy if exists "ssr_select_own" on public.sales_scan_results;
create policy "ssr_select_own" on public.sales_scan_results for select using (auth.uid() = user_id);

drop policy if exists "ssr_insert_own" on public.sales_scan_results;
create policy "ssr_insert_own" on public.sales_scan_results for insert with check (auth.uid() = user_id);

drop policy if exists "ssr_update_own" on public.sales_scan_results;
create policy "ssr_update_own" on public.sales_scan_results for update using (auth.uid() = user_id);

drop policy if exists "ssr_delete_own" on public.sales_scan_results;
create policy "ssr_delete_own" on public.sales_scan_results for delete using (auth.uid() = user_id);

-- Cutoff date stored per user so UI persists it across sessions
alter table public.user_settings add column if not exists sales_scan_cutoff_date date;
