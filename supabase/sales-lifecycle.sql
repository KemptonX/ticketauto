-- Sales lifecycle columns migration
-- Adds transfer tracking, payout date, and marketplace to the sales table

alter table public.sales add column if not exists transfer_date timestamp with time zone;
alter table public.sales add column if not exists payout_date timestamp with time zone;
alter table public.sales add column if not exists marketplace text;

-- Index for filtering by lifecycle status
create index if not exists sales_sale_status_idx on public.sales(user_id, sale_status);
