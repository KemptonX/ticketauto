// Viagogo browser automation provider — STUB for Railway worker.
//
// This file defines the interface and placeholder implementations.
// The actual Playwright automation runs ONLY in the separate Railway worker process.
// This code runs on Vercel only to: validate drafts, queue jobs, surface status.
//
// When the Railway worker is built, it imports the same types from ../types.ts
// and implements the real browser automation steps.

import type {
  IMarketplaceProvider,
  MarketplaceEvent,
  AccountStatusResult,
  ListingDraftInput,
  OrderSnapshot,
  ValidationResult,
} from "../types";
import { validateListingDraft } from "../validation";

export class ViagogoPlaceholderProvider implements IMarketplaceProvider {
  readonly marketplace = "viagogo" as const;

  // ── Event search ─────────────────────────────────────────────────────────────
  // On Vercel: returns empty — the actual search runs in the worker.
  // The worker will write results back to the DB and the UI polls for them.
  async searchEvents(_params: {
    eventName: string;
    eventDate: string;
    venue?: string;
  }): Promise<MarketplaceEvent[]> {
    // Real implementation: browser opens viagogo.co.uk, searches for eventName,
    // filters by date, scrapes event cards, returns candidates.
    return [];
  }

  // ── Account status ────────────────────────────────────────────────────────────
  // On Vercel: returns the status stored in the DB (set by the worker after login).
  async checkAccountStatus(
    _accountId: string,
    _encryptedSession: string | null,
  ): Promise<AccountStatusResult> {
    // Real implementation: browser loads Viagogo, checks if session cookies are valid,
    // navigates to seller area, confirms can_list.
    return {
      status: "needs_reconnect",
      canList: false,
      errorMessage: "Connection verification requires the background worker.",
    };
  }

  // ── 2FA code submission ────────────────────────────────────────────────────────
  async submitVerificationCode(
    _accountId: string,
    _code: string,
  ): Promise<AccountStatusResult> {
    // Real implementation: browser enters the code in Viagogo's 2FA input,
    // submits, then saves the resulting session cookies encrypted.
    return {
      status: "needs_reconnect",
      canList: false,
      errorMessage: "2FA submission requires the background worker.",
    };
  }

  // ── Draft validation ──────────────────────────────────────────────────────────
  // Runs fully on Vercel — no browser needed.
  validateDraft(draft: ListingDraftInput, order: OrderSnapshot): ValidationResult {
    return validateListingDraft(draft, order);
  }
}

// Singleton — only import this on the server side
export const viagogoProvider = new ViagogoPlaceholderProvider();
