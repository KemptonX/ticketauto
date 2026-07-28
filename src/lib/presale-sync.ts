import type { SupabaseClient } from "@supabase/supabase-js";
import { stripHtml, cleanText } from "./gmail-sync";

// ── Campaign definitions ───────────────────────────────────────────────────────
// Each campaign describes how to detect + parse its emails.
// Add new campaigns here; the sync function picks them up automatically.

export type CampaignDef = {
  id: string;           // stored in presale_entries.campaign
  label: string;        // human-readable name shown on the page
  // Returns true if this email belongs to this campaign
  detect: (from: string, subject: string) => boolean;
  // Extracts fields from the stripped-text body + subject
  parse: (subject: string, text: string, toAddress: string) => ParsedPresale | null;
};

export type ParsedPresale = {
  account_email: string;
  presale_code: string | null;
  slot_start: string | null;   // ISO string or null
  slot_end: string | null;
  notes: string | null;
};

// ── LA28 Olympics ─────────────────────────────────────────────────────────────

function parseLA28(subject: string, text: string, toAddress: string): ParsedPresale | null {
  // Must be a "time slot" alert, not generic LA28 marketing
  if (!/time slot/i.test(subject) && !/time slot/i.test(text)) return null;

  // Account email is the To: address the email arrived at
  const accountEmail = toAddress.trim();

  // "- Start: July 29/07, 2026 | 16:00 PT"
  // "- End:   July 31/07, 2026 | 16:00 PT"
  const startMatch = text.match(/[-–]\s*Start:\s*([A-Za-z]+\s+[\d/]+,?\s*\d{4})\s*\|\s*([\d:]+)\s*PT/i);
  const endMatch   = text.match(/[-–]\s*End:\s*([A-Za-z]+\s+[\d/]+,?\s*\d{4})\s*\|\s*([\d:]+)\s*PT/i);

  function parseSlot(datePart: string, timePart: string): string | null {
    // "July 29/07, 2026" → "July 29 2026"
    const cleaned = datePart.replace(/\/\d{2}/, "").replace(/,/g, "");
    const d = new Date(`${cleaned} ${timePart} PDT`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  const slot_start = startMatch ? parseSlot(startMatch[1], startMatch[2]) : null;
  const slot_end   = endMatch   ? parseSlot(endMatch[1],   endMatch[2])   : null;

  return {
    account_email: accountEmail,
    presale_code: null, // account-bound
    slot_start,
    slot_end,
    notes: null,
  };
}

export const CAMPAIGN_DEFS: CampaignDef[] = [
  {
    id: "la28_olympics",
    label: "LA28 Olympics",
    detect: (from, subject) =>
      (from.includes("la28.org") || from.includes("tickets.la28")) &&
      (/time slot/i.test(subject) || /ticket alert/i.test(subject)),
    parse: parseLA28,
  },
  // Add future campaigns here, e.g.:
  // { id: "taylor_swift_eras", label: "Taylor Swift – Eras Tour", detect: ..., parse: ... },
];

// ── Gmail presale scan ─────────────────────────────────────────────────────────

type GmailAccount = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  payload: {
    headers?: GmailHeader[];
    parts?: GmailPart[];
    body?: { data?: string };
    mimeType?: string;
  };
};
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function getHeader(headers: GmailHeader[], name: string) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64(encoded: string): string {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBodyParts(parts: GmailPart[] | undefined, mimeType: string): string {
  if (!parts) return "";
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64(part.body.data);
    }
    const nested = extractBodyParts(part.parts, mimeType);
    if (nested) return nested;
  }
  return "";
}

function getBody(payload: GmailMessage["payload"]): string {
  const plain = extractBodyParts(payload.parts, "text/plain") ||
    (payload.mimeType === "text/plain" && payload.body?.data ? decodeBase64(payload.body.data) : "");
  const html = extractBodyParts(payload.parts, "text/html") ||
    (payload.mimeType === "text/html" && payload.body?.data ? decodeBase64(payload.body.data) : "");
  return cleanText([plain, html ? stripHtml(html) : ""].filter(Boolean).join("\n"));
}

async function getValidAccessToken(supabase: SupabaseClient, account: GmailAccount): Promise<string> {
  if (!account.refresh_token || !account.token_expiry || !account.access_token) {
    return account.access_token || "";
  }
  const expiresAt = new Date(account.token_expiry);
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() > Date.now() + 60_000) {
    return account.access_token;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth env vars missing");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: account.refresh_token, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || "Failed to refresh token");
  await supabase.from("gmail_accounts").update({ access_token: data.access_token, token_expiry: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() }).eq("id", account.id);
  return data.access_token;
}

async function gmailFetch<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) }, cache: "no-store" });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function listMessages(accessToken: string, query: string): Promise<Array<{ id: string }>> {
  const all: Array<{ id: string }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(accessToken, url.toString());
    all.push(...(data.messages ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

// Gmail query that catches presale emails across all known campaigns
const PRESALE_GMAIL_QUERY =
  'is:unread newer_than:60d (' +
  '(from:tickets.la28.org (subject:"time slot" OR subject:"ticket alert"))' +
  ')';

export async function syncPresaleGmailInbox({
  supabase,
  gmailAccount,
  userId,
}: {
  supabase: SupabaseClient;
  gmailAccount: GmailAccount;
  userId: string;
}): Promise<{ scanned: number; inserted: number }> {
  const accessToken = await getValidAccessToken(supabase, gmailAccount);
  const messages = await listMessages(accessToken, PRESALE_GMAIL_QUERY);

  let scanned = 0;
  let inserted = 0;

  for (const msg of messages) {
    const full = await gmailFetch<GmailMessage>(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`);
    const headers = full.payload.headers ?? [];
    const from    = getHeader(headers, "From");
    const subject = getHeader(headers, "Subject");
    const to      = getHeader(headers, "To");
    const msgId   = getHeader(headers, "Message-ID") || msg.id;

    const campaign = CAMPAIGN_DEFS.find((c) => c.detect(from, subject));
    if (!campaign) continue;

    scanned++;

    // Dedup by source_message_id
    const { data: existing } = await supabase
      .from("presale_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("campaign", campaign.id)
      .eq("source_message_id", msgId)
      .maybeSingle();
    if (existing) continue;

    const body = getBody(full.payload);
    const parsed = campaign.parse(subject, body, to || gmailAccount.email);
    if (!parsed) continue;

    const { error } = await supabase.from("presale_entries").insert({
      user_id: userId,
      campaign: campaign.id,
      account_email: parsed.account_email,
      presale_code: parsed.presale_code,
      slot_start: parsed.slot_start,
      slot_end: parsed.slot_end,
      notes: parsed.notes,
      source_message_id: msgId,
    });

    if (!error) inserted++;
  }

  return { scanned, inserted };
}
