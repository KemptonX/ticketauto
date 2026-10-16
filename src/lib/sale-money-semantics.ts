// Marketplace money semantics — what `sale_total` and `payout_total` actually
// mean varies by source, traced directly against the parsers in
// src/lib/viagogo-sales-sync.ts. Documented here once, in one place, rather
// than left ambiguous across the accounting layer.
//
// This does NOT rename or restructure the `sales` table's columns — it's a
// read-only semantic helper over the existing sale_total/payout_total
// fields, so nothing destructive happens to historic data.

export type MoneySource =
  | "stubhub"
  | "ticombo"
  | "viagogo_sold_confirmation" // "You sold your ticket for..." — parseSoldConfirmation()
  | "viagogo_proceeds" // "Total Proceeds:" style email — parseSale()
  | "lysted"
  | "manual"
  | "csv_import"
  | "unknown";

export type NormalisedSaleMoney = {
  grossAmount: number | null;
  sellerFee: number | null;
  netAmount: number | null;
  grossKnown: boolean;
  feeKnown: boolean;
  netKnown: boolean;
  sourceExplanation: string;
};

// Source-by-source semantics, traced against the actual parser code:
//
// StubHub (parseStubHubSale, viagogo-sales-sync.ts ~L1758-1765):
//   sale_total   <- "Subtotal" / "Total ticket price"   — genuinely GROSS
//   payout_total <- "Payment Total" / "Your payment"    — genuinely NET
//   Gross known: Yes. Net known: Yes. Fee: gross - net.
//
// Ticombo (parseTicomboSale, ~L2311-2318):
//   sale_total   <- "Total Ticket Price" / "Subtotal"   — genuinely GROSS
//   payout_total <- "Total (payout)"                    — genuinely NET
//   Gross known: Yes. Net known: Yes. Fee: gross - net.
//
// Viagogo "sold" confirmation email (parseSoldConfirmation, ~L1119-1120):
//   payoutTotal <- "Payment Total" (the only figure in this email template)
//   saleTotal   <- literally set equal to payoutTotal in the parser itself
//     (`const saleTotal = payoutTotal;`) — there is no separate gross figure
//     in this email at all.
//   Gross known: NO (duplicated from net, not a real gross).
//   Net known: Yes. Fee: unknown — never derived from this source.
//
// Viagogo "Total Proceeds" email (parseSale, ~L1184-1185):
//   payoutTotal <- "Total Proceeds"                     — genuinely NET
//   saleTotal   <- qty * "Price per Ticket" when both are present in the
//     email (genuinely GROSS); falls back to payoutTotal (net-as-gross,
//     same ambiguity as above) only when price-per-ticket is missing.
//   Gross known: sometimes (depends on whether the email stated a
//     per-ticket price). Net known: Yes.
//
// Lysted: not traced in this pass — flagged as unknown/needs review rather
//   than assumed.
//
// Manual entry / CSV import: whatever was typed in has no fee breakdown at
//   all unless the user entered one separately — treated as net-only,
//   fee unknown.
const SOURCE_EXPLANATIONS: Record<MoneySource, string> = {
  stubhub: "StubHub: Subtotal (gross) and Payment Total (net) are two separately labelled fields in the source email — both genuinely known.",
  ticombo: "Ticombo: Total Ticket Price (gross) and Total (payout) (net) are two separately labelled fields in the source email — both genuinely known.",
  viagogo_sold_confirmation: "Viagogo 'You sold your ticket' email only states one figure (Payment Total). The parser duplicates it into both fields — gross is NOT genuinely known, it's the net figure relabelled.",
  viagogo_proceeds: "Viagogo 'Total Proceeds' email: net is always known (Total Proceeds). Gross is only genuinely known when the email also states a per-ticket price; otherwise it falls back to the same net-as-gross duplication.",
  lysted: "Lysted parser semantics weren't traced this pass — treat gross/fee as unverified until checked against the actual parser.",
  manual: "Manually entered — whatever was typed in. No fee breakdown exists unless entered separately.",
  csv_import: "Imported from a spreadsheet — no fee breakdown exists unless the CSV had a dedicated fee column.",
  unknown: "Source not identified — treat all fields as unverified.",
};

// Best-effort inference of which source produced a given sale row. The
// `sales` table doesn't currently store which parser matched (a real gap —
// see the final report's remaining limitations) — this infers from the
// shape of the data rather than a stored, authoritative source tag.
export function inferMoneySource(sale: { sale_total: number | null; payout_total: number | null }): MoneySource {
  if (sale.sale_total == null && sale.payout_total == null) return "unknown";
  if (sale.sale_total === sale.payout_total) return "viagogo_sold_confirmation"; // can't distinguish from viagogo_proceeds-fallback without a stored source tag
  return "unknown"; // a genuine gross≠net split could be StubHub, Ticombo, or a successful viagogo_proceeds parse — not distinguishable without a stored source tag
}

export function normaliseSaleMoney(
  sale: { sale_total: number | null; payout_total: number | null },
  source?: MoneySource,
): NormalisedSaleMoney {
  const resolvedSource = source ?? inferMoneySource(sale);
  const explanation = SOURCE_EXPLANATIONS[resolvedSource];

  const netKnown = sale.payout_total != null;
  const netAmount = sale.payout_total ?? null;

  if (resolvedSource === "viagogo_sold_confirmation") {
    // Gross is explicitly NOT trustworthy for this source — net is the only
    // confirmed figure.
    return { grossAmount: null, sellerFee: null, netAmount, grossKnown: false, feeKnown: false, netKnown, sourceExplanation: explanation };
  }

  const grossKnown = sale.sale_total != null && sale.sale_total !== sale.payout_total;
  const grossAmount = grossKnown ? sale.sale_total : null;
  const feeKnown = grossKnown && netKnown;
  const sellerFee = feeKnown ? Math.max(0, grossAmount! - netAmount!) : null;

  return { grossAmount, sellerFee, netAmount, grossKnown, feeKnown, netKnown, sourceExplanation: explanation };
}
