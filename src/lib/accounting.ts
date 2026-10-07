// Tax & Accounts — central accounting layer.
//
// This module is the single place that turns existing TixTracker records
// (orders, sales, overheads) into accounting figures. Nothing here duplicates
// those records — it only reads them and classifies/aggregates. Any UI or
// export that needs a financial total should go through this file so Tax &
// Accounts never disagrees with itself about what a number means.
//
// Two rules that drove every decision below (from direct product feedback
// after reviewing this against real data):
//   1. Archived does NOT mean excluded from tax. The Active/Archived split is
//      a Ticket Desk operational concept only — the accounting queries below
//      never filter on it except to separately flag unresolved archived stock.
//   2. Event date is never used to decide which tax year a transaction
//      belongs to. Only actual purchase/sale/payout dates are used, and which
//      one is authoritative for "income" depends on the configured accounting
//      basis (see resolveIncomeDate below).
import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessStructure = "sole_trader" | "limited_company";
export type AccountingBasis = "cash" | "traditional";

// ─── Period resolution ──────────────────────────────────────────────────────────

export type PeriodKind =
  | "uk_tax_year"
  | "company_fy"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "year_to_date"
  | "custom";

export type PeriodRange = {
  kind: PeriodKind;
  label: string;
  shortLabel: string;
  start: string; // ISO date, yyyy-mm-dd
  end: string; // ISO date, yyyy-mm-dd, inclusive
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDate(year: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex0, day));
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// UK tax year: 6 April Y to 5 April Y+1. offset 0 = current, 1 = previous, etc.
export function resolveUkTaxYear(now: Date, offset: number): PeriodRange {
  const aprilBoundary = utcDate(now.getUTCFullYear(), 3, 6);
  let startYear = now.getTime() >= aprilBoundary.getTime() ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  startYear -= offset;
  const start = utcDate(startYear, 3, 6);
  const end = utcDate(startYear + 1, 3, 5);
  const shortLabel = `${startYear}/${String(startYear + 1).slice(-2)}`;
  return {
    kind: "uk_tax_year",
    label: `${shortLabel} (${fmtDate(start)} – ${fmtDate(end)})`,
    shortLabel,
    start: toISODate(start),
    end: toISODate(end),
  };
}

// Company financial year, derived from the configured year-end date's month/day.
// offset 0 = the FY containing `now`, 1 = the one before that, etc.
export function resolveCompanyFinancialYear(yearEndDate: string, now: Date, offset: number): PeriodRange {
  const base = new Date(`${yearEndDate}T00:00:00Z`);
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const thisYearCandidate = utcDate(now.getUTCFullYear(), month, day);
  let endYear = now.getTime() <= thisYearCandidate.getTime() ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
  endYear -= offset;
  const end = utcDate(endYear, month, day);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  const shortLabel = `FY${String(start.getUTCFullYear()).slice(-2)}/${String(end.getUTCFullYear()).slice(-2)}`;
  return {
    kind: "company_fy",
    label: `${fmtDate(start)} – ${fmtDate(end)}`,
    shortLabel,
    start: toISODate(start),
    end: toISODate(end),
  };
}

export function resolvePresetPeriod(
  kind: "this_month" | "last_month" | "this_quarter",
  now: Date,
): PeriodRange {
  if (kind === "this_month") {
    const start = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const end = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 0);
    return { kind, label: "This Month", shortLabel: "This Month", start: toISODate(start), end: toISODate(end) };
  }
  if (kind === "last_month") {
    const start = utcDate(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const end = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 0);
    return { kind, label: "Last Month", shortLabel: "Last Month", start: toISODate(start), end: toISODate(end) };
  }
  const q = Math.floor(now.getUTCMonth() / 3);
  const start = utcDate(now.getUTCFullYear(), q * 3, 1);
  const end = utcDate(now.getUTCFullYear(), q * 3 + 3, 0);
  return { kind, label: "This Quarter", shortLabel: "This Quarter", start: toISODate(start), end: toISODate(end) };
}

export function resolveYearToDatePreset(
  businessStructure: BusinessStructure,
  companyYearEnd: string | null,
  now: Date,
): PeriodRange {
  const primary = resolvePrimaryPeriod(businessStructure, companyYearEnd, now, 0);
  return { kind: "year_to_date" as PeriodKind, label: "Year to Date", shortLabel: "YTD", start: primary.start, end: toISODate(now) };
}

export function resolveCustomPeriod(start: string, end: string): PeriodRange {
  return { kind: "custom", label: "Custom Range", shortLabel: "Custom", start, end };
}

// The "primary" accounting period type for a business structure — tax year
// for sole traders, company financial year for limited companies.
export function resolvePrimaryPeriod(
  businessStructure: BusinessStructure,
  companyYearEnd: string | null,
  now: Date,
  offset: number,
): PeriodRange {
  if (businessStructure === "limited_company" && companyYearEnd) {
    return resolveCompanyFinancialYear(companyYearEnd, now, offset);
  }
  return resolveUkTaxYear(now, offset);
}

// Named, real tax years for a selector — never "N periods ago". Newest first.
export function listPrimaryPeriods(
  businessStructure: BusinessStructure,
  companyYearEnd: string | null,
  now: Date,
  count: number,
): PeriodRange[] {
  return Array.from({ length: count }, (_, i) => resolvePrimaryPeriod(businessStructure, companyYearEnd, now, i));
}

// The UK Self Assessment filing deadline for the tax year that ENDED on
// `period.end` — 31 January following the end of the tax year. Only
// meaningful for sole traders; limited companies don't have this deadline on
// their trading accounts (they have Corporation Tax / Companies House
// deadlines instead, not modelled yet).
export function selfAssessmentDeadline(period: PeriodRange): string | null {
  if (period.kind !== "uk_tax_year") return null;
  const end = new Date(`${period.end}T00:00:00Z`);
  // Tax year end 5 April Y+1 → filing deadline 31 January Y+2.
  const deadlineYear = end.getUTCFullYear() + 1;
  return toISODate(utcDate(deadlineYear, 0, 31));
}

export function withinPeriod(dateStr: string | null | undefined, period: PeriodRange): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= period.start && d <= period.end;
}

// ─── Cost allocation ────────────────────────────────────────────────────────────
// Identical formula to the one already used in analytics-client.tsx,
// desk-client.tsx and orders-client.tsx (getProportionalCost) — reused here
// rather than reimplemented so Tax & Accounts never disagrees with the rest of
// the app about what an order's realised cost is. Only "Partially Sold" gets
// proportional treatment; "Sold" counts the full purchase cost (matching the
// existing convention), everything else (Unlisted/Listed) counts none of it yet.
export function getProportionalCost(
  totalCost: number | null,
  qtyBought: number | null,
  qtySold: number,
  status: string | null,
): number {
  const cost = totalCost ?? 0;
  if (status !== "Partially Sold" || (qtyBought ?? 0) <= 0 || qtySold <= 0) return cost;
  return Math.min(cost, (qtySold / qtyBought!) * cost);
}

// Cost attributable to a specific quantity of tickets from one order — used to
// allocate cost per individual sale event (finer-grained than the per-order
// figure above), matching the formula sales-client.tsx already uses per sale row.
function costForQty(totalCost: number | null, qtyBought: number | null, qty: number): number {
  if (!totalCost || !qtyBought || qtyBought <= 0 || qty <= 0) return 0;
  return (totalCost / qtyBought) * qty;
}

// "Ignored"/"Personal" are the only statuses that mean "not a business
// transaction at all" — everything else, Archived included, is real
// financial history and must be queried regardless of Ticket Desk state.
const NON_BUSINESS_STATUSES = new Set(["Ignored", "Personal"]);

function isPastEvent(eventDate: string | null, asOf: Date): boolean {
  if (!eventDate) return false;
  const cleaned = eventDate
    .replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/i, "")
    .replace(/\s*[•·\-]\s*\d{1,2}:\d{2}.*$/, "");
  const d = new Date(cleaned);
  return !isNaN(d.getTime()) && d < asOf;
}

// Which date recognises a sale as "income"? This is the single most important
// correctness decision in this file — it must never be the event date, and
// under Cash Basis it must be when cash actually landed, not when the item sold.
function resolveIncomeDate(
  basis: AccountingBasis,
  sale: { sold_at: string | null; payout_date: string | null },
): { date: string | null; basisForDate: "payout" | "sold" | "unknown" } {
  if (basis === "cash") {
    if (sale.payout_date) return { date: sale.payout_date, basisForDate: "payout" };
    // Cash hasn't landed yet — under cash basis this genuinely isn't income
    // yet. Returning null means it's excluded from every period until paid,
    // which is correct, not a bug. The caller surfaces this as "awaiting payout".
    return { date: null, basisForDate: "unknown" };
  }
  // Traditional accounting / limited company (accrual-style): recognise at
  // the transaction/sale date, falling back to payout date only if the sale
  // date itself is missing.
  if (sale.sold_at) return { date: sale.sold_at, basisForDate: "sold" };
  if (sale.payout_date) return { date: sale.payout_date, basisForDate: "payout" };
  return { date: null, basisForDate: "unknown" };
}

// ─── Data shapes ────────────────────────────────────────────────────────────────

type OrderRow = {
  id: number;
  booking_ref: string | null;
  event_name: string | null;
  venue: string | null;
  total_cost: number | null;
  qty_bought: number | null;
  listing_status: string | null;
  sold_total: number | null;
  purchased_at: string | null;
  created_at: string | null;
  event_date: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
};

type SaleRow = {
  id: number;
  inventory_order_id: number | null;
  qty_sold: number | null;
  sale_total: number | null;
  payout_total: number | null;
  sold_at: string | null;
  payout_date: string | null;
  currency: string | null;
};

export type OverviewFigures = {
  income: number;
  costOfSales: number;
  ticketPurchases: number; // alias of costOfSales, surfaced under the simpler "breakdown" grouping
  marketplaceFees: number;
  runningCosts: number; // overheads — the simpler label for "Other Business Expenses"
  refunds: number;
  estimatedProfit: number;
  unsoldInventoryCost: number;
  expiredUnsoldStockCost: number; // archived, event already happened, never sold — a write-off candidate, not current inventory
  cashReceived: number;
  pendingPayoutCount: number; // sales awaiting payout — not yet income under cash basis
  salesWithUnknownFees: number;
  recordCounts: { sales: number; purchases: number; expenses: number; payouts: number };
  refundsTrackedNote: string;
};

export async function computeOverview(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodRange,
  accountingBasis: AccountingBasis,
): Promise<OverviewFigures> {
  const [ordersRes, salesRes, overheadsRes] = await Promise.all([
    // No listing_status filter here at all — Archived must be queried exactly
    // like Active for accounting purposes. Only a true non-business status
    // (Ignored/Personal) is excluded, and that happens below in memory, not
    // in this query, so it's visible and auditable in one place.
    supabase
      .from("orders")
      .select("id, booking_ref, event_name, venue, total_cost, qty_bought, listing_status, sold_total, purchased_at, created_at, event_date, section, row, seat_from, seat_to")
      .eq("user_id", userId),
    supabase
      .from("sales")
      .select("id, inventory_order_id, qty_sold, sale_total, payout_total, sold_at, payout_date, currency")
      .eq("user_id", userId),
    supabase
      .from("overheads")
      .select("amount, billing_cycle, created_at")
      .eq("user_id", userId),
  ]);

  const orders = (ordersRes.data ?? []).filter(
    (o) => !NON_BUSINESS_STATUSES.has(o.listing_status ?? ""),
  ) as OrderRow[];
  const sales = (salesRes.data ?? []) as SaleRow[];
  const overheads = (overheadsRes.data ?? []) as { amount: number; billing_cycle: string; created_at: string }[];

  const salesByOrderId = new Map<number, SaleRow[]>();
  for (const s of sales) {
    if (s.inventory_order_id == null) continue;
    const list = salesByOrderId.get(s.inventory_order_id) ?? [];
    list.push(s);
    salesByOrderId.set(s.inventory_order_id, list);
  }

  let income = 0;
  let costOfSales = 0;
  let marketplaceFees = 0;
  let cashReceived = 0;
  let salesWithUnknownFees = 0;
  let pendingPayoutCount = 0;
  let salesCount = 0;
  let payoutsCount = 0;

  for (const order of orders) {
    const linkedSales = salesByOrderId.get(order.id) ?? [];

    if (linkedSales.length > 0) {
      for (const sale of linkedSales) {
        const { date: incomeDate, basisForDate } = resolveIncomeDate(accountingBasis, sale);
        if (basisForDate === "unknown" && accountingBasis === "cash") {
          pendingPayoutCount += 1; // not yet income anywhere — correct, not a gap
        }
        if (!withinPeriod(incomeDate, period)) continue;

        const qty = sale.qty_sold ?? 0;
        const gross = sale.sale_total ?? sale.payout_total ?? 0;
        income += gross;
        costOfSales += costForQty(order.total_cost, order.qty_bought, qty);
        salesCount += 1;

        if (sale.sale_total != null && sale.payout_total != null) {
          marketplaceFees += Math.max(0, sale.sale_total - sale.payout_total);
        } else {
          salesWithUnknownFees += 1;
        }

        if (withinPeriod(sale.payout_date, period) && sale.payout_total != null) {
          cashReceived += sale.payout_total;
          payoutsCount += 1;
        }
      }
    } else if ((order.sold_total ?? 0) > 0) {
      // Manually-recorded sale, no linked marketplace row — no payout_date
      // field exists for these at all, so under cash basis there's no
      // genuine "cash received" date to check. Approximated with purchase
      // date, same as analytics-client.tsx already does, but unlike that
      // page we flag it rather than treating it as known-good.
      const approxDate = order.purchased_at ?? order.created_at;
      if (withinPeriod(approxDate, period)) {
        income += order.sold_total ?? 0;
        costOfSales += getProportionalCost(order.total_cost, order.qty_bought, order.qty_bought ?? 0, order.listing_status);
        salesWithUnknownFees += 1;
        cashReceived += order.sold_total ?? 0;
        salesCount += 1;
      }
    }
  }

  // Inventory: split into "still sellable, unsold" vs "event already
  // happened, never sold" — the second is a write-off candidate, not current
  // stock, and must never be silently dropped just because the order is
  // Archived.
  let unsoldInventoryCost = 0;
  let expiredUnsoldStockCost = 0;
  const now = new Date();
  for (const order of orders) {
    const qtyBought = order.qty_bought ?? 0;
    if (qtyBought <= 0 || !order.total_cost) continue;

    const linkedSales = salesByOrderId.get(order.id) ?? [];
    const qtySoldToDate =
      linkedSales.length > 0
        ? linkedSales.reduce((sum, s) => sum + (s.qty_sold ?? 0), 0)
        : (order.sold_total ?? 0) > 0
          ? qtyBought
          : 0;

    const remainingQty = Math.max(0, qtyBought - qtySoldToDate);
    if (remainingQty <= 0) continue;
    const remainingCost = (order.total_cost / qtyBought) * remainingQty;

    if (isPastEvent(order.event_date, now)) {
      expiredUnsoldStockCost += remainingCost;
    } else {
      unsoldInventoryCost += remainingCost;
    }
  }

  // Running costs — overheads logged within the period. Each row is already
  // a discrete dated charge (including auto-added monthly rows), so this is
  // actual expenditure, never a monthly-equivalent or annual projection.
  const periodOverheads = overheads.filter((o) => withinPeriod(o.created_at, period));
  const runningCosts = periodOverheads.reduce((sum, o) => sum + (o.amount ?? 0), 0);

  const purchasesInPeriod = orders.filter((o) => withinPeriod(o.purchased_at ?? o.created_at, period)).length;

  // Refunds aren't captured anywhere yet — TixTracker's email scanner currently
  // skips refund/cancellation emails entirely (see SKIP_SUBJECT_PATTERNS in
  // gmail-sync.ts), so there's no data source for this figure.
  const refunds = 0;

  const estimatedProfit = income - costOfSales - marketplaceFees - runningCosts - refunds;

  return {
    income,
    costOfSales,
    ticketPurchases: costOfSales,
    marketplaceFees,
    runningCosts,
    refunds,
    estimatedProfit,
    unsoldInventoryCost,
    expiredUnsoldStockCost,
    cashReceived,
    pendingPayoutCount,
    salesWithUnknownFees,
    recordCounts: {
      sales: salesCount,
      purchases: purchasesInPeriod,
      expenses: periodOverheads.length,
      payouts: payoutsCount,
    },
    refundsTrackedNote:
      "Refunds aren't tracked yet — TixTracker's scanner currently ignores refund/cancellation emails. This will read as £0 until that's built.",
  };
}

// ─── Data quality / Accountant Readiness ───────────────────────────────────────
// Three severity tiers, weighted very differently — a missing receipt is not
// remotely as serious as a missing cost or an unknown transaction date, and
// the score must reflect that rather than treating every gap identically.

export type Severity = "critical" | "review" | "evidence";

export type DataQualityIssue = {
  severity: Severity;
  label: string;
  count: number;
  // Which order ids this issue refers to, so "Review Issues" can jump
  // straight to the exact records rather than making the user hunt.
  orderIds: number[];
};

export type DataQualityResult = {
  score: number;
  critical: DataQualityIssue[];
  review: DataQualityIssue[];
  evidence: DataQualityIssue[];
  totalChecked: number;
};

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, review: 3, evidence: 0.5 };

export async function computeDataQuality(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodRange,
): Promise<DataQualityResult> {
  const [ordersRes, salesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, booking_ref, event_name, venue, total_cost, qty_bought, listing_status, sold_total, purchased_at, created_at, event_date, section, row, seat_from, seat_to, email_html")
      .eq("user_id", userId),
    supabase
      .from("sales")
      .select("id, inventory_order_id, qty_sold, sale_total, payout_total, sold_at, payout_date")
      .eq("user_id", userId),
  ]);

  const allOrders = ((ordersRes.data ?? []) as (OrderRow & { email_html: string | null })[]).filter(
    (o) => !NON_BUSINESS_STATUSES.has(o.listing_status ?? ""),
  );
  const sales = (salesRes.data ?? []) as SaleRow[];

  const relevant = allOrders.filter((o) => withinPeriod(o.purchased_at ?? o.created_at, period));
  const salesByOrderId = new Map<number, SaleRow[]>();
  for (const s of sales) {
    if (s.inventory_order_id == null) continue;
    const list = salesByOrderId.get(s.inventory_order_id) ?? [];
    list.push(s);
    salesByOrderId.set(s.inventory_order_id, list);
  }

  const critical: DataQualityIssue[] = [];
  const review: DataQualityIssue[] = [];
  const evidence: DataQualityIssue[] = [];

  // ── Critical: these can change the totals ──────────────────────────────
  const missingCostIds = relevant.filter((o) => !o.total_cost && (o.qty_bought ?? 0) > 0).map((o) => o.id);
  if (missingCostIds.length > 0) {
    critical.push({ severity: "critical", label: `${missingCostIds.length} ticket purchase${missingCostIds.length === 1 ? "" : "s"} missing a cost`, count: missingCostIds.length, orderIds: missingCostIds });
  }

  const soldWithoutRevenueIds = relevant
    .filter((o) => {
      const isSold = o.listing_status === "Sold" || o.listing_status === "Partially Sold";
      const hasLinkedSale = (salesByOrderId.get(o.id) ?? []).length > 0;
      return isSold && !hasLinkedSale && !(o.sold_total && o.sold_total > 0);
    })
    .map((o) => o.id);
  if (soldWithoutRevenueIds.length > 0) {
    critical.push({ severity: "critical", label: `${soldWithoutRevenueIds.length} ticket${soldWithoutRevenueIds.length === 1 ? "" : "s"} marked Sold with no sale amount recorded`, count: soldWithoutRevenueIds.length, orderIds: soldWithoutRevenueIds });
  }

  const unknownDateIds = relevant
    .filter((o) => {
      const linked = salesByOrderId.get(o.id) ?? [];
      const hasManualSale = linked.length === 0 && (o.sold_total ?? 0) > 0;
      return hasManualSale; // no payout_date field exists for these at all
    })
    .map((o) => o.id);
  if (unknownDateIds.length > 0) {
    critical.push({ severity: "critical", label: `${unknownDateIds.length} sale${unknownDateIds.length === 1 ? "" : "s"} with no recorded sale/payout date (using purchase date as an approximation)`, count: unknownDateIds.length, orderIds: unknownDateIds });
  }

  // Suspicious values: £0 cost with quantity, or a near-zero sale amount on
  // something marked sold — these can materially distort totals either way.
  const suspiciousIds = relevant
    .filter((o) => {
      const zeroCostWithQty = (o.total_cost ?? 0) === 0 && (o.qty_bought ?? 0) > 0 && o.listing_status !== "Unlisted" && o.listing_status !== "Listed";
      const nearZeroSale = (o.sold_total ?? 0) > 0 && (o.sold_total ?? 0) <= 0.01;
      return zeroCostWithQty || nearZeroSale;
    })
    .map((o) => o.id);
  if (suspiciousIds.length > 0) {
    critical.push({ severity: "critical", label: `${suspiciousIds.length} transaction${suspiciousIds.length === 1 ? "" : "s"} with a suspicious £0/£0.01 value`, count: suspiciousIds.length, orderIds: suspiciousIds });
  }

  // ── Review: record exists but should be checked ────────────────────────
  const now = new Date();
  const expiredUnsoldIds = relevant
    .filter((o) => {
      const qtyBought = o.qty_bought ?? 0;
      if (qtyBought <= 0) return false;
      const linked = salesByOrderId.get(o.id) ?? [];
      const soldQty = linked.length > 0 ? linked.reduce((s, x) => s + (x.qty_sold ?? 0), 0) : (o.sold_total ?? 0) > 0 ? qtyBought : 0;
      return soldQty < qtyBought && isPastEvent(o.event_date, now);
    })
    .map((o) => o.id);
  if (expiredUnsoldIds.length > 0) {
    review.push({ severity: "review", label: `${expiredUnsoldIds.length} ticket${expiredUnsoldIds.length === 1 ? "" : "s"} never sold and the event has already happened — needs a decision (write off / refunded / personal use)`, count: expiredUnsoldIds.length, orderIds: expiredUnsoldIds });
  }

  // Possible duplicates — same event/venue/section/row/seats/cost but a
  // different booking ref. Never auto-merged, just surfaced for a look.
  const dupGroups = new Map<string, number[]>();
  for (const o of relevant) {
    const key = [o.event_name, o.venue, o.section, o.row, o.seat_from, o.seat_to, o.total_cost].join("|");
    const list = dupGroups.get(key) ?? [];
    list.push(o.id);
    dupGroups.set(key, list);
  }
  const duplicateIds: number[] = [];
  for (const ids of dupGroups.values()) {
    if (ids.length > 1) duplicateIds.push(...ids);
  }
  if (duplicateIds.length > 0) {
    review.push({ severity: "review", label: `${duplicateIds.length} purchase${duplicateIds.length === 1 ? "" : "s"} look like possible duplicates (same event/seats/cost, different reference) — please confirm`, count: duplicateIds.length, orderIds: duplicateIds });
  }

  // ── Evidence: financially fine, just no supporting document ────────────
  const missingEvidenceIds = relevant.filter((o) => !o.email_html).map((o) => o.id);
  if (missingEvidenceIds.length > 0) {
    evidence.push({ severity: "evidence", label: `${missingEvidenceIds.length} purchase${missingEvidenceIds.length === 1 ? "" : "s"} have no original email captured — fine for historic/imported records, mark reviewed if confirmed`, count: missingEvidenceIds.length, orderIds: missingEvidenceIds });
  }

  const allIssues = [...critical, ...review, ...evidence];
  const totalWeight = relevant.length * (SEVERITY_WEIGHT.critical + SEVERITY_WEIGHT.review + SEVERITY_WEIGHT.evidence);
  const failedWeight = allIssues.reduce((sum, i) => sum + i.count * SEVERITY_WEIGHT[i.severity], 0);
  const score = totalWeight > 0 ? Math.max(0, Math.round(((totalWeight - failedWeight) / totalWeight) * 100)) : 100;

  return { score, critical, review, evidence, totalChecked: relevant.length };
}
