// Spreadsheet-import validation/classification engine.
//
// Neither existing import flow (app/settings/settings-client.tsx's ticket
// importer, app/sales/SalesImportModal.tsx's sales importer) validated
// anything before writing to the database — rows were inserted straight
// through, with only a handful of post-insert DB errors ever surfacing.
// That is how a bad spreadsheet (wrong quantities, duplicate rows, a
// purchase-cost column accidentally mapped as a sale price, amounts in the
// wrong currency) can silently become bad data — plausibly including the
// 305 pre-existing oversold orders flagged by the pre-launch audit.
//
// This module classifies each row as "error" (cannot be imported until
// corrected), "warning" (unusual — needs explicit confirmation), or
// implicitly "valid" (no issues), with a plain-English message per issue.
// It never silently corrects, defaults, or drops a value — every check
// only ever reports a problem; the caller decides what to do about it.

export type IssueSeverity = "error" | "warning";

export type ImportIssue = {
  field?: string;
  severity: IssueSeverity;
  code: string;
  message: string;
};

export type RowClassification = "valid" | "warning" | "error";

export function classifyIssues(issues: ImportIssue[]): RowClassification {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "valid";
}

// ─── Quantities & oversell ─────────────────────────────────────────────────

// True if adding `additionalQty` more sold tickets to an order that already
// has `alreadySold` sold (excluding the row being checked) would push the
// total past `qtyBought`. Mirrors the exact semantics reasoned through in
// supabase/migrations/0007_prevent_oversell.sql (sum of non-"Deleted"
// sales vs qty_bought) — this is the same rule applied at the application
// layer, for import and manual entry, since that migration is not applied.
//
// A ticket legitimately resold after a cancellation, or split across
// several separate sales, is never incorrectly rejected here: this checks
// the running total against qty_bought, not any single sale's shape.
export function wouldOversell(
  qtyBought: number | null | undefined,
  alreadySold: number,
  additionalQty: number,
): boolean {
  const bought = qtyBought ?? 0;
  if (bought <= 0) return false; // unknown bound — handled separately as a missing/invalid-quantity issue
  return alreadySold + additionalQty > bought;
}

export function describeOversell(
  qtyBought: number,
  alreadySold: number,
  additionalQty: number,
): string {
  const total = alreadySold + additionalQty;
  if (alreadySold <= 0) {
    return `This order has ${qtyBought} ticket${qtyBought === 1 ? "" : "s"}, but ${additionalQty} are marked sold — that's more than were bought. Please check the quantity before importing.`;
  }
  return `This order has ${qtyBought} ticket${qtyBought === 1 ? "" : "s"}, and ${alreadySold} ${alreadySold === 1 ? "is" : "are"} already sold. Adding ${additionalQty} more would make ${total} sold in total — more than were bought. Please check the quantities before importing.`;
}

export function checkQuantity(
  field: string,
  label: string,
  value: number | null,
  opts: { required?: boolean; max?: number } = {},
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (value === null) {
    if (opts.required) {
      issues.push({ field, severity: "error", code: "missing_required", message: `${label} is missing. This is needed before the row can be imported.` });
    }
    return issues;
  }
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    issues.push({ field, severity: "error", code: "invalid_quantity", message: `${label} should be a whole number greater than 0 — found "${value}".` });
    return issues;
  }
  if (opts.max && value > opts.max) {
    issues.push({ field, severity: "warning", code: "suspicious_quantity", message: `${label} is ${value}, which is unusually high. Please double-check this is correct.` });
  }
  return issues;
}

// ─── Required text/date fields ─────────────────────────────────────────────

export function checkRequiredText(field: string, label: string, value: string | null | undefined): ImportIssue[] {
  if (!value || !value.trim()) {
    return [{ field, severity: "error", code: "missing_required", message: `${label} is missing. This is needed before the row can be imported.` }];
  }
  return [];
}

// `rawValue` is the original cell text (before parseImportDate ran) so the
// message can show the customer what they actually typed, not a blank.
export function checkDate(field: string, label: string, parsed: string | null, rawValue: string, opts: { required?: boolean } = {}): ImportIssue[] {
  if (parsed !== null) return [];
  if (!rawValue || !rawValue.trim()) {
    if (opts.required) {
      return [{ field, severity: "error", code: "missing_required", message: `${label} is missing.` }];
    }
    return [];
  }
  return [{
    field,
    severity: "warning",
    code: "ambiguous_date",
    message: `${label} ("${rawValue.trim()}") doesn't look like a date TixTracker recognises. Please check or correct it before importing.`,
  }];
}

// ─── Financial values ──────────────────────────────────────────────────────

// Never silently treats "missing" as "zero" — a missing financial value is
// always reported as its own issue rather than defaulted, since defaulting
// to 0 would misrepresent profitability.
export function checkFinancialValue(
  field: string,
  label: string,
  value: number | null,
  opts: { required?: boolean; allowNegative?: boolean; suspiciousAbove?: number } = {},
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (value === null) {
    if (opts.required) {
      issues.push({ field, severity: "warning", code: "missing_financial_value", message: `${label} is missing for this row. Leaving it blank could misrepresent profit — please add it or confirm it's genuinely unknown before importing.` });
    }
    return issues;
  }
  if (!opts.allowNegative && value < 0) {
    issues.push({ field, severity: "error", code: "negative_value", message: `${label} is negative (${value}). Please check this value before importing.` });
    return issues;
  }
  const threshold = opts.suspiciousAbove ?? 50000;
  if (Math.abs(value) > threshold) {
    issues.push({ field, severity: "warning", code: "suspicious_amount", message: `${label} is ${value} — unusually large. Please double-check this figure before importing.` });
  }
  return issues;
}

// Heuristic: flags when a sale price looks like it may have been swapped
// with the purchase cost (e.g. a much-larger "cost" and a tiny "sale
// price"). This is intentionally conservative — a genuine heavy loss on
// resale is a normal, legitimate scenario, so this only fires on an extreme
// ratio, and always as a warning the customer confirms, never a block.
export function checkCostPriceSwap(totalCost: number | null, saleTotal: number | null): ImportIssue | null {
  if (totalCost === null || saleTotal === null) return null;
  if (totalCost <= 0 || saleTotal <= 0) return null;
  if (totalCost > saleTotal * 10) {
    return {
      severity: "warning",
      code: "possible_cost_price_swap",
      message: `The purchase cost (${totalCost}) is far higher than the sale price (${saleTotal}) for this row — please check these two columns haven't been swapped.`,
    };
  }
  return null;
}

// `rawCells` are the original, unparsed text of every money cell mapped on
// this row — used only to spot a currency symbol that doesn't match the
// currency selected for the whole file.
export function checkCurrencyMismatch(rawCells: string[], selectedCurrency: string): ImportIssue | null {
  const symbolToCurrency: Record<string, string> = { "£": "GBP", "$": "USD", "€": "EUR" };
  for (const cell of rawCells) {
    for (const [symbol, currency] of Object.entries(symbolToCurrency)) {
      if (cell.includes(symbol) && currency !== selectedCurrency) {
        return {
          severity: "warning",
          code: "currency_mismatch",
          message: `This row contains a ${symbol} symbol, but you selected ${selectedCurrency} as this file's currency. Please check the right currency is selected.`,
        };
      }
    }
  }
  return null;
}

// ─── Duplicate detection ────────────────────────────────────────────────────

export type ExistingOrderContext = {
  bookingRef: string | null;
  eventName: string | null;
  eventDate: string | null;
  qtyBought: number | null;
  totalCost: number | null;
};

export type ExistingSaleContext = {
  externalSaleId: string | null;
  eventName: string | null;
  soldAt: string | null;
  qtySold: number | null;
  saleTotal: number | null;
};

function fuzzyTextMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Flags a row that looks like it may already be in TixTracker — either an
// exact booking-reference match, or (when no reference is present on
// either side) a close match on event + date + quantity + cost. Always a
// warning, never a block: a genuine repeat purchase of the same event with
// the same quantity and price is rare but not impossible, so the customer
// confirms rather than being silently blocked.
export function checkDuplicateOrder(
  candidate: { bookingRef: string | null; eventName: string | null; eventDate: string | null; qtyBought: number | null; totalCost: number | null },
  existing: ExistingOrderContext[],
): ImportIssue | null {
  if (candidate.bookingRef) {
    const match = existing.find((o) => o.bookingRef && o.bookingRef.trim().toLowerCase() === candidate.bookingRef!.trim().toLowerCase());
    if (match) {
      return { severity: "warning", code: "duplicate_order_ref", message: `A ticket with booking reference "${candidate.bookingRef}" already exists in TixTracker. Importing again will update it rather than create a duplicate — check this is intended.` };
    }
    return null;
  }
  const match = existing.find((o) =>
    !o.bookingRef &&
    fuzzyTextMatch(o.eventName, candidate.eventName) &&
    o.eventDate === candidate.eventDate &&
    o.qtyBought === candidate.qtyBought &&
    o.totalCost === candidate.totalCost,
  );
  if (match) {
    return { severity: "warning", code: "duplicate_order_fuzzy", message: `This looks like it may already be in TixTracker — same event, date, quantity and cost as an existing ticket. Please check this isn't a repeat import.` };
  }
  return null;
}

export function checkDuplicateSale(
  candidate: { externalSaleId: string | null; eventName: string | null; soldAt: string | null; qtySold: number | null; saleTotal: number | null },
  existing: ExistingSaleContext[],
): ImportIssue | null {
  if (candidate.externalSaleId) {
    const match = existing.find((s) => s.externalSaleId && s.externalSaleId.trim().toLowerCase() === candidate.externalSaleId!.trim().toLowerCase());
    if (match) {
      return { severity: "warning", code: "duplicate_sale_ref", message: `A sale with reference "${candidate.externalSaleId}" already exists in TixTracker. Please check this isn't a repeat import.` };
    }
    return null;
  }
  const match = existing.find((s) =>
    !s.externalSaleId &&
    fuzzyTextMatch(s.eventName, candidate.eventName) &&
    s.soldAt === candidate.soldAt &&
    s.qtySold === candidate.qtySold &&
    s.saleTotal === candidate.saleTotal,
  );
  if (match) {
    return { severity: "warning", code: "duplicate_sale_fuzzy", message: `This looks like it may already be in TixTracker — same event, sale date, quantity and price as an existing sale. Please check this isn't a repeat import.` };
  }
  return null;
}

// ─── Conflicting status ────────────────────────────────────────────────────

// Flags a row whose sale/payment/transfer status fields contradict each
// other in a way that can't be resolved automatically without guessing
// which field is right.
export function checkConflictingStatus(row: { saleStatus?: string | null; qtySold?: number | null; paymentStatus?: string | null }): ImportIssue | null {
  const cancelled = row.saleStatus === "Cancelled / Issue";
  const paid = row.paymentStatus === "Paid";
  if (cancelled && paid) {
    return { severity: "warning", code: "conflicting_status", message: `This row is marked both "Cancelled / Issue" and "Paid" — please check which status is correct.` };
  }
  if (cancelled && (row.qtySold ?? 0) > 0) {
    return { severity: "warning", code: "conflicting_status", message: `This row is marked "Cancelled / Issue" but still shows ${row.qtySold} ticket(s) sold — please confirm whether this sale actually went ahead.` };
  }
  return null;
}
