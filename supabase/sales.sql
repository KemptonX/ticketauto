create table if not exists public.sales (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  source text not null default 'viagogo',
  source_message_id text not null,
  external_sale_id text,
  subject text,
  event_name text,
  venue text,
  event_date text,
  sold_at timestamp with time zone,
  account_email text,
  buyer_email text,
  qty_sold integer,
  price_per_ticket numeric(10,2),
  sale_total numeric(10,2),
  payout_total numeric(10,2),
  currency text not null default 'GBP',
  section text,
  row text,
  seat_from text,
  seat_to text,
  sale_status text not null default 'Sold',
  inventory_order_id bigint references public.orders(id) on delete set null,
  match_confidence numeric(5,2),
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now()),
  unique (user_id, source_message_id)
);

alter table public.sales add column if not exists external_sale_id text;
alter table public.sales add column if not exists buyer_email text;
alter table public.sales add column if not exists price_per_ticket numeric(10,2);

create index if not exists sales_user_id_idx on public.sales(user_id);
create index if not exists sales_inventory_order_id_idx on public.sales(inventory_order_id);
create index if not exists sales_event_name_idx on public.sales(event_name);
create unique index if not exists sales_user_source_external_sale_id_idx
on public.sales(user_id, source, external_sale_id)
where external_sale_id is not null;

create or replace function public.set_sales_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_sales_updated_at on public.sales;
create trigger set_sales_updated_at
before update on public.sales
for each row
execute function public.set_sales_updated_at();

alter table public.sales enable row level security;

drop policy if exists "sales_select_own" on public.sales;
create policy "sales_select_own"
on public.sales for select
using (auth.uid() = user_id);

drop policy if exists "sales_insert_own" on public.sales;
create policy "sales_insert_own"
on public.sales for insert
with check (auth.uid() = user_id);

drop policy if exists "sales_update_own" on public.sales;
create policy "sales_update_own"
on public.sales for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "sales_delete_own" on public.sales;
create policy "sales_delete_own"
on public.sales for delete
using (auth.uid() = user_id);
