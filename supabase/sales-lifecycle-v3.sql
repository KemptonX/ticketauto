-- Sales lifecycle v3 — distinguish expected vs actual payout dates
-- expected_payout_date: when the platform says it will pay (e.g. 5 days after event)
-- payout_date already exists and stores the actual payment received date

alter table public.sales add column if not exists expected_payout_date timestamp with time zone;

create index if not exists sales_expected_payout_idx on public.sales(user_id, expected_payout_date);
create index if not exists sales_payout_date_idx on public.sales(user_id, payout_date);
