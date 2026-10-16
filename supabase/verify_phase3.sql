-- Tax & Accounts — Phase 3 verification queries (READ-ONLY).
-- Run these in the Supabase SQL editor AFTER applying 0003 and 0004 to
-- confirm the migration actually did what it claims. Nothing here writes
-- or modifies data.

-- 1. accounting_entities exists, with the expected columns.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'accounting_entities'
order by ordinal_position;

-- 2. overheads.expense_date exists.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'overheads' and column_name = 'expense_date';

-- 3. Every existing overhead row was backfilled (should return 0 rows).
select id, name, amount, created_at, expense_date
from overheads
where expense_date is null;

-- 4. Backfilled expense_date matches created_at exactly for pre-existing rows
--    (should return 0 rows — any mismatch means the backfill didn't copy
--    the value it was supposed to).
select id, name, created_at, expense_date
from overheads
where expense_date is not null
  and expense_date <> created_at::date;

-- 5. Cost total before vs after — run this BEFORE 0004 and save the number,
--    then re-run after to confirm it's unchanged. (Can't be fully automated
--    in one script since it's a before/after comparison across migrations.)
select count(*) as row_count, sum(amount) as total_amount
from overheads;

-- 6. RLS is enabled on the new tables.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in ('accounting_entities', 'tax_year_status', 'overheads')
  and relnamespace = 'public'::regnamespace;

-- 7. Policies exist on accounting_entities (should return exactly 1 row —
--    the "accounting_entities_owner" policy covering all operations).
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'accounting_entities'::regclass;

-- 8. Index exists on accounting_entities for the (user_id, effective_from)
--    lookup pattern used by every period-generation query.
select indexname, indexdef
from pg_indexes
where tablename = 'accounting_entities';

-- 9. No accounting_entities rows exist yet for any user (expected — nobody
--    has completed the one-time setup form yet since this hasn't shipped).
select count(*) from accounting_entities;
