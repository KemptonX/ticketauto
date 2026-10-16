-- Import history. NOT YET APPLIED.
--
-- Records what was imported and when, so Settings -> Import can show a
-- "Recent imports" list. Deliberately history-only: this does NOT add an
-- undo/delete-batch feature (decided explicitly — that would need its own
-- careful conflict-handling design, e.g. a ticket that gained a sale since
-- import must not be silently deleted by an undo), and deliberately does
-- NOT tag individual orders/sales rows with a batch id — a summary record
-- (counts + filename + timestamp) is all "what was imported and when"
-- needs, and it avoids adding a column to the orders/sales insert payload
-- that would hard-fail every import until this migration is applied.
--
-- Safe/additive: one new table. No existing table, column, or behaviour
-- is touched.

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  source_filename text,
  source text not null default 'ticket_import', -- 'ticket_import' | 'sales_import'
  counts jsonb not null default '{}'::jsonb
);

alter table public.import_batches enable row level security;

drop policy if exists import_batches_select_own on public.import_batches;
create policy import_batches_select_own on public.import_batches
  for select using (auth.uid() = user_id);

-- Only ever written by the app on behalf of the signed-in user (via the
-- normal authenticated client, same as orders/sales inserts) — no
-- separate insert policy is needed beyond the existing default-deny,
-- except explicitly allowing the owner to insert their own batch record.
drop policy if exists import_batches_insert_own on public.import_batches;
create policy import_batches_insert_own on public.import_batches
  for insert with check (auth.uid() = user_id);
