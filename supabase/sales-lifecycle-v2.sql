-- Sales lifecycle v2 — broker workflow columns
alter table public.sales add column if not exists buyer_name text;
alter table public.sales add column if not exists transfer_status text not null default 'Awaiting Transfer';
alter table public.sales add column if not exists payment_status text not null default 'Awaiting Payment';
alter table public.sales add column if not exists notes text;

-- Index for awaiting-transfer filter
create index if not exists sales_transfer_status_idx on public.sales(user_id, transfer_status);
create index if not exists sales_payment_status_idx on public.sales(user_id, payment_status);
