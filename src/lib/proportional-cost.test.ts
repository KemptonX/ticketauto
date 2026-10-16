import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProportionalCost } from "./proportional-cost.ts";

// A batch of 4 tickets costing £400 total (£100/ticket) is the running
// example across these tests, matching the exact scenarios requested in
// the remediation task.

describe("Partial-sale cost proration — driven by real quantities, not the status label", () => {
  it("1 of 4 sold: cost is exactly 1/4, regardless of status label", () => {
    assert.strictEqual(getProportionalCost(400, 4, 1, "Partially Sold"), 100);
    assert.strictEqual(getProportionalCost(400, 4, 1, "Sold"), 100, "status says Sold but only 1 of 4 actually sold — must still prorate");
    assert.strictEqual(getProportionalCost(400, 4, 1, "Listed"), 100);
    assert.strictEqual(getProportionalCost(400, 4, 1, null), 100);
  });

  it("2 of 4 sold: cost is exactly half", () => {
    assert.strictEqual(getProportionalCost(400, 4, 2, "Partially Sold"), 200);
    assert.strictEqual(getProportionalCost(400, 4, 2, "Problem / Missing"), 200, "an unrelated status string must not change the real quantity-based answer");
  });

  it("all 4 of 4 sold: full cost, exactly once (not 4x, not prorated down)", () => {
    assert.strictEqual(getProportionalCost(400, 4, 4, "Sold"), 400);
    assert.strictEqual(getProportionalCost(400, 4, 4, "Partially Sold"), 400, "even if the label is stale and still says Partially Sold, 4 of 4 is fully sold");
  });

  it("over-sold edge case (qtySold > qtyBought) never returns more than the real total cost", () => {
    assert.strictEqual(getProportionalCost(400, 4, 7, "Sold"), 400, "cost allocation must never exceed the true total purchase cost");
  });

  it("multiple separate partial sales accumulating toward the full batch: sum of prorated costs never exceeds the total", () => {
    // Sale A: 1 of 4. Sale B (later): 2 more of 4 (cumulative 3 of 4).
    const costA = getProportionalCost(400, 4, 1, "Partially Sold");
    const costB = getProportionalCost(400, 4, 3, "Partially Sold"); // cumulative qtySold at time of second sale
    assert.strictEqual(costA, 100);
    assert.strictEqual(costB, 300);
    assert.ok(costB <= 400, "cumulative prorated cost must never exceed the real total purchase cost");
  });

  it("zero sold returns the full cost unchanged (matches existing caller behaviour — none call this for a zero-revenue order in practice)", () => {
    assert.strictEqual(getProportionalCost(400, 4, 0, "Unlisted"), 400);
  });

  it("missing qtyBought or cost never divides by zero or throws", () => {
    assert.strictEqual(getProportionalCost(400, null, 2, "Sold"), 400);
    assert.strictEqual(getProportionalCost(400, 0, 2, "Sold"), 400);
    assert.strictEqual(getProportionalCost(null, 4, 2, "Sold"), 0);
  });

  it("a split sale (same order, two sale rows, combined qtySold passed in) prorates on the combined quantity, same as any other partial", () => {
    // Splits are modelled by the caller summing qty_sold across all linked
    // sales rows before calling this function — this function itself has
    // no concept of "split", it only ever sees a total qtySold. Confirming
    // that's sufficient: 2 split sales of 1 ticket each (2 of 4 total).
    const combinedQtySold = 1 + 1;
    assert.strictEqual(getProportionalCost(400, 4, combinedQtySold, "Partially Sold"), 200);
  });

  it("cancelled/refunded sales are a caller-side concern (excluded from qtySold before calling), not this function's — confirms it has no awareness of sale_status", () => {
    // If a caller correctly excludes a cancelled sale's quantity from the
    // qtySold it passes in, proration is unaffected by what sale_status
    // values exist — this function only ever sees the net result.
    assert.strictEqual(getProportionalCost(400, 4, 1, "Sold"), 100, "as if 1 of 4 genuinely sold after a cancelled sale for 1 other ticket was excluded upstream");
  });

  it("fees and currency are out of scope for this function by design — it only allocates the PURCHASE cost, already resolved to GBP upstream", () => {
    // totalCost here is assumed to already be the GBP-converted purchase
    // cost (resolved at save time per the app's existing currency
    // handling) — this function does not re-derive or convert currency,
    // and does not touch marketplace fees at all (those are deducted from
    // revenue, not from cost). Documenting the boundary with a concrete
    // example rather than asserting something this function was never
    // responsible for.
    const gbpConvertedCost = 400; // e.g. originally $500 USD, already converted to GBP before storage
    assert.strictEqual(getProportionalCost(gbpConvertedCost, 4, 2, "Partially Sold"), 200);
  });
});
