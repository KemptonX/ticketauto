import type { SupabaseClient } from "@supabase/supabase-js";

const GMAIL_QUERY = 'is:unread ticketmaster ("Order Update" OR "ticket confirmation" OR "You\'re in!")';
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
  const messages = await listMessages(accessToken, GMAIL_QUERY);

  let inserted = 0;

  for (const message of messages) {
    const fullMessage = await getMessage(accessToken, message.id);
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);
    const combined = cleanText(`${subject}\n${body}`);

    const bookingRef = parseBookingRef(subject, combined);
    if (!bookingRef) {
      continue;
    }

    const accountEmail = extractAccount(headers, combined);
    const duplicate = await isDuplicateOrder(supabase, {
      bookingRef,
      accountEmail,
      userId,
    });

    if (duplicate) {
      await markMessageProcessed(accessToken, message.id, labelId);
      continue;
    }

    const section = parseSection(combined);
    const row = parseRow(combined);
    const [seatFrom, seatTo] = parseSeats(combined);
    const total = parseTotal(combined);
    const qty = parseQty(body);

    const orderData: OrderInsert = {
      booking_ref: bookingRef,
      event_name: parseEvent(combined),
      venue: parseVenue(body),
      event_date: parseDate(combined),
      purchased_at: parsePurchasedAt(headers, combined),
      account_email: accountEmail,
      section,
      row,
      seat_from: seatFrom,
      seat_to: seatTo,
      qty_bought: qty ? Number.parseInt(qty, 10) : null,
      total_cost: total ? Number.parseFloat(total) : null,
      source_type: bookingRef.includes("/UK") ? "ticketmaster_direct" : "ticketmaster_resale",
      user_id: userId,
    };

    const { error } = await supabase.from("orders").insert(orderData);
    if (error) {
      throw new Error(error.message);
    }

    inserted += 1;
    await markMessageProcessed(accessToken, message.id, labelId);
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
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "20");

  const data = await gmailRequest<{ messages?: Array<{ id: string }> }>(accessToken, url.toString());
  return data.messages || [];
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

async function isDuplicateOrder(
  supabase: SupabaseClient,
  {
    bookingRef,
    accountEmail,
    userId,
  }: { bookingRef: string; accountEmail: string; userId: string },
) {
  const query = supabase
    .from("orders")
    .select("id")
    .eq("booking_ref", bookingRef)
    .eq("user_id", userId)
    .limit(1);

  const finalQuery = accountEmail ? query.eq("account_email", accountEmail) : query;
  const { data, error } = await finalQuery;
  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data && data.length > 0);
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

function stripHtml(text: string) {
  return text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|table|tbody|thead|tfoot|h[1-6])[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
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

function getBody(payload: GmailPayload): string {
  const parts: string[] = [];

  const walk = (part: GmailPayload) => {
    const data = part.body?.data;
    if (data) {
      let decoded = decodeBase64Url(data);
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
    /order number is\s*([0-9]{2}-[0-9]+\/UK\d+)/i,
    /\bORDER\b\s*#\s*([0-9]{2}-[0-9]+\/UK\d+)/i,
    /\b([0-9]{2}-[0-9]+\/UK\d+)\b/i,
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
  const dayMatch = subject.match(/-\s*(.+?)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  if (dayMatch?.[1]) {
    return dayMatch[1].trim();
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

function parseDate(subject: string) {
  return (
    subject.match(/((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday).*?\d{2}:\d{2})/i)?.[1] ||
    subject.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\s+[A-Z][a-z]{2}\s+\d{4}\s+[•\-]?\s*\d{1,2}:\d{2}\s*(?:am|pm)?\b/i)?.[0] ||
    ""
  );
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
    /\bSECTION\s*[:\-]?\s*(.+?)(?=\s+\bROW\b|\s+\bSEAT(?:S)?\b|[\n\r]|$)/i,
    /\bSEC(?:TION)?\.?\s*[:\-]?\s*(.+?)(?=\s+\bROW\b|\s+\bSEAT(?:S)?\b|[\n\r]|$)/i,
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
    if (match?.[1]) {
      return [match[1], match[2] || match[1]];
    }
  }

  return ["", ""];
}

function parsePurchasedAt(headers: GmailHeader[], text: string) {
  return getHeader(headers, "Date") || text.match(/Date:\s*(.+)/i)?.[1]?.trim() || "";
}

