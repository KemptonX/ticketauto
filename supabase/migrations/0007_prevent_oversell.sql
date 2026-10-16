-- BUG-002 remediation: prevent qty_sold summed across an order's sales
-- from exceeding that order's qty_bought. NOT YET APPLIED.
--
-- Why a trigger, not a CHECK constraint: a CHECK constraint only sees the
-- single row being written — it has no way to see the SUM across every
-- OTHER sales row linked to the same order, which is what actually needs
-- bounding here. A trigger function, run inside the same transaction as
-- the write, can compute that sum and reject the write if it would push
-- the total past qty_bought.
--
-- Concurrency reasoning (NOT live-tested under real concurrent load — no
-- staging environment exists to safely do that against production-shaped
-- traffic; this is reasoned from Postgres's documented locking behaviour,
-- flagged as such rather than claimed as verified):
--   The trigger first takes a row lock on the PARENT order
--   (`SELECT 1 FROM orders WHERE id = ... FOR UPDATE`) before computing
--   the sum. Two near-simultaneous INSERTs against sales rows for the
--   SAME order will serialize on that lock — the second transaction's
--   SELECT ... FOR UPDATE blocks until the first commits or rolls back,
--   so the second one's sum calculation always sees the first one's
--   already-committed row. Inserts against DIFFERENT orders don't
--   contend with each other at all (different lock targets), so this
--   shouldn't introduce a bottleneck for normal, unrelated traffic.
--
-- What this does NOT change: it does not touch existing rows, does not
-- retroactively validate historic data (a pre-existing oversold order, if
-- one exists, is left alone — this only guards FUTURE writes), and does
-- not change qty_bought/qty_sold's meaning or any application code's
-- reading of them.
--
-- Recommended rollout order: run the read-only check below FIRST, in
-- isolation, to confirm no currently-existing order is already oversold
-- (if one is, this trigger would make it impossible to add ANY further
-- sale against that one specific order, including a legitimate
-- correction — that specific order would need manual review first).

-- Step 1 (run first, separately, before applying the trigger below):
--   select o.id, o.qty_bought, sum(s.qty_sold) as total_qty_sold
--   from orders o
--   join sales s on s.inventory_order_id = o.id and s.sale_status <> 'Deleted'
--   group by o.id, o.qty_bought
--   having sum(s.qty_sold) > o.qty_bought;
-- Expected result: 0 rows. If this returns any rows, resolve them
-- manually before applying the trigger, or the trigger will permanently
-- block any further legitimate write against those specific orders.

create or replace function prevent_oversell() returns trigger as $$
declare
  bought int;
  total_sold int;
begin
  -- Lock the parent order first — see concurrency reasoning above.
  perform 1 from orders where id = new.inventory_order_id for update;

  select qty_bought into bought from orders where id = new.inventory_order_id;
  if bought is null then
    return new; -- no linked order (e.g. inventory_order_id is null) — nothing to bound against
  end if;

  select coalesce(sum(qty_sold), 0) into total_sold
  from sales
  where inventory_order_id = new.inventory_order_id
    and sale_status <> 'Deleted'
    and id <> coalesce(new.id, -1); -- exclude the row being updated from its own prior value

  if total_sold + new.qty_sold > bought then
    raise exception 'Oversell blocked: order % has % bought, % already sold (excl. this row), this write would add % more (total %)',
      new.inventory_order_id, bought, total_sold, new.qty_sold, total_sold + new.qty_sold;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists prevent_oversell_trigger on sales;
create trigger prevent_oversell_trigger
  before insert or update of qty_sold, inventory_order_id, sale_status on sales
  for each row
  when (new.inventory_order_id is not null and new.sale_status <> 'Deleted')
  execute function prevent_oversell();
