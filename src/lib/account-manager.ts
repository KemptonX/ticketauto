// Account Manager — shared, pure logic (platform classification) kept
// separate from the DB/API code so it's directly testable.
//
// Real source_type values in production are inconsistent (confirmed via
// a live query): "ticketmaster_direct", "ticketmaster_resale",
// "Ticketmaster UK", "Ticketmaster US", "AXS", "axs", "Axs", "axs_us",
// plus a couple of one-off typos ("Ticketmater UK"). Classification is
// deliberately a loose substring match on the normalised value — it
// only ever feeds the auto-discovery REVIEW list (never auto-creates an
// account), so a slightly loose match here costs nothing: the customer
// still confirms or dismisses every candidate before anything is saved.

// Platform is a plain string at the type level too (not a closed union of
// just these two) so a future provider added purely as app-level config
// (PLATFORM_LABELS + a classifyPlatform rule) doesn't need a type change
// anywhere that already handles "other".
export type Platform = "ticketmaster" | "axs" | "other";

export function classifyPlatform(sourceType: string | null | undefined): Platform {
  const s = (sourceType ?? "").toLowerCase();
  if (s.includes("ticketmaster")) return "ticketmaster";
  if (s.includes("axs")) return "axs";
  return "other";
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  ticketmaster: "Ticketmaster",
  axs: "AXS",
  other: "Other",
};

// Organisational only — never auto-assigned based on any inferred
// account health, per the brief ("do not automatically classify accounts
// as banned/restricted/healthy/verified unless trustworthy evidence
// exists"). The user sets these manually.
export const ACCOUNT_STATUSES = ["active", "needs_attention", "inactive", "archived"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  needs_attention: "Needs Attention",
  inactive: "Inactive",
  archived: "Archived",
};

export type TicketAccount = {
  id: string;
  user_id: string;
  platform: Platform;
  account_name: string | null;
  email: string | null;
  phone: string | null;
  browser_profile_number: string | null;
  browser_profile_tool: string | null;
  proxy_reference: string | null;
  country: string | null;
  status: AccountStatus;
  notes: string | null;
  tags: string[];
  source: "manual" | "auto_discovered";
  account_created_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

// Groups raw order rows into discovery candidates: one candidate per
// distinct (platform, email) pair, counting how many orders back it and
// the most recent purchase date — purely a display aid for the review
// list, not itself a database write.
// existingKeys: `${platform}__${lowercased email}` for every account
// already saved. Keyed by platform+email, not email alone — the same
// email is a distinct identity on Ticketmaster vs AXS, so saving one
// must not suppress discovery of the other.
export function buildDiscoveryCandidates(
  orders: { account_email: string | null; source_type: string | null; created_at: string }[],
  existingKeys: Set<string>,
): { platform: Platform; email: string; orderCount: number; lastSeenAt: string }[] {
  const byKey = new Map<string, { platform: Platform; email: string; orderCount: number; lastSeenAt: string }>();

  for (const o of orders) {
    if (!o.account_email) continue;
    const platform = classifyPlatform(o.source_type);
    if (platform === "other") continue; // only Ticketmaster/AXS are auto-discovered, per the brief
    const emailLower = o.account_email.trim().toLowerCase();
    if (!emailLower) continue;

    const key = `${platform}__${emailLower}`;
    if (existingKeys.has(key)) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.orderCount += 1;
      if (o.created_at > existing.lastSeenAt) existing.lastSeenAt = o.created_at;
    } else {
      byKey.set(key, { platform, email: o.account_email.trim(), orderCount: 1, lastSeenAt: o.created_at });
    }
  }

  return [...byKey.values()].sort((a, b) => b.orderCount - a.orderCount);
}
