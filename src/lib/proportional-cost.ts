// Shared, single source of truth for prorating a purchase's cost against
// however much of it has actually sold. Previously duplicated independently
// in app/orders/orders-client.tsx, app/desk-client.tsx,
// app/analytics/analytics-client.tsx, and src/lib/accounting.ts (unused
// there) — each with the same bug: proration only activated when
// listing_status was the EXACT string "Partially Sold". If a genuinely
// partially-sold order's status lagged behind (still "Sold", or anything
// else), the full purchase cost got counted against only the partial
// revenue, understating that event's profit/ROI with no indication
// anything was off.
//
// Fixed to derive "is this partial" from the real quantities themselves —
// qtySold vs qtyBought — which is already what every caller has on hand,
// rather than trusting a separate, independently-editable display label.
// The status parameter is kept (not removed) only so existing call sites
// don't need to change their argument list — it is no longer read.

export function getProportionalCost(
  totalCost: number | null,
  qtyBought: number | null,
  qtySold: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _status?: string | null,
): number {
  const cost = totalCost ?? 0;
  const bought = qtyBought ?? 0;

  // Can't meaningfully prorate without a real bought-quantity or cost, and
  // "nothing sold" preserves the pre-existing behaviour of every caller
  // (none currently call this for a zero-qtySold order in practice, since
  // all three UI call sites only reach this after already filtering for
  // "this order has recorded revenue").
  if (bought <= 0 || cost <= 0 || qtySold <= 0) return cost;

  // Fully sold (or an over-sold edge case — qtySold > qtyBought, which
  // shouldn't happen but is clamped defensively rather than ever returning
  // MORE than the real total purchase cost): full cost.
  if (qtySold >= bought) return cost;

  // Genuinely partial, regardless of what the status label says.
  return (qtySold / bought) * cost;
}
