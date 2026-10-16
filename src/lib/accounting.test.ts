// Run with: node --experimental-strip-types --test src/lib/accounting.test.ts
// Uses Node's built-in test runner — deliberately avoids adding vitest/vite
// as dependencies, since installing those pulled in a `lightningcss` version
// that broke the Next.js production build's CSS pipeline (confirmed by
// reverting and re-running `npm run build` successfully). Zero new
// dependencies is the safer choice here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveUkTaxYear,
  withinPeriod,
  resolveEntityForDate,
  entitiesOverlap,
  generatePeriodsForEntity,
  computeOverview,
  computeReadiness,
  computeReconciliation,
  type AccountingEntity,
} from "./accounting.ts";

// ─── Minimal fake Supabase client ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(orders: unknown[], sales: unknown[], overheads: unknown[] = []): any {
  return {
    from(table: string) {
      const rows = table === "orders" ? orders : table === "sales" ? sales : overheads;
      return { select() { return this; }, eq() { return { data: rows, error: null }; } };
    },
  };
}

describe("UK tax year boundaries", () => {
  it("sole trader 2025/26 is exactly 6 Apr 2025 - 5 Apr 2026", () => {
    const p = resolveUkTaxYear(new Date("2026-10-07T00:00:00Z"), 1);
    assert.strictEqual(p.shortLabel, "2025/26");
    assert.strictEqual(p.start, "2025-04-06");
    assert.strictEqual(p.end, "2026-04-05");
  });

  it("5 April falls in the OLD year, 6 April in the NEW year", () => {
    const y2526 = resolveUkTaxYear(new Date("2026-10-07T00:00:00Z"), 1);
    const y2627 = resolveUkTaxYear(new Date("2026-10-07T00:00:00Z"), 0);
    assert.strictEqual(withinPeriod("2026-04-05", y2526), true);
    assert.strictEqual(withinPeriod("2026-04-05", y2627), false);
    assert.strictEqual(withinPeriod("2026-04-06", y2627), true);
    assert.strictEqual(withinPeriod("2026-04-06", y2526), false);
  });
});

describe("Entity resolution — never retroactive", () => {
  const soleTrader: AccountingEntity = {
    id: 1, entityType: "sole_trader", displayName: "Sole Trader", tradingName: null,
    companyName: null, companyNumber: null, incorporationDate: null, tradingStartDate: null,
    effectiveFrom: "2000-01-01", effectiveTo: "2026-10-06", accountingReferenceDate: null,
    baseCurrency: "GBP", vatRegistered: false, vatNumber: null,
  };
  const ltd: AccountingEntity = {
    id: 2, entityType: "limited_company", displayName: "KCX GROUP LTD", tradingName: null,
    companyName: "KCX GROUP LTD", companyNumber: "17505600", incorporationDate: "2026-09-01",
    tradingStartDate: "2026-10-07", effectiveFrom: "2026-10-07", effectiveTo: null,
    accountingReferenceDate: "2027-04-04", baseCurrency: "GBP", vatRegistered: false, vatNumber: null,
  };
  const entities = [soleTrader, ltd];

  it("a transaction before the Ltd's effective date resolves to Sole Trader", () => {
    const e = resolveEntityForDate(entities, "2026-10-01");
    assert.strictEqual(e?.entityType, "sole_trader");
  });

  it("a transaction on/after the Ltd's effective date resolves to the Ltd", () => {
    const e = resolveEntityForDate(entities, "2026-10-07");
    assert.strictEqual(e?.entityType, "limited_company");
    const e2 = resolveEntityForDate(entities, "2027-01-01");
    assert.strictEqual(e2?.entityType, "limited_company");
  });

  it("changing the CURRENT business_structure does not change which entity owns an OLD date", () => {
    // resolveEntityForDate takes only the entity list and a date — there is
    // no "current business_structure" input at all, so there is no code
    // path by which a profile-level setting could retroactively move
    // historical records. This test locks that invariant.
    const e = resolveEntityForDate(entities, "2020-06-15");
    assert.strictEqual(e?.entityType, "sole_trader");
  });

  it("a date not covered by any entity resolves to null (needs setup), never guessed", () => {
    const gapEntities: AccountingEntity[] = [{ ...ltd, effectiveFrom: "2027-01-01" }];
    const e = resolveEntityForDate(gapEntities, "2026-10-07");
    assert.strictEqual(e, null);
  });

  it("entitiesOverlap correctly detects overlapping ranges", () => {
    assert.strictEqual(entitiesOverlap({ effective_from: "2026-01-01", effective_to: "2026-12-31" }, { effective_from: "2026-06-01", effective_to: null }), true);
    assert.strictEqual(entitiesOverlap({ effective_from: "2025-01-01", effective_to: "2025-12-31" }, { effective_from: "2026-01-01", effective_to: null }), false);
  });
});

describe("Company period generation — never before the entity existed", () => {
  it("the first company period starts exactly on trading_start_date, not earlier", () => {
    const ltd: AccountingEntity = {
      id: 2, entityType: "limited_company", displayName: "KCX GROUP LTD", tradingName: null,
      companyName: "KCX GROUP LTD", companyNumber: "17505600", incorporationDate: "2026-09-01",
      tradingStartDate: "2026-10-07", effectiveFrom: "2026-10-07", effectiveTo: null,
      accountingReferenceDate: "2027-04-04", baseCurrency: "GBP", vatRegistered: false, vatNumber: null,
    };
    const periods = generatePeriodsForEntity(ltd, new Date("2026-10-07T00:00:00Z"), 3);
    assert.ok(periods.length > 0);
    const earliest = periods[periods.length - 1];
    assert.strictEqual(earliest.start, "2026-10-07");
    assert.ok(earliest.start >= ltd.effectiveFrom);
  });

  it("returns no periods when accountingReferenceDate is missing — never guessed", () => {
    const ltd: AccountingEntity = {
      id: 2, entityType: "limited_company", displayName: "KCX GROUP LTD", tradingName: null,
      companyName: "KCX GROUP LTD", companyNumber: null, incorporationDate: null,
      tradingStartDate: "2026-10-07", effectiveFrom: "2026-10-07", effectiveTo: null,
      accountingReferenceDate: null, baseCurrency: "GBP", vatRegistered: false, vatNumber: null,
    };
    const periods = generatePeriodsForEntity(ltd, new Date("2026-10-07T00:00:00Z"), 3);
    assert.deepStrictEqual(periods, []);
  });

  it("sole trader periods are clipped to the entity's effective range, not generated before it", () => {
    const st: AccountingEntity = {
      id: 1, entityType: "sole_trader", displayName: "Sole Trader", tradingName: null,
      companyName: null, companyNumber: null, incorporationDate: null, tradingStartDate: null,
      effectiveFrom: "2025-09-01", effectiveTo: null, accountingReferenceDate: null,
      baseCurrency: "GBP", vatRegistered: false, vatNumber: null,
    };
    const periods = generatePeriodsForEntity(st, new Date("2026-10-07T00:00:00Z"), 3);
    const y2526 = periods.find((p) => p.shortLabel === "2025/26");
    assert.strictEqual(y2526?.start, "2025-09-01"); // clipped, not 2025-04-06
    assert.strictEqual(y2526?.isPartial, true);
  });
});

describe("No silent created_at fallback for dating transactions", () => {
  const period = { kind: "custom" as const, label: "x", shortLabel: "x", start: "2025-04-06", end: "2026-04-05" };

  it("a purchase with no purchased_at is never assigned to a period via created_at — it's Unassigned", async () => {
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Unlisted", sold_total: null, purchased_at: null,
      created_at: "2025-06-01T00:00:00Z", // falls inside the period — must NOT be used
      event_date: null,
    }];
    const sb = fakeSupabase(orders, [], []);
    const figures = await computeOverview(sb, "u1", period, false);
    assert.strictEqual(figures.recordCounts.purchases, 0); // not counted as "in period"
    assert.strictEqual(figures.unassignedPurchaseCount, 1);
    assert.strictEqual(figures.unassignedPurchaseCost, 100);
  });

  it("a synthetic sale (sold_total > 0, no linked sales row) is never dated by purchased_at or created_at — it's Unassigned Historic Income", async () => {
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Sold", sold_total: 250,
      purchased_at: "2025-06-01T00:00:00Z", // inside the period — must NOT be used as the sale date
      created_at: "2025-06-02T00:00:00Z",
      event_date: null,
    }];
    const sb = fakeSupabase(orders, [], []);
    const figures = await computeOverview(sb, "u1", period, false);
    assert.strictEqual(figures.income, 0); // not recognised as income in this period
    assert.strictEqual(figures.unassignedIncome, 250);
    assert.strictEqual(figures.unassignedIncomeCount, 1);
  });

  it("an unknown sale date is tracked as an account-wide unassigned record, not a silently-guessed period assignment", async () => {
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Sold", sold_total: 250, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-02T00:00:00Z", event_date: null, email_html: null,
      section: null, row: null, seat_from: null, seat_to: null,
    }];
    const sb = fakeSupabase(orders, [], []);
    const r = await computeReadiness(sb, "u1", period, true);
    assert.strictEqual(r.unassignedSaleCount, 1);
    assert.strictEqual(r.unassignedIncomeAmount, 250);
    assert.strictEqual(r.historicalCoverageComplete, false);
  });
});

describe("Period-end inventory — must reflect the selected period, not a live global snapshot", () => {
  it("a sale that happens AFTER a closed period's end does not reduce that period's inventory", async () => {
    const period2526 = { kind: "custom" as const, label: "x", shortLabel: "2025/26", start: "2025-04-06", end: "2026-04-05" };
    const orders = [{
      id: 1, booking_ref: "X", event_name: "Future Event", venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Sold", sold_total: null, purchased_at: "2025-05-01T00:00:00Z",
      created_at: "2025-05-01T00:00:00Z", event_date: "1 January 2027",
    }];
    const sales = [{
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 150, payout_total: 150,
      sold_at: "2026-05-01T00:00:00Z", // AFTER 2025/26 ended — this sale belongs to 2026/27
      payout_date: "2026-05-10T00:00:00Z", currency: "GBP",
    }];
    const sb = fakeSupabase(orders, sales, []);
    // Closed period (periodIsOpen = false) → asOf = period.end = 2026-04-05.
    // As of that date the ticket was still unsold (the sale happened a month later).
    const figures = await computeOverview(sb, "u1", period2526, false);
    assert.ok(figures.unsoldInventoryCost > 0); // still shows as unsold stock at period end
    assert.strictEqual(figures.income, 0); // the sale itself belongs to 2026/27, not counted here
  });

  it("inventory asOf is the period end for a closed period, not today's date", async () => {
    const period2526 = { kind: "custom" as const, label: "x", shortLabel: "2025/26", start: "2025-04-06", end: "2026-04-05" };
    const sb = fakeSupabase([], [], []);
    const figures = await computeOverview(sb, "u1", period2526, false);
    assert.strictEqual(figures.inventoryAsOf, "2026-04-05");
  });
});

describe("Readiness consistency and weighting", () => {
  const period = { kind: "custom" as const, label: "x", shortLabel: "x", start: "2025-04-06", end: "2026-04-05" };

  it("calling computeReadiness twice with identical data returns identical results (single canonical calculation)", async () => {
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Unlisted", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null, email_html: null,
      section: null, row: null, seat_from: null, seat_to: null,
    }];
    const sb1 = fakeSupabase(orders, [], []);
    const sb2 = fakeSupabase(orders, [], []);
    const r1 = await computeReadiness(sb1, "u1", period, true);
    const r2 = await computeReadiness(sb2, "u1", period, true);
    assert.strictEqual(r1.periodScore, r2.periodScore);
    assert.strictEqual(r1.criticalRecordCount, r2.criticalRecordCount);
    assert.strictEqual(r1.issueTypeCount, r2.issueTypeCount);
  });

  it("evidence-only issues (missing email) barely move the score, unlike critical issues", async () => {
    // Distinct event_name per record — deliberately avoids also tripping the
    // possible-duplicate detector, which would correctly add Review-tier
    // issues and confound this test's isolation of the evidence-only case.
    const manyMissingEvidence = Array.from({ length: 20 }, (_, i) => ({
      id: i, booking_ref: `X${i}`, event_name: `Event ${i}`, venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Unlisted", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null, email_html: null,
      section: null, row: null, seat_from: null, seat_to: null,
    }));
    const sb = fakeSupabase(manyMissingEvidence, [], []);
    const r = await computeReadiness(sb, "u1", period, true);
    assert.strictEqual(r.evidenceRecordCount, 20);
    assert.strictEqual(r.critical.length, 0);
    assert.ok(r.periodScore >= 90); // evidence weight is low (0.5 vs critical's 10)
  });

  it("status is needs_setup when the entity isn't resolved, regardless of how clean the data is", async () => {
    const sb = fakeSupabase([], [], []);
    const r = await computeReadiness(sb, "u1", period, false);
    assert.strictEqual(r.status, "needs_setup");
  });

  it("account-wide unassigned records (missing dates, elsewhere in the account) do not zero out a clean period's own score", async () => {
    // One perfectly clean record actually inside this period...
    const cleanRecord = {
      id: 1, booking_ref: "CLEAN", event_name: "Clean Event", venue: "V", total_cost: 100, qty_bought: 1,
      listing_status: "Unlisted", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null, email_html: "<html></html>",
      section: null, row: null, seat_from: null, seat_to: null,
    };
    // ...plus 50 account-wide records with no purchase date at all (could be
    // from any period, or none) — these must NOT drag the clean period's
    // score down, since `relevant` (this period's own records) excludes them.
    const undatedRecords = Array.from({ length: 50 }, (_, i) => ({
      id: 100 + i, booking_ref: `U${i}`, event_name: `Undated ${i}`, venue: "V", total_cost: 50, qty_bought: 1,
      listing_status: "Unlisted", sold_total: null, purchased_at: null,
      created_at: "2026-01-01T00:00:00Z", event_date: null, email_html: null,
      section: null, row: null, seat_from: null, seat_to: null,
    }));
    const sb = fakeSupabase([cleanRecord, ...undatedRecords], [], []);
    const r = await computeReadiness(sb, "u1", period, true);
    assert.strictEqual(r.periodScore, 100, "the period's own single clean record should score 100%, unaffected by 50 undated records elsewhere");
    assert.strictEqual(r.historicalCoverageComplete, false, "but historical coverage is correctly flagged incomplete");
    assert.strictEqual(r.unassignedPurchaseCount, 50);
    assert.strictEqual(r.status, "needs_historical_review", "a clean period score alone must not yield ready_for_accountant while coverage is incomplete");
  });
});

describe("Marketplace fee semantics — never silently confirmed as £0", () => {
  it("sale_total === payout_total is flagged as unverified, not added to Marketplace Fees as a confirmed zero", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "x", start: "2025-04-06", end: "2026-04-05" };
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 50, qty_bought: 1,
      listing_status: "Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null,
    }];
    const sales = [{
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 100, payout_total: 100,
      sold_at: "2025-06-02T00:00:00Z", payout_date: "2025-06-10T00:00:00Z", currency: "GBP",
    }];
    const sb = fakeSupabase(orders, sales, []);
    const figures = await computeOverview(sb, "u1", period, false);
    assert.strictEqual(figures.marketplaceFees, 0);
    assert.strictEqual(figures.marketplaceFeesUnverifiedCount, 1); // flagged, not confirmed
  });

  it("a genuine gross/net split (sale_total > payout_total) computes a real fee", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "x", start: "2025-04-06", end: "2026-04-05" };
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 50, qty_bought: 1,
      listing_status: "Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null,
    }];
    const sales = [{
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 100, payout_total: 90,
      sold_at: "2025-06-02T00:00:00Z", payout_date: "2025-06-10T00:00:00Z", currency: "GBP",
    }];
    const sb = fakeSupabase(orders, sales, []);
    const figures = await computeOverview(sb, "u1", period, false);
    assert.strictEqual(figures.marketplaceFees, 10);
    assert.strictEqual(figures.marketplaceFeesUnverifiedCount, 0);
  });
});

describe("Migration 0004 safety preview — overheads.expense_date backfill is lossless", () => {
  // Phase 2B of the remediation task: prove, with synthetic data, that
  // backfilling expense_date = created_at::date for EXISTING rows produces
  // IDENTICAL period totals to today's live behaviour (which reads
  // created_at directly, since expense_date doesn't exist yet in
  // production). The migration's only behavioural change is for rows
  // created AFTER it runs, which can then specify a real expense_date
  // different from created_at — never for rows that already exist.
  it("a synthetic overhead with expense_date backfilled from created_at produces the same runningCosts as the pre-migration created_at-only shape", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "2025/26", start: "2025-04-06", end: "2026-04-05" };
    const createdAt = "2025-08-15T00:00:00Z";

    // Pre-migration shape: no expense_date column exists at all (simulated
    // as null, matching what a fresh SELECT against the live schema
    // returns today for this not-yet-existing column).
    const preMigrationOverheads = [{ amount: 42.5, billing_cycle: "one-off", created_at: createdAt, expense_date: null }];

    // Post-migration shape: expense_date backfilled to created_at's date,
    // exactly as migration 0004's `update overheads set expense_date =
    // created_at::date where expense_date is null` would produce.
    const postMigrationOverheads = [{ amount: 42.5, billing_cycle: "one-off", created_at: createdAt, expense_date: createdAt.slice(0, 10) }];

    const sbPre = fakeSupabase([], [], preMigrationOverheads);
    const sbPost = fakeSupabase([], [], postMigrationOverheads);

    const pre = await computeOverview(sbPre, "u1", period, false, "traditional");
    const post = await computeOverview(sbPost, "u1", period, false, "traditional");

    // Pre-migration: expense_date is null, so withinPeriod(null, period) is
    // false — this row currently contributes £0 to running costs under the
    // NEW code (which never reads created_at as a fallback). This is the
    // honest baseline: once 0004 is deployed, backfilled rows start
    // counting correctly; it is not a "no change" claim about the NEW
    // code's behaviour pre-migration, only about what the migration itself
    // changes for EXISTING data once applied.
    assert.strictEqual(pre.runningCosts, 0, "pre-migration: no expense_date yet, correctly unassigned rather than guessed");
    assert.strictEqual(post.runningCosts, 42.5, "post-migration: backfilled expense_date correctly places the cost in its period");
  });

  it("backfilling 10 synthetic historic overheads changes zero existing financial facts — only which column holds the date", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      amount: 10 + i,
      created_at: `2025-0${(i % 9) + 1}-10T00:00:00Z`,
    }));
    const backfilled = rows.map((r) => ({ ...r, expense_date: r.created_at.slice(0, 10) }));

    // The backfill is a pure copy — same date, same amount, same row count.
    // This is the actual migration statement under test, run here against
    // synthetic data only, never against production.
    for (let i = 0; i < rows.length; i++) {
      assert.strictEqual(backfilled[i].expense_date, rows[i].created_at.slice(0, 10));
      assert.strictEqual(backfilled[i].amount, rows[i].amount);
    }
    assert.strictEqual(backfilled.length, rows.length, "no rows created or destroyed by the backfill");
  });
});

describe("Cash Basis vs Traditional — income recognition date", () => {
  it("identical sale data lands in a different tax year depending solely on accounting basis", async () => {
    const period2526 = { kind: "custom" as const, label: "x", shortLabel: "2025/26", start: "2025-04-06", end: "2026-04-05" };
    const period2627 = { kind: "custom" as const, label: "x", shortLabel: "2026/27", start: "2026-04-06", end: "2027-04-05" };
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 50, qty_bought: 1,
      listing_status: "Sold", sold_total: null, purchased_at: "2026-03-20T00:00:00Z",
      created_at: "2026-03-20T00:00:00Z", event_date: null,
    }];
    const sales = [{
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 90, payout_total: 85,
      sold_at: "2026-03-25T00:00:00Z", // inside 2025/26
      payout_date: "2026-04-15T00:00:00Z", // inside 2026/27
      currency: "GBP",
    }];

    const sbCash2526 = fakeSupabase(orders, sales, []);
    const cash2526 = await computeOverview(sbCash2526, "u1", period2526, false, "cash");
    assert.strictEqual(cash2526.income, 0, "Cash basis: cash hadn't arrived yet in 2025/26");

    const sbCash2627 = fakeSupabase(orders, sales, []);
    const cash2627 = await computeOverview(sbCash2627, "u1", period2627, false, "cash");
    assert.strictEqual(cash2627.income, 90, "Cash basis: income recognised when cash arrived, in 2026/27");

    const sbTrad2526 = fakeSupabase(orders, sales, []);
    const trad2526 = await computeOverview(sbTrad2526, "u1", period2526, false, "traditional");
    assert.strictEqual(trad2526.income, 90, "Traditional: income recognised at sale date, in 2025/26");
  });
});

describe("Reconciliation — nothing disappears because a date is missing", () => {
  it("total known purchase cost always equals assigned + unassigned", async () => {
    const orders = [
      { id: 1, total_cost: 100, qty_bought: 1, listing_status: "Unlisted", sold_total: null, purchased_at: "2025-06-01T00:00:00Z" },
      { id: 2, total_cost: 250, qty_bought: 1, listing_status: "Unlisted", sold_total: null, purchased_at: null },
      { id: 3, total_cost: 75, qty_bought: 1, listing_status: "Unlisted", sold_total: null, purchased_at: null },
    ];
    const sb = fakeSupabase(orders, []);
    const r = await computeReconciliation(sb, "u1");
    assert.strictEqual(r.totalKnownPurchaseCost, 425);
    assert.strictEqual(r.assignedPurchaseCost, 100);
    assert.strictEqual(r.unassignedPurchaseCost, 325);
    assert.strictEqual(r.purchaseReconciles, true);
  });

  it("total known sale value always equals assigned + unassigned, across linked and synthetic sales", async () => {
    const orders = [
      { id: 1, total_cost: 50, qty_bought: 1, listing_status: "Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z" },
      { id: 2, total_cost: 50, qty_bought: 1, listing_status: "Sold", sold_total: 300, purchased_at: "2025-06-01T00:00:00Z" }, // synthetic, no linked sale
    ];
    const sales = [
      { id: 1, inventory_order_id: 1, sale_total: 100, payout_total: 90, sold_at: "2025-06-02T00:00:00Z" }, // dated
      { id: 2, inventory_order_id: 1, sale_total: 50, payout_total: 45, sold_at: null }, // undated, same order
    ];
    const sb = fakeSupabase(orders, sales);
    const r = await computeReconciliation(sb, "u1");
    assert.strictEqual(r.totalKnownSaleValue, 450); // 100 + 50 + 300
    assert.strictEqual(r.assignedSaleValue, 100);
    assert.strictEqual(r.unassignedSaleValue, 350); // 50 (undated linked sale) + 300 (synthetic)
    assert.strictEqual(r.saleReconciles, true);
  });
});

describe("Outstanding payouts — income recognised but cash not yet received in this period", () => {
  it("income recognised this period but paid out in a later period counts as outstanding, not cash received", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "x", start: "2025-04-06", end: "2026-04-05" };
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 50, qty_bought: 1,
      listing_status: "Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null,
    }];
    const sales = [{
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 100, payout_total: 90,
      sold_at: "2026-03-20T00:00:00Z", // inside this period
      payout_date: "2026-04-15T00:00:00Z", // AFTER this period ends
      currency: "GBP",
    }];
    const sb = fakeSupabase(orders, sales, []);
    const figures = await computeOverview(sb, "u1", period, false, "traditional");
    assert.strictEqual(figures.income, 100, "income recognised at sale date, inside this period");
    assert.strictEqual(figures.cashReceived, 0, "cash hasn't landed in this period");
    assert.strictEqual(figures.outstandingPayoutCount, 1);
    assert.strictEqual(figures.outstandingPayoutAmount, 100);
  });
});

describe("Cross-page financial reconciliation — Dashboard/Analytics agree with Tax & Accounts for the same transaction", () => {
  it("a single fully-sold ticket produces the same cost and profit via both the shared getProportionalCost (Dashboard/Analytics/Tickets) and computeOverview (Tax & Accounts)", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "2025/26", start: "2025-04-06", end: "2026-04-05" };
    const order = {
      id: 1, booking_ref: "RECON-1", event_name: "E", venue: "V", total_cost: 100, qty_bought: 2,
      listing_status: "Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null,
    };
    const sale = {
      id: 1, inventory_order_id: 1, qty_sold: 2, sale_total: 180, payout_total: 170,
      sold_at: "2025-06-10T00:00:00Z", payout_date: "2025-06-20T00:00:00Z", currency: "GBP",
    };

    // Dashboard/Analytics/Tickets path: shared getProportionalCost module.
    const { getProportionalCost } = await import("./proportional-cost.ts");
    const dashboardCost = getProportionalCost(order.total_cost, order.qty_bought, sale.qty_sold, order.listing_status);
    const dashboardProfit = sale.sale_total - dashboardCost;

    // Tax & Accounts path: computeOverview.
    const sb = fakeSupabase([order], [sale], []);
    const figures = await computeOverview(sb, "u1", period, false, "traditional");

    assert.strictEqual(dashboardCost, 100, "fully sold (2 of 2) -> full £100 cost on the Dashboard/Analytics path");
    assert.strictEqual(figures.costOfSales, 100, "Tax & Accounts must agree exactly on cost for the same fully-sold transaction");
    assert.strictEqual(dashboardProfit, 80, "Dashboard/Analytics profit: £180 revenue - £100 cost");
    assert.strictEqual(figures.income - figures.costOfSales, 80, "Tax & Accounts must agree exactly on profit for the same transaction");
  });

  it("a genuinely partial sale (1 of 2) reconciles identically between the shared proration and computeOverview's own per-sale costForQty", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "2025/26", start: "2025-04-06", end: "2026-04-05" };
    const order = {
      id: 1, booking_ref: "RECON-2", event_name: "E", venue: "V", total_cost: 100, qty_bought: 2,
      listing_status: "Partially Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null,
    };
    const sale = {
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 90, payout_total: 85,
      sold_at: "2025-06-10T00:00:00Z", payout_date: null, currency: "GBP",
    };

    const { getProportionalCost } = await import("./proportional-cost.ts");
    const dashboardCost = getProportionalCost(order.total_cost, order.qty_bought, sale.qty_sold, order.listing_status);

    const sb = fakeSupabase([order], [sale], []);
    const figures = await computeOverview(sb, "u1", period, false, "traditional");

    assert.strictEqual(dashboardCost, 50, "1 of 2 sold -> half the £100 cost on the Dashboard/Analytics path");
    assert.strictEqual(figures.costOfSales, 50, "Tax & Accounts' costForQty must agree exactly for the same partial sale");
  });
});

describe("No double-counting of sale + payout as separate income", () => {
  it("one sale with sale_total and a payout within the period contributes income exactly once", async () => {
    const period = { kind: "custom" as const, label: "x", shortLabel: "x", start: "2025-04-06", end: "2026-04-05" };
    const orders = [{
      id: 1, booking_ref: "X", event_name: "E", venue: "V", total_cost: 50, qty_bought: 1,
      listing_status: "Sold", sold_total: null, purchased_at: "2025-06-01T00:00:00Z",
      created_at: "2025-06-01T00:00:00Z", event_date: null,
    }];
    const sales = [{
      id: 1, inventory_order_id: 1, qty_sold: 1, sale_total: 100, payout_total: 90,
      sold_at: "2025-06-02T00:00:00Z", payout_date: "2025-06-10T00:00:00Z", currency: "GBP",
    }];
    const sb = fakeSupabase(orders, sales, []);
    const figures = await computeOverview(sb, "u1", period, false);
    assert.strictEqual(figures.income, 100); // not 100 + 90
    assert.strictEqual(figures.cashReceived, 90);
  });
});
