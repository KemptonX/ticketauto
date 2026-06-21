import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SEARCH_QUERY = "ticketmaster OR axs";

type OutlookAccount = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type GraphMessage = {
  id: string;
  subject: string;
  receivedDateTime: string;
  isRead: boolean;
  body: {
    contentType: "text" | "html";
    content: string;
  };
  from: {
    emailAddress: { address: string; name?: string };
  };
  toRecipients: Array<{ emailAddress: { address: string; name?: string } }>;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
};

type SyncResult = {
  scanned: number;
  inserted: number;
  updated: number;
  insertedRefs: string[];
  updatedRefs: string[];
  email: string;
};

type OrderInsert = {
  booking_ref: string;
  event_name: string;
  venue: string;
  event_date: string;
  purchased_at: string;
  account_email: string;
  section: string;
  row: string;
  seat_from: string;
  seat_to: string;
  qty_bought: number | null;
  total_cost: number | null;
  source_type: string;
  user_id: string;
};

type ExistingOrder = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  purchased_at: string | null;
  account_email: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  listing_status: string | null;
  source_type: string | null;
};

export async function syncOutlookInbox({
  supabase,
  outlookAccount,
  userId,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookAccount;
  userId: string;
}): Promise<SyncResult> {
  const accessToken = await getValidAccessToken({ supabase, outlookAccount });
  const messages = await listMessages(accessToken);

  let inserted = 0;
  let updated = 0;
  const insertedRefs: string[] = [];
  const updatedRefs: string[] = [];

  for (const msg of messages) {
    if (msg.isRead) continue;

    const subject = msg.subject || "";
    const bodyText = msg.body.contentType === "html"
      ? stripHtml(msg.body.content)
      : msg.body.content;
    const combined = cleanText(`${subject}\n${bodyText}`);

    const fromAddress = msg.from?.emailAddress?.address || "";
    const axs = isAxsEmail(fromAddress, subject);

    const bookingRef = axs ? parseAxsBookingRef(combined) : parseBookingRef(subject, combined);
    if (!bookingRef) continue;

    const accountEmail = extractAccountFromMessage(msg, combined);
    const existingOrder = await findExistingOrder(supabase, { bookingRef, userId });

    let section: string;
    let row: string;
    let seatFrom: string;
    let seatTo: string;
    let total: string;
    let qty: string;
    let sourceType: string;

    if (axs) {
      section = parseAxsSection(combined);
      row = parseAxsRow(combined);
      [seatFrom, seatTo] = parseAxsSeats(combined);
      total = parseAxsTotal(combined);
      qty = parseAxsQty(combined);
      sourceType = "axs";
    } else {
      section = parseSection(combined);
      row = parseRow(combined);
      [seatFrom, seatTo] = parseSeats(combined);
      total = parseTotal(combined);
      qty = parseQty(bodyText);
      sourceType = bookingRef.includes("/UK") ? "ticketmaster_direct" : "ticketmaster_resale";
    }

    const orderData: OrderInsert = {
      booking_ref: bookingRef,
      event_name: axs ? parseAxsEvent(subject) : parseEvent(combined),
      venue: axs ? parseAxsVenue(combined) : parseVenue(bodyText),
      event_date: axs ? parseAxsDate(combined) : parseDateField(combined),
      purchased_at: msg.receivedDateTime || "",
      account_email: accountEmail,
      section,
      row,
      seat_from: seatFrom,
      seat_to: seatTo,
      qty_bought: qty ? Number.parseInt(qty, 10) : null,
      total_cost: total ? Number.parseFloat(total) : null,
      source_type: sourceType,
      user_id: userId,
    };

    if (existingOrder) {
      if (existingOrder.listing_status === "Ignored") continue;
      const { error } = await supabase
        .from("orders")
        .update({
          event_name: orderData.event_name || existingOrder.event_name,
          venue: orderData.venue || existingOrder.venue,
          event_date: orderData.event_date || existingOrder.event_date,
          purchased_at: orderData.purchased_at || existingOrder.purchased_at,
          account_email: orderData.account_email || existingOrder.account_email,
          section: orderData.section || existingOrder.section,
          row: orderData.row || existingOrder.row,
          seat_from: orderData.seat_from || existingOrder.seat_from,
          seat_to: orderData.seat_to || existingOrder.seat_to,
          qty_bought: orderData.qty_bought ?? existingOrder.qty_bought,
          total_cost: orderData.total_cost ?? existingOrder.total_cost,
          listing_status:
            existingOrder.listing_status === "Archived"
              ? "Unlisted"
              : existingOrder.listing_status ?? "Unlisted",
          source_type: orderData.source_type || existingOrder.source_type,
        })
        .eq("id", existingOrder.id);

      if (error) throw new Error(error.message);

      updated += 1;
      updatedRefs.push(bookingRef);
    } else {
      const { error } = await supabase.from("orders").insert(orderData);
      if (error) throw new Error(error.message);
      inserted += 1;
      insertedRefs.push(bookingRef);
    }

    await markMessageRead(accessToken, msg.id);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", outlookAccount.id);

  return {
    scanned: messages.length,
    inserted,
    updated,
    insertedRefs,
    updatedRefs,
    email: outlookAccount.email,
  };
}

// ── Token management ──────────────────────────────────────────────────────────

async function getValidAccessToken({
  supabase,
  outlookAccount,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookAccount;
}) {
  if (!outlookAccount.refresh_token || !outlookAccount.token_expiry || !outlookAccount.access_token) {
    return outlookAccount.access_token || "";
  }

  const expiresAt = new Date(outlookAccount.token_expiry);
  const refreshWindow = Date.now() + 60_000;

  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > refreshWindow) {
    return outlookAccount.access_token;
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth env vars are missing");

  const response = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: outlookAccount.refresh_token,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    },
  );

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to refresh Outlook token");
  }

  const nextExpiry = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : outlookAccount.token_expiry;

  await supabase
    .from("gmail_accounts")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || outlookAccount.refresh_token,
      token_expiry: nextExpiry,
      status: "Ready",
    })
    .eq("id", outlookAccount.id);

  return data.access_token;
}

// ── Graph API helpers ─────────────────────────────────────────────────────────

async function graphRequest<T>(accessToken: string, input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API error ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

async function listMessages(accessToken: string): Promise<GraphMessage[]> {
  const url = new URL(`${GRAPH_BASE}/me/messages`);
  url.searchParams.set("$search", `"${SEARCH_QUERY}"`);
  url.searchParams.set("$top", "20");
  url.searchParams.set("$select", "id,subject,body,from,toRecipients,receivedDateTime,isRead,internetMessageHeaders");

  const data = await graphRequest<{ value?: GraphMessage[] }>(
    accessToken,
    url.toString(),
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  return data.value || [];
}

async function markMessageRead(accessToken: string, messageId: string) {
  await graphRequest(
    accessToken,
    `${GRAPH_BASE}/me/messages/${messageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    },
  );
}

async function findExistingOrder(
  supabase: SupabaseClient,
  { bookingRef, userId }: { bookingRef: string; userId: string },
) {
  const { data, error } = await supabase
    .from("orders")
    .select("id, event_name, venue, event_date, purchased_at, account_email, section, row, seat_from, seat_to, qty_bought, total_cost, listing_status, source_type")
    .eq("booking_ref", bookingRef)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExistingOrder | null) ?? null;
}

// ── Account email extraction ──────────────────────────────────────────────────

const IGNORED_FRAGMENTS = ["ticketmaster", "amazon", "ebay", "stubhub", "noreply", "no-reply", "do-not-reply"];

function isAccountEmail(email: string) {
  if (!email) return false;
  return !IGNORED_FRAGMENTS.some((f) => email.includes(f));
}

function extractEmailAddress(header: string) {
  const angleMatch = header.match(/<([^>]+)>/);
  return (angleMatch?.[1] || header.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] || "").toLowerCase();
}

function extractAccountFromMessage(msg: GraphMessage, text: string): string {
  // Check forwarding/original-recipient headers first (same priority as Gmail)
  const headerPriority = [
    "X-Original-To",
    "Delivered-To",
    "X-Forwarded-To",
    "X-Forwarded-For",
    "Return-Path",
  ];

  for (const name of headerPriority) {
    const header = msg.internetMessageHeaders?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    );
    if (header) {
      const email = extractEmailAddress(header.value);
      if (isAccountEmail(email)) return email;
    }
  }

  // Fall back to To/From on the message envelope
  const candidates = [
    msg.toRecipients?.[0]?.emailAddress?.address,
    msg.from?.emailAddress?.address,
  ];

  for (const c of candidates) {
    const email = (c || "").toLowerCase();
    if (isAccountEmail(email)) return email;
  }

  const bodyPatterns = [
    /\b([A-Z0-9._%+-]+@gmail\.com)\b/i,
    /\b([A-Z0-9._%+-]+@outlook\.com)\b/i,
    /\b([A-Z0-9._%+-]+@hotmail\.com)\b/i,
    /\b([A-Z0-9._%+-]+@live\.com)\b/i,
    /\b([A-Z0-9._%+-]+@icloud\.com)\b/i,
    /\b([A-Z0-9._%+-]+@yahoo\.com)\b/i,
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  ];

  for (const pattern of bodyPatterns) {
    const match = text.match(pattern);
    const email = match?.[1]?.toLowerCase() || "";
    if (isAccountEmail(email)) return email;
  }

  return "";
}

// ── Text utilities ────────────────────────────────────────────────────────────

function stripHtml(text: string) {
  return text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|table|tbody|thead|tfoot|h[1-6])[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\ufeff/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Email parsers (same logic as gmail-sync) ──────────────────────────────────

function parseBookingRef(subject: string, text: string) {
  const simple = subject.match(/\b(RE\d+)\b/i)?.[1] || text.match(/\b(RE\d+)\b/i)?.[1];
  if (simple) return simple;

  const patterns = [
    /order number is\s*([0-9]{2}-[0-9]+\/UK\d+)/i,
    /\bORDER\b\s*#\s*([0-9]{2}-[0-9]+\/UK\d+)/i,
    /\b([0-9]{2}-[0-9]+\/UK\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function parseEvent(subject: string) {
  const orderUpdateMatch = subject.match(
    /Order Update\s+RE\d+\s+-\s+[A-Z0-9]+\s+-\s+(.+?)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}/i,
  );
  if (orderUpdateMatch?.[1]) return orderUpdateMatch[1].trim();

  const dayMatch = subject.match(/-\s*(.+?)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  if (dayMatch?.[1]) {
    return dayMatch[1].replace(/^[A-Z0-9]+\s+-\s+/i, "").trim();
  }

  const lines = subject.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.toLowerCase().includes("ticket confirmation")) {
      const cleaned = line
        .replace(/^fwd:\s*/i, "")
        .replace(/^you['']re in!\s*/i, "")
        .replace(/^your\s+/i, "")
        .replace(/\s*ticket confirmation$/i, "")
        .trim();
      if (cleaned) return cleaned;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/i.test(lines[i])) {
      const candidate = lines[i - 1]?.trim();
      if (candidate && !candidate.toLowerCase().includes("order")) return candidate;
    }
  }

  return "";
}

function parseDateField(subject: string) {
  return (
    subject.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday).*?\d{2}:\d{2})/i)?.[1] ||
    subject.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\b/i)?.[0] ||
    subject.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+[A-Z][a-z]{2}\s+\d{4}\s+[•\-]?\s*\d{1,2}:\d{2}\s*(?:am|pm)?\b/i)?.[0] ||
    ""
  );
}

function parseVenue(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(lines[i])) {
      const venue = lines[i - 1];
      if (venue && !venue.startsWith("Subject:")) return venue;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/i.test(lines[i])) {
      return lines[i + 1] || "";
    }
  }
  return "";
}

function parseQty(text: string) {
  const patterns = [
    /Ticket Quantity:\s*(\d+)/i,
    /x\s*(\d+)\s*:/i,
    /\b(\d+)x\s+Mobile Ticket\b/i,
    /\b(\d+)\s*x\s+.+Ticket\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function parseTotal(text: string) {
  const cleaned = cleanText(text);
  const directPatterns = [
    /Total\s*\(incl\. fee\)\s*[^\d]*([0-9]+\.[0-9]{2})/i,
    /Total\s*[^\d]*([0-9]+\.[0-9]{2})/i,
  ];
  for (const pattern of directPatterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return match[1];
  }
  const faceValueBlock = cleaned.match(/Face Value:([\s\S]{0,120})/i)?.[1] || "";
  return faceValueBlock.match(/[£Â]\s*([0-9]+\.[0-9]{2})/)?.[1] || "";
}

function parseSection(text: string) {
  const patterns = [
    /\bSECTION\s*[:\-]?\s*(.+?)(?=\s+\bROW\b|\s+\bSEAT(?:S)?\b|[\n\r]|$)/i,
    /\bSEC(?:TION)?\.?\s*[:\-]?\s*(.+?)(?=\s+\bROW\b|\s+\bSEAT(?:S)?\b|[\n\r]|$)/i,
    /\b(Pitch Standing|Standing|General Admission)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/^[ :\-]+|[ :\-]+$/g, "");
  }
  return "";
}

function parseRow(text: string) {
  return text.match(/\bROW\s*[:\-]?\s*([A-Z0-9]+)\b/i)?.[1]?.trim() || "";
}

function parseSeats(text: string): [string, string] {
  const patterns = [
    /\bSEAT(?:S)?\s*[:\-]?\s*(\d+)\s*(?:-|to|–)\s*(\d+)\b/i,
    /\bSEAT(?:S)?\s*[:\-]?\s*(\d+)\s*,\s*(\d+)\b/i,
    /\bSEAT(?:S)?\s*[:\-]?\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return [match[1], match[2] || match[1]];
  }
  return ["", ""];
}

// ── AXS ──────────────────────────────────────────────────────────────────────

function isAxsEmail(from: string, subject: string) {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  return f.includes("axs.co.uk") || f.includes("axs.com") || s.includes("thank you for purchasing tickets for");
}

function parseAxsBookingRef(text: string) {
  return (
    text.match(/confirmation\s+number\s+is\s+\*?(\d+)\*?/i)?.[1] ||
    text.match(/order\s+number\s+\*?(\d+)\*?/i)?.[1] ||
    ""
  );
}

function parseAxsEvent(subject: string) {
  return subject.match(/thank you for purchasing tickets for\s+(.+)/i)?.[1]?.trim() || "";
}

function parseAxsDate(text: string) {
  return (
    text.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}[^A-Z\n]{0,10}\d{1,2}:\d{2})/i)?.[1]?.trim() ||
    text.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i)?.[1]?.trim() ||
    ""
  );
}

function parseAxsVenue(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}/i.test(lines[i])) {
      const candidate = lines[i + 1];
      if (candidate && !/^\d+\s+Ticket/i.test(candidate)) {
        return candidate.replace(/^\[image:[^\]]*\]\s*/i, "").trim();
      }
    }
  }
  return "";
}

function parseAxsQty(text: string) {
  return text.match(/(\d+)\s+Tickets?\s*[-–]/i)?.[1] || "";
}

function parseAxsSection(text: string) {
  const compact = text.match(/\b(\w+)\|[A-Z0-9]+\|[\d-]+/i);
  if (compact) return compact[1];
  return (
    text.match(/(?:Regular|Floor|Block|Stand|Section|Sec)\s+(\S+)\s*\|/i)?.[1] ||
    text.match(/([^\s|]+)\s*\|\s*[A-Z0-9]+\s*\|\s*\d+/i)?.[1]?.trim() ||
    ""
  );
}

function parseAxsRow(text: string) {
  return (
    text.match(/\w+\s*\|\s*([A-Z0-9]+)\s*\|\s*\d+/i)?.[1]?.trim() || ""
  );
}

function parseAxsSeats(text: string): [string, string] {
  const rangeCompact = text.match(/\w+\|[A-Z0-9]+\|(\d+)[-–](\d+)/i);
  if (rangeCompact) return [rangeCompact[1], rangeCompact[2]];
  const rangeSpaced = text.match(/\|\s*[A-Z0-9]+\s*\|\s*(\d+)[-–](\d+)/i);
  if (rangeSpaced) return [rangeSpaced[1], rangeSpaced[2]];
  const single = text.match(/\|[A-Z0-9]+\|(\d+)/i) || text.match(/\|\s*[A-Z0-9]+\s*\|\s*(\d+)/i);
  if (single) return [single[1], single[1]];
  return ["", ""];
}

function parseAxsTotal(text: string) {
  const matches = [...text.matchAll(/Total[:\s]+\*?[£$€]?\s*([0-9]+\.[0-9]{2})\*?/gi)];
  return matches.at(-1)?.[1] || "";
}

