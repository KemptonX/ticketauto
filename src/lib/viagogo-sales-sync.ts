import type { SupabaseClient } from "@supabase/supabase-js";

const GMAIL_QUERY = 'is:unread from:orders.viagogo.com ("Please transfer the tickets for sale" OR "Please send your tickets") newer_than:120d';
const PROCESSED_LABEL = "My Sales";

type GmailAccount = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type OutlookSalesAccount = {
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

type OutlookGraphMessage = {
  id: string;
  subject: string;
  receivedDateTime: string;
  isRead: boolean;
  body: {
    contentType: "text" | "html";
    content: string;
  };
};

type SyncResult = {
  scanned: number;
  inserted: number;
  matched: number;
  email: string;
};

type SaleInsert = {
  external_sale_id: string;
  gmail_account_id: string;
  source: string;
  source_message_id: string;
  subject: string;
  event_name: string;
  venue: string;
  event_date: string;
  sold_at: string;
  account_email: string;
  buyer_email: string;
  qty_sold: number | null;
  price_per_ticket: number | null;
  sale_total: number | null;
  payout_total: number | null;
  currency: string;
  section: string;
  row: string;
  seat_from: string;
  seat_to: string;
  sale_status: string;
  inventory_order_id: number | null;
  match_confidence: number | null;
  user_id: string;
};

type CandidateOrder = {
  id: number;
  booking_ref: string | null;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  sold_total: number | null;
  listing_status: string | null;
};

type ExistingSale = {
  id: number;
  external_sale_id: string | null;
  source_message_id: string | null;
  inventory_order_id: number | null;
  match_confidence: number | null;
  qty_sold: number | null;
};

type UnmatchedSale = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  qty_sold: number | null;
  payout_total: number | null;
  sale_total: number | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
};

type ParsedSale = {
  externalSaleId: string;
  subject: string;
  eventName: string;
  venue: string;
  eventDate: string;
  soldAt: string;
  buyerEmail: string;
  qtySold: number | null;
  pricePerTicket: number | null;
  payoutTotal: number | null;
  saleTotal: number | null;
  section: string;
  row: string;
  seatFrom: string;
  seatTo: string;
};

export async function syncViagogoSalesInbox({
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
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);

  let inserted = 0;
  let matched = 0;

  for (const message of messages) {
    const fullMessage = await getMessage(accessToken, message.id);
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);
    const combined = cleanText(`${subject}\n${body}`);
    const sourceMessageId = getHeader(headers, "Message-ID") || message.id;

    const lowerSubject = subject.toLowerCase();
    if (!lowerSubject.includes("please transfer the tickets for sale") && !lowerSubject.includes("please send your tickets")) {
      continue;
    }

    const parsed = parseSale({ headers, subject, text: combined });
    if (!parsed.externalSaleId) {
      continue;
    }

    const existingSale = await findExistingSale(supabase, {
      userId,
      externalSaleId: parsed.externalSaleId,
      sourceMessageId,
    });

    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({
          orders: candidateOrders,
          orderUsage,
          sale: parsed,
        });

    const saleData: SaleInsert = {
      external_sale_id: parsed.externalSaleId,
      gmail_account_id: gmailAccount.id,
      source: "viagogo",
      source_message_id: sourceMessageId,
      subject: parsed.subject,
      event_name: parsed.eventName,
      venue: parsed.venue,
      event_date: parsed.eventDate,
      sold_at: parsed.soldAt,
      account_email: gmailAccount.email,
      buyer_email: parsed.buyerEmail,
      qty_sold: parsed.qtySold,
      price_per_ticket: parsed.pricePerTicket,
      sale_total: parsed.saleTotal,
      payout_total: parsed.payoutTotal,
      currency: "GBP",
      section: parsed.section,
      row: parsed.row,
      seat_from: parsed.seatFrom,
      seat_to: parsed.seatTo,
      sale_status: "Sold",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence:
        existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({
            ...saleData,
            source_message_id: existingSale.source_message_id || sourceMessageId,
          })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) {
      throw new Error(error.message);
    }

    if (!existingSale) {
      inserted += 1;
    }

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      orderUsage.set(match.order.id, currentUsed + (parsed.qtySold ?? 1));
      matched += 1;
      await updateMatchedOrder(supabase, {
        userId,
        order: match.order,
        payoutTotal: parsed.payoutTotal,
      });
    }

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
    matched,
    email: gmailAccount.email,
  };
}

export async function rematchViagogoSales({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);
  const unmatchedSales = await loadUnmatchedSales(supabase, userId);

  let matched = 0;

  for (const sale of unmatchedSales) {
    const match = findBestInventoryMatch({
      orders: candidateOrders,
      orderUsage,
      sale: {
        externalSaleId: "",
        subject: "",
        eventName: sale.event_name || "",
        venue: sale.venue || "",
        eventDate: sale.event_date || "",
        soldAt: "",
        buyerEmail: "",
        qtySold: sale.qty_sold,
        pricePerTicket: null,
        payoutTotal: sale.payout_total,
        saleTotal: sale.sale_total,
        section: sale.section || "",
        row: sale.row || "",
        seatFrom: sale.seat_from || "",
        seatTo: sale.seat_to || "",
      },
    });

    if (!match) {
      continue;
    }

    const { error } = await supabase
      .from("sales")
      .update({
        inventory_order_id: match.order.id,
        match_confidence: Number(match.score.toFixed(2)),
      })
      .eq("id", sale.id)
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }

    const currentUsed = orderUsage.get(match.order.id) ?? 0;
    orderUsage.set(match.order.id, currentUsed + (sale.qty_sold ?? 1));

    matched += 1;
    await updateMatchedOrder(supabase, {
      userId,
      order: match.order,
      payoutTotal: sale.payout_total,
    });
  }

  return matched;
}

export async function syncViagogoSalesOutlookInbox({
  supabase,
  outlookAccount,
  userId,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookSalesAccount;
  userId: string;
}): Promise<SyncResult> {
  const accessToken = await getValidOutlookToken({ supabase, outlookAccount });
  const messages = await listViagogoOutlookMessages(accessToken);
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);

  let inserted = 0;
  let matched = 0;

  for (const msg of messages) {
    if (msg.isRead) continue;

    const subject = msg.subject || "";
    const lowerSubject = subject.toLowerCase();
    if (
      !lowerSubject.includes("please transfer the tickets for sale") &&
      !lowerSubject.includes("please send your tickets")
    ) {
      continue;
    }

    const rawBody = decodeQuotedPrintable(msg.body.content);
    const bodyText =
      msg.body.contentType === "html" ? outlookStripHtml(rawBody) : rawBody;
    const combined = cleanText(`${subject}\n${bodyText}`);
    const sourceMessageId = msg.id;

    // parseSale uses headers only for the "Date" header → soldAt
    const fakeHeaders: GmailHeader[] = [
      { name: "Date", value: msg.receivedDateTime || "" },
    ];

    const parsed = parseSale({ headers: fakeHeaders, subject, text: combined });
    if (!parsed.externalSaleId) continue;

    const existingSale = await findExistingSale(supabase, {
      userId,
      externalSaleId: parsed.externalSaleId,
      sourceMessageId,
    });

    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsed });

    const saleData: SaleInsert = {
      external_sale_id: parsed.externalSaleId,
      gmail_account_id: outlookAccount.id,
      source: "viagogo",
      source_message_id: sourceMessageId,
      subject: parsed.subject,
      event_name: parsed.eventName,
      venue: parsed.venue,
      event_date: parsed.eventDate,
      sold_at: parsed.soldAt,
      account_email: outlookAccount.email,
      buyer_email: parsed.buyerEmail,
      qty_sold: parsed.qtySold,
      price_per_ticket: parsed.pricePerTicket,
      sale_total: parsed.saleTotal,
      payout_total: parsed.payoutTotal,
      currency: "GBP",
      section: parsed.section,
      row: parsed.row,
      seat_from: parsed.seatFrom,
      seat_to: parsed.seatTo,
      sale_status: "Sold",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence:
        existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({
            ...saleData,
            source_message_id: existingSale.source_message_id || sourceMessageId,
          })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);

    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      orderUsage.set(match.order.id, currentUsed + (parsed.qtySold ?? 1));
      matched += 1;
      await updateMatchedOrder(supabase, {
        userId,
        order: match.order,
        payoutTotal: parsed.payoutTotal,
      });
    }

    await outlookMarkRead(accessToken, msg.id);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", outlookAccount.id);

  return { scanned: messages.length, inserted, matched, email: outlookAccount.email };
}

async function findExistingSale(
  supabase: SupabaseClient,
  {
    userId,
    externalSaleId,
    sourceMessageId,
  }: {
    userId: string;
    externalSaleId: string;
    sourceMessageId: string;
  },
) {
  if (externalSaleId) {
    const { data, error } = await supabase
      .from("sales")
      .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
      .eq("user_id", userId)
      .eq("source", "viagogo")
      .eq("external_sale_id", externalSaleId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (data) {
      return data as ExistingSale;
    }
  }

  const { data, error } = await supabase
    .from("sales")
    .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
    .eq("user_id", userId)
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as ExistingSale | null) || null;
}
async function updateMatchedOrder(
  supabase: SupabaseClient,
  {
    userId,
    order,
    payoutTotal,
  }: {
    userId: string;
    order: CandidateOrder;
    payoutTotal: number | null;
  },
) {
  const payload: Record<string, string | number | null> = {
    listing_status: "Sold",
  };

  if (payoutTotal != null) {
    payload.sold_total = (order.sold_total ?? 0) + payoutTotal;
  }

  const { error } = await supabase
    .from("orders")
    .update(payload)
    .eq("id", order.id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

async function loadOrderUsage(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("sales")
    .select("inventory_order_id, qty_sold")
    .eq("user_id", userId)
    .not("inventory_order_id", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  const usage = new Map<number, number>();

  for (const row of (data as Array<{ inventory_order_id: number | null; qty_sold: number | null }>) || []) {
    if (row.inventory_order_id == null) {
      continue;
    }

    usage.set(row.inventory_order_id, (usage.get(row.inventory_order_id) ?? 0) + (row.qty_sold ?? 1));
  }

  return usage;
}

async function loadUnmatchedSales(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("sales")
    .select("id, event_name, venue, event_date, qty_sold, payout_total, sale_total, section, row, seat_from, seat_to")
    .eq("user_id", userId)
    .is("inventory_order_id", null)
    .order("sold_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data as UnmatchedSale[]) || [];
}

async function loadCandidateOrders(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("id, booking_ref, event_name, venue, event_date, section, row, seat_from, seat_to, qty_bought, total_cost, sold_total, listing_status")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return (data as CandidateOrder[]) || [];
}

function findBestInventoryMatch({
  orders,
  orderUsage,
  sale,
}: {
  orders: CandidateOrder[];
  orderUsage: Map<number, number>;
  sale: ParsedSale;
}) {
  let best: { order: CandidateOrder; score: number } | null = null;
  const sameShowCandidates = orders.filter((order) => {
    return (
      compareText(order.event_name, sale.eventName) >= 0.75 &&
      compareText(order.venue, sale.venue) >= 0.75 &&
      compareEventDay(order.event_date, sale.eventDate) === 1
    );
  }).length;

  for (const order of orders) {
    const eventScore = compareText(order.event_name, sale.eventName);
    if (eventScore === 0) {
      continue;
    }

    const venueScore = compareText(order.venue, sale.venue);
    const dayScore = compareEventDay(order.event_date, sale.eventDate);
    const sectionScore = compareSection(order.section, sale.section);
    const rowScore = compareExact(order.row, sale.row);
    const seatScore = compareSeats(order.seat_from, order.seat_to, sale.seatFrom, sale.seatTo);
    const quantityScore = compareQuantity(order.qty_bought, sale.qtySold);

    const strongExactSeatMatch =
      eventScore >= 0.75 &&
      venueScore >= 0.75 &&
      dayScore === 1 &&
      sectionScore >= 0.9 &&
      rowScore === 1 &&
      seatScore >= 0.6;

    const soldQty = orderUsage.get(order.id) ?? 0;
    const orderQty = order.qty_bought ?? 1;
    const requestedQty = sale.qtySold ?? 1;

    if (soldQty + requestedQty > orderQty && !strongExactSeatMatch) {
      continue;
    }

    let score = eventScore * 0.4;
    score += venueScore * 0.15;
    score += dayScore * 0.2;
    score += sectionScore * 0.1;
    score += rowScore * 0.05;
    score += seatScore * 0.15;
    score += quantityScore * 0.05;

    const hasLocationEvidence = sectionScore > 0 || rowScore > 0 || seatScore > 0;

    if (sameShowCandidates > 1 && !hasLocationEvidence && !strongExactSeatMatch) {
      continue;
    }

    if (strongExactSeatMatch) {
      score = Math.max(score, 0.98);
    }

    if (!best || score > best.score) {
      best = { order, score };
    }
  }

  return best && best.score >= 0.55 ? best : null;
}

function compareSection(left?: string | null, right?: string | null) {
  if (isGeneralAdmissionLabel(left) && isGeneralAdmissionLabel(right)) {
    return 1;
  }

  const leftSectionNumber = extractSectionNumber(left);
  const rightSectionNumber = extractSectionNumber(right);

  if (leftSectionNumber && rightSectionNumber && leftSectionNumber === rightSectionNumber) {
    return 0.9;
  }

  return compareText(left, right);
}

function compareText(left?: string | null, right?: string | null) {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return 0.75;
  }

  const aWords = new Set(a.split(" "));
  const bWords = new Set(b.split(" "));
  let overlap = 0;

  for (const word of aWords) {
    if (bWords.has(word)) {
      overlap += 1;
    }
  }

  return overlap >= 2 ? 0.45 : 0;
}

function compareExact(left?: string | null, right?: string | null) {
  if (!left || !right) {
    return 0;
  }

  return normalizeText(left) === normalizeText(right) ? 1 : 0;
}

function compareQuantity(left?: number | null, right?: number | null) {
  if (!left || !right) {
    return 0;
  }

  return left === right ? 1 : 0;
}

function compareEventDay(left?: string | null, right?: string | null) {
  const leftDate = parseDateLike(left);
  const rightDate = parseDateLike(right);

  if (!leftDate || !rightDate) {
    return 0;
  }

  return leftDate.toDateString() === rightDate.toDateString() ? 1 : 0;
}

function compareSeats(
  orderSeatFrom?: string | null,
  orderSeatTo?: string | null,
  saleSeatFrom?: string | null,
  saleSeatTo?: string | null,
) {
  const orderRange = toSeatRange(orderSeatFrom, orderSeatTo);
  const saleRange = toSeatRange(saleSeatFrom, saleSeatTo);

  if (!orderRange || !saleRange) {
    return 0;
  }

  if (orderRange.start === saleRange.start && orderRange.end === saleRange.end) {
    return 1;
  }

  const overlaps = orderRange.start <= saleRange.end && saleRange.start <= orderRange.end;
  return overlaps ? 0.6 : 0;
}

function toSeatRange(from?: string | null, to?: string | null) {
  const start = Number.parseInt(from || "", 10);
  const end = Number.parseInt(to || from || "", 10);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function normalizeText(value?: string | null) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGeneralAdmissionLabel(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return [
    "ticket",
    "general admission",
    "ga",
    "standing",
    "floor",
    "unreserved",
    "pit",
  ].some((label) => normalized === label || normalized.includes(label));
}

function extractSectionNumber(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d{1,4})/);
  return match?.[1] || null;
}

function parseSale({
  headers,
  subject,
  text,
}: {
  headers: GmailHeader[];
  subject: string;
  text: string;
}): ParsedSale {
  const ticketLine = extractField(text, "Ticket\\(s\\)", [
    "Event",
    "Listing Note\\(s\\)",
    "Venue",
    "Date",
    "Must Ship by Date",
    "Ticket Holder Details",
    "Number of Tickets",
    "Price per Ticket",
    "Total Proceeds",
  ]);

  const qtySold = parseInteger(text, [
    /Number of Tickets:\s*(\d+)/i,
    /\((\d+)\s*Ticket\(s\)\)/i,
  ]);
  const pricePerTicket = parseMoney(text, [/Price per Ticket:\s*:?\s*[£Â$]?\s*([0-9,.]+)/i]);
  const payoutTotal = parseMoney(text, [/Total Proceeds:\s*:?\s*[£Â$]?\s*([0-9,.]+)/i]);
  const derivedSaleTotal = qtySold != null && pricePerTicket != null ? qtySold * pricePerTicket : payoutTotal;

  return {
    externalSaleId:
      subject.match(/sale\s+#(\d+)/i)?.[1] || subject.match(/tickets\s+(\d+)/i)?.[1] || text.match(/Order ID:\s*(\d+)/i)?.[1] || "",
    subject,
    eventName:
      extractField(text, "Event", ["Listing Note\\(s\\)", "Venue", "Date", "Must Ship by Date"]) ||
      text.match(/sale of\s+(.+?)\s+tickets/i)?.[1]?.trim() ||
      subject.match(/sale\s+#\d+[^\w]*[-–]\s*(.+)/i)?.[1]?.trim() ||
      "",
    venue: extractField(text, "Venue", ["Date", "Must Ship by Date", "Ticket Holder Details"]) || "",
    eventDate:
      // Look for "Date: Sunday, April 26..." — full day name only, skips email header dates like "Date: Tue, 7 Apr..."
      text.match(/\bDate:\s*((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^\n]+)/i)?.[1]?.trim() || "",
    soldAt: normalizeTimestamp(getHeader(headers, "Date")) || new Date().toISOString(),
    buyerEmail: text.match(/Email Address:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() || "",
    qtySold,
    pricePerTicket,
    payoutTotal,
    saleTotal: derivedSaleTotal,
    section:
      ticketLine.match(/Section\s+(.+?)(?=,\s*Row|,\s*Seat|,\s*\()/i)?.[1]?.trim() ||
      extractField(text, "Section", ["Row", "Seat", "Event"]) ||
      "",
    row:
      ticketLine.match(/Row\s+([^,]+)/i)?.[1]?.trim() ||
      extractField(text, "Row", ["Seat", "Event"]) ||
      "",
    seatFrom: ticketLine.match(/Seat\(s\)\s*(\d+)/i)?.[1]?.trim() || "",
    seatTo:
      ticketLine.match(/Seat\(s\)\s*\d+\s*(?:-|–|to)\s*(\d+)/i)?.[1]?.trim() ||
      ticketLine.match(/Seat\(s\)\s*(\d+)/i)?.[1]?.trim() ||
      "",
  };
}

function extractField(text: string, label: string, stopLabels: string[]) {
  const stopPattern = stopLabels.length ? `(?=\\s*(?:${stopLabels.join("|")})\\s*:)` : "$";
  const regex = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)${stopPattern}`, "i");
  const value = regex.exec(text)?.[1]?.trim() || "";
  const cleaned = value.replace(/\s+/g, " ").replace(/:$/, "").trim();
  // Guard: if the extracted value is suspiciously long it captured too much — discard it
  return cleaned.length > 120 ? "" : cleaned;
}

function parseInteger(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

function parseMoney(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
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
  url.searchParams.set("maxResults", "25");

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

// ── Outlook / Microsoft Graph helpers for Viagogo sales ──────────────────────

async function getValidOutlookToken({
  supabase,
  outlookAccount,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookSalesAccount;
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

  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: outlookAccount.refresh_token,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

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

async function outlookGraphRequest<T>(accessToken: string, input: string, init?: RequestInit): Promise<T> {
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

async function listViagogoOutlookMessages(accessToken: string): Promise<OutlookGraphMessage[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", '"viagogo"');
  url.searchParams.set("$top", "25");
  url.searchParams.set("$select", "id,subject,body,receivedDateTime,isRead");

  // Request plain text body so forwarded Gmail→Outlook emails parse cleanly
  const data = await outlookGraphRequest<{ value?: OutlookGraphMessage[] }>(
    accessToken,
    url.toString(),
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  return data.value || [];
}

async function outlookMarkRead(accessToken: string, messageId: string) {
  await outlookGraphRequest(
    accessToken,
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
    { method: "PATCH", body: JSON.stringify({ isRead: true }) },
  );
}

function decodeQuotedPrintable(text: string) {
  return text
    .replace(/=\r?\n/g, "") // soft line breaks
    .replace(/(?:=[0-9A-F]{2})+/gi, (match) => {
      const bytes = match.split("=").filter(Boolean).map((h) => parseInt(h, 16));
      return Buffer.from(bytes).toString("utf8");
    });
}

function outlookStripHtml(text: string) {
  return text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|table|tbody|thead|tfoot|h[1-6])[^>]*>/gi, "\n")
    // Close of a table cell → ": " so label/value pairs gain the colon the parsers expect
    .replace(/<\/t[dh]>/gi, ": ")
    .replace(/<t[dh][^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseDateLike(value?: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTimestamp(value: string) {
  if (!value) {
    return "";
  }

  const cleaned = value.replace(/\s*\(UTC\)\s*$/i, "").trim();
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString();
}




