import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapAccount } from "./imap-sync";

const GMAIL_QUERY = 'is:unread from:orders.viagogo.com ("Please transfer the tickets for sale" OR "Please send your tickets" OR "You sold your ticket for" OR "Please upload your e-tickets") newer_than:14d';
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
  gmail_account_id: string | null;
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
  transfer_status?: string | null;
  marketplace?: string | null;
  inventory_order_id: number | null;
  match_confidence: number | null;
  split_of_sale_id?: number | null;
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

  // Fetch all message bodies in parallel batches of 10
  const BATCH_SIZE = 10;
  const fullMessages: Awaited<ReturnType<typeof getMessage>>[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(chunk.map((m) => getMessage(accessToken, m.id)));
    fullMessages.push(...fetched);
  }

  let inserted = 0;
  let matched = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const message = messages[msgIdx];
    const fullMessage = fullMessages[msgIdx];
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);
    const combined = cleanText(`${subject}\n${body}`);
    const sourceMessageId = getHeader(headers, "Message-ID") || message.id;

    const lowerSubject = subject.toLowerCase();
    const isSoldConfirmation = lowerSubject.includes("you sold your ticket for");
    if (
      !lowerSubject.includes("please transfer the tickets for sale") &&
      !lowerSubject.includes("please send your tickets") &&
      !lowerSubject.includes("please upload your e-tickets") &&
      !isSoldConfirmation
    ) {
      continue;
    }

    // Skip pre-sale "upload your listing now" reminders — they look like sale emails
    // but are sent before any sale has occurred. They say "Thank you for listing" and
    // "if they sell" rather than confirming a completed transaction.
    if (
      combined.toLowerCase().includes("thank you for listing") ||
      combined.toLowerCase().includes("if they sell")
    ) {
      continue;
    }

    const parsed = isSoldConfirmation
      ? parseSoldConfirmation({ headers, subject, text: combined })
      : parseSale({ headers, subject, text: combined });
    if (!parsed.externalSaleId) {
      continue;
    }

    const existingSale = await findExistingSale(supabase, {
      userId,
      externalSaleId: parsed.externalSaleId,
      sourceMessageId,
    });

    const strictMatch = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({
          orders: candidateOrders,
          orderUsage,
          sale: parsed,
        });

    const isPreUpload = isSoldConfirmation && combined.toLowerCase().includes("ticketpreupload");
    const baseSaleData = {
      external_sale_id: parsed.externalSaleId,
      gmail_account_id: gmailAccount.id,
      source: "viagogo" as const,
      source_message_id: sourceMessageId,
      subject: parsed.subject,
      event_name: parsed.eventName,
      venue: parsed.venue,
      event_date: parsed.eventDate,
      sold_at: parsed.soldAt,
      account_email: gmailAccount.email,
      buyer_email: parsed.buyerEmail,
      price_per_ticket: parsed.pricePerTicket,
      currency: "GBP",
      section: parsed.section,
      row: parsed.row,
      seat_from: parsed.seatFrom,
      seat_to: parsed.seatTo,
      sale_status: isPreUpload ? "Transferred" : "Sold – Awaiting Transfer",
      transfer_status: isPreUpload ? "Transfer Completed" : "Awaiting Transfer",
      marketplace: "Viagogo",
      user_id: userId,
    };

    // Try to split the sale across orders if no single order can hold the full qty
    const tryingSplit = !existingSale && !strictMatch && (parsed.qtySold ?? 1) > 1;
    const partialMatch = tryingSplit
      ? findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsed, allowPartial: true })
      : null;

    if (tryingSplit && partialMatch && partialMatch.availableQty > 0) {
      // SPLIT: portion the sale across the best partial order and then find the remainder's match
      const totalQty = parsed.qtySold ?? 1;
      const mainQty = partialMatch.availableQty;
      const overflowQty = totalQty - mainQty;
      const mainFraction = mainQty / totalQty;
      const overflowFraction = overflowQty / totalQty;
      const round2 = (n: number) => Math.round(n * 100) / 100;

      const { data: mainData, error: mainError } = await supabase
        .from("sales")
        .insert({
          ...baseSaleData,
          qty_sold: mainQty,
          sale_total: parsed.saleTotal != null ? round2(parsed.saleTotal * mainFraction) : null,
          payout_total: parsed.payoutTotal != null ? round2(parsed.payoutTotal * mainFraction) : null,
          inventory_order_id: partialMatch.order.id,
          match_confidence: Number(partialMatch.score.toFixed(2)),
        })
        .select("id")
        .single();

      if (mainError) throw new Error(mainError.message);
      inserted += 1;

      const mainCurrentUsed = orderUsage.get(partialMatch.order.id) ?? 0;
      const mainNewQtySold = mainCurrentUsed + mainQty;
      orderUsage.set(partialMatch.order.id, mainNewQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, {
        userId,
        order: partialMatch.order,
        payoutTotal: parsed.payoutTotal != null ? round2(parsed.payoutTotal * mainFraction) : null,
        totalQtySold: mainNewQtySold,
      });

      if (mainData) {
        const overflowMatch = findBestInventoryMatch({
          orders: candidateOrders,
          orderUsage,
          sale: { ...parsed, qtySold: overflowQty },
        });

        const { error: overflowError } = await supabase
          .from("sales")
          .insert({
            ...baseSaleData,
            external_sale_id: null,
            source_message_id: sourceMessageId + "-overflow",
            qty_sold: overflowQty,
            sale_total: parsed.saleTotal != null ? round2(parsed.saleTotal * overflowFraction) : null,
            payout_total: parsed.payoutTotal != null ? round2(parsed.payoutTotal * overflowFraction) : null,
            inventory_order_id: overflowMatch?.order.id ?? null,
            match_confidence: overflowMatch ? Number(overflowMatch.score.toFixed(2)) : null,
            split_of_sale_id: mainData.id,
          });

        if (overflowError) throw new Error(overflowError.message);

        if (overflowMatch) {
          const overflowCurrentUsed = orderUsage.get(overflowMatch.order.id) ?? 0;
          const overflowNewQtySold = overflowCurrentUsed + overflowQty;
          orderUsage.set(overflowMatch.order.id, overflowNewQtySold);
          matched += 1;
          await updateMatchedOrder(supabase, {
            userId,
            order: overflowMatch.order,
            payoutTotal: parsed.payoutTotal != null ? round2(parsed.payoutTotal * overflowFraction) : null,
            totalQtySold: overflowNewQtySold,
          });
        }
      }
    } else {
      // NORMAL PATH: single-order match or unmatched
      const match = strictMatch;
      const saleData: SaleInsert = {
        ...baseSaleData,
        qty_sold: parsed.qtySold,
        sale_total: parsed.saleTotal,
        payout_total: parsed.payoutTotal,
        inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
        match_confidence:
          existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
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
        const newQtySold = currentUsed + (parsed.qtySold ?? 1);
        orderUsage.set(match.order.id, newQtySold);
        matched += 1;
        await updateMatchedOrder(supabase, {
          userId,
          order: match.order,
          payoutTotal: parsed.payoutTotal,
          totalQtySold: newQtySold,
        });
      } else if (existingSale?.inventory_order_id != null) {
        await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
      }

      // Repair: if a prior scan split this sale but the overflow insert failed
      // (e.g. missing column), the existing record will have a lower qty_sold
      // than the email. Detect this and recreate the missing overflow.
      if (
        existingSale &&
        existingSale.qty_sold != null &&
        parsed.qtySold != null &&
        parsed.qtySold > existingSale.qty_sold
      ) {
        const missingQty = parsed.qtySold - existingSale.qty_sold;
        const { data: existingOverflow } = await supabase
          .from("sales")
          .select("id")
          .eq("split_of_sale_id", existingSale.id)
          .maybeSingle();

        if (!existingOverflow) {
          const round2 = (n: number) => Math.round(n * 100) / 100;
          const overflowFraction = missingQty / parsed.qtySold;
          const overflowMatch = findBestInventoryMatch({
            orders: candidateOrders,
            orderUsage,
            sale: { ...parsed, qtySold: missingQty },
          });

          const { error: repairError } = await supabase.from("sales").insert({
            ...baseSaleData,
            external_sale_id: null,
            source_message_id: sourceMessageId + "-overflow",
            qty_sold: missingQty,
            sale_total: parsed.saleTotal != null ? round2(parsed.saleTotal * overflowFraction) : null,
            payout_total: parsed.payoutTotal != null ? round2(parsed.payoutTotal * overflowFraction) : null,
            inventory_order_id: overflowMatch?.order.id ?? null,
            match_confidence: overflowMatch ? Number(overflowMatch.score.toFixed(2)) : null,
            split_of_sale_id: existingSale.id,
          });

          if (!repairError && overflowMatch) {
            const ovUsed = orderUsage.get(overflowMatch.order.id) ?? 0;
            const ovNew = ovUsed + missingQty;
            orderUsage.set(overflowMatch.order.id, ovNew);
            matched += 1;
            await updateMatchedOrder(supabase, {
              userId,
              order: overflowMatch.order,
              payoutTotal: parsed.payoutTotal != null ? round2(parsed.payoutTotal * overflowFraction) : null,
              totalQtySold: ovNew,
            });
          }
        }
      }
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
    const newQtySold = currentUsed + (sale.qty_sold ?? 1);
    orderUsage.set(match.order.id, newQtySold);

    matched += 1;
    await updateMatchedOrder(supabase, {
      userId,
      order: match.order,
      payoutTotal: sale.payout_total,
      totalQtySold: newQtySold,
    });
  }

  return matched;
}

// Detect and unlink over-matched sales caused by concurrent scans or race conditions.
// When two scan requests run simultaneously they both read orderUsage=0 and can both
// match to the same first-ranked order, producing e.g. 12 qty_sold against a 6-ticket
// order. This function unlinks the newest excess sales so rematchViagogoSales can then
// assign them to the correct (other) order.
export async function fixOverMatchedSales(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, qty_bought")
    .eq("user_id", userId)
    .not("qty_bought", "is", null);

  if (ordersError) throw new Error(ordersError.message);

  let fixed = 0;

  for (const order of (orders ?? []) as Array<{ id: number; qty_bought: number | null }>) {
    const qtyBought = order.qty_bought ?? 0;
    if (qtyBought <= 0) continue;

    const { data: linked, error: linkedError } = await supabase
      .from("sales")
      .select("id, qty_sold")
      .eq("inventory_order_id", order.id)
      .eq("user_id", userId)
      .neq("sale_status", "Deleted")
      .order("created_at", { ascending: true }); // oldest first → keep these

    if (linkedError) throw new Error(linkedError.message);

    const rows = (linked ?? []) as Array<{ id: number; qty_sold: number | null }>;
    const total = rows.reduce((s, r) => s + (r.qty_sold ?? 0), 0);
    if (total <= qtyBought) continue;

    // Unlink the newest sales that push us over capacity
    let excess = total - qtyBought;
    for (const sale of [...rows].reverse()) {
      if (excess <= 0) break;
      const { error: unlinkError } = await supabase
        .from("sales")
        .update({ inventory_order_id: null, match_confidence: null })
        .eq("id", sale.id)
        .eq("user_id", userId);
      if (unlinkError) throw new Error(unlinkError.message);
      excess -= sale.qty_sold ?? 0;
      fixed++;
    }

    // Recompute this order's status now that excess sales have been removed
    await recomputeOrderStatus(supabase, { userId, orderId: order.id });
  }

  return fixed;
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
    const isSoldConfirmation = lowerSubject.includes("you sold your ticket for");
    if (
      !lowerSubject.includes("please transfer the tickets for sale") &&
      !lowerSubject.includes("please send your tickets") &&
      !lowerSubject.includes("please upload your e-tickets") &&
      !isSoldConfirmation
    ) {
      continue;
    }

    const rawBody = decodeQuotedPrintable(msg.body.content);
    // Skip pre-sale "upload your listing now" reminders — same check as Gmail path
    const previewText = (subject + " " + rawBody).toLowerCase();
    if (previewText.includes("thank you for listing") || previewText.includes("if they sell")) {
      continue;
    }
    const bodyText =
      msg.body.contentType === "html" ? outlookStripHtml(rawBody) : rawBody;
    const combined = cleanText(`${subject}\n${bodyText}`);
    const sourceMessageId = msg.id;

    // parseSale/parseSoldConfirmation use headers only for the "Date" header → soldAt
    const fakeHeaders: GmailHeader[] = [
      { name: "Date", value: msg.receivedDateTime || "" },
    ];

    const parsed = isSoldConfirmation
      ? parseSoldConfirmation({ headers: fakeHeaders, subject, text: combined })
      : parseSale({ headers: fakeHeaders, subject, text: combined });
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
      sale_status: isSoldConfirmation && combined.toLowerCase().includes("ticketpreupload")
        ? "Transferred"
        : "Sold – Awaiting Transfer",
      transfer_status: isSoldConfirmation && combined.toLowerCase().includes("ticketpreupload")
        ? "Transfer Completed"
        : "Awaiting Transfer",
      marketplace: "Viagogo",
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
      const newQtySold = currentUsed + (parsed.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, {
        userId,
        order: match.order,
        payoutTotal: parsed.payoutTotal,
        totalQtySold: newQtySold,
      });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
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
async function recomputeOrderStatus(
  supabase: SupabaseClient,
  { userId, orderId }: { userId: string; orderId: number },
) {
  const [{ data: salesData }, { data: orderData }] = await Promise.all([
    supabase
      .from("sales")
      .select("sale_total, payout_total, qty_sold")
      .eq("inventory_order_id", orderId)
      .eq("user_id", userId)
      .neq("sale_status", "Deleted"),
    supabase
      .from("orders")
      .select("qty_bought")
      .eq("id", orderId)
      .eq("user_id", userId)
      .single(),
  ]);

  const linked = (salesData || []) as { sale_total?: number | null; payout_total?: number | null; qty_sold?: number | null }[];
  const soldTotal = linked.reduce((s, r) => s + (r.sale_total ?? r.payout_total ?? 0), 0);
  const qtySold = linked.reduce((s, r) => s + (r.qty_sold ?? 0), 0);
  const qtyBought = (orderData as { qty_bought?: number | null } | null)?.qty_bought ?? 0;

  const newStatus =
    linked.length === 0 ? "Unlisted"
    : qtyBought > 0 && qtySold < qtyBought ? "Partially Sold"
    : "Sold";

  await supabase
    .from("orders")
    .update({ listing_status: newStatus, sold_total: soldTotal > 0 ? soldTotal : null })
    .eq("id", orderId)
    .eq("user_id", userId);
}

async function updateMatchedOrder(
  supabase: SupabaseClient,
  {
    userId,
    order,
    payoutTotal,
    totalQtySold,
  }: {
    userId: string;
    order: CandidateOrder;
    payoutTotal: number | null;
    totalQtySold: number;
  },
) {
  const qtyBought = order.qty_bought ?? 0;
  const newStatus = qtyBought > 0 && totalQtySold < qtyBought ? "Partially Sold" : "Sold";
  const payload: Record<string, string | number | null> = {
    listing_status: newStatus,
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
    .not("inventory_order_id", "is", null)
    .neq("sale_status", "Deleted");

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
    .is("split_of_sale_id", null)
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
  allowPartial = false,
}: {
  orders: CandidateOrder[];
  orderUsage: Map<number, number>;
  sale: ParsedSale;
  allowPartial?: boolean;
}): { order: CandidateOrder; score: number; availableQty: number } | null {
  let best: { order: CandidateOrder; score: number; availableQty: number } | null = null;
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
    const availableQty = orderQty - soldQty;

    if (allowPartial) {
      if (availableQty <= 0) continue;
    } else {
      if (soldQty + requestedQty > orderQty) continue;
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
      best = { order, score, availableQty };
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

function parseViagogoSaleDate(text: string): string {
  // "Friday, May 08, 2026 | 19:30" → "2026-05-08"
  const match = text.match(/\w+day,\s+(\w+\s+\d{1,2},\s+\d{4})\s*\|/i);
  if (match) {
    const d = new Date(match[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return "";
}

function parseSoldConfirmation({
  headers,
  subject,
  text,
}: {
  headers: GmailHeader[];
  subject: string;
  text: string;
}): ParsedSale {
  const externalSaleId =
    subject.match(/Order#\s*(\d+)/i)?.[1] ||
    text.match(/OrderID\s*#?\s*(\d+)/i)?.[1] ||
    "";
  const eventName =
    subject.match(/You sold your ticket for (.+?)\s*-\s*Order#/i)?.[1]?.trim() || "";
  const qtySold = parseInteger(text, [/(\d+)\s*Ticket\(s\)/i]);
  const payoutTotal = parseMoney(text, [/Payment\s+Total[\s:]+[£$€Â\s]*([\d,]+\.?\d*)/i]);
  const saleTotal = payoutTotal;
  const pricePerTicket =
    qtySold && payoutTotal ? Math.round((payoutTotal / qtySold) * 100) / 100 : null;
  const eventDate = parseViagogoSaleDate(text);
  const venue =
    text.match(/\|\s*\d{1,2}:\d{2}[^\n]*\s+([^\n]+?):?\s+OrderID/i)?.[1]?.trim() || "";
  const section = text.match(/Section:\s*([^\n|:]+)/i)?.[1]?.trim() || "";

  return {
    externalSaleId,
    subject,
    eventName,
    venue,
    eventDate,
    soldAt: normalizeTimestamp(getHeader(headers, "Date")) || new Date().toISOString(),
    buyerEmail: "",
    qtySold,
    pricePerTicket,
    payoutTotal,
    saleTotal,
    section,
    row:
      text.match(/Row:\s*([^\n|,]+)/i)?.[1]?.trim() ||
      text.match(/\bRow\s+(\w[^\n|,]*)/i)?.[1]?.trim() ||
      "",
    seatFrom:
      text.match(/Seat\(?s?\)?:\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?\s+(\d+)/i)?.[1]?.trim() ||
      "",
    seatTo:
      text.match(/Seat\(?s?\)?:\s*\d+\s*[-–]\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?:\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?\s+\d+\s*[-–]\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?\s+(\d+)/i)?.[1]?.trim() ||
      "",
  };
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
      subject.match(/sale\s+#?(\d+)/i)?.[1] ||
      text.match(/Order ID:\s*(\d+)/i)?.[1] ||
      "",
    subject,
    eventName:
      extractField(text, "Event", ["Listing Note\\(s\\)", "Venue", "Date", "Must Ship by Date"]) ||
      text.match(/sale of\s+(.+?)\s+tickets/i)?.[1]?.trim() ||
      subject.match(/sale\s+#\d+[^\w]*[-–]\s*(.+)/i)?.[1]?.trim() ||
      "",
    venue: extractField(text, "Venue", ["Date", "Must Ship by Date", "Ticket Holder Details"]) || "",
    eventDate:
      // Look for "Date: Sunday, April 26..." — full day name only, skips email header dates like "Date: Tue, 7 Apr..."
      text.match(/\bDate:\s*((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^\n]+)/i)?.[1]?.trim() ||
      // Fallback for "upload e-tickets" format where date is standalone: "Thursday, July 17, 2026 | 19:30"
      parseViagogoSaleDate(text) ||
      "",
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
    seatFrom:
      ticketLine.match(/Seat\(s\)\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?:\s*(\d+)/i)?.[1]?.trim() ||
      "",
    seatTo:
      ticketLine.match(/Seat\(s\)\s*\d+\s*(?:-|–|to)\s*(\d+)/i)?.[1]?.trim() ||
      ticketLine.match(/Seat\(s\)\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?:\s*\d+\s*[-–]\s*(\d+)/i)?.[1]?.trim() ||
      text.match(/Seat\(?s?\)?:\s*(\d+)/i)?.[1]?.trim() ||
      "",
  };
}

function extractField(text: string, label: string, stopLabels: string[]) {
  const stopPattern = stopLabels.length ? `(?=\\s*(?:${stopLabels.join("|")})\\s*:)` : "$";
  const regex = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)${stopPattern}`, "i");
  const value = regex.exec(text)?.[1]?.trim() || "";
  const cleaned = value.replace(/\s+/g, " ").replace(/:$/, "").replace(/^:\s*/, "").trim();
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
  url.searchParams.set("maxResults", "50");

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

function getBody(payload: GmailPayload): string {
  const parts: string[] = [];

  const walk = (part: GmailPayload) => {
    const data = part.body?.data;
    if (data) {
      let decoded = decodeBase64Url(data);
      // Gmail API delivers body.data as raw base64URL without decoding QP.
      // Apply QP decode before HTML stripping so =C2=A3 → £ and =20 → space.
      const cte = (part.headers || [])
        .find((h) => h.name.toLowerCase() === "content-transfer-encoding")
        ?.value?.toLowerCase() ?? "";
      if (cte.includes("quoted-printable")) {
        decoded = decodeQuotedPrintable(decoded);
      }
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

const DATE_MONTHS: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,
  september:8,october:9,november:10,december:11,
};
function parseDateLike(value?: string | null): Date | null {
  if (!value) return null;
  const s = value.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();

  // ISO YYYY-MM-DD (fast path)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  // "18 July 2026" or "18 Jul 2026" (day before month — TM/Viagogo format)
  const dmy = s.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (dmy) {
    const month = DATE_MONTHS[dmy[2].toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(+dmy[3], month, +dmy[1]));
  }

  // "July 18 2026" or "Jul 18 2026" (month before day — US format)
  const mdy = s.match(/\b([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})\b/);
  if (mdy) {
    const month = DATE_MONTHS[mdy[1].toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(+mdy[3], month, +mdy[2]));
  }

  return null;
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

const SALE_SUBJECT_KEYWORDS = [
  "please transfer the tickets for sale",
  "please send your tickets",
  "you sold your ticket for",
  "please upload your e-tickets",
];

// ─── StubHub Sales Sync ───────────────────────────────────────────────────────

const STUBHUB_GMAIL_QUERY =
  'is:unread from:stubhubinternational.com (subject:"You sold your ticket" OR subject:"Payment processed" OR subject:"tickets were delivered") newer_than:14d';

const STUBHUB_SUBJECT_KEYWORDS = [
  "you sold your ticket",
  "payment processed on",
  "tickets were delivered for order",
];

const SH_MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseStubHubSale({
  headers,
  subject,
  text,
}: {
  headers: GmailHeader[];
  subject: string;
  text: string;
}): ParsedSale {
  const lowerSubject = subject.toLowerCase();

  // External sale ID — try subject first, then body
  const externalSaleId =
    subject.match(/[Oo]rder#\s*(\d+)/i)?.[1] ||
    text.match(/OrderID\s*\n#\s*(\d+)/i)?.[1] ||
    text.match(/Order\s*#\s*:?\s*\n\s*(\d{5,})/i)?.[1] ||
    "";

  // Event name
  let eventName = "";
  if (lowerSubject.startsWith("you sold your ticket")) {
    eventName =
      subject.match(/^You sold your tickets? for (.+?)\s*-\s*Order#\s*\d+$/i)?.[1]?.trim() ?? "";
  } else if (lowerSubject.startsWith("your tickets were delivered")) {
    eventName =
      subject.match(/^Your tickets were delivered for order#\s*\d+\s*-\s*(.+)$/i)?.[1]?.trim() ?? "";
  }
  if (!eventName) {
    eventName = text.match(/Sale info\s*\n([^\n]+)/i)?.[1]?.trim() ?? "";
  }
  // "Payment processed" body: count line + event name + date
  if (!eventName) {
    eventName = text.match(/^\d+\n([A-Z][^\n]{5,})\n\n\d{2}-\d{2}-\d{4}/m)?.[1]?.trim() ?? "";
  }

  // Event date
  let eventDate = "";
  // Emails 1 & 3: "Wed,\n10/06/2026,\n12:00" — DD/MM/YYYY
  const saleBlockDate = text.match(
    /(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*\n(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*\n(\d{1,2}:\d{2})/i,
  );
  if (saleBlockDate) {
    const [, weekday, dd, mm, yyyy, time] = saleBlockDate;
    const monthName = SH_MONTH_NAMES[parseInt(mm, 10) - 1] ?? mm;
    eventDate = `${weekday} ${parseInt(dd, 10)} ${monthName} ${yyyy} ${time}`;
  } else {
    // Email 2: "06-10-2026 12:00:00" — MM-DD-YYYY (StubHub International payment emails)
    const payDate = text.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2})/);
    if (payDate) {
      const [, mm, dd, yyyy, time] = payDate;
      const monthName = SH_MONTH_NAMES[parseInt(mm, 10) - 1] ?? mm;
      eventDate = `${parseInt(dd, 10)} ${monthName} ${yyyy} ${time}`;
    }
  }

  // Venue: lines immediately after the timezone line, until OrderID or ticket-count line
  let venue = "";
  const nonEmptyLines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const tzIdx = nonEmptyLines.findIndex((l) =>
    /^(Europe|America|Asia|Pacific|Atlantic|Indian|Arctic)\//.test(l) ||
    l === "UTC" ||
    l === "GMT",
  );
  if (tzIdx >= 0) {
    const venueLines: string[] = [];
    for (let i = tzIdx + 1; i < Math.min(tzIdx + 6, nonEmptyLines.length); i++) {
      if (/^(OrderID|#\d|\d+\s*tickets?)/i.test(nonEmptyLines[i])) break;
      venueLines.push(nonEmptyLines[i].replace(/,$/, "").trim());
    }
    if (venueLines.length) venue = venueLines.join(", ");
  }

  // Buyer email — only present in "You sold your ticket" emails
  const buyerEmail =
    text.match(/Your buyer[\s\S]{0,400}?([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() ??
    "";

  // Quantity
  const qtySoldStr =
    text.match(/^(\d+)\s+tickets?$/im)?.[1] ||
    text.match(/(\d+)\nticket\b/i)?.[1] ||
    text.match(/Quantity\s*\nx(\d+)/i)?.[1] ||
    null;
  const qtySold = qtySoldStr ? parseInt(qtySoldStr, 10) : null;

  // Amounts
  const saleTotal = parseMoney(text, [
    /Subtotal\s*\n\s*£\s*([\d,]+\.?\d*)/i,
    /Total\s+ticket\s+price\s*\n\s*£\s*([\d,]+\.?\d*)/i,
  ]);
  const payoutTotal = parseMoney(text, [
    /Payment\s+Total\s*[\s]+£\s*([\d,]+\.?\d*)/i,
    /Your\s+payment\s*[\s]+£\s*([\d,]+\.?\d*)/i,
  ]);
  const pricePerTicket =
    qtySold && saleTotal ? Math.round((saleTotal / qtySold) * 100) / 100 : null;

  // Section
  let section = "";
  // Emails 1 & 3: section appears after "X tickets" — "General Camping -\nGeneral admission"
  const sectionAfterQty = text.match(/\d+\s+tickets?\s*\n\n([^\n]+) -\n([^\n]+)/i);
  if (sectionAfterQty) {
    section = `${sectionAfterQty[1].trim()} - ${sectionAfterQty[2].trim()}`;
  } else {
    // Email 2: section appears before "Row N/A"
    section = text.match(/([^\n]+)\n\nRow N\/A/i)?.[1]?.trim() ?? "";
  }

  return {
    externalSaleId,
    subject,
    eventName,
    venue,
    eventDate,
    soldAt:
      normalizeTimestamp(headers.find((h) => h.name.toLowerCase() === "date")?.value ?? "") ||
      new Date().toISOString(),
    buyerEmail,
    qtySold,
    pricePerTicket,
    payoutTotal,
    saleTotal,
    section,
    row: "",
    seatFrom: "",
    seatTo: "",
  };
}

async function findExistingStubHubSale(
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
      .eq("source", "stubhub")
      .eq("external_sale_id", externalSaleId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as ExistingSale;
  }
  const { data, error } = await supabase
    .from("sales")
    .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
    .eq("user_id", userId)
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExistingSale | null) || null;
}

async function listStubHubOutlookMessages(accessToken: string): Promise<OutlookGraphMessage[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", '"stubhub"');
  url.searchParams.set("$top", "25");
  url.searchParams.set("$select", "id,subject,body,receivedDateTime,isRead");
  const data = await outlookGraphRequest<{ value?: OutlookGraphMessage[] }>(
    accessToken,
    url.toString(),
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  return data.value || [];
}

export async function syncStubHubSalesInbox({
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
  const messages = await listMessages(accessToken, STUBHUB_GMAIL_QUERY);
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);

  const BATCH_SIZE = 10;
  const fullMessages: Awaited<ReturnType<typeof getMessage>>[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(chunk.map((m) => getMessage(accessToken, m.id)));
    fullMessages.push(...fetched);
  }

  let inserted = 0;
  let matched = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const message = messages[msgIdx];
    const fullMessage = fullMessages[msgIdx];
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);
    const combined = cleanText(`${subject}\n${body}`);
    const sourceMessageId = getHeader(headers, "Message-ID") || message.id;

    const lowerSubject = subject.toLowerCase();
    if (!STUBHUB_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw))) continue;

    const parsed = parseStubHubSale({ headers, subject, text: combined });
    if (!parsed.externalSaleId) continue;

    const existingSale = await findExistingStubHubSale(supabase, {
      userId,
      externalSaleId: parsed.externalSaleId,
      sourceMessageId,
    });

    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsed });

    const saleData: SaleInsert = {
      external_sale_id: parsed.externalSaleId,
      gmail_account_id: gmailAccount.id,
      source: "stubhub",
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
      sale_status: "Sold – Awaiting Transfer",
      marketplace: "StubHub",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence:
        existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);

    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      const newQtySold = currentUsed + (parsed.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, {
        userId,
        order: match.order,
        payoutTotal: parsed.payoutTotal,
        totalQtySold: newQtySold,
      });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
    }

    await markMessageProcessed(accessToken, message.id, labelId);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", gmailAccount.id);

  return { scanned: messages.length, inserted, matched, email: gmailAccount.email };
}

export async function syncStubHubSalesOutlookInbox({
  supabase,
  outlookAccount,
  userId,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookSalesAccount;
  userId: string;
}): Promise<SyncResult> {
  const accessToken = await getValidOutlookToken({ supabase, outlookAccount });
  const messages = await listStubHubOutlookMessages(accessToken);
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);

  let inserted = 0;
  let matched = 0;

  for (const msg of messages) {
    if (msg.isRead) continue;

    const subject = msg.subject || "";
    const lowerSubject = subject.toLowerCase();
    if (!STUBHUB_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw))) continue;

    const rawBody = decodeQuotedPrintable(msg.body.content);
    const bodyText = msg.body.contentType === "html" ? outlookStripHtml(rawBody) : rawBody;
    const combined = cleanText(`${subject}\n${bodyText}`);
    const sourceMessageId = msg.id;

    const fakeHeaders: GmailHeader[] = [{ name: "Date", value: msg.receivedDateTime || "" }];
    const parsed = parseStubHubSale({ headers: fakeHeaders, subject, text: combined });
    if (!parsed.externalSaleId) continue;

    const existingSale = await findExistingStubHubSale(supabase, {
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
      source: "stubhub",
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
      sale_status: "Sold – Awaiting Transfer",
      marketplace: "StubHub",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence:
        existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);

    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      const newQtySold = currentUsed + (parsed.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, {
        userId,
        order: match.order,
        payoutTotal: parsed.payoutTotal,
        totalQtySold: newQtySold,
      });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
    }

    await outlookMarkRead(accessToken, msg.id);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", outlookAccount.id);

  return { scanned: messages.length, inserted, matched, email: outlookAccount.email };
}

export async function syncStubHubSalesImapInbox({
  supabase,
  imapAccount,
  userId,
}: {
  supabase: SupabaseClient;
  imapAccount: ImapAccount;
  userId: string;
}): Promise<SyncResult> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: imapAccount.host,
    port: imapAccount.port,
    secure: imapAccount.use_tls,
    auth: { user: imapAccount.username, pass: imapAccount.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 30000,
  });

  let inserted = 0;
  let matched = 0;
  let scanned = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(imapAccount.mailbox || "INBOX");
    try {
      const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const uidResult = await client.search({ since: since14, seen: false }, { uid: true });
      const allUids = (Array.isArray(uidResult) ? uidResult : []).slice(-500) as number[];

      if (allUids.length === 0) {
        return { scanned: 0, inserted, matched, email: imapAccount.username };
      }

      const candidateUids: number[] = [];
      const ENV_BATCH = 50;
      for (let ei = 0; ei < allUids.length; ei += ENV_BATCH) {
        const chunk = allUids.slice(ei, ei + ENV_BATCH);
        for await (const msg of client.fetch(chunk, { envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? "";
          const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          if (
            from.includes("stubhubinternational.com") &&
            STUBHUB_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))
          ) {
            candidateUids.push(msg.uid);
          }
        }
      }

      if (candidateUids.length === 0) {
        return { scanned: 0, inserted, matched, email: imapAccount.username };
      }

      try { await client.mailboxCreate("My Sales"); } catch { /* already exists */ }

      const candidateOrders = await loadCandidateOrders(supabase, userId);
      const orderUsage = await loadOrderUsage(supabase, userId);

      const BODY_BATCH = 10;
      for (let bi = 0; bi < candidateUids.length; bi += BODY_BATCH) {
        const batchUids = candidateUids.slice(bi, bi + BODY_BATCH);
        const batchSources = new Map<number, Buffer>();
        for await (const msg of client.fetch(batchUids, { source: true }, { uid: true })) {
          if (msg.source) batchSources.set(msg.uid, msg.source as Buffer);
        }

        for (const uid of batchUids) {
          const source = batchSources.get(uid);
          if (!source) continue;

          try {
            const parsed = await simpleParser(source, { skipHtmlToText: true });
            scanned++;

            const subject = parsed.subject ?? "";
            const sourceMessageId = parsed.messageId
              ? parsed.messageId.replace(/^<|>$/g, "")
              : `imap-uid-${uid}`;

            const plainPart = parsed.text ?? "";
            const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
            const bodyParts: string[] = [];
            if (plainPart) bodyParts.push(plainPart);
            if (rawHtml) bodyParts.push(stripHtml(rawHtml));
            const body = cleanText(bodyParts.join("\n"));
            const combined = cleanText(`${subject}\n${body}`);

            const fakeHeaders: GmailHeader[] = [
              { name: "Date", value: parsed.date?.toUTCString() ?? "" },
            ];

            const saleParsed = parseStubHubSale({ headers: fakeHeaders, subject, text: combined });
            if (!saleParsed.externalSaleId) { scanned--; continue; }

            const existingSale = await findExistingStubHubSale(supabase, {
              userId,
              externalSaleId: saleParsed.externalSaleId,
              sourceMessageId,
            });

            const match = existingSale?.inventory_order_id
              ? null
              : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: saleParsed });

            const saleData: SaleInsert = {
              external_sale_id: saleParsed.externalSaleId,
              gmail_account_id: imapAccount.id,
              source: "stubhub",
              source_message_id: sourceMessageId,
              subject: saleParsed.subject,
              event_name: saleParsed.eventName,
              venue: saleParsed.venue,
              event_date: saleParsed.eventDate,
              sold_at: saleParsed.soldAt,
              account_email: imapAccount.username,
              buyer_email: saleParsed.buyerEmail,
              qty_sold: saleParsed.qtySold,
              price_per_ticket: saleParsed.pricePerTicket,
              sale_total: saleParsed.saleTotal,
              payout_total: saleParsed.payoutTotal,
              currency: "GBP",
              section: saleParsed.section,
              row: saleParsed.row,
              seat_from: saleParsed.seatFrom,
              seat_to: saleParsed.seatTo,
              sale_status: "Sold – Awaiting Transfer",
              marketplace: "StubHub",
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

            if (!existingSale) inserted++;

            if (match) {
              const currentUsed = orderUsage.get(match.order.id) ?? 0;
              const newQtySold = currentUsed + (saleParsed.qtySold ?? 1);
              orderUsage.set(match.order.id, newQtySold);
              matched++;
              await updateMatchedOrder(supabase, {
                userId,
                order: match.order,
                payoutTotal: saleParsed.payoutTotal,
                totalQtySold: newQtySold,
              });
            } else if (existingSale?.inventory_order_id != null) {
              await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
            }

            try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* best-effort */ }
            try { await client.messageMove(String(uid), "My Sales", { uid: true }); } catch { /* best-effort */ }
          } catch {
            scanned--;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  await supabase
    .from("imap_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", imapAccount.id);

  return { scanned, inserted, matched, email: imapAccount.username };
}

// ─── Ticombo Sales Sync ───────────────────────────────────────────────────────

const TICOMBO_GMAIL_QUERY =
  'is:unread from:ticombo.com subject:"Your tickets are sold" newer_than:14d';

const TICOMBO_SUBJECT_KEYWORDS = ["your tickets are sold for"];

function parseTicomboSale({
  headers,
  subject,
  text,
}: {
  headers: GmailHeader[];
  subject: string;
  text: string;
}): ParsedSale {
  // Order # is the primary dedup key; fall back to Transaction ID
  const externalSaleId =
    text.match(/Order\s*#\s*:\s*(\S+)/i)?.[1] ||
    text.match(/Order\s*#\s*(\S+)/i)?.[1] ||
    text.match(/Transaction\s+ID\s*:\s*(\S+)/i)?.[1] ||
    "";

  // "Your tickets are sold for Hayley Williams" → eventName = "Hayley Williams"
  const eventName =
    subject.match(/your tickets are sold for (.+?)$/i)?.[1]?.trim() || "";

  // Date block: "Jun 23, 2026, 19:00 GMT\nHayley Williams\nManchester Academy, ..."
  // After stripping HTML, the h3 (event name) gets newlines; small tags become spaces.
  const blockMatch = text.match(
    /([A-Za-z]{3}\s+\d{1,2},\s+\d{4}),?\s+\d{1,2}:\d{2}[^\n]*\n[^\n]+\n([^\n]+)/i,
  );
  const eventDate = (() => {
    const raw = blockMatch?.[1];
    if (!raw) return "";
    const d = new Date(raw);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  })();
  const venue = blockMatch?.[2]?.trim() || "";

  // "1 ticket" — default 1 if missing
  const qtySold = parseInt(text.match(/(\d+)\s+ticket/i)?.[1] ?? "1", 10);

  // "Total Ticket Price: £130.00" in the ticket details block
  const saleTotal =
    parseMoney(text, [/Total Ticket Price\s*:?\s*£\s*([\d,.]+)/i]) ||
    parseMoney(text, [/Subtotal\s+£\s*([\d,.]+)/i]) ||
    parseMoney(text, [/Subtotal\s*:?\s*£\s*([\d,.]+)/i]);

  // "Total (payout) £130.00" in the order summary table
  const payoutTotal =
    parseMoney(text, [/Total\s*\(payout\)\s*:?\s*£\s*([\d,.]+)/i]);

  // "Category: Floor" → section
  const section = text.match(/Category\s*:\s*([^\n]+)/i)?.[1]?.trim() || "";

  return {
    externalSaleId,
    subject,
    eventName,
    venue,
    eventDate,
    soldAt: normalizeTimestamp(getHeader(headers, "Date")) || new Date().toISOString(),
    buyerEmail: "",
    qtySold,
    pricePerTicket: qtySold && saleTotal ? Math.round((saleTotal / qtySold) * 100) / 100 : null,
    saleTotal: saleTotal ?? null,
    payoutTotal: payoutTotal ?? null,
    section,
    row: "",
    seatFrom: "",
    seatTo: "",
  };
}

async function findExistingTicomboSale(
  supabase: SupabaseClient,
  { userId, externalSaleId, sourceMessageId }: { userId: string; externalSaleId: string; sourceMessageId: string },
) {
  if (externalSaleId) {
    const { data, error } = await supabase
      .from("sales")
      .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
      .eq("user_id", userId)
      .eq("source", "ticombo")
      .eq("external_sale_id", externalSaleId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as ExistingSale;
  }
  const { data, error } = await supabase
    .from("sales")
    .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
    .eq("user_id", userId)
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExistingSale | null) || null;
}

export async function syncTicomboSalesInbox({
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
  const messages = await listMessages(accessToken, TICOMBO_GMAIL_QUERY);
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);

  const BATCH_SIZE = 10;
  const fullMessages: Awaited<ReturnType<typeof getMessage>>[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(chunk.map((m) => getMessage(accessToken, m.id)));
    fullMessages.push(...fetched);
  }

  let inserted = 0;
  let matched = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const message = messages[msgIdx];
    const fullMessage = fullMessages[msgIdx];
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);
    const combined = cleanText(`${subject}\n${body}`);
    const sourceMessageId = getHeader(headers, "Message-ID") || message.id;

    const lowerSubject = subject.toLowerCase();
    if (!TICOMBO_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw))) continue;

    const parsed = parseTicomboSale({ headers, subject, text: combined });
    if (!parsed.externalSaleId) continue;

    const existingSale = await findExistingTicomboSale(supabase, {
      userId, externalSaleId: parsed.externalSaleId, sourceMessageId,
    });

    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsed });

    const saleData: SaleInsert = {
      external_sale_id: parsed.externalSaleId,
      gmail_account_id: gmailAccount.id,
      source: "ticombo",
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
      sale_status: "Sold – Awaiting Transfer",
      marketplace: "Ticombo",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);
    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      const newQtySold = currentUsed + (parsed.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: parsed.payoutTotal, totalQtySold: newQtySold });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
    }

    await markMessageProcessed(accessToken, message.id, labelId);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", gmailAccount.id);

  return { scanned: messages.length, inserted, matched, email: gmailAccount.email };
}

export async function syncTicomboSalesOutlookInbox({
  supabase,
  outlookAccount,
  userId,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookSalesAccount;
  userId: string;
}): Promise<SyncResult> {
  const accessToken = await getValidOutlookToken({ supabase, outlookAccount });

  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", '"ticombo"');
  url.searchParams.set("$top", "25");
  url.searchParams.set("$select", "id,subject,body,receivedDateTime,isRead");
  const data = await outlookGraphRequest<{ value?: OutlookGraphMessage[] }>(
    accessToken, url.toString(), { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  const messages = data.value || [];

  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);
  let inserted = 0;
  let matched = 0;

  for (const msg of messages) {
    if (msg.isRead) continue;
    const subject = msg.subject || "";
    if (!TICOMBO_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))) continue;

    const rawBody = decodeQuotedPrintable(msg.body.content);
    const bodyText = msg.body.contentType === "html" ? outlookStripHtml(rawBody) : rawBody;
    const combined = cleanText(`${subject}\n${bodyText}`);
    const sourceMessageId = msg.id;
    const fakeHeaders: GmailHeader[] = [{ name: "Date", value: msg.receivedDateTime || "" }];

    const parsed = parseTicomboSale({ headers: fakeHeaders, subject, text: combined });
    if (!parsed.externalSaleId) continue;

    const existingSale = await findExistingTicomboSale(supabase, {
      userId, externalSaleId: parsed.externalSaleId, sourceMessageId,
    });

    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsed });

    const saleData: SaleInsert = {
      external_sale_id: parsed.externalSaleId,
      gmail_account_id: outlookAccount.id,
      source: "ticombo",
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
      sale_status: "Sold – Awaiting Transfer",
      marketplace: "Ticombo",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);
    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      const newQtySold = currentUsed + (parsed.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: parsed.payoutTotal, totalQtySold: newQtySold });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
    }

    await outlookMarkRead(accessToken, msg.id);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", outlookAccount.id);

  return { scanned: messages.length, inserted, matched, email: outlookAccount.email };
}

export async function syncTicomboSalesImapInbox({
  supabase,
  imapAccount,
  userId,
}: {
  supabase: SupabaseClient;
  imapAccount: ImapAccount;
  userId: string;
}): Promise<SyncResult> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: imapAccount.host,
    port: imapAccount.port,
    secure: imapAccount.use_tls,
    auth: { user: imapAccount.username, pass: imapAccount.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 30000,
  });

  let inserted = 0;
  let matched = 0;
  let scanned = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(imapAccount.mailbox || "INBOX");
    try {
      const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const uidResult = await client.search({ since: since14, seen: false }, { uid: true });
      const allUids = (Array.isArray(uidResult) ? uidResult : []).slice(-500) as number[];

      if (allUids.length === 0) return { scanned: 0, inserted, matched, email: imapAccount.username };

      const candidateUids: number[] = [];
      const ENV_BATCH = 50;
      for (let ei = 0; ei < allUids.length; ei += ENV_BATCH) {
        const chunk = allUids.slice(ei, ei + ENV_BATCH);
        for await (const msg of client.fetch(chunk, { envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? "";
          const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          if (
            from.includes("ticombo.com") &&
            TICOMBO_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))
          ) {
            candidateUids.push(msg.uid);
          }
        }
      }

      if (candidateUids.length === 0) return { scanned: 0, inserted, matched, email: imapAccount.username };

      try { await client.mailboxCreate("My Sales"); } catch { /* already exists */ }

      const candidateOrders = await loadCandidateOrders(supabase, userId);
      const orderUsage = await loadOrderUsage(supabase, userId);

      const BODY_BATCH = 10;
      for (let bi = 0; bi < candidateUids.length; bi += BODY_BATCH) {
        const batchUids = candidateUids.slice(bi, bi + BODY_BATCH);
        const batchSources = new Map<number, Buffer>();
        for await (const msg of client.fetch(batchUids, { source: true }, { uid: true })) {
          if (msg.source) batchSources.set(msg.uid, msg.source as Buffer);
        }

        for (const uid of batchUids) {
          const source = batchSources.get(uid);
          if (!source) continue;
          try {
            const parsed = await simpleParser(source, { skipHtmlToText: true });
            scanned++;
            const subject = parsed.subject ?? "";
            const sourceMessageId = parsed.messageId
              ? parsed.messageId.replace(/^<|>$/g, "")
              : `imap-uid-${uid}`;

            const plainPart = parsed.text ?? "";
            const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
            const bodyParts: string[] = [];
            if (plainPart) bodyParts.push(plainPart);
            if (rawHtml) bodyParts.push(stripHtml(rawHtml));
            const combined = cleanText(`${subject}\n${cleanText(bodyParts.join("\n"))}`);

            const fakeHeaders: GmailHeader[] = [{ name: "Date", value: parsed.date?.toUTCString() ?? "" }];
            const saleParsed = parseTicomboSale({ headers: fakeHeaders, subject, text: combined });
            if (!saleParsed.externalSaleId) { scanned--; continue; }

            const existingSale = await findExistingTicomboSale(supabase, {
              userId, externalSaleId: saleParsed.externalSaleId, sourceMessageId,
            });

            const match = existingSale?.inventory_order_id
              ? null
              : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: saleParsed });

            const saleData: SaleInsert = {
              external_sale_id: saleParsed.externalSaleId,
              gmail_account_id: imapAccount.id,
              source: "ticombo",
              source_message_id: sourceMessageId,
              subject: saleParsed.subject,
              event_name: saleParsed.eventName,
              venue: saleParsed.venue,
              event_date: saleParsed.eventDate,
              sold_at: saleParsed.soldAt,
              account_email: imapAccount.username,
              buyer_email: saleParsed.buyerEmail,
              qty_sold: saleParsed.qtySold,
              price_per_ticket: saleParsed.pricePerTicket,
              sale_total: saleParsed.saleTotal,
              payout_total: saleParsed.payoutTotal,
              currency: "GBP",
              section: saleParsed.section,
              row: saleParsed.row,
              seat_from: saleParsed.seatFrom,
              seat_to: saleParsed.seatTo,
              sale_status: "Sold – Awaiting Transfer",
              marketplace: "Ticombo",
              inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
              match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
              user_id: userId,
            };

            const mutation = existingSale
              ? supabase
                  .from("sales")
                  .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
                  .eq("id", existingSale.id)
              : supabase.from("sales").insert(saleData);

            const { error } = await mutation;
            if (error) throw new Error(error.message);
            if (!existingSale) inserted++;

            if (match) {
              const currentUsed = orderUsage.get(match.order.id) ?? 0;
              const newQtySold = currentUsed + (saleParsed.qtySold ?? 1);
              orderUsage.set(match.order.id, newQtySold);
              matched++;
              await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: saleParsed.payoutTotal, totalQtySold: newQtySold });
            } else if (existingSale?.inventory_order_id != null) {
              await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
            }

            try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* best-effort */ }
            try { await client.messageMove(String(uid), "My Sales", { uid: true }); } catch { /* best-effort */ }
          } catch {
            scanned--;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  await supabase
    .from("imap_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", imapAccount.id);

  return { scanned, inserted, matched, email: imapAccount.username };
}

export async function syncViagogoSalesImapInbox({
  supabase,
  imapAccount,
  userId,
}: {
  supabase: SupabaseClient;
  imapAccount: ImapAccount;
  userId: string;
}): Promise<SyncResult> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: imapAccount.host,
    port: imapAccount.port,
    secure: imapAccount.use_tls,
    auth: { user: imapAccount.username, pass: imapAccount.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 30000,
  });

  let inserted = 0;
  let matched = 0;
  let scanned = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(imapAccount.mailbox || "INBOX");
    try {
      // Mirror Gmail query: is:unread newer_than:14d from:orders.viagogo.com (subjects)
      const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const uidResult = await client.search({ since: since14, seen: false }, { uid: true });
      const allUids = (Array.isArray(uidResult) ? uidResult : []).slice(-500) as number[];

      if (allUids.length === 0) {
        return { scanned: 0, inserted, matched, email: imapAccount.username };
      }

      // Phase 1 — envelope pre-filter in batches of 50 (mirrors Gmail's from: + subject: filter)
      const candidateUids: number[] = [];
      const ENV_BATCH = 50;
      for (let ei = 0; ei < allUids.length; ei += ENV_BATCH) {
        const chunk = allUids.slice(ei, ei + ENV_BATCH);
        for await (const msg of client.fetch(chunk, { envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? "";
          const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          if (
            from.includes("@orders.viagogo.com") &&
            SALE_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))
          ) {
            candidateUids.push(msg.uid);
          }
        }
      }

      if (candidateUids.length === 0) {
        return { scanned: 0, inserted, matched, email: imapAccount.username };
      }

      // Create "My Sales" IMAP folder (mirrors Gmail's "My Sales" label)
      try { await client.mailboxCreate("My Sales"); } catch { /* already exists */ }

      const candidateOrders = await loadCandidateOrders(supabase, userId);
      const orderUsage = await loadOrderUsage(supabase, userId);

      // Phase 2 — fetch full source in batches of 10, collect first then process sequentially
      // (mirrors syncGmailInbox: fullMessages batch then sequential for loop)
      const BODY_BATCH = 10;
      for (let bi = 0; bi < candidateUids.length; bi += BODY_BATCH) {
        const batchUids = candidateUids.slice(bi, bi + BODY_BATCH);

        const batchSources = new Map<number, Buffer>();
        for await (const msg of client.fetch(batchUids, { source: true }, { uid: true })) {
          if (msg.source) batchSources.set(msg.uid, msg.source as Buffer);
        }

        for (const uid of batchUids) {
          const source = batchSources.get(uid);
          if (!source) continue;

          try {
            // skipHtmlToText: true prevents mailparser's html-to-text from including
            // image src URLs in parsed.text, which corrupts event/venue field extraction
            const parsed = await simpleParser(source, { skipHtmlToText: true });
            scanned++;

            const subject = parsed.subject ?? "";
            const lowerSubject = subject.toLowerCase();
            const sourceMessageId = parsed.messageId
              ? parsed.messageId.replace(/^<|>$/g, "")
              : `imap-uid-${uid}`;

            // Build combined text the same way Gmail's getBody() does:
            // concatenate text/plain and stripHtml(text/html) from all MIME parts
            const plainPart = parsed.text ?? "";
            const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
            const bodyParts: string[] = [];
            if (plainPart) bodyParts.push(plainPart);
            if (rawHtml) bodyParts.push(stripHtml(rawHtml));
            const body = cleanText(bodyParts.join("\n"));
            const combined = cleanText(`${subject}\n${body}`);

            const fakeHeaders: GmailHeader[] = [
              { name: "Date", value: parsed.date?.toUTCString() ?? "" },
            ];

            const isSoldConfirmation = lowerSubject.includes("you sold your ticket for");
            const saleParsed = isSoldConfirmation
              ? parseSoldConfirmation({ headers: fakeHeaders, subject, text: combined })
              : parseSale({ headers: fakeHeaders, subject, text: combined });

            if (!saleParsed.externalSaleId) { scanned--; continue; }

            const existingSale = await findExistingSale(supabase, {
              userId,
              externalSaleId: saleParsed.externalSaleId,
              sourceMessageId,
            });

            const match = existingSale?.inventory_order_id
              ? null
              : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: saleParsed });

            const saleData: SaleInsert = {
              external_sale_id: saleParsed.externalSaleId,
              gmail_account_id: imapAccount.id,
              source: "viagogo",
              source_message_id: sourceMessageId,
              subject: saleParsed.subject,
              event_name: saleParsed.eventName,
              venue: saleParsed.venue,
              event_date: saleParsed.eventDate,
              sold_at: saleParsed.soldAt,
              account_email: imapAccount.username,
              buyer_email: saleParsed.buyerEmail,
              qty_sold: saleParsed.qtySold,
              price_per_ticket: saleParsed.pricePerTicket,
              sale_total: saleParsed.saleTotal,
              payout_total: saleParsed.payoutTotal,
              currency: "GBP",
              section: saleParsed.section,
              row: saleParsed.row,
              seat_from: saleParsed.seatFrom,
              seat_to: saleParsed.seatTo,
              sale_status: isSoldConfirmation && combined.toLowerCase().includes("ticketpreupload")
                ? "Transferred"
                : "Sold – Awaiting Transfer",
              transfer_status: isSoldConfirmation && combined.toLowerCase().includes("ticketpreupload")
                ? "Transfer Completed"
                : "Awaiting Transfer",
              marketplace: "Viagogo",
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

            if (!existingSale) inserted++;

            if (match) {
              const currentUsed = orderUsage.get(match.order.id) ?? 0;
              const newQtySold = currentUsed + (saleParsed.qtySold ?? 1);
              orderUsage.set(match.order.id, newQtySold);
              matched++;
              await updateMatchedOrder(supabase, {
                userId,
                order: match.order,
                payoutTotal: saleParsed.payoutTotal,
                totalQtySold: newQtySold,
              });
            } else if (existingSale?.inventory_order_id != null) {
              await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
            }

            // Mark read + file into "My Sales" (mirrors Gmail's markMessageProcessed)
            try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* best-effort */ }
            try { await client.messageMove(String(uid), "My Sales", { uid: true }); } catch { /* best-effort */ }
          } catch {
            scanned--;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  await supabase
    .from("imap_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", imapAccount.id);

  return { scanned, inserted, matched, email: imapAccount.username };
}

// ─── Lysted Sales Sync ────────────────────────────────────────────────────────

const LYSTED_GMAIL_QUERY =
  'is:unread from:lysted.com subject:"TICKETS SOLD" newer_than:14d';

const LYSTED_SUBJECT_KEYWORDS = ["tickets sold:"];

// Exchange-rate cache shared across Lysted sync calls (1-hour TTL).
let _saleRateCache: { rates: Record<string, number>; fetchedAt: number } | null = null;

async function getSaleGbpRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_saleRateCache && now - _saleRateCache.fetchedAt < 3_600_000) return _saleRateCache.rates;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=GBP", { cache: "no-store" });
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (data.rates) {
      _saleRateCache = { rates: data.rates, fetchedAt: now };
      return data.rates;
    }
  } catch { /* fall through */ }
  return {};
}

async function convertToGbpAmount(amount: number | null, currency: string): Promise<number | null> {
  if (amount == null || amount <= 0) return null;
  if (currency === "GBP") return amount;
  const rates = await getSaleGbpRates();
  const rate = rates[currency];
  if (!rate) return amount; // fallback: keep original if rate unavailable
  return Math.round((amount / rate) * 100) / 100;
}

function parseLystedDate(text: string): string {
  // "Jul 11th 2026, 8:00pm" — strip ordinal suffix then delegate to parseDateLike
  const m = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\b/i);
  if (!m) return "";
  const d = parseDateLike(`${m[1]} ${m[2]} ${m[3]}`);
  return d ? d.toISOString().slice(0, 10) : "";
}

function parseLystedVenue(text: string): string {
  // Venue is the first non-empty line after the date line and before Section/Row/Seat
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{4}\b/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const candidate = lines[j];
        if (candidate && !/^(?:Section|Row|Seat|\d+\s*(?:&[a-z]+;|[×x]))/i.test(candidate)) {
          return candidate;
        }
      }
    }
  }
  return "";
}

function parseLystedSaleEmail({
  headers,
  subject,
  text,
}: {
  headers: GmailHeader[];
  subject: string;
  text: string;
}): ParsedSale {
  // Invoice # from subject: "[lysted] TICKETS SOLD: ... (Invoice #11479582)"
  const externalSaleId = subject.match(/Invoice\s*#(\d+)/i)?.[1] || "";

  // Event name: strip "[lysted] TICKETS SOLD: " prefix and " (Invoice #...)" suffix
  const eventName =
    subject.match(/TICKETS\s+SOLD:\s*(.+?)\s*\(Invoice/i)?.[1]?.trim() ||
    subject.replace(/^\[lysted\]\s*/i, "").replace(/\s*\(Invoice[^)]+\)/i, "").replace(/^TICKETS\s+SOLD:\s*/i, "").trim();

  const eventDate = parseLystedDate(text);
  const venue = parseLystedVenue(text);

  // Section / Row / Seat — appear as "Section 303", "Row 19", "Seat 13"
  // outlookStripHtml produces "Section: 303" so the :? handles both forms.
  const section = text.match(/\bSection\s*:?\s*(\w+)/i)?.[1]?.trim() || "";
  const row = text.match(/\bRow\s*:?\s*([A-Z0-9]+)/i)?.[1]?.trim() || "";
  const seatFrom = text.match(/\bSeat\s*:?\s*(\d+)/i)?.[1] || "";
  const seatTo = seatFrom;

  // Quantity and per-ticket price: "1 &times; $1,421.00" (HTML entity for ×)
  const qtyLineMatch = text.match(/(\d+)\s+(?:&times;|[×x])\s+\$([\d,]+\.?\d*)/i);
  const qtySold = qtyLineMatch ? parseInt(qtyLineMatch[1], 10) : 1;
  const pricePerTicketUsd = qtyLineMatch ? parseFloat(qtyLineMatch[2].replace(/,/g, "")) : null;

  // Sale Total in USD — label on one line, amount on the next (2-column email layout)
  const saleTotalStr = text.match(/Sale\s+Total[\s\S]{0,60}?\$([\d,]+\.?\d*)/i)?.[1]?.replace(/,/g, "");
  const saleTotalUsd = saleTotalStr
    ? parseFloat(saleTotalStr)
    : pricePerTicketUsd != null
      ? Math.round(pricePerTicketUsd * qtySold * 100) / 100
      : null;

  // Payout in USD
  const payoutStr = text.match(/\bPayout[\s\S]{0,60}?\$([\d,]+\.?\d*)/i)?.[1]?.replace(/,/g, "");
  const payoutUsd = payoutStr ? parseFloat(payoutStr) : null;

  return {
    externalSaleId,
    subject,
    eventName,
    venue,
    eventDate,
    soldAt: normalizeTimestamp(getHeader(headers, "Date")) || new Date().toISOString(),
    buyerEmail: "",
    qtySold,
    pricePerTicket: pricePerTicketUsd,  // original USD per-ticket price (for Discord display)
    saleTotal: saleTotalUsd,            // USD — caller must convert to GBP before storing
    payoutTotal: payoutUsd,            // USD — caller must convert to GBP before storing
    section,
    row,
    seatFrom,
    seatTo,
  };
}

async function findExistingLystedSale(
  supabase: SupabaseClient,
  { userId, externalSaleId, sourceMessageId }: { userId: string; externalSaleId: string; sourceMessageId: string },
) {
  if (externalSaleId) {
    const { data, error } = await supabase
      .from("sales")
      .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
      .eq("user_id", userId)
      .eq("source", "lysted")
      .eq("external_sale_id", externalSaleId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as ExistingSale;
  }
  const { data, error } = await supabase
    .from("sales")
    .select("id, external_sale_id, source_message_id, inventory_order_id, match_confidence, qty_sold")
    .eq("user_id", userId)
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExistingSale | null) || null;
}

export async function syncLystedSalesInbox({
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
  const messages = await listMessages(accessToken, LYSTED_GMAIL_QUERY);
  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);

  const BATCH_SIZE = 10;
  const fullMessages: Awaited<ReturnType<typeof getMessage>>[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(chunk.map((m) => getMessage(accessToken, m.id)));
    fullMessages.push(...fetched);
  }

  let inserted = 0;
  let matched = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const message = messages[msgIdx];
    const fullMessage = fullMessages[msgIdx];
    const headers = fullMessage.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const body = getBody(fullMessage.payload);
    const combined = cleanText(`${subject}\n${body}`);
    const sourceMessageId = getHeader(headers, "Message-ID") || message.id;

    if (!LYSTED_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))) continue;

    const lystedRaw = parseLystedSaleEmail({ headers, subject, text: combined });
    if (!lystedRaw.externalSaleId) continue;

    const gbpSaleTotal = await convertToGbpAmount(lystedRaw.saleTotal, "USD");
    const gbpPayoutTotal = await convertToGbpAmount(lystedRaw.payoutTotal, "USD");

    const existingSale = await findExistingLystedSale(supabase, {
      userId, externalSaleId: lystedRaw.externalSaleId, sourceMessageId,
    });

    const parsedGbp: ParsedSale = { ...lystedRaw, saleTotal: gbpSaleTotal, payoutTotal: gbpPayoutTotal };
    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsedGbp });

    const saleData: SaleInsert = {
      external_sale_id: lystedRaw.externalSaleId,
      gmail_account_id: gmailAccount.id,
      source: "lysted",
      source_message_id: sourceMessageId,
      subject: lystedRaw.subject,
      event_name: lystedRaw.eventName,
      venue: lystedRaw.venue,
      event_date: lystedRaw.eventDate,
      sold_at: lystedRaw.soldAt,
      account_email: gmailAccount.email,
      buyer_email: "",
      qty_sold: lystedRaw.qtySold,
      price_per_ticket: lystedRaw.pricePerTicket,  // original USD per-ticket price
      sale_total: gbpSaleTotal,
      payout_total: gbpPayoutTotal,
      currency: "USD",
      section: lystedRaw.section,
      row: lystedRaw.row,
      seat_from: lystedRaw.seatFrom,
      seat_to: lystedRaw.seatTo,
      sale_status: "Sold – Awaiting Transfer",
      marketplace: "Lysted",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);
    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      const newQtySold = currentUsed + (lystedRaw.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: gbpPayoutTotal, totalQtySold: newQtySold });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
    }

    await markMessageProcessed(accessToken, message.id, labelId);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", gmailAccount.id);

  return { scanned: messages.length, inserted, matched, email: gmailAccount.email };
}

export async function syncLystedSalesOutlookInbox({
  supabase,
  outlookAccount,
  userId,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookSalesAccount;
  userId: string;
}): Promise<SyncResult> {
  const accessToken = await getValidOutlookToken({ supabase, outlookAccount });

  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", '"lysted"');
  url.searchParams.set("$top", "25");
  url.searchParams.set("$select", "id,subject,body,receivedDateTime,isRead");
  const data = await outlookGraphRequest<{ value?: OutlookGraphMessage[] }>(
    accessToken, url.toString(), { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  const messages = data.value || [];

  const candidateOrders = await loadCandidateOrders(supabase, userId);
  const orderUsage = await loadOrderUsage(supabase, userId);
  let inserted = 0;
  let matched = 0;

  for (const msg of messages) {
    if (msg.isRead) continue;
    const subject = msg.subject || "";
    if (!LYSTED_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))) continue;

    const rawBody = decodeQuotedPrintable(msg.body.content);
    const bodyText = msg.body.contentType === "html" ? outlookStripHtml(rawBody) : rawBody;
    const combined = cleanText(`${subject}\n${bodyText}`);
    const sourceMessageId = msg.id;
    const fakeHeaders: GmailHeader[] = [{ name: "Date", value: msg.receivedDateTime || "" }];

    const lystedRaw = parseLystedSaleEmail({ headers: fakeHeaders, subject, text: combined });
    if (!lystedRaw.externalSaleId) continue;

    const gbpSaleTotal = await convertToGbpAmount(lystedRaw.saleTotal, "USD");
    const gbpPayoutTotal = await convertToGbpAmount(lystedRaw.payoutTotal, "USD");

    const existingSale = await findExistingLystedSale(supabase, {
      userId, externalSaleId: lystedRaw.externalSaleId, sourceMessageId,
    });

    const parsedGbp: ParsedSale = { ...lystedRaw, saleTotal: gbpSaleTotal, payoutTotal: gbpPayoutTotal };
    const match = existingSale?.inventory_order_id
      ? null
      : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsedGbp });

    const saleData: SaleInsert = {
      external_sale_id: lystedRaw.externalSaleId,
      gmail_account_id: outlookAccount.id,
      source: "lysted",
      source_message_id: sourceMessageId,
      subject: lystedRaw.subject,
      event_name: lystedRaw.eventName,
      venue: lystedRaw.venue,
      event_date: lystedRaw.eventDate,
      sold_at: lystedRaw.soldAt,
      account_email: outlookAccount.email,
      buyer_email: "",
      qty_sold: lystedRaw.qtySold,
      price_per_ticket: lystedRaw.pricePerTicket,
      sale_total: gbpSaleTotal,
      payout_total: gbpPayoutTotal,
      currency: "USD",
      section: lystedRaw.section,
      row: lystedRaw.row,
      seat_from: lystedRaw.seatFrom,
      seat_to: lystedRaw.seatTo,
      sale_status: "Sold – Awaiting Transfer",
      marketplace: "Lysted",
      inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
      match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
      user_id: userId,
    };

    const mutation = existingSale
      ? supabase
          .from("sales")
          .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
          .eq("id", existingSale.id)
      : supabase.from("sales").insert(saleData);

    const { error } = await mutation;
    if (error) throw new Error(error.message);
    if (!existingSale) inserted += 1;

    if (match) {
      const currentUsed = orderUsage.get(match.order.id) ?? 0;
      const newQtySold = currentUsed + (lystedRaw.qtySold ?? 1);
      orderUsage.set(match.order.id, newQtySold);
      matched += 1;
      await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: gbpPayoutTotal, totalQtySold: newQtySold });
    } else if (existingSale?.inventory_order_id != null) {
      await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
    }

    await outlookMarkRead(accessToken, msg.id);
  }

  await supabase
    .from("gmail_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", outlookAccount.id);

  return { scanned: messages.length, inserted, matched, email: outlookAccount.email };
}

export async function syncLystedSalesImapInbox({
  supabase,
  imapAccount,
  userId,
}: {
  supabase: SupabaseClient;
  imapAccount: ImapAccount;
  userId: string;
}): Promise<SyncResult> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: imapAccount.host,
    port: imapAccount.port,
    secure: imapAccount.use_tls,
    auth: { user: imapAccount.username, pass: imapAccount.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 30000,
  });

  let inserted = 0;
  let matched = 0;
  let scanned = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(imapAccount.mailbox || "INBOX");
    try {
      const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const uidResult = await client.search({ since: since14, seen: false }, { uid: true });
      const allUids = (Array.isArray(uidResult) ? uidResult : []).slice(-500) as number[];

      if (allUids.length === 0) return { scanned: 0, inserted, matched, email: imapAccount.username };

      const candidateUids: number[] = [];
      const ENV_BATCH = 50;
      for (let ei = 0; ei < allUids.length; ei += ENV_BATCH) {
        const chunk = allUids.slice(ei, ei + ENV_BATCH);
        for await (const msg of client.fetch(chunk, { envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? "";
          const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          if (
            from.includes("lysted.com") &&
            LYSTED_SUBJECT_KEYWORDS.some((kw) => subject.toLowerCase().includes(kw))
          ) {
            candidateUids.push(msg.uid);
          }
        }
      }

      if (candidateUids.length === 0) return { scanned: 0, inserted, matched, email: imapAccount.username };

      try { await client.mailboxCreate("My Sales"); } catch { /* already exists */ }

      const candidateOrders = await loadCandidateOrders(supabase, userId);
      const orderUsage = await loadOrderUsage(supabase, userId);

      const BODY_BATCH = 10;
      for (let bi = 0; bi < candidateUids.length; bi += BODY_BATCH) {
        const batchUids = candidateUids.slice(bi, bi + BODY_BATCH);
        const batchSources = new Map<number, Buffer>();
        for await (const msg of client.fetch(batchUids, { source: true }, { uid: true })) {
          if (msg.source) batchSources.set(msg.uid, msg.source as Buffer);
        }

        for (const uid of batchUids) {
          const source = batchSources.get(uid);
          if (!source) continue;
          try {
            const parsed = await simpleParser(source, { skipHtmlToText: true });
            scanned++;
            const subject = parsed.subject ?? "";
            const sourceMessageId = parsed.messageId
              ? parsed.messageId.replace(/^<|>$/g, "")
              : `imap-uid-${uid}`;

            const plainPart = parsed.text ?? "";
            const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
            const bodyParts: string[] = [];
            if (plainPart) bodyParts.push(plainPart);
            if (rawHtml) bodyParts.push(stripHtml(rawHtml));
            const combined = cleanText(`${subject}\n${cleanText(bodyParts.join("\n"))}`);

            const fakeHeaders: GmailHeader[] = [{ name: "Date", value: parsed.date?.toUTCString() ?? "" }];
            const lystedRaw = parseLystedSaleEmail({ headers: fakeHeaders, subject, text: combined });
            if (!lystedRaw.externalSaleId) { scanned--; continue; }

            const gbpSaleTotal = await convertToGbpAmount(lystedRaw.saleTotal, "USD");
            const gbpPayoutTotal = await convertToGbpAmount(lystedRaw.payoutTotal, "USD");

            const existingSale = await findExistingLystedSale(supabase, {
              userId, externalSaleId: lystedRaw.externalSaleId, sourceMessageId,
            });

            const parsedGbp: ParsedSale = { ...lystedRaw, saleTotal: gbpSaleTotal, payoutTotal: gbpPayoutTotal };
            const match = existingSale?.inventory_order_id
              ? null
              : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsedGbp });

            const saleData: SaleInsert = {
              external_sale_id: lystedRaw.externalSaleId,
              gmail_account_id: imapAccount.id,
              source: "lysted",
              source_message_id: sourceMessageId,
              subject: lystedRaw.subject,
              event_name: lystedRaw.eventName,
              venue: lystedRaw.venue,
              event_date: lystedRaw.eventDate,
              sold_at: lystedRaw.soldAt,
              account_email: imapAccount.username,
              buyer_email: "",
              qty_sold: lystedRaw.qtySold,
              price_per_ticket: lystedRaw.pricePerTicket,
              sale_total: gbpSaleTotal,
              payout_total: gbpPayoutTotal,
              currency: "USD",
              section: lystedRaw.section,
              row: lystedRaw.row,
              seat_from: lystedRaw.seatFrom,
              seat_to: lystedRaw.seatTo,
              sale_status: "Sold – Awaiting Transfer",
              marketplace: "Lysted",
              inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
              match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
              user_id: userId,
            };

            const mutation = existingSale
              ? supabase
                  .from("sales")
                  .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
                  .eq("id", existingSale.id)
              : supabase.from("sales").insert(saleData);

            const { error } = await mutation;
            if (error) throw new Error(error.message);
            if (!existingSale) inserted++;

            if (match) {
              const currentUsed = orderUsage.get(match.order.id) ?? 0;
              const newQtySold = currentUsed + (lystedRaw.qtySold ?? 1);
              orderUsage.set(match.order.id, newQtySold);
              matched++;
              await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: gbpPayoutTotal, totalQtySold: newQtySold });
            } else if (existingSale?.inventory_order_id != null) {
              await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
            }

            try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* best-effort */ }
            try { await client.messageMove(String(uid), "My Sales", { uid: true }); } catch { /* best-effort */ }
          } catch {
            scanned--;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  await supabase
    .from("imap_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", imapAccount.id);

  return { scanned, inserted, matched, email: imapAccount.username };
}

// ─── Single-email processing (inbound email forwarding) ───────────────────────

export async function processSingleSaleEmail({
  supabase,
  userId,
  subject,
  textBody,
  htmlBody,
  receivedAt,
  sourceMessageId,
  accountEmail,
}: {
  supabase: SupabaseClient;
  userId: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  receivedAt: string;
  sourceMessageId: string;
  accountEmail: string;
}): Promise<{ inserted: boolean; matched: boolean; source: string; saleId: number | null } | null> {
  const lowerSubject = subject.toLowerCase();

  const isViagogo = SALE_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw));
  const isStubHub = !isViagogo && STUBHUB_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw));
  const isTicombo = !isViagogo && !isStubHub && TICOMBO_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw));
  // Detect Lysted by subject tag only — forwarded emails arrive from the user's Gmail,
  // so we cannot rely on the sender domain being lysted.com here.
  const isLysted = !isViagogo && !isStubHub && !isTicombo &&
    lowerSubject.includes("[lysted]") &&
    LYSTED_SUBJECT_KEYWORDS.some((kw) => lowerSubject.includes(kw));

  if (!isViagogo && !isStubHub && !isTicombo && !isLysted) return null;

  // For Lysted, always parse from HTML — auto-forwarded emails produce a textBody that
  // only contains Gmail's forwarding header, not the actual email content.
  const bodyText = isLysted
    ? (htmlBody ? outlookStripHtml(htmlBody) : textBody || "")
    : (textBody || (htmlBody ? outlookStripHtml(htmlBody) : ""));
  const combined = cleanText(`${subject}\n${bodyText}`);
  const fakeHeaders: GmailHeader[] = [{ name: "Date", value: receivedAt }];

  let parsed: ParsedSale;
  let source: string;
  let marketplace: string;
  let existingSale: ExistingSale | null;
  let saleCurrency = "GBP";

  if (isViagogo) {
    // Skip pre-sale upload reminders — they say "Thank you for listing" / "if they sell"
    const lowerCombined = combined.toLowerCase();
    if (lowerCombined.includes("thank you for listing") || lowerCombined.includes("if they sell")) {
      return null;
    }
    const isSoldConfirmation = lowerSubject.includes("you sold your ticket for");
    parsed = isSoldConfirmation
      ? parseSoldConfirmation({ headers: fakeHeaders, subject, text: combined })
      : parseSale({ headers: fakeHeaders, subject, text: combined });
    source = "viagogo";
    marketplace = "Viagogo";
    if (!parsed.externalSaleId) return null;
    existingSale = await findExistingSale(supabase, { userId, externalSaleId: parsed.externalSaleId, sourceMessageId });
  } else if (isStubHub) {
    parsed = parseStubHubSale({ headers: fakeHeaders, subject, text: combined });
    source = "stubhub";
    marketplace = "StubHub";
    if (!parsed.externalSaleId) return null;
    existingSale = await findExistingStubHubSale(supabase, { userId, externalSaleId: parsed.externalSaleId, sourceMessageId });
  } else if (isTicombo) {
    parsed = parseTicomboSale({ headers: fakeHeaders, subject, text: combined });
    source = "ticombo";
    marketplace = "Ticombo";
    if (!parsed.externalSaleId) return null;
    existingSale = await findExistingTicomboSale(supabase, { userId, externalSaleId: parsed.externalSaleId, sourceMessageId });
  } else {
    // isLysted
    const lystedRaw = parseLystedSaleEmail({ headers: fakeHeaders, subject, text: combined });
    source = "lysted";
    marketplace = "Lysted";
    if (!lystedRaw.externalSaleId) return null;
    existingSale = await findExistingLystedSale(supabase, { userId, externalSaleId: lystedRaw.externalSaleId, sourceMessageId });
    const gbpSaleTotal = await convertToGbpAmount(lystedRaw.saleTotal, "USD");
    const gbpPayoutTotal = await convertToGbpAmount(lystedRaw.payoutTotal, "USD");
    parsed = { ...lystedRaw, saleTotal: gbpSaleTotal, payoutTotal: gbpPayoutTotal };
    saleCurrency = "USD";
  }

  const [candidateOrders, orderUsage] = await Promise.all([
    loadCandidateOrders(supabase, userId),
    loadOrderUsage(supabase, userId),
  ]);

  const match = existingSale?.inventory_order_id
    ? null
    : findBestInventoryMatch({ orders: candidateOrders, orderUsage, sale: parsed });

  const isSoldConf = isViagogo && lowerSubject.includes("you sold your ticket for");
  const saleData: SaleInsert = {
    external_sale_id: parsed.externalSaleId,
    gmail_account_id: null,
    source,
    source_message_id: sourceMessageId,
    subject: parsed.subject,
    event_name: parsed.eventName,
    venue: parsed.venue,
    event_date: parsed.eventDate,
    sold_at: parsed.soldAt,
    account_email: accountEmail,
    buyer_email: parsed.buyerEmail,
    qty_sold: parsed.qtySold,
    price_per_ticket: parsed.pricePerTicket,
    sale_total: parsed.saleTotal,
    payout_total: parsed.payoutTotal,
    currency: saleCurrency,
    section: parsed.section,
    row: parsed.row,
    seat_from: parsed.seatFrom,
    seat_to: parsed.seatTo,
    sale_status: isSoldConf && combined.toLowerCase().includes("ticketpreupload")
      ? "Transferred"
      : "Sold – Awaiting Transfer",
    transfer_status: isSoldConf && combined.toLowerCase().includes("ticketpreupload")
      ? "Transfer Completed"
      : "Awaiting Transfer",
    marketplace,
    inventory_order_id: existingSale?.inventory_order_id ?? match?.order.id ?? null,
    match_confidence: existingSale?.match_confidence ?? (match ? Number(match.score.toFixed(2)) : null),
    user_id: userId,
  };

  let saleId: number | null = null;

  if (existingSale) {
    saleId = existingSale.id;
    const { error } = await supabase
      .from("sales")
      .update({ ...saleData, source_message_id: existingSale.source_message_id || sourceMessageId })
      .eq("id", existingSale.id);
    if (error) throw new Error(error.message);
  } else {
    const { data: inserted, error } = await supabase
      .from("sales")
      .insert(saleData)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    saleId = inserted?.id ?? null;
  }

  if (match) {
    const currentUsed = orderUsage.get(match.order.id) ?? 0;
    const newQtySold = currentUsed + (parsed.qtySold ?? 1);
    await updateMatchedOrder(supabase, { userId, order: match.order, payoutTotal: parsed.payoutTotal, totalQtySold: newQtySold });
  } else if (existingSale?.inventory_order_id != null) {
    await recomputeOrderStatus(supabase, { userId, orderId: existingSale.inventory_order_id });
  }

  return { inserted: !existingSale, matched: !!match, source, saleId };
}

export async function reparseSaleFromGmail({
  supabase,
  userId,
  saleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  saleId: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .select("id, source_message_id, account_email, inventory_order_id")
    .eq("id", saleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (saleError || !sale) return { ok: false, error: "Sale not found" };
  if (!sale.source_message_id || (sale.source_message_id as string).startsWith("manual-")) {
    return { ok: false, error: "No Gmail message to re-parse" };
  }

  const { data: gmailAccounts } = await supabase
    .from("gmail_accounts")
    .select("id, email, access_token, refresh_token, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .eq("is_active", true);

  if (!gmailAccounts?.length) return { ok: false, error: "No active Gmail account" };

  const gmailAccount =
    (gmailAccounts as GmailAccount[]).find((a) => a.email === (sale.account_email as string)) ??
    (gmailAccounts as GmailAccount[])[0];
  if (!gmailAccount.access_token) return { ok: false, error: "Gmail account not authorized" };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken({ supabase, gmailAccount });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Token refresh failed" };
  }

  let message: GmailMessage;
  try {
    message = await getMessage(accessToken, sale.source_message_id as string);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to fetch Gmail message" };
  }

  const headers = message.payload.headers || [];
  const subject = getHeader(headers, "Subject");
  const body = getBody(message.payload);
  const combined = cleanText(`${subject}\n${body}`);

  const isSoldConf = /You sold your ticket for/i.test(subject);
  const parsed = isSoldConf
    ? parseSoldConfirmation({ headers, subject, text: combined })
    : parseSale({ headers, subject, text: combined });

  const isPreUpload = isSoldConf && combined.toLowerCase().includes("ticketpreupload");

  const updates: Record<string, unknown> = {};
  if (parsed.venue) updates.venue = parsed.venue;
  if (parsed.eventName) updates.event_name = parsed.eventName;
  if (parsed.eventDate) updates.event_date = parsed.eventDate;
  if (parsed.saleTotal != null) updates.sale_total = parsed.saleTotal;
  if (parsed.payoutTotal != null) updates.payout_total = parsed.payoutTotal;
  if (parsed.pricePerTicket != null) updates.price_per_ticket = parsed.pricePerTicket;
  if (parsed.section) updates.section = parsed.section;
  if (parsed.row) updates.row = parsed.row;
  if (parsed.seatFrom) updates.seat_from = parsed.seatFrom;
  if (parsed.seatTo) updates.seat_to = parsed.seatTo;
  if (isSoldConf) {
    updates.sale_status = isPreUpload ? "Transferred" : "Sold – Awaiting Transfer";
    updates.transfer_status = isPreUpload ? "Transfer Completed" : "Awaiting Transfer";
  }

  if (Object.keys(updates).length === 0) return { ok: false, error: "Nothing to update after re-parse" };

  const { error: updateError } = await supabase
    .from("sales")
    .update(updates)
    .eq("id", saleId)
    .eq("user_id", userId);

  if (updateError) return { ok: false, error: updateError.message };

  if ((sale.inventory_order_id as number | null) != null) {
    await recomputeOrderStatus(supabase, { userId, orderId: sale.inventory_order_id as number });
  }

  return { ok: true };
}
