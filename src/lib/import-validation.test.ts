import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyIssues,
  wouldOversell,
  describeOversell,
  checkQuantity,
  checkRequiredText,
  checkDate,
  checkFinancialValue,
  checkCostPriceSwap,
  checkCurrencyMismatch,
  checkDuplicateOrder,
  checkDuplicateSale,
  checkConflictingStatus,
} from "./import-validation.ts";

describe("classifyIssues", () => {
  it("valid when no issues", () => assert.equal(classifyIssues([]), "valid"));
  it("warning when only warnings", () => assert.equal(classifyIssues([{ severity: "warning", code: "x", message: "m" }]), "warning"));
  it("error when any error is present, even alongside warnings", () => {
    assert.equal(classifyIssues([
      { severity: "warning", code: "x", message: "m" },
      { severity: "error", code: "y", message: "m" },
    ]), "error");
  });
});

describe("wouldOversell / describeOversell — the brief's partial-sale scenarios", () => {
  it("1 of 4 sold is fine", () => assert.equal(wouldOversell(4, 0, 1), false));
  it("2 of 4 sold (cumulative) is fine", () => assert.equal(wouldOversell(4, 2, 0), false));
  it("all 4 of 4 sold is fine, exactly at the limit", () => assert.equal(wouldOversell(4, 0, 4), false));
  it("4 sold then 1 more is an oversell", () => assert.equal(wouldOversell(4, 4, 1), true));
  it("multiple separate sales summing past qty_bought is an oversell", () => assert.equal(wouldOversell(2, 2, 1), true));
  it("split sales across rows that together equal qty_bought are fine", () => assert.equal(wouldOversell(4, 1, 3), false));
  it("an order with no qty_bought recorded is never flagged here (handled by the missing-field check instead)", () => assert.equal(wouldOversell(null, 0, 5), false));
  it("describeOversell produces a plain-English message, not a technical one", () => {
    const msg = describeOversell(2, 2, 3);
    assert.match(msg, /2 tickets/);
    assert.match(msg, /already sold/);
    assert.doesNotMatch(msg, /constraint|null|undefined|NaN/i);
  });
});

describe("checkQuantity", () => {
  it("required + missing -> error", () => {
    const issues = checkQuantity("qty_bought", "Qty Bought", null, { required: true });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "error");
  });
  it("not required + missing -> no issue", () => {
    assert.deepEqual(checkQuantity("qty_sold", "Qty Sold", null), []);
  });
  it("zero or negative -> error", () => {
    assert.equal(checkQuantity("qty_bought", "Qty Bought", 0, { required: true })[0].severity, "error");
    assert.equal(checkQuantity("qty_bought", "Qty Bought", -2, { required: true })[0].severity, "error");
  });
  it("non-integer -> error", () => {
    assert.equal(checkQuantity("qty_bought", "Qty Bought", 2.5)[0].severity, "error");
  });
  it("valid positive integer -> no issue", () => {
    assert.deepEqual(checkQuantity("qty_bought", "Qty Bought", 4, { required: true }), []);
  });
  it("suspiciously large -> warning, not error", () => {
    const issues = checkQuantity("qty_bought", "Qty Bought", 5000, { max: 1000 });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
  });
});

describe("checkRequiredText", () => {
  it("missing event name -> error with a plain-English message, not 'validation failed'", () => {
    const issues = checkRequiredText("event_name", "Event Name", "");
    assert.equal(issues[0].severity, "error");
    assert.doesNotMatch(issues[0].message, /validation/i);
  });
  it("present -> no issue", () => assert.deepEqual(checkRequiredText("event_name", "Event Name", "Coldplay"), []));
});

describe("checkDate", () => {
  it("missing/ambiguous date that failed to parse -> warning, shows the original text", () => {
    const issues = checkDate("event_date", "Event Date", null, "whenever");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
    assert.match(issues[0].message, /whenever/);
  });
  it("successfully parsed date -> no issue", () => assert.deepEqual(checkDate("event_date", "Event Date", "2025-06-15", "15/06/2025"), []));
  it("required + genuinely blank -> error, not warning", () => {
    const issues = checkDate("event_date", "Event Date", null, "", { required: true });
    assert.equal(issues[0].severity, "error");
  });
  it("not required + blank -> no issue", () => assert.deepEqual(checkDate("purchased_at", "Date Bought", null, ""), []));
});

describe("checkFinancialValue — never defaults missing values to zero", () => {
  it("missing + required -> warning (not silently treated as 0)", () => {
    const issues = checkFinancialValue("total_cost", "Total Cost", null, { required: true });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
    assert.match(issues[0].message, /misrepresent/);
  });
  it("missing + not required -> no issue", () => assert.deepEqual(checkFinancialValue("payout_total", "Payout", null), []));
  it("negative purchase cost -> error", () => {
    const issues = checkFinancialValue("total_cost", "Total Cost", -50, {});
    assert.equal(issues[0].severity, "error");
  });
  it("negative allowed when explicitly permitted (e.g. a refund adjustment) -> no issue", () => {
    assert.deepEqual(checkFinancialValue("sale_total", "Sale Total", -50, { allowNegative: true }), []);
  });
  it("legitimate negative financial amount is preserved, not rejected, when allowed", () => {
    assert.deepEqual(checkFinancialValue("sale_total", "Sale Total", -12.34, { allowNegative: true }), []);
  });
  it("suspiciously large -> warning, never blocks a genuinely expensive ticket", () => {
    const issues = checkFinancialValue("total_cost", "Total Cost", 75000, {});
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
  });
  it("ordinary value -> no issue", () => assert.deepEqual(checkFinancialValue("total_cost", "Total Cost", 350, {}), []));
});

describe("checkCostPriceSwap", () => {
  it("flags cost far exceeding sale price", () => {
    const issue = checkCostPriceSwap(1000, 50);
    assert.ok(issue);
    assert.equal(issue!.severity, "warning");
  });
  it("does not flag a normal profitable resale", () => {
    assert.equal(checkCostPriceSwap(100, 150), null);
  });
  it("does not flag a genuine, moderate loss on resale", () => {
    assert.equal(checkCostPriceSwap(100, 60), null);
  });
  it("skips when either value is missing", () => {
    assert.equal(checkCostPriceSwap(null, 50), null);
    assert.equal(checkCostPriceSwap(100, null), null);
  });
});

describe("checkCurrencyMismatch", () => {
  it("flags a $ symbol when GBP is selected", () => {
    const issue = checkCurrencyMismatch(["$100.00"], "GBP");
    assert.ok(issue);
    assert.equal(issue!.severity, "warning");
  });
  it("does not flag when the symbol matches the selected currency", () => {
    assert.equal(checkCurrencyMismatch(["£100.00"], "GBP"), null);
  });
  it("does not flag plain numbers with no symbol", () => {
    assert.equal(checkCurrencyMismatch(["100.00"], "GBP"), null);
  });
});

describe("checkDuplicateOrder / previously-imported detection", () => {
  it("flags an exact booking-ref match", () => {
    const issue = checkDuplicateOrder(
      { bookingRef: "TM-123", eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 },
      [{ bookingRef: "TM-123", eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 }],
    );
    assert.ok(issue);
  });
  it("flags a ref-less fuzzy match on event+date+qty+cost", () => {
    const issue = checkDuplicateOrder(
      { bookingRef: null, eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 },
      [{ bookingRef: null, eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 }],
    );
    assert.ok(issue);
  });
  it("does not flag a different order with a different booking ref", () => {
    assert.equal(checkDuplicateOrder(
      { bookingRef: "TM-999", eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 },
      [{ bookingRef: "TM-123", eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 }],
    ), null);
  });
  it("does not incorrectly flag two legitimately separate purchases of the same event/date with different qty or cost", () => {
    assert.equal(checkDuplicateOrder(
      { bookingRef: null, eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 4, totalCost: 600 },
      [{ bookingRef: null, eventName: "Coldplay", eventDate: "2025-06-15", qtyBought: 2, totalCost: 300 }],
    ), null);
  });
});

describe("checkDuplicateSale", () => {
  it("flags an exact external-id match", () => {
    const issue = checkDuplicateSale(
      { externalSaleId: "VG-1", eventName: "Coldplay", soldAt: "2025-05-01", qtySold: 2, saleTotal: 400 },
      [{ externalSaleId: "VG-1", eventName: "Coldplay", soldAt: "2025-05-01", qtySold: 2, saleTotal: 400 }],
    );
    assert.ok(issue);
  });
  it("does not flag distinct sales with different references", () => {
    assert.equal(checkDuplicateSale(
      { externalSaleId: "VG-2", eventName: "Coldplay", soldAt: "2025-05-01", qtySold: 2, saleTotal: 400 },
      [{ externalSaleId: "VG-1", eventName: "Coldplay", soldAt: "2025-05-01", qtySold: 2, saleTotal: 400 }],
    ), null);
  });
});

describe("checkConflictingStatus", () => {
  it("flags Cancelled + Paid together", () => {
    assert.ok(checkConflictingStatus({ saleStatus: "Cancelled / Issue", paymentStatus: "Paid" }));
  });
  it("flags Cancelled with a nonzero qty sold", () => {
    assert.ok(checkConflictingStatus({ saleStatus: "Cancelled / Issue", qtySold: 2 }));
  });
  it("does not flag a normal awaiting-transfer sale", () => {
    assert.equal(checkConflictingStatus({ saleStatus: "Sold – Awaiting Transfer", qtySold: 2, paymentStatus: "Awaiting Payment" }), null);
  });
});
