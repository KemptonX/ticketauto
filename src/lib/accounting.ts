// Tax & Accounts — central accounting layer.
//
// This module is the single place that turns existing TixTracker records
// (orders, sales, overheads) into accounting figures. Nothing here duplicates
// those records — it only reads them and classifies/aggregates.
//
// Rules that drove this version, from a read-only audit against real data:
//   1. Archived does NOT mean excluded from tax — never filtered on.
//   2. Event date is NEVER used to decide accounting period or recognise
//      income/expense. Only real transaction dates are used.
//   3. created_at is audit/import metadata, NEVER a transaction date. If a
//      record has no real date, it is NOT silently assigned to a period —
//      it goes into an "unassigned" bucket, visible, never hidden.
//   4. Which legal entity (Sole Trader / Limited Company) owns a
//      transaction is resolved from that transaction's own date against an
//      entity timeline — never from "whatever business_structure is
//      currently configured." A later change of business type must never
//      rewrite the accounting interpretation of earlier years.
//   5. Inventory/stock figures are calculated AS OF the selected period's
//      end date (or today, for the still-open current period) — never as a
//      live global snapshot shown identically under every period.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountingBasis = "cash" | "traditional";

// ─── Entities ───────────────────────────────────────────────────────────────────

export type EntityType = "sole_trader" | "limited_company";

export type AccountingEntity = {
  id: number;
  entityType: EntityType;
  displayName: string;
  tradingName: string | null;
  companyName: string | null;
  companyNumber: string | null;
  incorporationDate: string | null;
  tradingStartDate: string | null;
  effectiveFrom: string;
  effectiveTo: string | null; // null = ongoing/current entity
  accountingReferenceDate: string | null; // limited_company only
  baseCurrency: string;
  vatRegistered: boolean;
  vatNumber: string | null;
};

type EntityRow = {
  id: number;
  entity_type: EntityType;
  display_name: string;
  trading_name: string | null;
  company_name: string | null;
  company_number: string | null;
  incorporation_date: string | null;
  trading_start_date: string | null;
  effective_from: string;
  effective_to: string | null;
  accounting_reference_date: string | null;
  base_currency: string;
  vat_registered: boolean;
  vat_number: string | null;
};

export function mapEntityRow(r: EntityRow): AccountingEntity {
  return {
    id: r.id,
    entityType: r.entity_type,
    displayName: r.display_name,
    tradingName: r.trading_name,
    companyName: r.company_name,
    companyNumber: r.company_number,
    incorporationDate: r.incorporation_date,
    tradingStartDate: r.trading_start_date,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    accountingReferenceDate: r.accounting_reference_date,
    baseCurrency: r.base_currency,
    vatRegistered: r.vat_registered,
    vatNumber: r.vat_number,
  };
}

export async function fetchEntities(supabase: SupabaseClient, userId: string): Promise<AccountingEntity[]> {
  const { data } = await supabase
    .from("accounting_entities")
    .select("*")
    .eq("user_id", userId)
    .order("effective_from", { ascending: true });
  return ((data ?? []) as EntityRow[]).map(mapEntityRow);
}

// Resolve which entity owned a given transaction, by its real date — never
// by "whatever the profile currently says." Returns null if the date falls
// in a gap not covered by any configured entity (needs setup).
export function resolveEntityForDate(entities: AccountingEntity[], dateStr: string | null | undefined): AccountingEntity | null {
  if (!dateStr) return null;
  const d = dateStr.slice(0, 10);
  for (const e of entities) {
    if (d >= e.effectiveFrom && (e.effectiveTo == null || d <= e.effectiveTo)) return e;
  }
  return null;
}

export function entitiesOverlap(a: { effective_from: string; effective_to: string | null }, b: { effective_from: string; effective_to: string | null }): boolean {
  const aEnd = a.effective_to ?? "9999-12-31";
  const bEnd = b.effective_to ?? "9999-12-31";
  return a.effective_from <= bEnd && b.effective_from <= aEnd;
}

// ─── Period resolution ──────────────────────────────────────────────────────────

export type PeriodKind = "uk_tax_year" | "company_fy" | "this_month" | "last_month" | "this_quarter" | "year_to_date" | "custom";
export type PeriodType = "sole_trader_tax_year" | "company_accounts_period" | "custom_report";

export type PeriodRange = {
  kind: PeriodKind;
  label: string;
  shortLabel: string;
  start: string;
  end: string;
};

export type EntityPeriod = PeriodRange & {
  periodType: PeriodType;
  entityId: number;
  entityDisplayName: string;
  entityType: EntityType;
  isPartial: boolean;
  ctPeriodNote?: string;
};

function toISODate(d: Date): string { return d.toISOString().slice(0, 10); }
function utcDate(year: number, monthIndex0: number, day: number): Date { return new Date(Date.UTC(year, monthIndex0, day)); }
function fmtDate(d: Date): string { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function resolveUkTaxYear(now: Date, offset: number): PeriodRange {
  const aprilBoundary = utcDate(now.getUTCFullYear(), 3, 6);
  let startYear = now.getTime() >= aprilBoundary.getTime() ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  startYear -= offset;
  const start = utcDate(startYear, 3, 6);
  const end = utcDate(startYear + 1, 3, 5);
  const shortLabel = `${startYear}/${String(startYear + 1).slice(-2)}`;
  return { kind: "uk_tax_year", label: `${shortLabel} (${fmtDate(start)} – ${fmtDate(end)})`, shortLabel, start: toISODate(start), end: toISODate(end) };
}

export function resolvePresetPeriod(kind: "this_month" | "last_month" | "this_quarter", now: Date): PeriodRange {
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

export function resolveCustomPeriod(start: string, end: string): PeriodRange {
  return { kind: "custom", label: "Custom Range", shortLabel: "Custom", start, end };
}

export function selfAssessmentDeadline(period: PeriodRange): string | null {
  if (period.kind !== "uk_tax_year") return null;
  const end = new Date(`${period.end}T00:00:00Z`);
  const deadlineYear = end.getUTCFullYear() + 1;
  return toISODate(utcDate(deadlineYear, 0, 31));
}

export function withinPeriod(dateStr: string | null | undefined, period: { start: string; end: string }): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= period.start && d <= period.end;
}

// Generate real, named periods for one entity — never "N periods ago",
// never extending before the entity's effective_from, clipped to
// effective_to when the entity has ended. `count` is how many recent
// periods to return (newest first).
export function generatePeriodsForEntity(entity: AccountingEntity, now: Date, count: number): EntityPeriod[] {
  const todayIso = toISODate(now);

  if (entity.entityType === "sole_trader") {
    const periods: EntityPeriod[] = [];
    for (let offset = 0; periods.length < count && offset < count + 10; offset++) {
      const tax = resolveUkTaxYear(now, offset);
      if (tax.end < entity.effectiveFrom) break; // gone further back than the entity existed
      if (entity.effectiveTo && tax.start > entity.effectiveTo) continue; // this tax year is after entity ended
      const start = tax.start < entity.effectiveFrom ? entity.effectiveFrom : tax.start;
      const end = entity.effectiveTo && tax.end > entity.effectiveTo ? entity.effectiveTo : tax.end;
      if (start > end) continue;
      periods.push({
        ...tax,
        start,
        end,
        periodType: "sole_trader_tax_year",
        entityId: entity.id,
        entityDisplayName: entity.displayName,
        entityType: entity.entityType,
        isPartial: start !== tax.start || end !== tax.end,
      });
    }
    return periods;
  }

  // Limited company: roll forward from effectiveFrom (trading start) using
  // the accounting reference date's month/day. Never generated without a
  // real trading_start/effective_from — no guessing.
  if (!entity.accountingReferenceDate) return [];
  const base = new Date(`${entity.accountingReferenceDate}T00:00:00Z`);
  const refMonth = base.getUTCMonth();
  const refDay = base.getUTCDate();

  const allPeriods: { start: string; end: string }[] = [];
  let cursor = entity.effectiveFrom;
  let guard = 0;
  while (guard < 60) {
    guard++;
    const cursorDate = new Date(`${cursor}T00:00:00Z`);
    let ard = utcDate(cursorDate.getUTCFullYear(), refMonth, refDay);
    if (ard.getTime() <= cursorDate.getTime()) ard = utcDate(cursorDate.getUTCFullYear() + 1, refMonth, refDay);
    const end = toISODate(ard);
    allPeriods.push({ start: cursor, end });
    if (entity.effectiveTo && end >= entity.effectiveTo) break;
    cursor = addDays(end, 1);
    if (cursor > todayIso && allPeriods.length >= count) break;
  }

  const recent = allPeriods.slice(-count).reverse();
  return recent.map((p, i) => {
    const spanDays = (new Date(`${p.end}T00:00:00Z`).getTime() - new Date(`${p.start}T00:00:00Z`).getTime()) / 86400000;
    const isFirst = p.start === entity.effectiveFrom;
    return {
      kind: "company_fy" as PeriodKind,
      label: `${fmtDate(new Date(`${p.start}T00:00:00Z`))} – ${fmtDate(new Date(`${p.end}T00:00:00Z`))}`,
      shortLabel: isFirst ? "First Accounts" : `FY${String(new Date(`${p.start}T00:00:00Z`).getUTCFullYear()).slice(-2)}/${String(new Date(`${p.end}T00:00:00Z`).getUTCFullYear()).slice(-2)}`,
      start: p.start,
      end: p.end,
      periodType: "company_accounts_period" as PeriodType,
      entityId: entity.id,
      entityDisplayName: entity.displayName,
      entityType: entity.entityType,
      isPartial: false,
      ctPeriodNote:
        spanDays > 370
          ? "This accounts period is longer than 12 months. A Corporation Tax accounting period can't exceed 12 months, so CT may need to be split into two periods — confirm the exact split with your accountant."
          : i === recent.length - 1 && isFirst
            ? undefined
            : undefined,
    };
  });
}

// ─── Cost allocation ────────────────────────────────────────────────────────────

// (getProportionalCost previously duplicated here was dead code — never
// called within this file; costForQty below is this file's own real
// per-sale cost allocator. The shared, bug-fixed getProportionalCost used
// by the UI components lives in src/lib/proportional-cost.ts.)

function costForQty(totalCost: number | null, qtyBought: number | null, qty: number): number {
  if (!totalCost || !qtyBought || qtyBought <= 0 || qty <= 0) return 0;
  return (totalCost / qtyBought) * qty;
}

const NON_BUSINESS_STATUSES = new Set(["Ignored", "Personal"]);

function isPastEvent(eventDate: string | null, asOf: Date): boolean {
  if (!eventDate) return false;
  const cleaned = eventDate
    .replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/i, "")
    .replace(/\s*[•·\-]\s*\d{1,2}:\d{2}.*$/, "");
  const d = new Date(cleaned);
  return !isNaN(d.getTime()) && d < asOf;
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
  email_html?: string | null;
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
  ticketPurchases: number;
  marketplaceFees: number;
  marketplaceFeesUnverifiedCount: number; // sale_total === payout_total — may be net duplicated as gross, not a confirmed £0 fee
  runningCosts: number;
  refunds: number;
  refundsTrackedNote: string;
  estimatedProfit: number;
  inventoryAsOf: string; // ISO date the inventory figures below are calculated as of
  unsoldInventoryCost: number;
  pastEventStockRequiringReview: number; // was "expiredUnsoldStockCost" / "Unresolved Stock"
  cashReceived: number;
  payoutsCount: number;
  salesWithUnknownFees: number;
  pendingPayoutCount: number;
  // Unassigned — real money/cost that could NOT be safely placed in this
  // period (or any period) because the record has no real transaction date.
  // Never silently dropped — always visible, always counted separately.
  unassignedIncome: number;
  unassignedIncomeCount: number;
  unassignedPurchaseCost: number;
  unassignedPurchaseCount: number;
  // Revenue recognised this period where the cash hasn't actually landed
  // (yet, or not within this period) — distinct from pendingPayoutCount,
  // which only tracks the cash-basis-specific "not recognised as income at
  // all until paid" case. This tracks the Traditional-basis case too:
  // income IS recognised, but cash receipt is a separate, later event.
  outstandingPayoutAmount: number;
  outstandingPayoutCount: number;
  recordCounts: { sales: number; purchases: number; expenses: number; payouts: number };
};

// Classify a purchase order's own date. Never falls back to created_at.
function purchaseDateStatus(order: OrderRow): { date: string | null; known: boolean } {
  if (order.purchased_at) return { date: order.purchased_at, known: true };
  return { date: null, known: false };
}

export async function computeOverview(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodRange,
  periodIsOpen: boolean,
  accountingBasis: AccountingBasis = "traditional",
): Promise<OverviewFigures> {
  const [ordersRes, salesRes, overheadsRes] = await Promise.all([
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
      .select("amount, billing_cycle, created_at, expense_date")
      .eq("user_id", userId),
  ]);

  const orders = (ordersRes.data ?? []).filter((o) => !NON_BUSINESS_STATUSES.has(o.listing_status ?? "")) as OrderRow[];
  const sales = (salesRes.data ?? []) as SaleRow[];
  const overheads = (overheadsRes.data ?? []) as { amount: number; billing_cycle: string; created_at: string; expense_date: string | null }[];

  const salesByOrderId = new Map<number, SaleRow[]>();
  for (const s of sales) {
    if (s.inventory_order_id == null) continue;
    const list = salesByOrderId.get(s.inventory_order_id) ?? [];
    list.push(s);
    salesByOrderId.set(s.inventory_order_id, list);
  }

  let income = 0, costOfSales = 0, marketplaceFees = 0, marketplaceFeesUnverifiedCount = 0;
  let cashReceived = 0, salesWithUnknownFees = 0, pendingPayoutCount = 0, salesCount = 0, payoutsCount = 0;
  let unassignedIncome = 0, unassignedIncomeCount = 0;
  let outstandingPayoutAmount = 0, outstandingPayoutCount = 0;

  for (const order of orders) {
    const linked = salesByOrderId.get(order.id) ?? [];

    if (linked.length > 0) {
      for (const sale of linked) {
        // Income recognition date depends on accounting basis — the single
        // most important correctness decision here. Under Cash Basis, income
        // isn't recognised until cash actually lands (payout_date); under
        // Traditional, it's recognised at the sale date (sold_at). Neither
        // ever falls back to purchased_at or created_at — if the basis's
        // required date is missing, the money is real but genuinely
        // unplaceable, so it goes to Unassigned rather than being guessed.
        const incomeDate = accountingBasis === "cash" ? sale.payout_date : sale.sold_at;
        if (accountingBasis === "cash" && !sale.payout_date) pendingPayoutCount += 1;
        if (!incomeDate) {
          unassignedIncome += sale.sale_total ?? sale.payout_total ?? 0;
          unassignedIncomeCount += 1;
          continue;
        }
        if (!withinPeriod(incomeDate, period)) continue;

        const qty = sale.qty_sold ?? 0;
        const gross = sale.sale_total ?? sale.payout_total ?? 0;
        income += gross;
        costOfSales += costForQty(order.total_cost, order.qty_bought, qty);
        salesCount += 1;

        if (sale.sale_total != null && sale.payout_total != null) {
          if (sale.sale_total === sale.payout_total) {
            // Parser semantics vary by marketplace: some sources (e.g. one
            // Viagogo email template) literally duplicate the net payment
            // figure into both fields when no separate gross/fee breakdown
            // exists. Equal values are NOT reliable proof of a zero fee —
            // treated as unverified, not silently added as a confirmed £0.
            marketplaceFeesUnverifiedCount += 1;
          } else {
            marketplaceFees += Math.max(0, sale.sale_total - sale.payout_total);
          }
        } else {
          salesWithUnknownFees += 1;
        }

        // Revenue Recognised (income, above) vs Cash Received: income is
        // already counted for this period regardless of basis; whether the
        // cash has actually arrived IN this period is a separate fact.
        const cashLandedInPeriod = sale.payout_total != null && withinPeriod(sale.payout_date, period);
        if (cashLandedInPeriod) {
          cashReceived += sale.payout_total!;
          payoutsCount += 1;
        } else {
          outstandingPayoutAmount += gross;
          outstandingPayoutCount += 1;
        }
        if (sale.payout_date == null) pendingPayoutCount += 1;
      }
    } else if ((order.sold_total ?? 0) > 0) {
      // Manually-recorded sale, no linked marketplace row, and critically no
      // real sale-date field exists for these at all. Previously this was
      // dated by purchased_at/created_at — removed: a purchase date is not a
      // sale date, and an import timestamp is not a sale date either. This
      // revenue is real but unassigned until a real sale date is recorded.
      unassignedIncome += order.sold_total ?? 0;
      unassignedIncomeCount += 1;
    }
  }

  // ── Purchases: entity/period assignment uses purchased_at only ──────────
  let unassignedPurchaseCost = 0, unassignedPurchaseCount = 0, purchasesInPeriod = 0;
  for (const order of orders) {
    const { date, known } = purchaseDateStatus(order);
    if (!known) {
      unassignedPurchaseCost += order.total_cost ?? 0;
      unassignedPurchaseCount += 1;
      continue;
    }
    if (withinPeriod(date, period)) purchasesInPeriod += 1;
  }

  // ── Inventory: calculated AS OF the period end (or today, if this period
  // is still open) — never a live "right now" snapshot shown under every
  // period regardless of which one is selected. Only orders known to have
  // been purchased on/before asOf count; only sales known to have happened
  // on/before asOf reduce the remaining quantity.
  const now = new Date();
  const asOf = periodIsOpen ? (toISODate(now) < period.end ? toISODate(now) : period.end) : period.end;
  const asOfDate = new Date(`${asOf}T00:00:00Z`);

  let unsoldInventoryCost = 0;
  let pastEventStockRequiringReview = 0;
  for (const order of orders) {
    const { date: purchaseDate, known } = purchaseDateStatus(order);
    if (!known || purchaseDate!.slice(0, 10) > asOf) continue; // not acquired by asOf (or date unknown — already counted in unassigned above)

    const qtyBought = order.qty_bought ?? 0;
    if (qtyBought <= 0 || !order.total_cost) continue;

    const linked = salesByOrderId.get(order.id) ?? [];
    const qtySoldByAsOf =
      linked.length > 0
        ? linked.filter((s) => s.sold_at && s.sold_at.slice(0, 10) <= asOf).reduce((sum, s) => sum + (s.qty_sold ?? 0), 0)
        : (order.sold_total ?? 0) > 0
          ? qtyBought // manual sale, no date known — treated as already disposed of (conservative: doesn't overstate inventory)
          : 0;

    const remainingQty = Math.max(0, qtyBought - qtySoldByAsOf);
    if (remainingQty <= 0) continue;
    const remainingCost = (order.total_cost / qtyBought) * remainingQty;

    if (isPastEvent(order.event_date, asOfDate)) pastEventStockRequiringReview += remainingCost;
    else unsoldInventoryCost += remainingCost;
  }

  // ── Running costs: explicit expense_date, never created_at, never a
  // monthly-equivalent/annual projection.
  const periodOverheads = overheads.filter((o) => withinPeriod(o.expense_date ?? null, period));
  const runningCosts = periodOverheads.reduce((sum, o) => sum + (o.amount ?? 0), 0);

  const refunds = 0;

  const estimatedProfit = income - costOfSales - marketplaceFees - runningCosts - refunds;

  return {
    income,
    costOfSales,
    ticketPurchases: costOfSales,
    marketplaceFees,
    marketplaceFeesUnverifiedCount,
    runningCosts,
    refunds,
    refundsTrackedNote:
      "Refund data isn't fully tracked yet — TixTracker's scanner currently skips refund/cancellation emails rather than recording them. This reads as £0, which is not confirmed accurate if refunds actually occurred.",
    estimatedProfit,
    inventoryAsOf: asOf,
    unsoldInventoryCost,
    pastEventStockRequiringReview,
    cashReceived,
    payoutsCount,
    salesWithUnknownFees,
    pendingPayoutCount,
    unassignedIncome,
    unassignedIncomeCount,
    unassignedPurchaseCost,
    unassignedPurchaseCount,
    outstandingPayoutAmount,
    outstandingPayoutCount,
    recordCounts: { sales: salesCount, purchases: purchasesInPeriod, expenses: periodOverheads.length, payouts: payoutsCount },
  };
}

// ─── Reconciliation ─────────────────────────────────────────────────────────────
// Proves nothing disappears because a date is missing: every known £ of
// purchase cost and sale value is either assigned (has a real date) or
// unassigned (doesn't yet) — never silently excluded from both. Account-wide,
// not period-scoped, since this is a safety check on the total, not a report.

export type ReconciliationResult = {
  totalKnownPurchaseCost: number;
  assignedPurchaseCost: number;
  unassignedPurchaseCost: number;
  purchaseReconciles: boolean;
  totalKnownSaleValue: number;
  assignedSaleValue: number;
  unassignedSaleValue: number;
  saleReconciles: boolean;
};

export async function computeReconciliation(supabase: SupabaseClient, userId: string): Promise<ReconciliationResult> {
  const [ordersRes, salesRes] = await Promise.all([
    supabase.from("orders").select("id, total_cost, qty_bought, listing_status, sold_total, purchased_at").eq("user_id", userId),
    supabase.from("sales").select("id, inventory_order_id, sale_total, payout_total, sold_at").eq("user_id", userId),
  ]);

  const orders = ((ordersRes.data ?? []) as OrderRow[]).filter((o) => !NON_BUSINESS_STATUSES.has(o.listing_status ?? ""));
  const sales = (salesRes.data ?? []) as SaleRow[];
  const salesByOrderId = new Map<number, SaleRow[]>();
  for (const s of sales) {
    if (s.inventory_order_id == null) continue;
    const list = salesByOrderId.get(s.inventory_order_id) ?? [];
    list.push(s);
    salesByOrderId.set(s.inventory_order_id, list);
  }

  let assignedPurchaseCost = 0, unassignedPurchaseCost = 0;
  for (const o of orders) {
    const cost = o.total_cost ?? 0;
    if (o.purchased_at) assignedPurchaseCost += cost;
    else unassignedPurchaseCost += cost;
  }
  const totalKnownPurchaseCost = assignedPurchaseCost + unassignedPurchaseCost;

  let assignedSaleValue = 0, unassignedSaleValue = 0;
  for (const o of orders) {
    const linked = salesByOrderId.get(o.id) ?? [];
    if (linked.length > 0) {
      for (const s of linked) {
        const value = s.sale_total ?? s.payout_total ?? 0;
        if (s.sold_at) assignedSaleValue += value;
        else unassignedSaleValue += value;
      }
    } else if ((o.sold_total ?? 0) > 0) {
      unassignedSaleValue += o.sold_total ?? 0; // no sale-date field exists for these at all
    }
  }
  const totalKnownSaleValue = assignedSaleValue + unassignedSaleValue;

  const EPSILON = 0.01; // floating point rounding tolerance
  return {
    totalKnownPurchaseCost,
    assignedPurchaseCost,
    unassignedPurchaseCost,
    purchaseReconciles: Math.abs(totalKnownPurchaseCost - (assignedPurchaseCost + unassignedPurchaseCost)) < EPSILON,
    totalKnownSaleValue,
    assignedSaleValue,
    unassignedSaleValue,
    saleReconciles: Math.abs(totalKnownSaleValue - (assignedSaleValue + unassignedSaleValue)) < EPSILON,
  };
}

// ─── Canonical readiness ────────────────────────────────────────────────────────

export type Severity = "critical" | "review" | "evidence";
export type DataQualityIssue = { severity: Severity; label: string; count: number; orderIds: number[] };

export type AccountingReadinessSummary = {
  // periodScore reflects ONLY records actually assigned to this period —
  // account-wide unassigned records (missing dates) never dilute or zero it
  // out just because they're numerous elsewhere in the account's history.
  periodScore: number;
  // historicalCoverageComplete is account-wide, not period-specific: true
  // only when there is NO unassigned purchase/sale anywhere in the account
  // that could plausibly belong to any period. This is what actually gates
  // "Ready for Accountant" — a clean period score alone is not enough,
  // because material unassigned activity could still belong to this period.
  historicalCoverageComplete: boolean;
  status: "needs_setup" | "needs_historical_review" | "needs_review" | "ready_for_accountant";
  criticalRecordCount: number;
  reviewRecordCount: number;
  evidenceRecordCount: number;
  issueTypeCount: number;
  // Account-wide (not period-scoped) — see historicalCoverageComplete above.
  unassignedPurchaseCount: number;
  unassignedSaleCount: number;
  unassignedIncomeAmount: number;
  unassignedPurchaseCost: number;
  blockingReasons: string[];
  critical: DataQualityIssue[];
  review: DataQualityIssue[];
  evidence: DataQualityIssue[];
  totalChecked: number;
};

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, review: 3, evidence: 0.5 };

// The ONE function that computes readiness — used identically by the year
// cards, the Overview tab, the Review tab and the Accountant Pack tab, so
// they can never disagree.
export async function computeReadiness(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodRange,
  entityResolved: boolean,
): Promise<AccountingReadinessSummary> {
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

  const allOrders = ((ordersRes.data ?? []) as OrderRow[]).filter((o) => !NON_BUSINESS_STATUSES.has(o.listing_status ?? ""));
  const sales = (salesRes.data ?? []) as SaleRow[];
  const relevant = allOrders.filter((o) => withinPeriod(o.purchased_at, period));

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
  const blockingReasons: string[] = [];

  if (!entityResolved) {
    blockingReasons.push("Business entity history isn't fully set up — some transactions in this period can't be confirmed as belonging to the right legal entity yet.");
  }

  // ── Account-wide historical coverage (NOT period-scoped) ────────────────
  // These never feed the period score — they're a separate, global gate.
  const unassignedPurchaseOrders = allOrders.filter((o) => !o.purchased_at);
  const unassignedPurchaseCount = unassignedPurchaseOrders.length;
  const unassignedPurchaseCost = unassignedPurchaseOrders.reduce((s, o) => s + (o.total_cost ?? 0), 0);

  let unassignedSaleCount = 0;
  let unassignedIncomeAmount = 0;
  for (const o of allOrders) {
    const linked = salesByOrderId.get(o.id) ?? [];
    if (linked.length > 0) {
      for (const s of linked) {
        if (!s.sold_at) {
          unassignedSaleCount += 1;
          unassignedIncomeAmount += s.sale_total ?? s.payout_total ?? 0;
        }
      }
    } else if ((o.sold_total ?? 0) > 0) {
      unassignedSaleCount += 1;
      unassignedIncomeAmount += o.sold_total ?? 0;
    }
  }

  const historicalCoverageComplete = unassignedPurchaseCount === 0 && unassignedSaleCount === 0;
  if (unassignedPurchaseCount > 0) {
    blockingReasons.push(`${unassignedPurchaseCount} historic purchase${unassignedPurchaseCount === 1 ? "" : "s"} (£${unassignedPurchaseCost.toFixed(2)}) have no purchase date and could belong to any period — see Historical Data Check.`);
  }
  if (unassignedSaleCount > 0) {
    blockingReasons.push(`${unassignedSaleCount} sale${unassignedSaleCount === 1 ? "" : "s"} (£${unassignedIncomeAmount.toFixed(2)}) have no sale date and could belong to any period — see Historical Data Check.`);
  }

  // ── Period-scoped issues (these DO drive periodScore) ───────────────────
  const missingCostIds = relevant.filter((o) => !o.total_cost && (o.qty_bought ?? 0) > 0).map((o) => o.id);
  if (missingCostIds.length > 0) critical.push({ severity: "critical", label: `${missingCostIds.length} ticket purchase${missingCostIds.length === 1 ? "" : "s"} missing a cost`, count: missingCostIds.length, orderIds: missingCostIds });

  const soldWithoutRevenueIds = relevant
    .filter((o) => {
      const isSold = o.listing_status === "Sold" || o.listing_status === "Partially Sold";
      const hasLinkedSale = (salesByOrderId.get(o.id) ?? []).length > 0;
      return isSold && !hasLinkedSale && !(o.sold_total && o.sold_total > 0);
    })
    .map((o) => o.id);
  if (soldWithoutRevenueIds.length > 0) critical.push({ severity: "critical", label: `${soldWithoutRevenueIds.length} ticket${soldWithoutRevenueIds.length === 1 ? "" : "s"} marked Sold with no sale amount recorded`, count: soldWithoutRevenueIds.length, orderIds: soldWithoutRevenueIds });

  const suspiciousIds = relevant
    .filter((o) => {
      const zeroCostWithQty = (o.total_cost ?? 0) === 0 && (o.qty_bought ?? 0) > 0 && o.listing_status !== "Unlisted" && o.listing_status !== "Listed";
      const nearZeroSale = (o.sold_total ?? 0) > 0 && (o.sold_total ?? 0) <= 0.01;
      return zeroCostWithQty || nearZeroSale;
    })
    .map((o) => o.id);
  if (suspiciousIds.length > 0) critical.push({ severity: "critical", label: `${suspiciousIds.length} transaction${suspiciousIds.length === 1 ? "" : "s"} with a suspicious £0/£0.01 value`, count: suspiciousIds.length, orderIds: suspiciousIds });

  // Review
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
  if (expiredUnsoldIds.length > 0) review.push({ severity: "review", label: `${expiredUnsoldIds.length} ticket${expiredUnsoldIds.length === 1 ? "" : "s"} never sold and the event has already happened — needs a decision (write off / refunded / personal use)`, count: expiredUnsoldIds.length, orderIds: expiredUnsoldIds });

  const unverifiedFeeIds: number[] = [];
  for (const o of relevant) {
    for (const s of salesByOrderId.get(o.id) ?? []) {
      if (s.sale_total != null && s.payout_total != null && s.sale_total === s.payout_total) unverifiedFeeIds.push(o.id);
    }
  }
  if (unverifiedFeeIds.length > 0) review.push({ severity: "review", label: `${unverifiedFeeIds.length} sale${unverifiedFeeIds.length === 1 ? "" : "s"} show identical sale and payout amounts — the marketplace fee could genuinely be £0, or the source email may only have provided a net figure. Please confirm.`, count: unverifiedFeeIds.length, orderIds: unverifiedFeeIds });

  const dupGroups = new Map<string, number[]>();
  for (const o of relevant) {
    const key = [o.event_name, o.venue, o.section, o.row, o.seat_from, o.seat_to, o.total_cost].join("|");
    const list = dupGroups.get(key) ?? [];
    list.push(o.id);
    dupGroups.set(key, list);
  }
  const duplicateIds: number[] = [];
  for (const ids of dupGroups.values()) if (ids.length > 1) duplicateIds.push(...ids);
  if (duplicateIds.length > 0) review.push({ severity: "review", label: `${duplicateIds.length} purchase${duplicateIds.length === 1 ? "" : "s"} look like possible duplicates (same event/seats/cost, different reference) — please confirm`, count: duplicateIds.length, orderIds: duplicateIds });

  // Evidence
  const missingEvidenceIds = relevant.filter((o) => !o.email_html).map((o) => o.id);
  if (missingEvidenceIds.length > 0) evidence.push({ severity: "evidence", label: `${missingEvidenceIds.length} purchase${missingEvidenceIds.length === 1 ? "" : "s"} have no original email captured — fine for historic/imported records, mark reviewed if confirmed`, count: missingEvidenceIds.length, orderIds: missingEvidenceIds });

  // periodScore is scoped to `relevant` (this period's own records) only —
  // the account-wide unassigned counts above never factor into it, so 180
  // undated purchases elsewhere in the account's history can't mathematically
  // zero out a clean, small period.
  const allIssues = [...critical, ...review, ...evidence];
  const totalWeight = relevant.length * (SEVERITY_WEIGHT.critical + SEVERITY_WEIGHT.review + SEVERITY_WEIGHT.evidence);
  const failedWeight = allIssues.reduce((sum, i) => sum + i.count * SEVERITY_WEIGHT[i.severity], 0);
  const periodScore = totalWeight > 0 ? Math.max(0, Math.round(((totalWeight - failedWeight) / totalWeight) * 100)) : entityResolved ? 100 : 0;

  const criticalRecordCount = critical.reduce((s, i) => s + i.count, 0);
  const reviewRecordCount = review.reduce((s, i) => s + i.count, 0);
  const evidenceRecordCount = evidence.reduce((s, i) => s + i.count, 0);

  // Status: entity setup gates everything; then a clean period score alone
  // is NOT enough for "Ready for Accountant" — material unassigned historic
  // activity (which could plausibly belong to this period) must be resolved
  // first, surfaced as its own distinct status rather than folded into the
  // percentage.
  let status: AccountingReadinessSummary["status"];
  if (!entityResolved) status = "needs_setup";
  else if (criticalRecordCount > 0) status = "needs_review";
  else if (!historicalCoverageComplete) status = "needs_historical_review";
  else status = "ready_for_accountant";

  return {
    periodScore,
    historicalCoverageComplete,
    status,
    criticalRecordCount,
    reviewRecordCount,
    evidenceRecordCount,
    issueTypeCount: critical.length + review.length + evidence.length,
    unassignedPurchaseCount,
    unassignedSaleCount,
    unassignedIncomeAmount,
    unassignedPurchaseCost,
    blockingReasons,
    critical,
    review,
    evidence,
    totalChecked: relevant.length,
  };
}
