-- Tax & Accounts — Phase 3: business entity timeline
-- Run in the Supabase SQL editor, after 0001 and 0002.
--
-- Replaces "one current business_structure applied to all history" with a
-- proper entity timeline. accounting_profiles continues to hold the
-- *default/current* settings (country, base currency, tax reserve %,
-- accountant details) but which legal entity a given transaction belongs to
-- is now resolved from this table by date, never from whatever the profile
-- currently says.

create table if not exists accounting_entities (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('sole_trader', 'limited_company')),
  display_name text not null,
  trading_name text,
  company_name text,
  company_number text,
  incorporation_date date,
  trading_start_date date,
  -- The date range this entity is the accounting owner of transactions.
  -- effective_to = null means "ongoing / current entity".
  effective_from date not null,
  effective_to date,
  -- Month/day this entity's accounting year ends on (limited_company only).
  accounting_reference_date date,
  base_currency text not null default 'GBP',
  vat_registered boolean not null default false,
  vat_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

alter table accounting_entities enable row level security;

drop policy if exists "accounting_entities_owner" on accounting_entities;
create policy "accounting_entities_owner" on accounting_entities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_accounting_entities_user_range
  on accounting_entities (user_id, effective_from);

-- Note: overlap prevention between entities for the same user is enforced in
-- the application layer (app/api/tax-accounts/entities/route.ts), not via a
-- DB exclusion constraint, to keep this migration simple and avoid requiring
-- the btree_gist extension.
