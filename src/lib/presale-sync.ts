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
      // Match direct LA28 senders AND iCloud/other privacy-relay senders
      // (iCloud relay rewrites From to *_at_tickets_la28_org_*@icloud.com)
      (from.toLowerCase().includes("la28") || /la28/i.test(subject)) &&
      (/time slot/i.test(subject) || /ticket alert/i.test(subject)),
    parse: parseLA28,
  },
  // Add future campaigns here, e.g.:
  // { id: "taylor_swift_eras", label: "Taylor Swift – Eras Tour", detect: ..., parse: ... },
];

// ── Inbound email presale scan ────────────────────────────────────────────────
// Emails arrive via Postmark webhook → stored in inbound_email_events.
// Rescan queries that table directly — no Gmail API needed.

type InboundEmailRow = {
  id: number;
  sender_email: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  postmark_message_id: string | null;
  normalized_hash: string | null;
  x_forwarded_to: string | null;
};

export async function syncPresaleFromInboundEvents({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ scanned: number; inserted: number }> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: emails } = await supabase
    .from("inbound_email_events")
    .select("id, sender_email, subject, text_body, html_body, postmark_message_id, normalized_hash, x_forwarded_to")
    .eq("user_id", userId)
    .gte("received_at", since)
    .order("received_at", { ascending: false }) as { data: InboundEmailRow[] | null };

  let scanned = 0;
  let inserted = 0;

  for (const email of emails ?? []) {
    const from    = email.sender_email ?? "";
    const subject = email.subject ?? "";

    const campaign = CAMPAIGN_DEFS.find((c) => c.detect(from, subject));
    if (!campaign) continue;

    scanned++;

    const msgId = email.postmark_message_id ?? email.normalized_hash ?? String(email.id);

    const { data: existing } = await supabase
      .from("presale_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("campaign", campaign.id)
      .eq("source_message_id", msgId)
      .maybeSingle();
    if (existing) continue;

    const body = cleanText([
      email.text_body ?? "",
      email.html_body ? stripHtml(email.html_body) : "",
    ].filter(Boolean).join("\n"));

    // Use x_forwarded_to as the account email — this is the Gmail/email account
    // that forwarded the email to TixTracker, i.e. the account the presale was sent to.
    const parsed = campaign.parse(subject, body, email.x_forwarded_to ?? "");
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
