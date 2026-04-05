-- Run this in Supabase SQL Editor before inviting members.

alter table public.orders
add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists orders_user_id_idx on public.orders(user_id);

alter table public.orders
alter column user_id set default auth.uid();

-- Backfill your own existing rows after you create your account.
-- Replace the UUID below with your auth user id from Supabase Auth.
-- update public.orders
-- set user_id = 'YOUR_AUTH_USER_ID'
-- where user_id is null;

alter table public.orders enable row level security;

create policy if not exists "orders_select_own"
on public.orders for select
using (auth.uid() = user_id);

create policy if not exists "orders_insert_own"
on public.orders for insert
with check (auth.uid() = user_id);

create policy if not exists "orders_update_own"
on public.orders for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "orders_delete_own"
on public.orders for delete
using (auth.uid() = user_id);
