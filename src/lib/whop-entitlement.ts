// Shared Whop membership-checking logic (SEC-001 remediation) — extracted
// from app/auth/callback/route.ts, where this exact logic previously lived
// inline and ran exactly once, at login, never again. Now reusable by both
// the OAuth callback (so the first check is stored, not just acted on) and
// the periodic refresh cron (app/api/cron/whop-refresh/route.ts), which is
// what actually closes the "checked only at login" gap.
//
// Deliberately NOT using "server-only" here even though every current
// caller is server-side — this module has no side effects of its own
// (no cookies, no redirects), making it easy to unit test directly.

import type { SupabaseClient } from "@supabase/supabase-js";

const WHOP_API_BASE = process.env.WHOP_API_BASE_URL ?? "https://api.whop.com/api/v2";
// Free Whop products may return "completed" instead of "active"/"trialing".
// Also accept past_due/pastDue so payment-grace members aren't locked out.
export const ALLOWED_WHOP_STATUSES = new Set([
  "active", "trialing", "completed", "canceling", "past_due", "pastDue",
]);

// How long a failed Whop check's grace period lasts before access is
// actually revoked, and the periodic re-check interval it's paired with
// (see vercel.json's whop-refresh cron schedule). Both are explicit,
// documented business policy — flagged for the owner to confirm/adjust in
// the final report, not silently assumed as "correct" by this code.
export const OUTAGE_GRACE_HOURS = 48;
export const RECHECK_INTERVAL_HOURS = 6;

export type WhopMembership = {
  id: string;
  product?: string;
  status: string;
  valid?: boolean;
  email?: string;
  discord?: { id?: string; username?: string } | null;
  [key: string]: unknown;
};

export type EntitlementCheckResult =
  | { ok: true; isEntitled: boolean; status: string; membershipId: string | null }
  | { ok: false; error: string };

async function fetchWhopMemberships(params: URLSearchParams, apiKey: string): Promise<WhopMembership[]> {
  const res = await fetch(`${WHOP_API_BASE}/memberships?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Whop API returned HTTP ${res.status}`);
  const parsed = (await res.json()) as { data?: WhopMembership[] };
  return parsed.data ?? [];
}

export function pickActiveMembership(
  memberships: WhopMembership[],
  allowedProductIds: Set<string>,
  identity: { discordId?: string; email?: string },
): WhopMembership | undefined {
  return memberships.find((m) => {
    if (identity.discordId && m.discord?.id !== identity.discordId) return false;
    if (identity.email && !identity.discordId && m.email !== identity.email) return false;
    const planId = String((m as Record<string, unknown>).plan ?? "");
    const productMatch =
      allowedProductIds.size === 0 || allowedProductIds.has(m.product ?? "") || allowedProductIds.has(planId);
    const accessOk = m.valid === true || ALLOWED_WHOP_STATUSES.has(m.status);
    return productMatch && accessOk;
  });
}

// Checks Whop directly for one user's current membership status. Does NOT
// touch the database — callers decide what to do with the result (the
// callback upserts whop_entitlements; the cron does the same in bulk).
export async function checkWhopMembership(
  identity: { discordId?: string; email?: string },
  apiKey: string,
  allowedProductIds: Set<string>,
): Promise<EntitlementCheckResult> {
  try {
    let membership: WhopMembership | undefined;

    if (identity.discordId) {
      const memberships = await fetchWhopMemberships(new URLSearchParams({ discord_account_id: identity.discordId }), apiKey);
      membership = pickActiveMembership(memberships, allowedProductIds, identity);
    }
    if (!membership && identity.email) {
      const memberships = await fetchWhopMemberships(new URLSearchParams({ email: identity.email }), apiKey);
      membership = pickActiveMembership(memberships, allowedProductIds, identity);
    }

    return { ok: true, isEntitled: !!membership, status: membership?.status ?? "none_found", membershipId: membership?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error contacting Whop" };
  }
}

export type ExistingEntitlementRow = { is_entitled: boolean; grace_until: string | null } | null;
export type GraceDecision = { isEntitled: boolean; graceUntil: string | null };

// Pure decision logic for a FAILED Whop check, isolated from the database
// I/O around it so it's directly unit-testable: a failed check never
// immediately flips a previously-entitled user to not-entitled — it
// starts (or continues) a grace window, and only actually revokes once
// that window has fully elapsed without a successful check in between.
export function resolveGraceDecision(existing: ExistingEntitlementRow, nowMs: number): GraceDecision {
  const existingGraceUntilMs = existing?.grace_until ? new Date(existing.grace_until).getTime() : null;
  const graceExpired = existingGraceUntilMs !== null && existingGraceUntilMs < nowMs;

  if (graceExpired) {
    return { isEntitled: false, graceUntil: null };
  }
  return {
    isEntitled: existing?.is_entitled ?? true, // no row yet at all -> never seen a failure before -> preserve default-allow
    graceUntil: existing?.grace_until ?? new Date(nowMs + OUTAGE_GRACE_HOURS * 60 * 60 * 1000).toISOString(),
  };
}

// Writes the result of a check into whop_entitlements.
export async function upsertEntitlement(
  supabase: SupabaseClient,
  userId: string,
  discordId: string | null,
  result: EntitlementCheckResult,
): Promise<void> {
  if (result.ok) {
    await supabase.from("whop_entitlements").upsert({
      user_id: userId,
      discord_id: discordId,
      status: result.status,
      is_entitled: result.isEntitled,
      last_checked_at: new Date().toISOString(),
      last_check_succeeded: true,
      last_check_error: null,
      grace_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return;
  }

  const { data: existing } = await supabase
    .from("whop_entitlements")
    .select("is_entitled, grace_until")
    .eq("user_id", userId)
    .maybeSingle();

  const decision = resolveGraceDecision(existing as ExistingEntitlementRow, Date.now());

  await supabase.from("whop_entitlements").upsert({
    user_id: userId,
    discord_id: discordId,
    is_entitled: decision.isEntitled,
    last_checked_at: new Date().toISOString(),
    last_check_succeeded: false,
    last_check_error: result.error,
    grace_until: decision.graceUntil,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
}
