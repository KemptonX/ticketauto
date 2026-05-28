import type { SupabaseClient } from "@supabase/supabase-js";

let _rateCache: { rates: Record<string, number>; fetchedAt: number } | null = null;

async function getGbpRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_rateCache && now - _rateCache.fetchedAt < 3_600_000) return _rateCache.rates;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=GBP", { cache: "no-store" });
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (data.rates) {
      _rateCache = { rates: data.rates, fetchedAt: now };
      return data.rates;
    }
  } catch { /* fall through */ }
  return {};
}

function isEventInPast(eventDate: string): boolean {
  if (!eventDate) return false;
  const cleaned = eventDate
    .replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/i, "")
    .replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i, "")
    .replace(/\s*[•·\-]\s*\d{1,2}:\d{2}.*$/, "")
    .trim();
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return false;
  return d < new Date();
}

async function convertToGbp(rawAmount: string, currency: string): Promise<string> {
  if (!rawAmount) return "";
  const num = parseFloat(rawAmount);
  if (isNaN(num) || num <= 0) return "";
  const rates = await getGbpRates();
  const rate = rates[currency];
  if (!rate) return rawAmount; // fallback: keep original if rate unavailable
  return String(Math.round((num / rate) * 100) / 100);
}

const GMAIL_QUERY = [
  '(ticketmaster -subject:"Welcome to Ticketmaster" ("Order Update" OR "ticket confirmation" OR "You\'re in!" OR "You Got Tickets" OR "Your Ticketmaster order" OR "Order confirm" OR "Confirmacion de compra" OR "compra para" OR "ORDER NUMBER" OR "Order number"))',
  '(subject:"Thank you for purchasing tickets for" "AXS Mobile ID")',
].join(' OR ');
const GMAIL_QUERY_FILTERED = `is:unread newer_than:14d (${GMAIL_QUERY})`;
const PROCESSED_LABEL = "My Tickets";
const FORWARD_TO_ACCOUNT = "kemptoncameron9x@gmail.com";

type GmailAccount = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type GmailHeader = {
  name: string;
  value: string;
};

type GmailPayload = {
  mimeType?: string;
  body?: { data?: string };
  headers?: GmailHeader[];
  parts?: GmailPayload[];
};

type GmailMessage = {
  id: string;
  payload: GmailPayload;
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
  listing_status: string;
  user_id: string;
  email_html: string | null;
};

export type NormalisedEmail = {
  from: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  headers: Array<{ name: string; value: string }>;
};

export type ProcessResult = {
  action: "inserted" | "updated" | "ignored" | "no_ref";
  bookingRef: string | null;
};

export async function processNormalisedEmail(
  supabase: SupabaseClient,
  email: NormalisedEmail,
  userId: string,
  fallbackAccountEmail: string,
): Promise<ProcessResult> {
  const combined = cleanText(`${email.subject}\n${email.body}`);

  const axs = isAxsEmail(email.from, email.subject);
  const intl = !axs && isIntlTmEmail(email.from, email.subject);
  const effectiveFrom = intl ? getEffectiveFrom(email.from, email.subject) : email.from;

  const bookingRef = axs
    ? parseAxsBookingRef(combined)
    : intl
      ? parseIntlBookingRef(effectiveFrom, email.subject, combined)
      : parseBookingRef(email.subject, combined);

  if (!bookingRef) {
    return { action: "no_ref", bookingRef: null };
  }

  const accountEmail = extractAccount(email.headers, combined) || fallbackAccountEmail;
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
    section = parseSection(combined);
    row = parseRow(combined);
    [seatFrom, seatTo] = parseSeats(combined);
    qty = parseIntlQty(combined);
    sourceType = getIntlSourceType(effectiveFrom, email.subject);
    const rawTotal = parseIntlTotal(combined);
    const intlCurrency = SOURCE_CURRENCY[sourceType] ?? "EUR";
    total = await convertToGbp(rawTotal, intlCurrency);

    if (!qty && seatFrom && seatTo) {
      const sf = parseInt(seatFrom, 10);
      const st = parseInt(seatTo, 10);
      if (!isNaN(sf) && !isNaN(st) && st >= sf && st - sf < 20) {
        qty = String(st - sf + 1);
      }
    }
  } else {
    section = parseSection(combined);
    row = parseRow(combined);
    [seatFrom, seatTo] = parseSeats(combined);
    total = parseTotal(combined);
    qty = parseQty(email.body);
    sourceType = bookingRef.includes("/UK") ? "ticketmaster_direct" : "ticketmaster_resale";
  }

  const orderData: OrderInsert = {
    booking_ref: bookingRef,
    event_name: axs ? parseAxsEvent(email.subject) : intl ? parseIntlEvent(effectiveFrom, email.subject, combined) : parseEvent(combined),
    venue: axs ? parseAxsVenue(combined) : intl ? parseIntlVenue(effectiveFrom, combined) : parseVenue(email.body),
    event_date: axs ? parseAxsDate(combined) : intl ? parseIntlDate(effectiveFrom, combined) : parseDate(combined),
    purchased_at: parsePurchasedAt(email.headers, combined),
    account_email: accountEmail,
    section,
    row,
    seat_from: seatFrom,
    seat_to: seatTo,
    qty_bought: qty ? Number.parseInt(qty, 10) : null,
    total_cost: total ? Number.parseFloat(total) : null,
    source_type: sourceType,
    listing_status: "Unlisted",
    user_id: userId,
    email_html: email.htmlBody,
  };

  const resolvedDate = orderData.event_date || existingOrder?.event_date || "";
  const pastEvent = isEventInPast(resolvedDate);

  if (existingOrder) {
    if (existingOrder.listing_status === "Ignored") {
      return { action: "ignored", bookingRef };
    }
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
        listing_status: existingOrder.listing_status === "Sold"
          ? "Sold"
          : pastEvent
            ? "Archived"
            : existingOrder.listing_status ?? "Unlisted",
        source_type: orderData.source_type || existingOrder.source_type,
        ...(orderData.email_html !== null ? { email_html: orderData.email_html } : {}),
      })
      .eq("id", existingOrder.id);

    if (error) {
      throw new Error(error.message);
    }
    return { action: "updated", bookingRef };
  }

  const { error } = await supabase.from("orders").insert({
    ...orderData,
    listing_status: pastEvent ? "Archived" : "Unlisted",
  });
  if (error) {
    if (error.code === "23505") return { action: "ignored", bookingRef };
    throw new Error(error.message);
  }
  return { action: "inserted", bookingRef };
}

export async function syncGmailInbox({
  supabase,
  gmailAccount,
  userId,
}: {
  supabase: SupabaseClient;
  gmailAccount: GmailAccount;
  userId: string;
}): Promise<SyncResult> {
  const accessToken = await getValidAccessToken({ supabase, gmailAccount });
  const labelId = await getOrCreateLabel(accessToken, PROCESSED_LABEL);
  const messages = await listMessages(accessToken, GMAIL_QUERY_FILTERED);

  // Fetch full message bodies in parallel batches of 10
  const BATCH_SIZE = 10;
  const fullMessages: GmailMessage[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(chunk.map((m) => getMessage(accessToken, m.id)));
    fullMessages.push(...fetched);
  }

  let inserted = 0;
  let updated = 0;
  const insertedRefs: string[] = [];
  const updatedRefs: string[] = [];

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const message = messages[msgIdx];
    const fullMessage = fullMessages[msgIdx];
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);

    const normEmail: NormalisedEmail = {
      from: getHeader(headers, "From"),
      subject,
      body,
      htmlBody: getRawHtml(fullMessage.payload) || null,
      headers,
    };

    const result = await processNormalisedEmail(supabase, normEmail, userId, gmailAccount.email);

    if (result.action === "no_ref") continue;

    await markMessageProcessed(accessToken, message.id, labelId);

    if (result.action === "inserted") {
      inserted += 1;
      insertedRefs.push(result.bookingRef!);
    } else if (result.action === "updated") {
      updated += 1;
      updatedRefs.push(result.bookingRef!);
    }
  }

  await supabase
    .from("gmail_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      status: "Ready",
    })
    .eq("id", gmailAccount.id);

  return {
    scanned: messages.length,
    inserted,
    updated,
    insertedRefs,
    updatedRefs,
    email: gmailAccount.email,
  };
}

async function getValidAccessToken({
  supabase,
  gmailAccount,
}: {
  supabase: SupabaseClient;
  gmailAccount: GmailAccount;
}) {
  if (!gmailAccount.refresh_token || !gmailAccount.token_expiry || !gmailAccount.access_token) {
    return gmailAccount.access_token || "";
  }

  const expiresAt = new Date(gmailAccount.token_expiry);
  const refreshWindow = Date.now() + 60_000;

  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > refreshWindow) {
    return gmailAccount.access_token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth env vars are missing");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: gmailAccount.refresh_token,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to refresh Gmail token");
  }

  const nextExpiry = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : gmailAccount.token_expiry;

  await supabase
    .from("gmail_accounts")
    .update({
      access_token: data.access_token,
      token_expiry: nextExpiry,
      status: "Ready",
    })
    .eq("id", gmailAccount.id);

  return data.access_token;
}

async function gmailRequest<T>(accessToken: string, input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API error ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

async function listMessages(accessToken: string, query: string) {
  const all: Array<{ id: string }> = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await gmailRequest<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      accessToken,
      url.toString(),
    );
    all.push(...(data.messages ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

async function getMessage(accessToken: string, id: string) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  url.searchParams.set("format", "full");
  return gmailRequest<GmailMessage>(accessToken, url.toString());
}

async function listLabels(accessToken: string) {
  return gmailRequest<{ labels?: Array<{ id: string; name: string }> }>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
  );
}

async function createLabel(accessToken: string, name: string) {
  return gmailRequest<{ id: string }>(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
}

async function getOrCreateLabel(accessToken: string, name: string) {
  const labels = await listLabels(accessToken);
  const existing = labels.labels?.find((label) => label.name === name);
  if (existing) {
    return existing.id;
  }

  const created = await createLabel(accessToken, name);
  return created.id;
}

async function markMessageProcessed(accessToken: string, messageId: string, labelId: string) {
  await gmailRequest(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      removeLabelIds: ["UNREAD"],
      addLabelIds: [labelId],
    }),
  });
}

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

async function findExistingOrder(
  supabase: SupabaseClient,
  {
    bookingRef,
    userId,
  }: { bookingRef: string; userId: string },
) {
  const { data, error } = await supabase
    .from("orders")
    .select("id, event_name, venue, event_date, purchased_at, account_email, section, row, seat_from, seat_to, qty_bought, total_cost, listing_status, source_type")
    .eq("booking_ref", bookingRef)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return (data as ExistingOrder | null) ?? null;
}

function getHeader(headers: GmailHeader[], name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(data?: string) {
  if (!data) {
    return "";
  }

  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getPartCharset(part: GmailPayload): string {
  const ct = part.headers?.find(h => h.name.toLowerCase() === "content-type")?.value ?? "";
  return (ct.match(/charset=["']?([^"'\s;]+)/i)?.[1] ?? "utf-8").toLowerCase().replace(/_/g, "-");
}

function decodeQuotedPrintable(str: string, charset = "utf-8"): string {
  const noSoftBreaks = str.replace(/=\r?\n/g, "");
  const byteStr = noSoftBreaks.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  const buf = Buffer.from(byteStr, "binary");
  if (charset === "utf-8" || charset === "utf8") {
    const utf8 = buf.toString("utf8");
    if (!utf8.includes("\ufffd")) return utf8;
    // Declared UTF-8 but has invalid bytes — Gmail forwards can embed latin-1/windows-1252
    // QP escapes (e.g. =E1 for á) inside a UTF-8 MIME part. Fall back to windows-1252.
    try { return new TextDecoder("windows-1252").decode(buf); } catch { /* fall through */ }
    return buf.toString("latin1");
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

export function stripHtml(text: string) {
  return text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|table|tbody|thead|tfoot|h[1-6])[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/gi, "€")
    .replace(/&#8364;/g, "€")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&bull;/gi, "•")
    .replace(/&middot;/gi, "·")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, "\"")
    .replace(/&ldquo;/gi, "\"")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&#65279;/g, "")
    .replace(/&#xFEFF;/gi, "");
}

export function cleanText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\ufeff/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPartCte(part: GmailPayload): string {
  return part.headers?.find(
    (h) => h.name.toLowerCase() === "content-transfer-encoding"
  )?.value?.toLowerCase().trim() ?? "";
}

function decodePartData(part: GmailPayload): string {
  if (!part.body?.data) return "";
  const decoded = decodeBase64Url(part.body.data);
  if (getPartCte(part) === "quoted-printable") {
    return decodeQuotedPrintable(decoded, getPartCharset(part));
  }
  return decoded;
}

function extractPlainText(payload: GmailPayload): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodePartData(payload);
  }
  for (const part of payload.parts || []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  return "";
}

function getRawHtml(payload: GmailPayload): string {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodePartData(payload);
  }
  for (const part of payload.parts || []) {
    const html = getRawHtml(part);
    if (html) return html;
  }
  // Fallback: plain text wrapped in HTML (e.g. text/plain-only emails)
  const plain = extractPlainText(payload);
  if (!plain) return "";
  const escaped = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><body><pre style="font-family:sans-serif;white-space:pre-wrap;padding:20px;color:#222">${escaped}</pre></body></html>`;
}

function getBody(payload: GmailPayload): string {
  const parts: string[] = [];

  const walk = (part: GmailPayload) => {
    const data = part.body?.data;
    if (data) {
      let decoded = decodePartData(part);
      if (part.mimeType === "text/html") {
        decoded = stripHtml(decoded);
      }
      parts.push(decoded);
    }

    for (const child of part.parts || []) {
      walk(child);
    }
  };

  walk(payload);
  return cleanText(parts.join("\n"));
}

function extractEmail(header: string) {
  const angleMatch = header.match(/<([^>]+)>/);
  const email = angleMatch?.[1] || header.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] || "";
  return email.toLowerCase();
}

function isAccountEmail(email: string) {
  if (!email) {
    return false;
  }

  const ignoredFragments = [
    "ticketmaster",
    "amazon",
    "ebay",
    "stubhub",
    "noreply",
    "no-reply",
    "do-not-reply",
    "bounces+",
    "bounce+",
    "mailer-daemon",
  ];

  return email !== FORWARD_TO_ACCOUNT && !ignoredFragments.some((fragment) => email.includes(fragment));
}

function extractAccount(headers: GmailHeader[], text: string) {
  const headerCandidates = [
    "X-Original-To",
    "To",
    "Reply-To",
    "Return-Path",
    "Sender",
    "From",
    "Delivered-To",
    "X-Forwarded-To",
  ];

  for (const name of headerCandidates) {
    const email = extractEmail(getHeader(headers, name));
    if (isAccountEmail(email)) {
      return email;
    }
  }

  const bodyPatterns = [
    /^From:\s*.*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/im,
    /^To:\s*.*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/im,
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
    if (isAccountEmail(email)) {
      return email;
    }
  }

  return "";
}

function parseBookingRef(subject: string, text: string) {
  const simple = subject.match(/\b(RE\d+)\b/i)?.[1] || text.match(/\b(RE\d+)\b/i)?.[1];
  if (simple) {
    return simple;
  }

  const patterns = [
    /order number is\s*([0-9]{1,3}-[0-9]+\/UK\d+)/i,
    /\bORDER\b\s*#\s*([0-9]{1,3}-[0-9]+\/UK\d+)/i,
    /\b([0-9]{1,3}-[0-9]+\/UK\d+)\b/i,
    // Non-UK slash refs (US, AU, IE, etc.)
    /\bORDER\b\s*#\s*([0-9]{1,3}-[0-9]+\/[A-Z]{2,}\d*)/i,
    /\b([0-9]{1,3}-[0-9]+\/[A-Z]{2,}\d*)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function parseEvent(subject: string) {
  const orderUpdateMatch = subject.match(
    /Order Update\s+RE\d+\s+-\s+[A-Z0-9]+\s+-\s+(.+?)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}/i,
  );
  if (orderUpdateMatch?.[1]) {
    return orderUpdateMatch[1].trim();
  }

  const dayMatch = subject.match(/-\s*(.+?)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  if (dayMatch?.[1]) {
    return dayMatch[1]
      .replace(/^[A-Z0-9]+\s+-\s+/i, "")
      .trim();
  }

  const lines = subject.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.toLowerCase().includes("ticket confirmation")) {
      const cleaned = line
        .replace(/^fwd:\s*/i, "")
        .replace(/^you[’']re in!\s*/i, "")
        .replace(/^your\s+/i, "")
        .replace(/\s*ticket confirmation$/i, "")
        .trim();
      if (cleaned) {
        return cleaned;
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/i.test(lines[index])) {
      const candidate = lines[index - 1]?.trim();
      if (candidate && !candidate.toLowerCase().includes("order")) {
        return candidate;
      }
    }
  }

  return "";
}

function parseDate(text: string) {
  // Full day name with time (require digit after day to avoid "Sunday Sunday 26..." doubling)
  const p1 = text.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}.*?\d{2}:\d{2})/i)?.[1];
  if (p1) return p1;
  // Full day name without time
  const p2 = text.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\b/i)?.[0];
  if (p2) return p2;
  // Abbreviated day with time: "Sun 26 Apr 2026 • 7:30 pm"
  const p3 = text.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\s*[•·\-]\s*\d{1,2}:\d{2}\s*(?:am|pm)?\b/i)?.[0];
  if (p3) return p3;
  // Abbreviated day without time: "Sun 26 Apr 2026"
  const p4 = text.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}\b/i)?.[0];
  if (p4) return p4;
  return "";
}

function parseVenue(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(lines[index])) {
      const venue = lines[index - 1];
      if (venue && !venue.startsWith("Subject:")) {
        return venue;
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+[A-Z][a-z]{2}\s+\d{4}/i.test(lines[index])) {
      return lines[index + 1] || "";
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
    if (match?.[1]) {
      return match[1];
    }
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
    if (match?.[1]) {
      return match[1];
    }
  }

  const faceValueBlock = cleaned.match(/Face Value:([\s\S]{0,120})/i)?.[1] || "";
  return faceValueBlock.match(/[£Â]\s*([0-9]+\.[0-9]{2})/)?.[1] || "";
}

function parseSection(text: string) {
  const patterns = [
    /\bSECTION\s*[:\-]?\s*(.+?)(?=\s+\b(?:ROW|SEAT|Fila|Asiento)\b|[\n\r]|$)/i,
    /\bSector\s+(\S+)/i,
    /\bSEC(?:tor|tion)\.?\s*[:\-]?\s*(.+?)(?=\s+\b(?:ROW|SEAT|Fila|Asiento)\b|[\n\r]|$)/i,
    /\b(Pitch Standing|Standing|General Admission)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/^[ :\-]+|[ :\-]+$/g, "");
    }
  }

  return "";
}

function parseRow(text: string) {
  return (
    text.match(/\bROW\s*[:\-]?\s*([A-Z0-9]+)\b/i)?.[1]?.trim() ||
    text.match(/\bFila\s*[:\-]?\s*([A-Z0-9]+)\b/i)?.[1]?.trim() ||
    ""
  );
}

function parseSeats(text: string): [string, string] {
  const patterns = [
    /\bSEAT(?:S)?\s*[:\-]?\s*(\d+)\s*(?:-|to|–)\s*(\d+)\b/i,
    /\bSEAT(?:S)?\s*[:\-]?\s*(\d+)\s*,\s*(\d+)\b/i,
    /\bSEAT(?:S)?\s*[:\-]?\s*(\d+)\b/i,
    /\bAsiento\s*[:\-]?\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return [match[1], match[2] || match[1]];
    }
  }

  return ["", ""];
}

function parsePurchasedAt(headers: GmailHeader[], text: string) {
  const raw = getHeader(headers, "Date") || text.match(/Date:\s*(.+)/i)?.[1]?.trim() || "";
  if (!raw) return "";
  const cleaned = raw.replace(/\s+\([^)]+\)\s*$/, ""); // strip "(UTC)" / "(PST)" etc.
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

// ── AXS ──────────────────────────────────────────────────────────────────────

function isAxsEmail(from: string, subject: string) {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  return (
    fromLower.includes("axs.co.uk") ||
    fromLower.includes("axs.com") ||
    subjectLower.includes("thank you for purchasing tickets for")
  );
}

function parseAxsBookingRef(text: string) {
  // Handle bold markers: "confirmation number is *1160185362*"
  return (
    text.match(/confirmation\s+number\s+is\s+\*?(\d+)\*?/i)?.[1] ||
    text.match(/order\s+number\s+\*?(\d+)\*?/i)?.[1] ||
    ""
  );
}

function parseAxsEvent(subject: string) {
  // Handle "Fwd: " prefix on forwarded emails
  return (
    subject.match(/thank you for purchasing tickets for\s+(.+)/i)?.[1]?.trim() || ""
  );
}

function parseAxsDate(text: string) {
  return (
    text.match(
      /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}[^A-Z\n]{0,10}\d{1,2}:\d{2})/i,
    )?.[1]?.trim() ||
    text.match(
      /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i,
    )?.[1]?.trim() ||
    ""
  );
}

function parseAxsVenue(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (
      /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}/i.test(
        lines[i],
      )
    ) {
      const candidate = lines[i + 1];
      if (candidate && !/^\d+\s+Ticket/i.test(candidate)) {
        // Strip "[image: venue]" or "[image: ...]" prefixes added by email clients
        return candidate.replace(/^\[image:[^\]]*\]\s*/i, "").trim();
      }
    }
  }
  return "";
}

function parseAxsQty(text: string) {
  return (
    text.match(/(\d+)\s+Tickets?\s*[-–]/i)?.[1] ||
    text.match(/(\d+)\s+Tickets?\b/i)?.[1] ||
    ""
  );
}

// Seat format: "110|R|6-7" (compact) or "Regular 107 | M | 220-223" (spaced)
function parseAxsSection(text: string) {
  // Compact pipe: "110|R|6-7"
  const compact = text.match(/\b(\w+)\|[A-Z0-9]+\|[\d-]+/i);
  if (compact) return compact[1];
  // Spaced pipe: "Regular 107 | M | ..."
  const piped =
    text.match(/(?:Regular|Floor|Block|Stand|Section|Sec)\s+(\S+)\s*\|/i)?.[1] ||
    text.match(/([^\s|]+)\s*\|\s*[A-Z0-9]+\s*\|\s*\d+/i)?.[1]?.trim();
  if (piped) return piped;
  // Plain text: "Block 110" / "Section A2"
  return text.match(/\b(?:Block|Section|Stand|Floor)\s+([A-Z0-9]+)\b/i)?.[1]?.trim() || "";
}

function parseAxsRow(text: string) {
  // Pipe formats
  return (
    text.match(/\w+\s*\|\s*([A-Z0-9]+)\s*\|\s*\d+/i)?.[1]?.trim() ||
    text.match(/\|\s*([A-Z0-9]+)\s*\|\s*\d+/i)?.[1]?.trim() ||
    // Plain text: "Row G" / "Row 12"
    text.match(/\bRow\s+([A-Z0-9]+)\b/i)?.[1]?.trim() ||
    ""
  );
}

function parseAxsSeats(text: string): [string, string] {
  // Pipe compact range: "110|R|6-7"
  const rangeCompact = text.match(/\w+\|[A-Z0-9]+\|(\d+)[-–](\d+)/i);
  if (rangeCompact) return [rangeCompact[1], rangeCompact[2]];
  // Pipe spaced range: "| R | 6-7"
  const rangeSpaced = text.match(/\|\s*[A-Z0-9]+\s*\|\s*(\d+)[-–](\d+)/i);
  if (rangeSpaced) return [rangeSpaced[1], rangeSpaced[2]];
  // Pipe single
  const pipeSingle = text.match(/\|[A-Z0-9]+\|(\d+)/i) || text.match(/\|\s*[A-Z0-9]+\s*\|\s*(\d+)/i);
  if (pipeSingle) return [pipeSingle[1], pipeSingle[1]];
  // Plain text: "Seats 14-15" / "Seat 14 - 15"
  const textRange = text.match(/\bSeats?\s+(\d+)\s*[-–]\s*(\d+)/i);
  if (textRange) return [textRange[1], textRange[2]];
  // Plain text: "Seat 14"
  const textSingle = text.match(/\bSeat\s+(\d+)\b/i);
  if (textSingle) return [textSingle[1], textSingle[1]];
  return ["", ""];
}

function parseAxsTotal(text: string) {
  // Handle bold markers: "Total: *£124.65*"
  const matches = [...text.matchAll(/Total[:\s]+\*?[£$€]?\s*([0-9]+\.[0-9]{2})\*?/gi)];
  return matches.at(-1)?.[1] || "";
}

// ── International TM (DE / ES / IT / US) ─────────────────────────────────────

// For forwarded emails the From header is the forwarder, not the original sender.
// Detect the effective TM domain from the subject so all parsing functions work correctly.
function getEffectiveFrom(from: string, subject: string): string {
  if (from.toLowerCase().includes("ticketmaster")) return from;
  const s = subject.toLowerCase();
  if (s.includes("confirmacion de compra") || s.includes("confirmación de compra")) return "noreply@ticketmaster.es";
  if (/^(?:fwd:\s*)?order\s+confirm\s+\d/i.test(s)) return "noreply@ticketmaster.it";
  if (s.includes("your ticketmaster order")) return "noreply@ticketmaster.de";
  return from;
}

const SOURCE_CURRENCY: Record<string, string> = {
  ticketmaster_us:  "USD",
  ticketmaster_de:  "EUR",
  ticketmaster_es:  "EUR",
  ticketmaster_it:  "EUR",
  ticketmaster_fr:  "EUR",
  ticketmaster_nl:  "EUR",
  ticketmaster_be:  "EUR",
  ticketmaster_au:  "AUD",
  ticketmaster_ca:  "CAD",
  ticketmaster_mx:  "MXN",
  ticketmaster_se:  "SEK",
  ticketmaster_no:  "NOK",
  ticketmaster_dk:  "DKK",
  ticketmaster_pl:  "PLN",
  ticketmaster_ch:  "CHF",
};

function isIntlTmEmail(from: string, subject: string) {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  return (
    f.includes("ticketmaster.de") ||
    f.includes("ticketmaster.es") ||
    f.includes("ticketmaster.it") ||
    s.includes("you got tickets to") ||
    s.includes("your ticketmaster order") ||
    s.startsWith("order confirm ") ||
    s.includes("confirmacion de compra") ||
    s.includes("confirmación de compra")
  );
}

function getIntlSourceType(from: string, subject: string): string {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  if (f.includes("ticketmaster.de")) return "ticketmaster_de";
  if (f.includes("ticketmaster.es")) return "ticketmaster_es";
  if (f.includes("ticketmaster.it")) return "ticketmaster_it";
  if (s.includes("you got tickets") || f.includes("email.ticketmaster.com")) return "ticketmaster_us";
  return "ticketmaster_direct";
}

function parseIntlBookingRef(from: string, subject: string, text: string): string {
  const f = from.toLowerCase();

  // US TM: "Order # 7-54076/DAL" or "Order # 21-43317/NV2"
  const usRef = text.match(/\bOrder\s*#\s*([0-9]{1,3}-[0-9]+\/[A-Z0-9]+)/i)?.[1];
  if (usRef) return usRef;

  // DE: "ORDER NUMBER: 32535020"
  if (f.includes("ticketmaster.de")) {
    const ref = text.match(/ORDER\s+NUMBER\s*:?\s*(\d{5,})/i)?.[1];
    if (ref) return `DE-${ref}`;
  }

  // ES: "NÚMERO DE REFERENCIA: 10361399" or in subject "referencia 010361399"
  if (f.includes("ticketmaster.es")) {
    const ref =
      text.match(/(?:N[ÚU]MERO\s+DE\s+REFERENCIA)\s*:?\s*(\d{5,})/i)?.[1] ||
      subject.match(/referencia\s+0*(\d{5,})/i)?.[1];
    if (ref) return `ES-${ref}`;
  }

  // IT: "Order number\n3549083" or "Order number 3549083"
  if (f.includes("ticketmaster.it")) {
    const ref = text.match(/Order\s+number[\s\n\r:]*(\d{5,})/i)?.[1];
    if (ref) return `IT-${ref}`;
  }

  return "";
}

function parseIntlEvent(from: string, subject: string, text: string): string {
  const f = from.toLowerCase();

  // US: "You Got Tickets To EVENT NAME"
  const usMatch = subject.match(/You Got Tickets To\s+(.+)/i);
  if (usMatch) return usMatch[1].trim();

  // ES: "Confirmacion de compra para EVENT, número de referencia..."
  const esMatch = subject.match(/Confirmaci[oó]n\s+de\s+compra\s+para\s+(.+?),?\s*n[uú]mero\s+de\s+referencia/i);
  if (esMatch) return esMatch[1].trim();

  // DE: event is a capitalised line after ORDER NUMBER
  if (f.includes("ticketmaster.de")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/ORDER\s+NUMBER/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const candidate = lines[j];
          if (candidate && candidate.length > 8 && !/^\d+\s*x/i.test(candidate) && !/^(Level|Section|Seat|Ticket|Mobile|View)/i.test(candidate)) {
            return candidate;
          }
        }
      }
    }
  }

  // IT: first meaningful capitalised line in body
  if (f.includes("ticketmaster.it")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (
        line.length > 10 &&
        /^[A-Z]/.test(line) &&
        !/^(Order|Total|Your|Dear|Thank|Congratulation|We\s|This|Please|Information|You|Ticketmaster)/i.test(line)
      ) {
        return line;
      }
    }
  }

  return "";
}

function parseIntlVenue(from: string, text: string): string {
  const f = from.toLowerCase();

  // DE: venue appears on the line immediately before the German date
  if (f.includes("ticketmaster.de")) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      if (/(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)/i.test(lines[i])) {
        const candidate = lines[i - 1];
        if (candidate && candidate.length > 3 && !/^\d+\s*x/i.test(candidate)) {
          return candidate;
        }
      }
    }
  }

  // ES: venue — find text between booking ref and event date (pre-RESUMEN only)
  if (f.includes("ticketmaster.es")) {
    const resumenIdx = text.search(/\bRESUMEN\b/i);
    const esText = resumenIdx > 0 ? text.slice(0, resumenIdx) : text;
    const refIdx = esText.search(/(?:N[ÚU]MERO\s+DE\s+REFERENCIA|REFERENCIA\s*:)/i);
    const dateIdx = esText.search(/(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)[^0-9]{0,10}\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i);
    const searchText = refIdx >= 0 && dateIdx > refIdx
      ? esText.slice(refIdx, dateIdx)
      : esText;
    const lines = searchText.split(/\n/).map((l) => l.trim()).filter((l) =>
      l.length > 4 &&
      !/^(?:n[uú]mero|referencia|\d+$|subject:|date:|from:|to:|ya\s+tienes|ver\s+entradas|fwd:|[-]{3}|\[image|&#)/i.test(l) &&
      !/ticketmaster/i.test(l)
    );
    const venue = lines[lines.length - 1];
    if (venue) return venue;
  }

  // US: venue is the line after the date line — anchor to "Order #" to skip email headers
  const usVenueAnchor = text.search(/Order\s*#/i);
  const usVenueText = usVenueAnchor >= 0 ? text.slice(usVenueAnchor) : text;
  const usLines = usVenueText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < usLines.length; i++) {
    if (/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).+\d{4}/i.test(usLines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, usLines.length); j++) {
        const candidate = usLines[j].replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
        if (
          candidate.length > 5 &&
          !/^(?:subject:|date:|from:|to:|get\s+dir|view\s+|transfer|manage\s+|important|download|your\s+ticket|section|sec\b|row\b|seat)/i.test(candidate)
        ) {
          return candidate;
        }
      }
    }
  }

  return "";
}

const DE_MONTHS: Record<string, string> = {
  januar: "Jan", februar: "Feb", märz: "Mar", april: "Apr", mai: "May",
  juni: "Jun", juli: "Jul", august: "Aug", september: "Sep",
  oktober: "Oct", november: "Nov", dezember: "Dec",
};

const ES_MONTHS: Record<string, string> = {
  enero: "Jan", febrero: "Feb", marzo: "Mar", abril: "Apr", mayo: "May",
  junio: "Jun", julio: "Jul", agosto: "Aug", septiembre: "Sep",
  octubre: "Oct", noviembre: "Nov", diciembre: "Dec",
};

const ES_DAYS: Record<string, string> = {
  lunes: "Monday", martes: "Tuesday", miércoles: "Wednesday", miercoles: "Wednesday",
  jueves: "Thursday", viernes: "Friday", sábado: "Saturday", sabado: "Saturday",
  domingo: "Sunday",
};

function parseIntlDate(from: string, text: string): string {
  const f = from.toLowerCase();

  // DE: "Sonntag, 12. Juli 2026, 20:00 Uhr"
  if (f.includes("ticketmaster.de")) {
    const m = text.match(/(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\s+(\d{1,2})\.\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})/i);
    if (m) {
      const month = DE_MONTHS[m[2].toLowerCase()] ?? m[2];
      return `${m[1]} ${month} ${m[3]}`;
    }
  }

  // ES: event date — search before RESUMEN section to avoid matching the purchase date
  if (f.includes("ticketmaster.es")) {
    const resumenIdx = text.search(/\bRESUMEN\b/i);
    const esText = resumenIdx > 0 ? text.slice(0, resumenIdx) : text;
    const m = esText.match(/(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)[^0-9]{0,10}(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})(?:[^0-9]{0,15}(\d{1,2}:\d{2}))?/i);
    if (m) {
      const day = ES_DAYS[m[1].toLowerCase()] ?? m[1];
      const month = ES_MONTHS[m[3].toLowerCase()] ?? m[3];
      const time = m[5] ? ` · ${m[5]}` : "";
      return `${day} ${m[2]} ${month} ${m[4]}${time}`;
    }
  }

  // US: anchor to "Order #" to skip email-header text in text/plain parts
  const usAnchor = text.search(/Order\s*#/i);
  const usText = usAnchor >= 0 ? text.slice(usAnchor) : text;

  // "Sat · May 02, 2026 · 8:00 PM" or "Sat, May 02, 2026"
  const usM = usText.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*[·,\s]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:\s*[·,]?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i);
  if (usM) return usM[1].trim();

  const usDate = usText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i)?.[1];
  if (usDate) return usDate;

  return "";
}

function parseIntlTotal(text: string): string {
  const cleaned = cleanText(text);

  // ES: grand total in RESUMEN DE PAGO section — "*1.068,00 €*" (dot-thousands, comma-decimal)
  // Currency symbol may be mangled; match anything non-digit/non-word after the number
  const resumenM = cleaned.match(/RESUMEN\s+DE\s+PAGO[\s\S]{0,500}?\*?(\d{1,3}(?:\.\d{3})+),(\d{2})\s*(?:EUR|€|[^\d\w\s]|\*|\n|$)/i);
  if (resumenM) return `${resumenM[1].replace(/\./g, "")}.${resumenM[2]}`;

  // EUR dot-thousands separator: "1.068,00 €"
  const eurThousands = cleaned.match(/(\d{1,3}(?:\.\d{3})+),(\d{2})\s*(?:EUR|€|[^\d\w\s])/i);
  if (eurThousands) return `${eurThousands[1].replace(/\./g, "")}.${eurThousands[2]}`;

  // EUR comma-decimal: "722,00 EUR" or "180,50 €"
  const eurComma = cleaned.match(/(\d{1,6}),(\d{2})\s*(?:EUR|€|[^\d\w\s])/i);
  if (eurComma) return `${eurComma[1]}.${eurComma[2]}`;

  // EUR dot-decimal: "12.00 €" or "€ 12.00"
  const eurDot =
    cleaned.match(/(?:€|EUR)\s*(\d+\.\d{2})/i)?.[1] ||
    cleaned.match(/(\d+\.\d{2})\s*(?:€|EUR)/i)?.[1];
  if (eurDot) return eurDot;

  // USD total line: "Total: $512.76" or "Total:&nbsp;$512.76"
  const usdTotal = [...cleaned.matchAll(/Total[:\s&]+\$\s*([\d,]+\.\d{2})/gi)];
  if (usdTotal.length > 0) return (usdTotal.at(-1)?.[1] ?? "").replace(/,/g, "");

  // USD bare: "$512.76"
  const usdBare = cleaned.match(/\$\s*([0-9]+\.[0-9]{2})/);
  if (usdBare) return usdBare[1];

  return "";
}

function parseIntlQty(text: string): string {
  return (
    text.match(/([1-9]\d{0,2})\s*x\s+(?:tickets?|Mobile Ticket)/i)?.[1] ||
    text.match(/([1-9]\d{0,2})\s+tickets?\b/i)?.[1] ||
    text.match(/([1-9]\d{0,2})\s+entradas?(?:\/s|\(s\))?\b/i)?.[1] ||
    text.match(/^([1-9]\d{0,2})\s*x\b/im)?.[1] ||
    ""
  );
}

