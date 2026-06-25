// Shared types for the marketplace listing system.
// All marketplace integrations (browser automation or official API) share these types.

export type Marketplace = "viagogo";

export type AccountStatus =
  | "connected"
  | "disconnected"
  | "needs_reconnect"
  | "verification_required"
  | "login_failed"
  | "error";

export type JobStatus =
  | "queued"
  | "validating"
  | "logging_in"
  | "session_checking"
  | "opening_event_page"
  | "verifying_event"
  | "clicking_sell"
  | "selecting_quantity"
  | "selecting_split_rule"
  | "filling_ticket_details"
  | "filling_features_restrictions"
  | "selecting_ticket_provider"
  | "filling_seat_details"
  | "filling_price"
  | "final_review"
  | "submitting_listing"
  | "waiting_for_confirmation"
  | "listed"
  | "failed"
  | "needs_reconnect"
  | "verification_required"
  | "unknown_needs_review"
  | "cancelled";

export type SplitRule =
  | "any_quantity"
  | "all_together"
  | "no_single_left"
  | "no_one_or_three_left";

export type TicketStorageProvider =
  | "ticketmaster"
  | "axs"
  | "seatgeek"
  | "other"
  | "unknown";

export type MatchStatus = "pending" | "confirmed" | "rejected";

// Human-readable labels for split rules shown in UI
export const SPLIT_RULE_LABELS: Record<SplitRule, string> = {
  any_quantity:          "Sell any quantity of my tickets",
  all_together:          "Sell all of my tickets together",
  no_single_left:        "Sell any quantity but don't leave me with a single ticket",
  no_one_or_three_left:  "Sell any quantity but don't leave me with one or three tickets",
};

// Split rules valid for each quantity (Viagogo only shows options that apply)
export const SPLIT_RULES_FOR_QTY: Record<number, SplitRule[]> = {
  1: ["all_together"],
  2: ["any_quantity", "all_together"],
  3: ["any_quantity", "all_together", "no_single_left"],
  4: ["any_quantity", "all_together", "no_single_left", "no_one_or_three_left"],
};
export function splitRulesForQty(qty: number): SplitRule[] {
  if (qty <= 0) return [];
  if (qty === 1) return SPLIT_RULES_FOR_QTY[1];
  if (qty === 2) return SPLIT_RULES_FOR_QTY[2];
  if (qty === 3) return SPLIT_RULES_FOR_QTY[3];
  return SPLIT_RULES_FOR_QTY[4];
}

// Mapping from TixTracker source_type to Viagogo ticket storage provider
export const SOURCE_TYPE_TO_PROVIDER: Record<string, TicketStorageProvider> = {
  ticketmaster_direct:   "ticketmaster",
  ticketmaster_transfer: "ticketmaster",
  ticketmaster_ie:       "ticketmaster",
  ticketmaster_us:       "ticketmaster",
  axs:                   "axs",
  axs_transfer:          "axs",
  seatgeek:              "seatgeek",
};
export function providerFromSourceType(sourceType: string | null | undefined): TicketStorageProvider | null {
  if (!sourceType) return null;
  return SOURCE_TYPE_TO_PROVIDER[sourceType.toLowerCase()] ?? null;
}

// ── Validated Viagogo event from search ────────────────────────────────────────

export type MarketplaceEvent = {
  id: string;             // Viagogo event ID
  name: string;
  date: string;           // ISO date, e.g. '2026-06-27'
  time?: string;          // e.g. '17:00'
  venue: string;
  city: string;
  country: string;
  url: string;
};

// ── Account status result from provider ────────────────────────────────────────

export type AccountStatusResult = {
  status: AccountStatus;
  canList: boolean;
  displayEmail?: string;
  errorCode?: string;
  errorMessage?: string;
  requires2fa?: boolean;
};

// ── Listing draft fields passed to the service layer ──────────────────────────

export type ListingDraftInput = {
  orderId: number;
  marketplaceAccountId: string;
  viagogoEventId: string;
  eventMatchId: string;
  quantity: number;
  splitRule: SplitRule;
  ticketType: string;
  ticketStorageProvider: TicketStorageProvider;
  section: string;
  row: string;
  seatFrom: string;
  seatTo: string;
  pricePerTicket: number;
  currency: string;
  faceValuePerTicket: number;
  listingFeatures: string;
  comments: string;
  restrictions: string;
  limitations: string;
  aboutYouConfirmed: boolean;
  termsConfirmed: boolean;
};

// ── Validation result ──────────────────────────────────────────────────────────

export type ValidationError = { field: string; message: string };

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

// ── Job result written by worker ───────────────────────────────────────────────

export type JobUpdatePayload = {
  status: JobStatus;
  currentStep?: string;
  errorCode?: string;
  errorMessage?: string;
  resultListingId?: string;
  resultListingUrl?: string;
  pendingVerification?: boolean;
  verificationExpiresAt?: string;
  lockedBy?: string;
};

// ── Abstract interface all marketplace providers must implement ─────────────────
// When we get official Viagogo API access, we create a ViagogoApiProvider
// that satisfies this same interface. The UI and job system never need to change.

export interface IMarketplaceProvider {
  readonly marketplace: Marketplace;

  /** Search for matching events by name + date. Returns candidates for user confirmation. */
  searchEvents(params: {
    eventName: string;
    eventDate: string;  // ISO date
    venue?: string;
  }): Promise<MarketplaceEvent[]>;

  /** Check whether the stored account credentials/session are still valid. */
  checkAccountStatus(accountId: string, encryptedSession: string | null): Promise<AccountStatusResult>;

  /** Submit a 2FA / auth code that Viagogo requested during login. */
  submitVerificationCode(accountId: string, code: string): Promise<AccountStatusResult>;

  /** Validate a listing draft locally (no network calls). Returns errors if invalid. */
  validateDraft(draft: ListingDraftInput, order: OrderSnapshot): ValidationResult;
}

// Snapshot of the order row, passed to validation so we never modify the real order
export type OrderSnapshot = {
  id: number;
  event_name: string | null;
  event_date: string | null;
  venue: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  source_type: string | null;
  listing_status: string | null;
};
