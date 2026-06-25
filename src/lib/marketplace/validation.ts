// Shared draft validation logic — runs server-side before a job is queued.
// No network calls. Pure data checks only.

import type {
  ListingDraftInput,
  OrderSnapshot,
  ValidationResult,
  ValidationError,
  SplitRule,
} from "./types";
import { splitRulesForQty } from "./types";

export function validateListingDraft(
  draft: ListingDraftInput,
  order: OrderSnapshot,
): ValidationResult {
  const errors: ValidationError[] = [];

  // ── Ownership guard (belt-and-suspenders; RLS enforces this too) ──────────
  if (draft.orderId !== order.id) {
    errors.push({ field: "orderId", message: "Order ID mismatch" });
    return { valid: false, errors };
  }

  // ── Order must not already be sold/archived/ignored ────────────────────────
  const blockedStatuses = ["Archived", "Ignored", "Sold"];
  if (order.listing_status && blockedStatuses.includes(order.listing_status)) {
    errors.push({
      field: "order",
      message: `Order is ${order.listing_status} and cannot be listed`,
    });
  }

  // ── Event match ────────────────────────────────────────────────────────────
  if (!draft.viagogoEventId?.trim()) {
    errors.push({ field: "viagogoEventId", message: "Viagogo event must be selected and confirmed" });
  }
  if (!draft.eventMatchId?.trim()) {
    errors.push({ field: "eventMatchId", message: "Event match confirmation is required" });
  }

  // ── Account ────────────────────────────────────────────────────────────────
  if (!draft.marketplaceAccountId?.trim()) {
    errors.push({ field: "marketplaceAccountId", message: "Viagogo account is required" });
  }

  // ── Quantity ───────────────────────────────────────────────────────────────
  if (!draft.quantity || draft.quantity < 1) {
    errors.push({ field: "quantity", message: "Quantity must be at least 1" });
  }
  const orderQty = order.qty_bought ?? 0;
  if (draft.quantity > orderQty) {
    errors.push({
      field: "quantity",
      message: `Quantity (${draft.quantity}) exceeds available tickets (${orderQty})`,
    });
  }

  // ── Split rule ─────────────────────────────────────────────────────────────
  if (draft.quantity > 1) {
    const validRules = splitRulesForQty(draft.quantity);
    if (!draft.splitRule) {
      errors.push({ field: "splitRule", message: "Split rule is required for multiple tickets" });
    } else if (!(validRules as string[]).includes(draft.splitRule)) {
      errors.push({
        field: "splitRule",
        message: `Split rule '${draft.splitRule}' is not valid for ${draft.quantity} tickets`,
      });
    }
  }

  // ── Ticket type ────────────────────────────────────────────────────────────
  if (!draft.ticketType?.trim()) {
    errors.push({ field: "ticketType", message: "Ticket type is required" });
  }

  // ── Ticket storage provider ────────────────────────────────────────────────
  if (!draft.ticketStorageProvider || draft.ticketStorageProvider === "unknown") {
    errors.push({
      field: "ticketStorageProvider",
      message: "Ticket storage provider must be selected (cannot be Unknown)",
    });
  }

  // ── Seat details ───────────────────────────────────────────────────────────
  if (!draft.section?.trim()) {
    errors.push({ field: "section", message: "Section is required" });
  }
  if (!draft.row?.trim()) {
    errors.push({ field: "row", message: "Row is required" });
  }
  if (!draft.seatFrom?.trim()) {
    errors.push({ field: "seatFrom", message: "First seat is required" });
  }
  if (!draft.seatTo?.trim()) {
    errors.push({ field: "seatTo", message: "Last seat is required" });
  }

  // ── Price ──────────────────────────────────────────────────────────────────
  if (!draft.pricePerTicket || draft.pricePerTicket <= 0) {
    errors.push({ field: "pricePerTicket", message: "Price per ticket must be greater than 0" });
  }
  if (!draft.currency?.trim()) {
    errors.push({ field: "currency", message: "Currency is required" });
  }
  if (!draft.faceValuePerTicket || draft.faceValuePerTicket <= 0) {
    errors.push({ field: "faceValuePerTicket", message: "Face value per ticket must be greater than 0" });
  }

  // ── Confirmations ──────────────────────────────────────────────────────────
  if (!draft.aboutYouConfirmed) {
    errors.push({
      field: "aboutYouConfirmed",
      message: "You must confirm you are neither the event organiser nor employed by Viagogo",
    });
  }
  if (!draft.termsConfirmed) {
    errors.push({
      field: "termsConfirmed",
      message: "You must confirm you have the right to sell these tickets",
    });
  }

  return { valid: errors.length === 0, errors };
}
