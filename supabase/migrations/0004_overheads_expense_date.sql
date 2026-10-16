-- Tax & Accounts — Phase 3: explicit expense date
-- Run in the Supabase SQL editor, after 0003.
--
-- Costs page's addOverhead() already writes the user-selected "billed date"
-- into overheads.created_at (confirmed by reading app/costs/costs-client.tsx)
-- rather than created_at being a true insert-audit timestamp. That's exactly
-- the data this needs, so the backfill is a safe, lossless copy — not a guess.
-- Going forward both columns are written explicitly and kept distinct:
-- expense_date is the accounting date, created_at remains whatever it already
-- was (so autoAddMonthlyCharges' month-dedup logic, which reads created_at,
-- is entirely unaffected).

alter table overheads add column if not exists expense_date date;

update overheads
set expense_date = created_at::date
where expense_date is null;
