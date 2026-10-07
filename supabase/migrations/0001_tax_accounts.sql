-- Tax & Accounts — Phase 1 schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- This repo has no migration tooling wired up yet, so this file is the source of truth
-- for what's been applied; run migrations in this folder in filename order.
--
-- Design principle: every table here references existing TixTracker records
-- (orders, sales, overheads) by (source_type, source_id) rather than copying their
-- data. orders/sales/overheads remain the single source of truth for financial facts;
-- these tables only carry accounting metadata that doesn't exist anywhere else yet.

-- ── accounting_profiles ────────────────────────────────────────────────────────
-- One row per user: business structure, tax settings, accountant details.
create table if not exists accounting_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_structure text not null default 'sole_trader'
    check (business_structure in ('sole_trader', 'limited_company')),
  country text not null default 'GB',
  base_currency text not null default 'GBP',
  accounting_basis text
    check (accounting_basis in ('cash', 'traditional')),
  trading_name text,
  company_name text,
  company_number text,
  company_year_end date,
  vat_registered boolean not null default false,
  vat_registration_date date,
  vat_number text,
  vat_scheme text,
  utr text,
  accountant_name text,
  accountant_email text,
  tax_reserve_percent numeric not null default 25,
  associated_companies integer not null default 0,
  internal_notes text,
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table accounting_profiles enable row level security;

drop policy if exists "accounting_profiles_owner" on accounting_profiles;
create policy "accounting_profiles_owner" on accounting_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── accounting_transaction_meta ────────────────────────────────────────────────
-- Flexible per-transaction accounting metadata (classification, tax/VAT treatment,
-- reconciliation state, review state) for ANY source record. One row per
-- (user, source_type, source_id) — source_type is 'order' | 'sale' | 'overhead' |
-- 'director_transaction' | 'adjustment'; source_id is that table's id, as text.
create table if not exists accounting_transaction_meta (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  accounting_category text,
  tax_treatment text
    check (tax_treatment in ('allowable', 'partially_allowable', 'disallowable', 'needs_review')),
  business_use_percent numeric not null default 100,
  vat_treatment text
    check (vat_treatment in (
      'not_registered', 'confirmed', 'outside_scope', 'zero_rated', 'exempt',
      'standard_rated', 'reverse_charge', 'needs_review'
    )),
  vat_amount numeric,
  reconciliation_status text not null default 'unmatched'
    check (reconciliation_status in ('matched', 'partially_matched', 'unmatched', 'needs_review')),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'user_reviewed', 'accountant_reviewed')),
  notes text,
  accountant_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

alter table accounting_transaction_meta enable row level security;

drop policy if exists "accounting_transaction_meta_owner" on accounting_transaction_meta;
create policy "accounting_transaction_meta_owner" on accounting_transaction_meta
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_tx_meta_source
  on accounting_transaction_meta (user_id, source_type, source_id);

-- ── accounting_documents ───────────────────────────────────────────────────────
-- Evidence/receipt attachments. Files themselves live in Supabase Storage
-- (bucket 'accounting-documents'); this table only indexes them.
create table if not exists accounting_documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

alter table accounting_documents enable row level security;

drop policy if exists "accounting_documents_owner" on accounting_documents;
create policy "accounting_documents_owner" on accounting_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_documents_source
  on accounting_documents (user_id, source_type, source_id);

-- ── director_transactions ───────────────────────────────────────────────────────
-- Owner/director money ledger. Genuinely new data — not derivable from existing
-- tables. Sign convention: positive amount = money the business owes the director
-- (introduced funds, personally-paid expenses, reimbursements due); negative =
-- money the director owes the business / has drawn out (repayments, drawings,
-- personal withdrawals). Documented here and enforced in the application layer,
-- not the database, since the correct sign depends on category.
create table if not exists director_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null,
  amount numeric not null,
  currency text not null default 'GBP',
  description text,
  notes text,
  created_at timestamptz not null default now()
);

alter table director_transactions enable row level security;

drop policy if exists "director_transactions_owner" on director_transactions;
create policy "director_transactions_owner" on director_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── accounting_adjustments ─────────────────────────────────────────────────────
-- Manual accounting adjustments. Never rewrites a source transaction — always an
-- additional, visually-distinct record.
create table if not exists accounting_adjustments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount numeric not null,
  category text not null
    check (category in (
      'opening_balance', 'closing_inventory', 'accrual', 'prepayment', 'correction',
      'fx_adjustment', 'bad_debt', 'accountant_adjustment', 'other'
    )),
  description text not null,
  reason text,
  accountant_note text,
  created_at timestamptz not null default now()
);

alter table accounting_adjustments enable row level security;

drop policy if exists "accounting_adjustments_owner" on accounting_adjustments;
create policy "accounting_adjustments_owner" on accounting_adjustments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── accountant_exports ─────────────────────────────────────────────────────────
-- Year-end / period snapshots. Frozen at generation time; a later edit to source
-- data never mutates a past export — a revision creates a new row referencing it.
create table if not exists accountant_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_label text not null,
  period_start date not null,
  period_end date not null,
  included_sections jsonb not null default '{}'::jsonb,
  snapshot_data jsonb,
  storage_path text,
  readiness_score numeric,
  is_revision_of bigint references accountant_exports(id),
  created_at timestamptz not null default now()
);

alter table accountant_exports enable row level security;

drop policy if exists "accountant_exports_owner" on accountant_exports;
create policy "accountant_exports_owner" on accountant_exports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── accounting_audit_log ───────────────────────────────────────────────────────
-- Field-level change history for accounting-relevant edits.
create table if not exists accounting_audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  field text not null,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now(),
  reason text
);

alter table accounting_audit_log enable row level security;

drop policy if exists "accounting_audit_log_owner" on accounting_audit_log;
create policy "accounting_audit_log_owner" on accounting_audit_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_audit_log_source
  on accounting_audit_log (user_id, source_type, source_id);
