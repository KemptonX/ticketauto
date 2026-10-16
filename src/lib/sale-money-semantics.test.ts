import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normaliseSaleMoney } from "./sale-money-semantics.ts";

describe("Marketplace money semantics", () => {
  it("a genuine gross/net split (StubHub/Ticombo-shaped) reports gross, fee and net all known", () => {
    const result = normaliseSaleMoney({ sale_total: 100, payout_total: 90 });
    assert.strictEqual(result.grossKnown, true);
    assert.strictEqual(result.netKnown, true);
    assert.strictEqual(result.feeKnown, true);
    assert.strictEqual(result.grossAmount, 100);
    assert.strictEqual(result.sellerFee, 10);
    assert.strictEqual(result.netAmount, 90);
  });

  it("identical sale_total/payout_total (Viagogo sold-confirmation shape) reports gross and fee as NOT known, net as known", () => {
    const result = normaliseSaleMoney({ sale_total: 300, payout_total: 300 });
    assert.strictEqual(result.grossKnown, false);
    assert.strictEqual(result.feeKnown, false);
    assert.strictEqual(result.netKnown, true);
    assert.strictEqual(result.netAmount, 300);
    assert.strictEqual(result.grossAmount, null, "must never fabricate a gross figure from a net-duplicated value");
  });

  it("no data at all reports everything unknown, never a fabricated £0", () => {
    const result = normaliseSaleMoney({ sale_total: null, payout_total: null });
    assert.strictEqual(result.grossKnown, false);
    assert.strictEqual(result.feeKnown, false);
    assert.strictEqual(result.netKnown, false);
    assert.strictEqual(result.sellerFee, null, "fee must be null (unknown), never 0 (confirmed zero)");
  });
});
