import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SEARCH_QUERY = "ticketmaster OR axs OR seetickets OR gigsandtours OR eventim OR royalalberthall";

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
    const intl = !axs && isIntlTmEmail(fromAddress, subject);
    const eventimDe = !axs && !intl && isEventimDeEmail(fromAddress, subject, combined);
    const seeGigs = !axs && !intl && !eventimDe && isSeeGigsEmail(fromAddress, subject, combined);
    const rah = !axs && !intl && !eventimDe && !seeGigs && isRahEmail(fromAddress, combined);
    const effectiveFrom = intl ? getEffectiveFrom(fromAddress, subject, combined) : fromAddress;

    const bookingRef = axs
      ? parseAxsBookingRef(combined)
      : intl
        ? parseIntlBookingRef(effectiveFrom, subject, combined)
        : eventimDe
          ? parseEventimDeBookingRef(subject, combined)
          : seeGigs
            ? parseSeeGigsBookingRef(subject, combined)
            : rah
              ? parseRahBookingRef(combined)
              : parseBookingRef(subject, combined);
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
    } else if (intl) {
      const restrictionsIdx = combined.search(/\bRestrictions?\s*:/i);
      const combinedBeforeRestrictions = restrictionsIdx > 0 ? combined.slice(0, restrictionsIdx) : combined;
      section = parseSection(combined);
      row = parseRow(combinedBeforeRestrictions);
      [seatFrom, seatTo] = parseSeats(combined);
      qty = parseIntlQty(combined);
      sourceType = getIntlSourceType(effectiveFrom, subject);
      total = parseIntlTotal(combined);
    } else if (eventimDe) {
      section = parseEventimDeSection(combined);
      row = parseRow(combined);
      [seatFrom, seatTo] = parseSeats(combined);
      qty = parseEventimDeQty(combined);
      sourceType = "eventim_de";
      total = parseEventimDeTotal(combined);
    } else if (seeGigs) {
      section = parseSeeGigsSection(combined);
      row = parseRow(combined);
      [seatFrom, seatTo] = parseSeats(combined);
      qty = parseSeeGigsQty(combined);
      sourceType = getSeeGigsSourceType(fromAddress, combined);
      total = parseSeeGigsTotal(combined);
    } else if (rah) {
      section = parseRahSection(combined);
      row = parseRow(combined);
      [seatFrom, seatTo] = parseSeats(combined);
      qty = parseRahQty(combined);
      sourceType = "royal_albert_hall";
      total = parseRahTotal(combined);
    } else {
      section = parseSection(combined);
      row = parseRow(combined);
      [seatFrom, seatTo] = parseSeats(combined);
      total = parseTotal(combined);
      qty = parseQty(bodyText);
      sourceType = bookingRef.includes("/UK") ? "ticketmaster_direct" : bookingRef.includes("/IE") ? "ticketmaster_ie" : "ticketmaster_resale";
    }

    const orderData: OrderInsert = {
      booking_ref: bookingRef,
      event_name: axs ? parseAxsEvent(subject) : intl ? parseIntlEventOutlook(effectiveFrom, subject, combined) : eventimDe ? parseEventimDeEvent(subject) : seeGigs ? parseSeeGigsEvent(subject, combined) : rah ? parseRahEvent(combined) : parseEvent(combined),
      venue: axs ? parseAxsVenue(combined) : intl ? parseIntlVenueOutlook(effectiveFrom, combined) : eventimDe ? parseEventimDeVenue(combined) : seeGigs ? parseSeeGigsVenue(combined) : rah ? "Royal Albert Hall" : parseVenue(bodyText),
      event_date: axs ? parseAxsDate(combined) : intl ? parseIntlDateOutlook(effectiveFrom, combined) : eventimDe ? parseEventimDeDate(combined) : seeGigs ? parseSeeGigsDate(combined) : rah ? parseRahDate(combined) : parseDateField(combined),
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

const IGNORED_FRAGMENTS = [
  "ticketmaster", "amazon", "ebay", "stubhub", "axs.com", "axs.co.uk",
  "seetickets", "gigsandtours", "eventim", "viagogo", "tixr.com",
  "dice.fm", "seatgeek.com", "mandrillapp", "noreply", "no-reply",
  "do-not-reply", "bounces+", "bounce+", "bounce-", "mailer-daemon",
  "inbound.tixtracker.app", "vortexmail.space",
];

function isAccountEmail(email: string) {
  if (!email) return false;
  return !IGNORED_FRAGMENTS.some((f) => email.includes(f));
}

function extractEmailAddress(header: string) {
  const angleMatch = header.match(/<([^>]+)>/);
  return (angleMatch?.[1] || header.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] || "").toLowerCase();
}

function extractAccountFromMessage(msg: GraphMessage, text: string): string {
  const allHeaders = msg.internetMessageHeaders ?? [];

  // X-Forwarded-For: Gmail stamps one per hop in newest-first order.
  // The LAST header (innermost hop) has the original recipient first.
  const xffHeaders = allHeaders
    .filter((h) => h.name.toLowerCase() === "x-forwarded-for")
    .map((h) => h.value);
  for (let i = xffHeaders.length - 1; i >= 0; i--) {
    const m = xffHeaders[i].match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    const addr = m?.[1]?.toLowerCase() ?? "";
    if (isAccountEmail(addr)) return addr;
  }

  // Delivered-To / X-Original-To: headers arrive newest-first.
  // Try from LAST (innermost = original recipient) to first (outermost = relay).
  for (const multiHeader of ["delivered-to", "x-original-to"]) {
    const vals = allHeaders
      .filter((h) => h.name.toLowerCase() === multiHeader)
      .map((h) => extractEmailAddress(h.value));
    for (let i = vals.length - 1; i >= 0; i--) {
      if (isAccountEmail(vals[i])) return vals[i];
    }
  }

  // Single-value routing headers
  for (const name of ["X-Forwarded-To", "Return-Path"]) {
    const header = allHeaders.find((h) => h.name.toLowerCase() === name.toLowerCase());
    if (header) {
      const email = extractEmailAddress(header.value);
      if (isAccountEmail(email)) return email;
    }
  }

  // Envelope To/From fallback
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
  // Require 5+ digits — RE26/RE2026 appear in non-ticket promotional emails
  const simple = subject.match(/\b(RE\d{5,})\b/i)?.[1] || text.match(/\b(RE\d{5,})\b/i)?.[1];
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

function stripForwardingPreamble(text: string): string {
  const fwdMatch = text.match(/^-{5,}\s*Forwarded message\s*-{5,}/im);
  if (!fwdMatch) return text;
  const afterSep = text.slice(fwdMatch.index! + fwdMatch[0].length);
  const blankMatch = afterSep.match(/\n[ \t]*\n/);
  return blankMatch ? afterSep.slice(blankMatch.index! + blankMatch[0].length) : afterSep;
}

function parseVenue(text: string) {
  const lines = stripForwardingPreamble(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(lines[i])) {
      const venue = lines[i - 1];
      if (venue && !venue.startsWith("Subject:")) return venue;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const candidate = lines[j];
        if (/^\d{1,2}:\d{2}/.test(candidate)) continue;
        if (/^\d+\s*(x\s*)?(ticket)/i.test(candidate)) break;
        if (candidate) return candidate;
      }
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

// ── International Ticketmaster (FR / DK) ─────────────────────────────────────

function isIntlTmEmail(from: string, subject: string): boolean {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  return (
    f.includes("ticketmaster.de") ||
    f.includes("ticketmaster.es") ||
    f.includes("ticketmaster.it") ||
    f.includes("ticketmaster.ie") ||
    f.includes("ticketmaster.fr") ||
    f.includes("ticketmaster.dk") ||
    s.includes("you got tickets to") ||
    s.includes("your ticketmaster order") ||
    s.startsWith("order confirm ") ||
    s.includes("confirmacion de compra") ||
    s.includes("confirmación de compra") ||
    /^(?:fwd:\s*)?confirmation de votre commande\s+\d+\s*$/i.test(s) ||
    /ticketmaster confirmation for order number/i.test(s)
  );
}

function getEffectiveFrom(from: string, subject: string, text: string = ""): string {
  if (from.toLowerCase().includes("ticketmaster")) return from;
  const s = subject.toLowerCase();
  const t = text.toLowerCase();
  if (s.includes("confirmacion de compra") || s.includes("confirmación de compra")) return "noreply@ticketmaster.es";
  if (/^(?:fwd:\s*)?order\s+confirm\s+\d/i.test(s)) return "noreply@ticketmaster.it";
  if (/^(?:fwd:\s*)?confirmation de votre commande\s+\d+\s*$/i.test(s)) return "noreply@ticketmaster.fr";
  if (/ticketmaster confirmation for order number/i.test(s)) return "noreply@ticketmaster.dk";
  if (s.includes("your ticketmaster order")) {
    if (t.includes("ticketmaster.ie")) return "noreply@ticketmaster.ie";
    return "noreply@ticketmaster.de";
  }
  return from;
}

function getIntlSourceType(from: string, subject: string): string {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  if (f.includes("ticketmaster.de")) return "ticketmaster_de";
  if (f.includes("ticketmaster.es")) return "ticketmaster_es";
  if (f.includes("ticketmaster.it")) return "ticketmaster_it";
  if (f.includes("ticketmaster.ie")) return "ticketmaster_ie";
  if (f.includes("ticketmaster.fr")) return "ticketmaster_fr";
  if (f.includes("ticketmaster.dk")) return "ticketmaster_dk";
  if (s.includes("you got tickets") || f.includes("email.ticketmaster.com")) return "ticketmaster_us";
  return "ticketmaster_direct";
}

function parseIntlBookingRef(from: string, subject: string, text: string): string {
  const f = from.toLowerCase();
  const usRef = text.match(/\bOrder\s*#\s*([0-9]{1,3}-[0-9]+\/[A-Z0-9]+)/i)?.[1];
  if (usRef) return usRef;
  if (f.includes("ticketmaster.de")) {
    const ref = text.match(/ORDER\s+NUMBER\s*:?\s*(\d{5,})/i)?.[1];
    if (ref) return `DE-${ref}`;
  }
  if (f.includes("ticketmaster.es")) {
    const ref =
      text.match(/(?:N[ÚU]MERO\s+DE\s+REFERENCIA)\s*:?\s*(\d{5,})/i)?.[1] ||
      subject.match(/referencia\s+0*(\d{5,})/i)?.[1];
    if (ref) return `ES-${ref}`;
  }
  if (f.includes("ticketmaster.it")) {
    const ref = text.match(/Order\s+number[\s\n\r:]*(\d{5,})/i)?.[1];
    if (ref) return `IT-${ref}`;
  }
  if (f.includes("ticketmaster.ie")) {
    const ref = subject.match(/\b(RE\d{5,})\b/i)?.[1] || text.match(/\b(RE\d{5,})\b/i)?.[1];
    if (ref) return ref;
  }
  if (f.includes("ticketmaster.fr")) {
    const ref = subject.match(/Confirmation de votre commande\s+(\d+)/i)?.[1];
    if (ref) return `FR-${ref}`;
  }
  if (f.includes("ticketmaster.dk")) {
    const ref =
      text.match(/ORDER\s+NUMBER\s*:?\s*(\d+)/i)?.[1] ||
      subject.match(/Ticketmaster confirmation for order number\s+(\d+)/i)?.[1];
    if (ref) return `DK-${ref}`;
  }
  return "";
}

function parseIntlQty(text: string): string {
  return (
    text.match(/Ticket\s+Quantity\s*:\s*(\d+)/i)?.[1] ||
    text.match(/([1-9]\d{0,2})\s*x\s+(?:tickets?|Mobile Ticket)/i)?.[1] ||
    text.match(/([1-9]\d{0,2})\s+billets?\b/i)?.[1] ||
    text.match(/([1-9]\d{0,2})\s+tickets?\b/i)?.[1] ||
    text.match(/([1-9]\d{0,2})\s+entradas?(?:\/s|\(s\))?\b/i)?.[1] ||
    text.match(/^([1-9]\d{0,2})\s*x\b/im)?.[1] ||
    ""
  );
}

function parseIntlTotal(text: string): string {
  const cleaned = cleanText(text);
  const dkkM = cleaned.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})\s*DKK/i);
  if (dkkM) return `${dkkM[1].replace(/\./g, "")}.${dkkM[2]}`;
  const resumenM = cleaned.match(/RESUMEN\s+DE\s+PAGO[\s\S]{0,500}?\*?(\d{1,3}(?:\.\d{3})+),(\d{2})\s*(?:EUR|€|[^\d\w\s]|\*|\n|$)/i);
  if (resumenM) return `${resumenM[1].replace(/\./g, "")}.${resumenM[2]}`;
  const eurThousands = cleaned.match(/(\d{1,3}(?:\.\d{3})+),(\d{2})\s*(?:EUR|€|[^\d\w\s])/i);
  if (eurThousands) return `${eurThousands[1].replace(/\./g, "")}.${eurThousands[2]}`;
  const eurComma = cleaned.match(/(\d{1,6}),(\d{2})\s*(?:EUR|€|[^\d\w\s])/i);
  if (eurComma) return `${eurComma[1]}.${eurComma[2]}`;
  // Anchored to Total: — handles IE/UK 2-column plain-text where amount follows "Total:" by several lines
  const totalContextM = cleaned.match(/\bTotal\s*:\s*[^€£$\d]*(€|£|\$)\s*(\d[\d,]*\.\d{2})/i);
  if (totalContextM) return totalContextM[2].replace(/,/g, "");
  const eurDot =
    cleaned.match(/(?:€|EUR)\s*(\d+\.\d{2})/i)?.[1] ||
    cleaned.match(/(\d+\.\d{2})\s*(?:€|EUR)/i)?.[1];
  if (eurDot) return eurDot;
  const usdTotal = [...cleaned.matchAll(/Total[:\s&]+\$\s*([\d,]+\.\d{2})/gi)];
  if (usdTotal.length > 0) return (usdTotal.at(-1)?.[1] ?? "").replace(/,/g, "");
  const usdBare = cleaned.match(/\$\s*([0-9]+\.[0-9]{2})/);
  if (usdBare) return usdBare[1];
  return "";
}

const EN_MONTHS_OUTLOOK: Record<string, string> = {
  january: "Jan", february: "Feb", march: "Mar", april: "Apr", may: "May",
  june: "Jun", july: "Jul", august: "Aug", september: "Sep",
  october: "Oct", november: "Nov", december: "Dec",
};

function parseIntlEventOutlook(from: string, subject: string, text: string): string {
  const f = from.toLowerCase();
  const usMatch = subject.match(/You Got Tickets To\s+(.+)/i);
  if (usMatch) return usMatch[1].trim();
  const esMatch = subject.match(/Confirmaci[oó]n\s+de\s+compra\s+para\s+(.+?),?\s*n[uú]mero\s+de\s+referencia/i);
  if (esMatch) return esMatch[1].trim();
  if (f.includes("ticketmaster.de")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/ORDER\s+NUMBER/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const c = lines[j];
          if (c && c.length > 8 && !/^\d+\s*x/i.test(c) && !/^(Level|Section|Seat|Ticket|Mobile|View)/i.test(c)) return c;
        }
      }
    }
  }
  if (f.includes("ticketmaster.ie")) {
    const sm = subject.match(/-\s*(.+?)\s*-\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
    if (sm?.[1]) return sm[1].trim();
    const dm = subject.match(/-\s*(.+?)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
    if (dm?.[1]) return dm[1].trim();
  }
  if (f.includes("ticketmaster.fr")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}/i.test(lines[i])) {
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const c = lines[j];
          if (c && c.length > 3 && !/^\d/.test(c) && !/^(?:Votre|Confirmation|Cher|Dear|Ticketmaster|billets?)/i.test(c)) return c;
        }
      }
    }
  }
  if (f.includes("ticketmaster.dk")) {
    const sm = subject.match(/Ticketmaster confirmation for order number\s+\d+\s*-\s*(.+)/i);
    if (sm?.[1]) return sm[1].trim();
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/ORDER\s+NUMBER\s*:?\s*\d+/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const c = lines[j];
          if (c && c.length > 3 && !/^\d/.test(c) && !/^(?:YOU\s+GOT|Order|Total|Level|Section)/i.test(c)) return c;
        }
      }
    }
  }
  return "";
}

function parseIntlVenueOutlook(from: string, text: string): string {
  const f = from.toLowerCase();
  // IE: venue is the line immediately before the date (not after — after is "Ticket Quantity:")
  if (f.includes("ticketmaster.ie")) {
    const ieLines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < ieLines.length; i++) {
      if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(ieLines[i]) ||
          /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}/i.test(ieLines[i])) {
        if (i > 0) {
          const before = ieLines[i - 1];
          if (before &&
              !/^ORDER\s*#/i.test(before) &&
              !/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(before)) {
            return before;
          }
        }
        for (let j = i + 1; j < Math.min(i + 4, ieLines.length); j++) {
          const candidate = ieLines[j];
          if (/^\d{1,2}:\d{2}/.test(candidate)) continue;
          if (/^(?:Ticket\s+Quantity|\d+\s*(x\s*)?ticket)/i.test(candidate)) break;
          if (candidate) return candidate;
        }
      }
    }
    return "";
  }
  if (f.includes("ticketmaster.fr")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const c = lines[j];
          if (c && c.length > 3 && !/^\d/.test(c) && !/^billets?/i.test(c) && !/^(?:Votre|Confirmation|Cher|Dear|Ticketmaster)/i.test(c)) return c;
        }
      }
    }
    return "";
  }
  if (f.includes("ticketmaster.dk")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+/i.test(lines[i])) {
        const c = lines[i - 1];
        if (c && c.length > 2 && !/^\d/.test(c) && !/^(?:ORDER|YOU\s+GOT)/i.test(c)) return c;
      }
    }
    return "";
  }
  if (f.includes("ticketmaster.de")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      if (/(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)/i.test(lines[i])) {
        const c = lines[i - 1];
        if (c && c.length > 3 && !/^\d+\s*x/i.test(c)) return c;
      }
    }
  }
  const usAnchor = text.search(/Order\s*#/i);
  const usText = usAnchor >= 0 ? text.slice(usAnchor) : text;
  const usLines = usText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < usLines.length; i++) {
    if (/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).+\d{4}/i.test(usLines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, usLines.length); j++) {
        const c = usLines[j].replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
        if (c.length > 5 && !/^(?:subject:|date:|from:|to:|get\s+dir|view\s+|transfer|manage\s+|important|download|your\s+ticket|section|sec\b|row\b|seat)/i.test(c)) return c;
      }
    }
  }
  return "";
}

function parseIntlDateOutlook(from: string, text: string): string {
  const f = from.toLowerCase();
  if (f.includes("ticketmaster.de")) {
    const DE_MONTHS: Record<string, string> = {
      januar: "Jan", februar: "Feb", märz: "Mar", april: "Apr", mai: "May",
      juni: "Jun", juli: "Jul", august: "Aug", september: "Sep",
      oktober: "Oct", november: "Nov", dezember: "Dec",
    };
    const m = text.match(/(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\s+(\d{1,2})\.\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})/i);
    if (m) return `${m[1]} ${DE_MONTHS[m[2].toLowerCase()] ?? m[2]} ${m[3]}`;
  }
  if (f.includes("ticketmaster.ie")) return parseDateField(text);
  if (f.includes("ticketmaster.fr")) {
    const m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}:\d{2})\b/i);
    if (m) return `${m[1]} ${m[2]} ${m[3]} · ${m[4]}`;
    const m2 = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);
    if (m2) return `${m2[1]} ${m2[2]} ${m2[3]}`;
    return "";
  }
  if (f.includes("ticketmaster.dk")) {
    const m = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})(?:\s+at\s+(\d{1,2}:\d{2}))?/i);
    if (m) {
      const month = EN_MONTHS_OUTLOOK[m[2].toLowerCase()] ?? m[2];
      const time = m[4] ? ` · ${m[4]}` : "";
      return `${m[1]} ${month} ${m[3]}${time}`;
    }
    return "";
  }
  const usAnchor = text.search(/Order\s*#/i);
  const usText = usAnchor >= 0 ? text.slice(usAnchor) : text;
  const usM = usText.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*[·,\s]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:\s*[·,]?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i);
  if (usM) return usM[1].trim();
  const usDate = usText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i)?.[1];
  if (usDate) return usDate;
  return "";
}

// ── Eventim DE ───────────────────────────────────────────────────────────────

function isEventimDeEmail(from: string, subject: string, text: string = ""): boolean {
  const f = from.toLowerCase();
  if (f.includes("eventim.de")) return true;
  const s = subject.toLowerCase();
  const t = text.toLowerCase();
  return (
    s.includes("eventim-bestellung") ||
    (t.includes("eventim.de") && t.includes("bestellnummer"))
  );
}

const EVENTIM_MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseEventimDeBookingRef(subject: string, text: string): string {
  const fromSubject = subject.match(/Bestellnummer\s+(\d+)/i)?.[1];
  if (fromSubject) return `EVDE-${fromSubject}`;
  const fromBody = text.match(/(?:Ordernummer|Bestellnummer)\s*:?\s*\*?(\d{6,})/i)?.[1];
  if (fromBody) return `EVDE-${fromBody}`;
  return "";
}

function parseEventimDeEvent(subject: string): string {
  const m = subject.match(/EVENTIM-Bestellung[:\s]+(.+?)\s*-\s*Bestellnummer\s+\d+/i);
  return m?.[1]?.trim() || "";
}

function parseEventimDeDate(text: string): string {
  const m = text.match(/(?:Mo|Di|Mi|Do|Fr|Sa|So)\.,?\s+(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*(\d{2}:\d{2})/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthIdx = parseInt(m[2], 10) - 1;
    const year = m[3];
    const time = m[4];
    const month = EVENTIM_MONTH_ABBR[monthIdx] ?? m[2];
    return `${day} ${month} ${year} · ${time}`;
  }
  return "";
}

function parseEventimDeVenue(text: string): string {
  return text.match(/Ort:\s*\n\s*([^\n]+)/i)?.[1]?.trim() || "";
}

function parseEventimDeQty(text: string): string {
  return text.match(/(\d+)\s*[×x]\s*(?:€|EUR)/i)?.[1] || "";
}

function parseEventimDeSection(text: string): string {
  return text.match(/^(Block\s+[^\n,]+)/m)?.[1]?.trim() || "";
}

function parseEventimDeTotal(text: string): string {
  const m = text.match(/(?:Gesamtsumme|Gesamtwert)[^€\d]{0,40}€\s*([\d.]+),([\d]{2})/i);
  if (m) return `${m[1].replace(/\./g, "")}.${m[2]}`;
  return "";
}

// ── See Tickets UK / Gigs & Tours UK ─────────────────────────────────────────

function isSeeGigsEmail(from: string, subject: string = "", text: string = ""): boolean {
  const f = from.toLowerCase();
  if (f.includes("seetickets.com") || f.includes("gigsandtours.com")) return true;
  const s = subject.toLowerCase();
  const t = text.toLowerCase();
  return (
    s.includes("ticket order confirmation") &&
    (t.includes("gigsandtours.com") || t.includes("seetickets.com"))
  );
}

function getSeeGigsSourceType(from: string, text: string = ""): string {
  const f = from.toLowerCase();
  const t = text.toLowerCase();
  if (f.includes("gigsandtours.com") || t.includes("gigsandtours.com")) return "gigs_and_tours_uk";
  return "see_tickets_uk";
}

function parseSeeGigsBookingRef(subject: string, text: string): string {
  return (
    text.match(/BOOKING REFERENCE\s+(\d+)/i)?.[1] ||
    subject.match(/Ticket Order Confirmation\s+(\d+)/i)?.[1] ||
    ""
  );
}

function parseSeeGigsEvent(subject: string, text: string): string {
  const cleanSubject = subject.replace(/^(?:(?:fwd?|fw)\s*:\s*)*/i, "").trim();
  const subjectArtist = cleanSubject.match(/^(.+?)\s+-\s+Ticket Order Confirmation\s+\d+\s*$/i)?.[1];
  if (subjectArtist) return subjectArtist.trim();
  const confirmed = text.match(/Order confirmed:\s*([^\n]+)/i)?.[1];
  if (confirmed) return confirmed.trim();
  const titleM = text.match(/Booking confirmation for\s+(.+?)\s+at\s+/i)?.[1];
  if (titleM) return titleM.trim();
  return "";
}

function parseSeeGigsDate(text: string): string {
  return (
    text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}\s+\w{3,}\s+\d{4}\s+at\s+[\d.]+/i)?.[0] ||
    ""
  );
}

function parseSeeGigsVenue(text: string): string {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\d{1,2}\s+\w{3,}\s+\d{4}/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const c = lines[j];
        if (/^Doors open/i.test(c)) continue;
        if (/^\d{1,2}[.:]\d{2}/.test(c)) continue;
        if (c && c.length > 3) return c;
      }
    }
  }
  return "";
}

function parseSeeGigsTotal(text: string): string {
  const m = text.match(/charged a total of\s+£([\d,]+\.\d{2})/i);
  if (m) return m[1].replace(/,/g, "");
  const t = text.match(/\bTotal\b[^£\n]{0,20}£\s*([\d,.]+)/i);
  if (t) return t[1].replace(/,/g, "");
  return "";
}

function parseSeeGigsSection(text: string): string {
  const inlineM = text.match(/([A-Za-z][A-Za-z ]+)\s+Block:\s*\w+\s*-\s*Row:/i);
  if (inlineM) return inlineM[1].trim();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    if (/Block:\s*\w+\s*-\s*Row:/i.test(lines[i])) {
      const prev = lines[i - 1];
      if (prev && /^[A-Za-z]/.test(prev) && prev.length < 60 && !/^(?:BOOKING|Your|Order|Ticket|Date|Total|Dear|We|Please|Thank)/i.test(prev)) return prev;
    }
  }
  return "";
}

function parseSeeGigsQty(text: string): string {
  return text.match(/(\d+)\s*x\s*Seats?/i)?.[1] || "";
}

// ── Royal Albert Hall ─────────────────────────────────────────────────────────
function isRahEmail(from: string, text: string): boolean {
  if (from.toLowerCase().includes("royalalberthall.com")) return true;
  const t = text.toLowerCase();
  return t.includes("royalalberthall.com") && t.includes("order number");
}

function parseRahBookingRef(text: string): string {
  const n = text.match(/Order\s+Number\s+is\s+#(\d+)/i)?.[1];
  return n ? `RAH-${n}` : "";
}

function parseRahEvent(text: string): string {
  const anchor = text.search(/Item\(s\)\s+Quantity\s+Price/i);
  const haystack = anchor >= 0 ? text.slice(anchor) : text;
  const lines = haystack.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(.+?)(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+/i);
    if (m) return m[1].trim();
  }
  return "";
}

function parseRahDate(text: string): string {
  return (
    text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+\w+\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i)?.[0] ||
    text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+\w+\s+\d{4}/i)?.[0] ||
    ""
  );
}

function parseRahSection(text: string): string {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][^\n]*?)\s+Row\s+\d+\s+Seat\s+\d+/i);
    if (m) {
      const suffix = m[1].trim();
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const cleanPrev = lines[j].replace(/^.*?>\s*/, "").trim();
        if (cleanPrev && /^[A-Za-z]/.test(cleanPrev) && cleanPrev.length < 40 && !/^(?:Dear|Thank|Your|Order|Item|Add|View|Forward|ticket)/i.test(cleanPrev)) {
          return `${cleanPrev} ${suffix}`;
        }
      }
      return suffix;
    }
  }
  return "";
}

function parseRahQty(text: string): string {
  return text.match(/-\s*(\d+)\s*x\s+\w/i)?.[1] || text.match(/(\d+)\s+x\s+(?:Standard|Premium|Adult|Child)/i)?.[1] || "";
}

function parseRahTotal(text: string): string {
  return text.match(/Basket\s+total[^£]*£\s*([\d.]+)/i)?.[1] || "";
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

