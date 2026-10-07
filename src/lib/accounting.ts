// Tax & Accounts — central accounting layer.
//
// This module is the single place that turns existing TixTracker records
// (orders, sales, overheads) into accounting figures. Nothing here duplicates
// those records — it only reads them and classifies/aggregates. Any UI or
// export that needs a financial total should go through this file so Tax &
// Accounts never disagrees with itself about what a number means.
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Period resolution ──────────────────────────────────────────────────────────

export type PeriodKind =
  | "uk_tax_year"
  | "company_fy"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "year_to_date"
  | "previous_accounting_year"
  | "custom";

export type PeriodRange = {
  kind: PeriodKind;
  label: string;
  start: string; // ISO date, yyyy-mm-dd
  end: string; // ISO date, yyyy-mm-dd, inclusive
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDate(year: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex0, day));
}

// UK tax year: 6 April Y to 5 April Y+1. offset 0 = current, 1 = previous, etc.
export function resolveUkTaxYear(now: Date, offset: number): PeriodRange {
  const aprilBoundary = utcDate(now.getUTCFullYear(), 3, 6);
  let startYear = now.getTime() >= aprilBoundary.getTime() ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  startYear -= offset;
  const start = utcDate(startYear, 3, 6);
  const end = utcDate(startYear + 1, 3, 5);
  return {
    kind: "uk_tax_year",
    label: `${startYear}/${String(startYear + 1).slice(-2)}`,
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
  return {
    kind: "company_fy",
    label: `FY ending ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
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
    return { kind, label: "This Month", start: toISODate(start), end: toISODate(end) };
  }
  if (kind === "last_month") {
    const start = utcDate(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const end = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 0);
    return { kind, label: "Last Month", start: toISODate(start), end: toISODate(end) };
  }
  const q = Math.floor(now.getUTCMonth() / 3);
  const start = utcDate(now.getUTCFullYear(), q * 3, 1);
  const end = utcDate(now.getUTCFullYear(), q * 3 + 3, 0);
  return { kind, label: "This Quarter", start: toISODate(start), end: toISODate(end) };
}

export function resolveCustomPeriod(start: string, end: string): PeriodRange {
  return { kind: "custom", label: "Custom Range", start, end };
}

// The "primary" period type for a business structure — tax year for sole
// traders, company financial year for limited companies. Used by Year-to-date
// (start of the currently-active primary period → today) and Previous
// accounting year (offset 1 of the primary period).
export function resolvePrimaryPeriod(
  businessStructure: "sole_trader" | "limited_company",
  companyYearEnd: string | null,
  now: Date,
  offset: number,
): PeriodRange {
  if (businessStructure === "limited_company" && companyYearEnd) {
    return resolveCompanyFinancialYear(companyYearEnd, now, offset);
  }
  return resolveUkTaxYear(now, offset);
}

export function resolveYearToDate(
  businessStructure: "sole_trader" | "limited_company",
  companyYearEnd: string | null,
  now: Date,
): PeriodRange {
  const primary = resolvePrimaryPeriod(businessStructure, companyYearEnd, now, 0);
  return { kind: "year_to_date", label: "Year to Date", start: primary.start, end: toISODate(now) };
}

// Recent tax-year options for a period-selector dropdown, newest first.
export function listRecentUkTaxYears(now: Date, count: number): PeriodRange[] {
  return Array.from({ length: count }, (_, i) => resolveUkTaxYear(now, i));
}

export function listRecentCompanyYears(yearEndDate: string, now: Date, count: number): PeriodRange[] {
  return Array.from({ length: count }, (_, i) => resolveCompanyFinancialYear(yearEndDate, now, i));
}

function withinPeriod(dateStr: string | null | undefined, period: PeriodRange): boolean {
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

const EXCLUDED_STATUSES = new Set(["Ignored", "Personal"]);

// ─── Data shapes ────────────────────────────────────────────────────────────────

type OrderRow = {
  id: number;
  total_cost: number | null;
  qty_bought: number | null;
  listing_status: string | null;
  sold_total: number | null;
  purchased_at: string | null;
  created_at: string | null;
  event_date: string | null;
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
  grossSales: number;
  costOfSales: number;
  marketplaceFees: number;
  otherExpenses: number;
  refunds: number;
  netTradingProfit: number;
  unsoldInventoryCost: number;
  cashReceived: number;
  // Transparency flags — never silently invent a figure.
  salesWithUnknownFees: number;
  refundsTrackedNote: string;
};

export type ReadinessIssue = { label: string; count: number };
export type ReadinessResult = { score: number; issues: ReadinessIssue[]; totalChecked: number };

// A real, data-driven readiness score — not a fixed/fake number. Only checks
// things this phase can actually know about (cost + evidence coverage on
// purchases in the period). More checks (reconciliation, VAT classification,
// missing documents) get added as those features land, which will make this
// score more complete over time rather than ever less honest.
export async function computeReadiness(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodRange,
): Promise<ReadinessResult> {
  const { data } = await supabase
    .from("orders")
    .select("id, listing_status, total_cost, email_html, purchased_at, created_at")
    .eq("user_id", userId);

  const orders = (data ?? []) as Array<{
    id: number;
    listing_status: string | null;
    total_cost: number | null;
    email_html: string | null;
    purchased_at: string | null;
    created_at: string | null;
  }>;

  const relevant = orders.filter(
    (o) => !EXCLUDED_STATUSES.has(o.listing_status ?? "") && withinPeriod(o.purchased_at ?? o.created_at, period),
  );

  let missingCost = 0;
  let missingEvidence = 0;
  for (const o of relevant) {
    if (!o.total_cost) missingCost += 1;
    if (!o.email_html) missingEvidence += 1;
  }

  const checks = relevant.length * 2;
  const failed = missingCost + missingEvidence;
  const score = checks > 0 ? Math.round(((checks - failed) / checks) * 100) : 100;

  const issues: ReadinessIssue[] = [];
  if (missingCost > 0) {
    issues.push({ label: `${missingCost} purchase${missingCost === 1 ? "" : "s"} missing a cost value`, count: missingCost });
  }
  if (missingEvidence > 0) {
    issues.push({
      label: `${missingEvidence} purchase${missingEvidence === 1 ? "" : "s"} with no captured evidence (email)`,
      count: missingEvidence,
    });
  }

  return { score, issues, totalChecked: relevant.length };
}

export async function computeOverview(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodRange,
): Promise<OverviewFigures> {
  const [ordersRes, salesRes, overheadsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, total_cost, qty_bought, listing_status, sold_total, purchased_at, created_at, event_date")
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

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const sales = (salesRes.data ?? []) as SaleRow[];
  const overheads = (overheadsRes.data ?? []) as { amount: number; billing_cycle: string; created_at: string }[];

  const salesByOrderId = new Map<number, SaleRow[]>();
  for (const s of sales) {
    if (s.inventory_order_id == null) continue;
    const list = salesByOrderId.get(s.inventory_order_id) ?? [];
    list.push(s);
    salesByOrderId.set(s.inventory_order_id, list);
  }

  let grossSales = 0;
  let costOfSales = 0;
  let marketplaceFees = 0;
  let cashReceived = 0;
  let salesWithUnknownFees = 0;

  for (const order of orders) {
    if (EXCLUDED_STATUSES.has(order.listing_status ?? "")) continue;
    const linkedSales = salesByOrderId.get(order.id) ?? [];

    if (linkedSales.length > 0) {
      // Each marketplace sale is its own ledger entry, dated by when it sold.
      for (const sale of linkedSales) {
        const saleDate = sale.sold_at ?? order.purchased_at;
        if (!withinPeriod(saleDate, period)) continue;

        const qty = sale.qty_sold ?? 0;
        const gross = sale.sale_total ?? sale.payout_total ?? 0;
        grossSales += gross;
        costOfSales += costForQty(order.total_cost, order.qty_bought, qty);

        if (sale.sale_total != null && sale.payout_total != null) {
          marketplaceFees += Math.max(0, sale.sale_total - sale.payout_total);
        } else {
          // Only a net (payout) figure is known — fee can't be derived, so it's
          // left out of Marketplace Fees entirely rather than guessed at.
          salesWithUnknownFees += 1;
        }

        const payoutDate = sale.payout_date ?? saleDate;
        if (withinPeriod(payoutDate, period) && sale.payout_total != null) {
          cashReceived += sale.payout_total;
        }
      }
    } else if ((order.sold_total ?? 0) > 0) {
      // No linked marketplace sale row — a manually-recorded sale with no fee
      // breakdown available. Treated as net = gross (fee unknown), dated by the
      // best date we have (purchase date — same fallback analytics-client.tsx uses).
      const saleDate = order.purchased_at ?? order.created_at;
      if (withinPeriod(saleDate, period)) {
        grossSales += order.sold_total ?? 0;
        costOfSales += getProportionalCost(
          order.total_cost,
          order.qty_bought,
          order.qty_bought ?? 0,
          order.listing_status,
        );
        salesWithUnknownFees += 1;
        cashReceived += order.sold_total ?? 0;
      }
    }
  }

  // Unsold inventory: point-in-time snapshot as of the period end, using all
  // known sales to date (not just sales within the period) — an order bought
  // two years ago and still unsold today is still unsold inventory now.
  let unsoldInventoryCost = 0;
  for (const order of orders) {
    if (EXCLUDED_STATUSES.has(order.listing_status ?? "") || order.listing_status === "Archived") continue;
    const qtyBought = order.qty_bought ?? 0;
    if (qtyBought <= 0 || !order.total_cost) continue;

    const linkedSales = salesByOrderId.get(order.id) ?? [];
    const qtySoldToDate =
      linkedSales.length > 0
        ? linkedSales.reduce((sum, s) => sum + (s.qty_sold ?? 0), 0)
        : (order.sold_total ?? 0) > 0
          ? qtyBought // treated as fully sold, matching getProportionalCost's "Sold" convention
          : 0;

    const remainingQty = Math.max(0, qtyBought - qtySoldToDate);
    if (remainingQty > 0) {
      unsoldInventoryCost += (order.total_cost / qtyBought) * remainingQty;
    }
  }

  // Other business expenses — overheads logged within the period. Each overhead
  // row is already a discrete dated charge (including auto-added monthly rows),
  // so no proration is needed.
  const otherExpenses = overheads
    .filter((o) => withinPeriod(o.created_at, period))
    .reduce((sum, o) => sum + (o.amount ?? 0), 0);

  // Refunds aren't captured anywhere yet — TixTracker's email scanner currently
  // skips refund/cancellation emails entirely (see SKIP_SUBJECT_PATTERNS in
  // gmail-sync.ts), so there's no data source for this figure. Reported as 0
  // with an explicit note rather than silently implying it's been checked.
  const refunds = 0;

  const netTradingProfit = grossSales - costOfSales - marketplaceFees - otherExpenses - refunds;

  return {
    grossSales,
    costOfSales,
    marketplaceFees,
    otherExpenses,
    refunds,
    netTradingProfit,
    unsoldInventoryCost,
    cashReceived,
    salesWithUnknownFees,
    refundsTrackedNote:
      "Refunds aren't tracked yet — TixTracker's scanner currently ignores refund/cancellation emails. This will read as £0 until that's built.",
  };
}
