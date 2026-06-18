import type { SupabaseClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ImapAccount } from "./imap-sync";

// ── Shared types ──────────────────────────────────────────────────────────────

type GmailAccount = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type OutlookAccount = {
  id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type GmailHeader = { name: string; value: string };

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
  body: { contentType: "text" | "html"; content: string };
};

// ── Domain types ──────────────────────────────────────────────────────────────

type TransferEmailData = {
  orderId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  qty: number | null;
  section: string;
  paymentTotal: number | null;
  receivedAt: string;
  xVgId: string;
  subject: string;
};

type PayoutOrderLine = {
  paymentReference: string;
  orderId: string;
  orderDate: string;
  amount: number;
  qty: number | null;
};

type PayoutEmailData = {
  paymentReference: string;
  paymentDate: string;
  orderLines: PayoutOrderLine[];
  receivedAt: string;
  subject: string;
};

type ScanLineResult = {
  orderId: string | null;
  paymentReference: string | null;
  eventName: string | null;
  eventDate: string | null;
  orderDate: string | null;
  amount: number | null;
  qty: number | null;
  saleId: number | null;
  matchStatus: "matched" | "unmatched" | "already_processed" | "needs_review" | "error";
  actionTaken: string | null;
  confidence: string | null;
  notes: string | null;
};

export type LifecycleScanResult = {
  scanned: number;
  processed: number;
  updated: number;
  needsReview: number;
  alreadyProcessed: number;
  errors: number;
  email: string;
  labelError?: string;
};

// ── Gmail lifecycle scanner ────────────────────────────────────────────────────

export async function scanViagogoLifecycleGmail({
  supabase,
  gmailAccount,
  userId,
  cutoffDate,
}: {
  supabase: SupabaseClient;
  gmailAccount: GmailAccount;
  userId: string;
  cutoffDate: string; // ISO date string e.g. "2026-01-01"
}): Promise<LifecycleScanResult> {
  const accessToken = await getValidAccessToken({ supabase, gmailAccount });

  const cutoffGmail = cutoffDate.replace(/-/g, "/");

  // Split into two simple queries — combined OR queries are unreliable in the Gmail API
  const [transferMsgs, payoutMsgs] = await Promise.all([
    listMessages(accessToken, `from:automated@orders.viagogo.com subject:"confirmed transfer for order" after:${cutoffGmail}`),
    listMessages(accessToken, `from:automated@orders.viagogo.com subject:"just been paid" after:${cutoffGmail}`),
  ]);

  // Merge and deduplicate by Gmail message ID
  const seenIds = new Set<string>();
  const messages: Array<{ id: string }> = [];
  for (const m of [...transferMsgs, ...payoutMsgs]) {
    if (!seenIds.has(m.id)) { seenIds.add(m.id); messages.push(m); }
  }

  const BATCH_SIZE = 10;
  const fullMessages: GmailMessage[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(chunk.map((m) => getMessage(accessToken, m.id)));
    fullMessages.push(...fetched);
  }

  // Pre-fetch/create Gmail labels for filing processed emails
  let gmailLabels: { transfers: string; payouts: string } | null = null;
  let labelError: string | undefined;
  try {
    gmailLabels = await ensureGmailLabels(accessToken);
  } catch (e) {
    labelError = e instanceof Error ? e.message : "Label setup failed";
  }

  const totals = { scanned: 0, processed: 0, updated: 0, needsReview: 0, alreadyProcessed: 0, errors: 0 };

  for (let i = 0; i < messages.length; i++) {
    totals.scanned++;
    const message = messages[i];
    const fullMessage = fullMessages[i];
    const headers = fullMessage.payload.headers ?? [];
    const subject = getHeader(headers, "Subject");
    const xVgId = getHeader(headers, "X-VG-ID");
    const messageId = getHeader(headers, "Message-ID") || message.id;
    const receivedAt = normalizeTimestamp(getHeader(headers, "Date")) || new Date().toISOString();

    const alreadyDone = await isAlreadyProcessed(supabase, userId, messageId);
    if (alreadyDone) {
      totals.alreadyProcessed++;
      // Still apply label in case it was missed on a previous run
      if (gmailLabels) {
        const labelId = isTransferEmail(subject) ? gmailLabels.transfers : gmailLabels.payouts;
        applyGmailLabel(accessToken, message.id, labelId).catch(() => undefined);
      }
      continue;
    }

    try {
      if (isTransferEmail(subject)) {
        const body = getBody(fullMessage.payload);
        const data = parseTransferEmail(subject, body, headers, xVgId, receivedAt);
        if (!data) {
          try { await insertScanLog(supabase, userId, { messageId, xVgId, emailType: "transfer_complete", subject, receivedAt, accountEmail: gmailAccount.email, status: "error", notes: "Failed to parse transfer email" }); } catch { /* ignore */ }
          totals.errors++;
          continue;
        }
        const logId = await insertScanLog(supabase, userId, {
          messageId,
          xVgId,
          emailType: "transfer_complete",
          subject,
          receivedAt,
          accountEmail: gmailAccount.email,
          rawExtracted: { orderId: data.orderId, eventName: data.eventName, qty: data.qty },
        });
        const result = await processTransferEmail(supabase, userId, data, logId);
        await insertScanResult(supabase, userId, logId, "transfer_complete", result, {
          orderId: data.orderId,
          eventName: data.eventName,
          eventDate: data.eventDate,
          qty: data.qty,
        });
        tally(totals, result);
        totals.processed++;
        // File in Gmail "Transfers" folder
        if (gmailLabels) {
          applyGmailLabel(accessToken, message.id, gmailLabels.transfers).catch(() => undefined);
        }
      } else if (isPayoutEmail(subject)) {
        const body = getBody(fullMessage.payload);
        const rawHtml = getHtmlBody(fullMessage.payload);
        const data = parsePayoutEmail(subject, body, rawHtml, headers, receivedAt);
        if (!data || data.orderLines.length === 0) {
          try { await insertScanLog(supabase, userId, { messageId, xVgId, emailType: "payout", subject, receivedAt, accountEmail: gmailAccount.email, status: "error", notes: "Failed to parse payout email or no order lines found" }); } catch { /* ignore */ }
          totals.errors++;
          continue;
        }
        const logId = await insertScanLog(supabase, userId, {
          messageId,
          xVgId,
          emailType: "payout",
          subject,
          receivedAt,
          accountEmail: gmailAccount.email,
          rawExtracted: { paymentReference: data.paymentReference, lineCount: data.orderLines.length },
        });
        for (const line of data.orderLines) {
          const result = await processPayoutOrderLine(supabase, userId, line, data.paymentDate, logId);
          await insertScanResult(supabase, userId, logId, "payout", result, {
            orderId: line.orderId,
            paymentReference: line.paymentReference,
            orderDate: line.orderDate,
            amount: line.amount,
            qty: line.qty,
          });
          tally(totals, result);
        }
        totals.processed++;
        // File in Gmail "Payouts" folder
        if (gmailLabels) {
          applyGmailLabel(accessToken, message.id, gmailLabels.payouts).catch(() => undefined);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      try { await insertScanLog(supabase, userId, { messageId, xVgId, emailType: isTransferEmail(subject) ? "transfer_complete" : "payout", subject, receivedAt, accountEmail: gmailAccount.email, status: "error", notes: msg }); } catch { /* ignore */ }
      totals.errors++;
    }
  }

  return { ...totals, email: gmailAccount.email, labelError };
}

// ── Outlook lifecycle scanner ─────────────────────────────────────────────────

export async function scanViagogoLifecycleOutlook({
  supabase,
  outlookAccount,
  userId,
  cutoffDate,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookAccount;
  userId: string;
  cutoffDate: string;
}): Promise<LifecycleScanResult> {
  const accessToken = await getValidOutlookToken({ supabase, outlookAccount });

  const cutoffIso = new Date(cutoffDate).toISOString();

  // Run two separate searches and merge — Graph API $search + $filter together is unreliable
  async function outlookSearch(phrase: string): Promise<OutlookGraphMessage[]> {
    const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    url.searchParams.set("$search", `"${phrase}"`);
    url.searchParams.set("$top", "50");
    url.searchParams.set("$select", "id,subject,body,receivedDateTime");
    const data = await outlookGraphRequest<{ value?: OutlookGraphMessage[] }>(accessToken, url.toString());
    return (data.value ?? []).filter((m) => {
      const d = new Date(m.receivedDateTime ?? "");
      return !Number.isNaN(d.getTime()) && d >= new Date(cutoffIso);
    });
  }

  const [transferMsgsOl, payoutMsgsOl] = await Promise.all([
    outlookSearch("confirmed transfer for order"),
    outlookSearch("just been paid"),
  ]);

  const seenIdsOl = new Set<string>();
  const messages = [...transferMsgsOl, ...payoutMsgsOl].filter((m) => {
    if (seenIdsOl.has(m.id)) return false;
    seenIdsOl.add(m.id);
    return isTransferEmail(m.subject) || isPayoutEmail(m.subject);
  });

  // Pre-fetch/create Outlook folders for filing processed emails
  let outlookFolders: { transfers: string; payouts: string } | null = null;
  let labelError: string | undefined;
  try {
    outlookFolders = await ensureOutlookFolders(accessToken);
  } catch (e) {
    labelError = e instanceof Error ? e.message : "Folder setup failed";
  }

  const totals = { scanned: 0, processed: 0, updated: 0, needsReview: 0, alreadyProcessed: 0, errors: 0 };

  for (const msg of messages) {
    totals.scanned++;
    const subject = msg.subject ?? "";
    const messageId = msg.id;
    const receivedAt = msg.receivedDateTime || new Date().toISOString();

    const alreadyDone = await isAlreadyProcessed(supabase, userId, messageId);
    if (alreadyDone) {
      totals.alreadyProcessed++;
      // Still move to folder in case it was missed on a previous run
      if (outlookFolders) {
        const folderId = isTransferEmail(subject) ? outlookFolders.transfers : outlookFolders.payouts;
        moveOutlookMessage(accessToken, messageId, folderId).catch(() => undefined);
      }
      continue;
    }

    try {
      const rawHtml =
        msg.body.contentType === "html" ? decodeQuotedPrintable(msg.body.content) : "";
      const strippedBody = rawHtml
        ? outlookStripHtml(rawHtml)
        : decodeQuotedPrintable(msg.body.content);
      const body = cleanText(strippedBody);
      const fakeHeaders: GmailHeader[] = [{ name: "Date", value: receivedAt }];

      if (isTransferEmail(subject)) {
        const data = parseTransferEmail(subject, body, fakeHeaders, "", receivedAt);
        if (!data) {
          try { await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: "transfer_complete", subject, receivedAt, accountEmail: outlookAccount.email, status: "error", notes: "Failed to parse transfer email" }); } catch { /* ignore */ }
          totals.errors++;
          continue;
        }
        const logId = await insertScanLog(supabase, userId, {
          messageId,
          xVgId: "",
          emailType: "transfer_complete",
          subject,
          receivedAt,
          accountEmail: outlookAccount.email,
          rawExtracted: { orderId: data.orderId, eventName: data.eventName, qty: data.qty },
        });
        const result = await processTransferEmail(supabase, userId, data, logId);
        await insertScanResult(supabase, userId, logId, "transfer_complete", result, {
          orderId: data.orderId,
          eventName: data.eventName,
          eventDate: data.eventDate,
          qty: data.qty,
        });
        tally(totals, result);
        totals.processed++;
        if (outlookFolders) moveOutlookMessage(accessToken, messageId, outlookFolders.transfers).catch(() => undefined);
      } else if (isPayoutEmail(subject)) {
        const data = parsePayoutEmail(subject, body, rawHtml, fakeHeaders, receivedAt);
        if (!data || data.orderLines.length === 0) {
          try { await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: "payout", subject, receivedAt, accountEmail: outlookAccount.email, status: "error", notes: "No order lines parsed from payout email" }); } catch { /* ignore */ }
          totals.errors++;
          continue;
        }
        const logId = await insertScanLog(supabase, userId, {
          messageId,
          xVgId: "",
          emailType: "payout",
          subject,
          receivedAt,
          accountEmail: outlookAccount.email,
          rawExtracted: { paymentReference: data.paymentReference, lineCount: data.orderLines.length },
        });
        for (const line of data.orderLines) {
          const result = await processPayoutOrderLine(supabase, userId, line, data.paymentDate, logId);
          await insertScanResult(supabase, userId, logId, "payout", result, {
            orderId: line.orderId,
            paymentReference: line.paymentReference,
            orderDate: line.orderDate,
            amount: line.amount,
            qty: line.qty,
          });
          tally(totals, result);
        }
        totals.processed++;
        if (outlookFolders) moveOutlookMessage(accessToken, messageId, outlookFolders.payouts).catch(() => undefined);
      }
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : "Unknown error";
      try { await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: isTransferEmail(subject) ? "transfer_complete" : "payout", subject, receivedAt, accountEmail: outlookAccount.email, status: "error", notes: msg2 }); } catch { /* ignore */ }
      totals.errors++;
    }
  }

  return { ...totals, email: outlookAccount.email, labelError };
}

// ── IMAP lifecycle scanner ────────────────────────────────────────────────────

export async function scanViagogoLifecycleImap({
  supabase,
  imapAccount,
  userId,
  cutoffDate,
}: {
  supabase: SupabaseClient;
  imapAccount: ImapAccount;
  userId: string;
  cutoffDate: string;
}): Promise<LifecycleScanResult> {
  const client = new ImapFlow({
    host: imapAccount.host,
    port: imapAccount.port,
    secure: imapAccount.use_tls,
    auth: { user: imapAccount.username, pass: imapAccount.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 30000,
  });

  const totals = { scanned: 0, processed: 0, updated: 0, needsReview: 0, alreadyProcessed: 0, errors: 0 };
  let labelError: string | undefined;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(imapAccount.mailbox || "INBOX");
    try {
      // Search for Viagogo lifecycle emails since cutoff date
      const uidResult = await client.search(
        { since: new Date(cutoffDate), from: "automated@orders.viagogo.com" },
        { uid: true },
      );
      const allUids = Array.isArray(uidResult) ? uidResult : [];
      if (allUids.length === 0) return { ...totals, email: imapAccount.username };

      // Envelope pre-filter — only keep transfer/payout subjects
      const candidateUids: number[] = [];
      for await (const msg of client.fetch(allUids, { envelope: true }, { uid: true })) {
        const subject = msg.envelope?.subject ?? "";
        if (isTransferEmail(subject) || isPayoutEmail(subject)) candidateUids.push(msg.uid);
      }
      if (candidateUids.length === 0) return { ...totals, email: imapAccount.username };

      // Ensure Transfers and Payouts mailboxes exist (best-effort)
      try { await client.mailboxCreate("Transfers"); } catch { /* already exists */ }
      try { await client.mailboxCreate("Payouts"); } catch { /* already exists */ }

      // Batch-fetch full source and process
      const BATCH = 10;
      for (let i = 0; i < candidateUids.length; i += BATCH) {
        const batchUids = candidateUids.slice(i, i + BATCH);
        const batchSources = new Map<number, Buffer>();
        for await (const msg of client.fetch(batchUids, { source: true }, { uid: true })) {
          if (msg.source) batchSources.set(msg.uid, msg.source as Buffer);
        }

        for (const uid of batchUids) {
          const source = batchSources.get(uid);
          if (!source) { totals.errors++; continue; }
          totals.scanned++;

          let subject = "";
          let receivedAt = new Date().toISOString();
          try {
            const parsed = await simpleParser(source, { skipHtmlToText: true });
            subject = parsed.subject ?? "";
            receivedAt = parsed.date?.toISOString() ?? receivedAt;
            const messageId = (parsed.messageId ?? "").replace(/^<|>$/g, "") || `imap-uid-${uid}`;
            const rawHeaders: GmailHeader[] = [];
            if (parsed.date) rawHeaders.push({ name: "Date", value: parsed.date.toUTCString() });
            if (parsed.messageId) rawHeaders.push({ name: "Message-ID", value: parsed.messageId });

            const alreadyDone = await isAlreadyProcessed(supabase, userId, messageId);
            if (alreadyDone) {
              totals.alreadyProcessed++;
              const folder = isTransferEmail(subject) ? "Transfers" : "Payouts";
              try { await client.messageMove(uid.toString(), folder, { uid: true }); } catch { /* best-effort */ }
              continue;
            }

            const plainPart = parsed.text ?? "";
            const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
            const body = cleanText([plainPart, rawHtml ? stripHtml(rawHtml) : ""].filter(Boolean).join("\n"));

            if (isTransferEmail(subject)) {
              const data = parseTransferEmail(subject, body, rawHeaders, "", receivedAt);
              if (!data) {
                try { await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: "transfer_complete", subject, receivedAt, accountEmail: imapAccount.username, status: "error", notes: "Failed to parse transfer email" }); } catch { /* ignore */ }
                totals.errors++;
                continue;
              }
              const logId = await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: "transfer_complete", subject, receivedAt, accountEmail: imapAccount.username, rawExtracted: { orderId: data.orderId, eventName: data.eventName, qty: data.qty } });
              const result = await processTransferEmail(supabase, userId, data, logId);
              await insertScanResult(supabase, userId, logId, "transfer_complete", result, { orderId: data.orderId, eventName: data.eventName, eventDate: data.eventDate, qty: data.qty });
              tally(totals, result);
              totals.processed++;
              try { await client.messageMove(uid.toString(), "Transfers", { uid: true }); } catch { /* best-effort */ }
            } else if (isPayoutEmail(subject)) {
              const data = parsePayoutEmail(subject, body, rawHtml, rawHeaders, receivedAt);
              if (!data || data.orderLines.length === 0) {
                try { await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: "payout", subject, receivedAt, accountEmail: imapAccount.username, status: "error", notes: "Failed to parse payout email or no order lines found" }); } catch { /* ignore */ }
                totals.errors++;
                continue;
              }
              const logId = await insertScanLog(supabase, userId, { messageId, xVgId: "", emailType: "payout", subject, receivedAt, accountEmail: imapAccount.username, rawExtracted: { paymentReference: data.paymentReference, lineCount: data.orderLines.length } });
              for (const line of data.orderLines) {
                const result = await processPayoutOrderLine(supabase, userId, line, data.paymentDate, logId);
                await insertScanResult(supabase, userId, logId, "payout", result, { orderId: line.orderId, paymentReference: line.paymentReference, orderDate: line.orderDate, amount: line.amount, qty: line.qty });
                tally(totals, result);
              }
              totals.processed++;
              try { await client.messageMove(uid.toString(), "Payouts", { uid: true }); } catch { /* best-effort */ }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            try { await insertScanLog(supabase, userId, { messageId: `imap-uid-${uid}`, xVgId: "", emailType: isTransferEmail(subject) ? "transfer_complete" : "payout", subject, receivedAt, accountEmail: imapAccount.username, status: "error", notes: msg }); } catch { /* ignore */ }
            totals.errors++;
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    labelError = err instanceof Error ? err.message : "IMAP connection failed";
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  return { ...totals, email: imapAccount.username, labelError };
}

// ── Email type detection ──────────────────────────────────────────────────────

function isTransferEmail(subject: string): boolean {
  return subject.toLowerCase().includes("confirmed transfer for order");
}

function isPayoutEmail(subject: string): boolean {
  return subject.toLowerCase().includes("just been paid");
}

// ── Transfer email parser ─────────────────────────────────────────────────────

function parseTransferEmail(
  subject: string,
  body: string,
  headers: GmailHeader[],
  xVgId: string,
  receivedAt: string,
): TransferEmailData | null {
  // Subject: "You successfully confirmed transfer for order # 645871591 - Black Veil Brides"
  const orderIdMatch = subject.match(/order\s*#\s*(\d+)/i);
  if (!orderIdMatch) return null;
  const orderId = orderIdMatch[1];

  const eventName =
    subject.match(/order\s*#\s*\d+\s*[-–]\s*(.+)/i)?.[1]?.trim() ?? "";

  const eventDate = parseViagogoEventDate(body);

  // Venue: line right after the event date line
  let venue = "";
  const dateLineMatch = body.match(/\w+day,\s+\w+ \d{1,2},\s+\d{4}\s*\|\s*\d{1,2}:\d{2}[^\n]*/i);
  if (dateLineMatch) {
    const after = body.slice((dateLineMatch.index ?? 0) + dateLineMatch[0].length);
    const venueLine = after.match(/^\s*\n+\s*([^\n]+)/);
    venue = venueLine?.[1]?.trim() ?? "";
  }

  const qty = parseInteger(body, [/(\d+)\s*Ticket\(s\)/i]);
  const section = body.match(/Section:\s*([^\n|]+)/i)?.[1]?.trim() ?? "";
  const paymentTotal = parseMoney(body, [
    /Payment\s+Total\s+[£$€Â\s]*([\d,]+\.?\d*)/i,
    /Subtotal\s+[£$€Â\s]*([\d,]+\.?\d*)/i,
  ]);

  return { orderId, eventName, eventDate, venue, qty, section, paymentTotal, receivedAt, xVgId, subject };
}

// ── Payout email parser ───────────────────────────────────────────────────────

function parsePayoutEmail(
  subject: string,
  body: string,
  rawHtml: string,
  headers: GmailHeader[],
  receivedAt: string,
): PayoutEmailData | null {
  // Subject: "viagogo payment 66251393 - You have just been paid"
  const refMatch = subject.match(/viagogo payment\s+(\d+)/i);
  if (!refMatch) return null;
  const paymentReference = refMatch[1];

  // "We processed your payment on Thursday, 18 June 2026."
  const paymentDateRaw = body.match(
    /processed your payment on\s+\w+,\s+(\d{1,2}\s+\w+\s+\d{4})/i,
  )?.[1] ?? "";
  const paymentDateParsed = paymentDateRaw ? new Date(paymentDateRaw) : null;
  const paymentDate =
    paymentDateParsed && !Number.isNaN(paymentDateParsed.getTime())
      ? paymentDateParsed.toISOString()
      : receivedAt;

  const orderLines = rawHtml
    ? parsePayoutHtmlTable(rawHtml, paymentReference)
    : parsePayoutTextBody(body, paymentReference);

  return { paymentReference, paymentDate, orderLines, receivedAt, subject };
}

function parsePayoutHtmlTable(html: string, paymentReference: string): PayoutOrderLine[] {
  const lines: PayoutOrderLine[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    // Data rows: cells[0] = payment ID (8+ digits), cells[1] = order ID (9+ digits)
    if (cells.length >= 4 && /^\d{6,}$/.test(cells[0]) && /^\d{6,}$/.test(cells[1])) {
      const amountRaw = (cells[3] ?? "").replace(/[£$€,\s]/g, "");
      const amount = Number.parseFloat(amountRaw);
      if (Number.isNaN(amount)) continue;
      const qtyRaw = parseInt(cells[4] ?? "0", 10);
      lines.push({
        paymentReference,
        orderId: cells[1],
        orderDate: cells[2] ?? "",
        amount,
        qty: Number.isNaN(qtyRaw) ? null : qtyRaw || null,
      });
    }
  }
  return lines;
}

function extractCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    const text = m[1]
      .replace(/=\r?\n/g, "")                                             // remove QP soft-break continuations
      .replace(/=[0-9A-Fa-f]{2}/g, (c) => {                              // decode any residual QP bytes
        try { return String.fromCharCode(parseInt(c.slice(1), 16)); } catch { return ""; }
      })
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    cells.push(text);
  }
  return cells;
}

function parsePayoutTextBody(body: string, paymentReference: string): PayoutOrderLine[] {
  // Fallback: scan for lines that look like order rows in plain text
  // Pattern: <payment_id> <order_id> <date> <amount> <qty>
  const lines: PayoutOrderLine[] = [];
  const lineRegex = /\b(\d{6,})\s+(\d{8,})\s+([\d]{2}-\w{3}-\d{2}[^\n£$€]*?)\s+[£$€]([\d,]+\.\d{2})\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(body)) !== null) {
    const amount = Number.parseFloat(m[4].replace(/,/g, ""));
    if (!Number.isNaN(amount)) {
      lines.push({
        paymentReference,
        orderId: m[2],
        orderDate: m[3].trim(),
        amount,
        qty: parseInt(m[5], 10) || null,
      });
    }
  }
  return lines;
}

// ── Database operations ───────────────────────────────────────────────────────

async function isAlreadyProcessed(
  supabase: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("sales_scan_log")
    .select("id, status")
    .eq("user_id", userId)
    .eq("message_id", messageId)
    .maybeSingle();
  if (!data) return false;
  // Don't skip emails that previously errored — allow them to be retried
  return (data as { status: string }).status !== "error";
}

async function insertScanLog(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    messageId: string;
    xVgId: string;
    emailType: string;
    subject: string;
    receivedAt: string;
    accountEmail: string;
    status?: string;
    rawExtracted?: Record<string, unknown>;
    notes?: string;
  },
): Promise<number> {
  // Upsert so that retrying a previously-errored email updates the existing row
  const { data, error } = await supabase
    .from("sales_scan_log")
    .upsert(
      {
        user_id: userId,
        message_id: opts.messageId,
        x_vg_id: opts.xVgId || null,
        email_type: opts.emailType,
        platform: "viagogo",
        subject: opts.subject,
        received_at: opts.receivedAt,
        status: opts.status ?? "ok",
        account_email: opts.accountEmail,
        raw_extracted: opts.rawExtracted ?? null,
        notes: opts.notes ?? null,
      },
      { onConflict: "user_id,message_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  if (error) throw new Error(`insertScanLog: ${error.message}`);
  return (data as { id: number }).id;
}

async function insertScanResult(
  supabase: SupabaseClient,
  userId: string,
  scanLogId: number,
  emailType: string,
  result: ScanLineResult,
  extra: {
    orderId?: string | null;
    paymentReference?: string | null;
    eventName?: string | null;
    eventDate?: string | null;
    orderDate?: string | null;
    amount?: number | null;
    qty?: number | null;
  },
) {
  const { error } = await supabase.from("sales_scan_results").insert({
    user_id: userId,
    scan_log_id: scanLogId,
    platform: "viagogo",
    email_type: emailType,
    order_id: extra.orderId ?? result.orderId ?? null,
    payment_reference: extra.paymentReference ?? result.paymentReference ?? null,
    event_name: extra.eventName ?? result.eventName ?? null,
    event_date: extra.eventDate ?? result.eventDate ?? null,
    order_date: extra.orderDate ?? result.orderDate ?? null,
    amount: extra.amount ?? result.amount ?? null,
    qty: extra.qty ?? result.qty ?? null,
    sale_id: result.saleId,
    match_status: result.matchStatus,
    action_taken: result.actionTaken,
    confidence: result.confidence,
    notes: result.notes,
  });
  if (error) throw new Error(`insertScanResult: ${error.message}`);
}

async function processTransferEmail(
  supabase: SupabaseClient,
  userId: string,
  data: TransferEmailData,
  _scanLogId: number,
): Promise<ScanLineResult> {
  const base: Omit<ScanLineResult, "matchStatus" | "saleId" | "actionTaken" | "confidence" | "notes"> = {
    orderId: data.orderId,
    paymentReference: null,
    eventName: data.eventName,
    eventDate: data.eventDate,
    orderDate: null,
    amount: data.paymentTotal,
    qty: data.qty,
  };

  const { data: sale, error } = await supabase
    .from("sales")
    .select("id, transfer_status, payment_status, sale_status, notes")
    .eq("user_id", userId)
    .eq("external_sale_id", data.orderId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!sale) {
    return { ...base, saleId: null, matchStatus: "unmatched", actionTaken: null, confidence: null, notes: "No sale found with this order ID" };
  }

  const s = sale as {
    id: number;
    transfer_status: string;
    payment_status: string;
    sale_status: string;
    notes: string | null;
  };

  if (s.transfer_status === "Transfer Completed") {
    return { ...base, saleId: s.id, matchStatus: "already_processed", actionTaken: "no_change", confidence: "exact", notes: "Transfer already recorded" };
  }

  const isAlreadyPaid = s.payment_status === "Paid";
  const updatedAt = data.receivedAt.slice(0, 10);

  await supabase
    .from("sales")
    .update({
      transfer_status: "Transfer Completed",
      transfer_date: data.receivedAt,
      payment_status: isAlreadyPaid ? "Paid" : "Awaiting Payment",
      sale_status: isAlreadyPaid ? "Paid" : "Sold – Transfer Completed",
      notes: appendNote(s.notes, `Transfer confirmed ${updatedAt}`),
    })
    .eq("id", s.id)
    .eq("user_id", userId);

  return { ...base, saleId: s.id, matchStatus: "matched", actionTaken: "updated_transfer", confidence: "exact", notes: null };
}

async function processPayoutOrderLine(
  supabase: SupabaseClient,
  userId: string,
  line: PayoutOrderLine,
  paymentDate: string,
  _scanLogId: number,
): Promise<ScanLineResult> {
  const base: Omit<ScanLineResult, "matchStatus" | "saleId" | "actionTaken" | "confidence" | "notes"> = {
    orderId: line.orderId,
    paymentReference: line.paymentReference,
    eventName: null,
    eventDate: null,
    orderDate: line.orderDate,
    amount: line.amount,
    qty: line.qty,
  };

  const { data: sale, error } = await supabase
    .from("sales")
    .select("id, payment_status, payout_total, notes, event_name")
    .eq("user_id", userId)
    .eq("external_sale_id", line.orderId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!sale) {
    return { ...base, saleId: null, matchStatus: "unmatched", actionTaken: null, confidence: null, notes: "No sale found with this order ID" };
  }

  const s = sale as {
    id: number;
    payment_status: string;
    payout_total: number | null;
    notes: string | null;
    event_name: string | null;
  };

  if (s.payment_status === "Paid") {
    return { ...base, eventName: s.event_name, saleId: s.id, matchStatus: "already_processed", actionTaken: "no_change", confidence: "exact", notes: "Payment already recorded" };
  }

  const paidDate = paymentDate.slice(0, 10);

  await supabase
    .from("sales")
    .update({
      payment_status: "Paid",
      payout_total: line.amount,
      payout_date: paymentDate,
      sale_status: "Paid",
      transfer_status: "Transfer Completed",
      notes: appendNote(s.notes, `Paid ${paidDate} — ref #${line.paymentReference}, £${line.amount.toFixed(2)}`),
    })
    .eq("id", s.id)
    .eq("user_id", userId);

  return { ...base, eventName: s.event_name, saleId: s.id, matchStatus: "matched", actionTaken: "updated_payment", confidence: "exact", notes: null };
}

function tally(
  totals: { updated: number; needsReview: number },
  result: ScanLineResult,
) {
  if (result.matchStatus === "matched") totals.updated++;
  else if (result.matchStatus === "unmatched" || result.matchStatus === "needs_review") totals.needsReview++;
}

// ── Text / date helpers ────────────────────────────────────────────────────────

function parseViagogoEventDate(text: string): string {
  // "Wednesday, June 17, 2026 | 19:00"
  const match = text.match(/\w+day,\s+(\w+\s+\d{1,2},\s+\d{4})\s*\|/i);
  if (match) {
    const d = new Date(match[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return "";
}

function parseMoney(text: string, patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const n = Number.parseFloat(m[1].replace(/,/g, ""));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function parseInteger(text: string, patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return Number.parseInt(m[1], 10);
  }
  return null;
}

function appendNote(existing: string | null, note: string): string {
  if (!existing?.trim()) return note;
  if (existing.includes(note)) return existing;
  return `${existing.trim()}\n${note}`;
}

function normalizeTimestamp(value: string): string {
  if (!value) return "";
  const cleaned = value.replace(/\s*\(UTC\)\s*$/i, "").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function cleanText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/ /g, " ")
    .replace(/​/g, "")
    .replace(/﻿/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Gmail API helpers ─────────────────────────────────────────────────────────

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
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now() + 60_000) {
    return gmailAccount.access_token;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth env vars missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: gmailAccount.refresh_token,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    throw new Error(`Gmail token refresh failed (${msg}). Reconnect Gmail in Connections.`);
  } finally {
    clearTimeout(timeout);
  }
  const tokenData = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description ?? tokenData.error ?? "Failed to refresh Gmail token");
  }
  const nextExpiry = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : gmailAccount.token_expiry;
  await supabase
    .from("gmail_accounts")
    .update({ access_token: tokenData.access_token, token_expiry: nextExpiry, status: "Ready" })
    .eq("id", gmailAccount.id);
  return tokenData.access_token;
}

async function gmailRequest<T>(accessToken: string, input: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    throw new Error(`Gmail API request failed (${msg})`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) throw new Error(`Gmail token expired or revoked (${res.status}). Reconnect Gmail in Connections.`);
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function listMessages(accessToken: string, query: string) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "100");
  const data = await gmailRequest<{ messages?: Array<{ id: string }> }>(accessToken, url.toString());
  return data.messages ?? [];
}

async function ensureGmailLabels(
  accessToken: string,
): Promise<{ transfers: string; payouts: string }> {
  const data = await gmailRequest<{ labels?: Array<{ id: string; name: string }> }>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
  );
  const labels = data.labels ?? [];

  async function getOrCreate(name: string): Promise<string> {
    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await gmailRequest<{ id: string }>(
      accessToken,
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
      },
    );
    return created.id;
  }

  const [transfers, payouts] = await Promise.all([getOrCreate("Transfers"), getOrCreate("Payouts")]);
  return { transfers, payouts };
}

async function applyGmailLabel(accessToken: string, gmailMessageId: string, labelId: string): Promise<void> {
  await gmailRequest(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    },
  );
}

async function getMessage(accessToken: string, id: string) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  url.searchParams.set("format", "full");
  return gmailRequest<GmailMessage>(accessToken, url.toString());
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data?: string): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getBody(payload: GmailPayload): string {
  const parts: string[] = [];
  const walk = (part: GmailPayload) => {
    if (part.body?.data) {
      let decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === "text/html") decoded = stripHtml(decoded);
      parts.push(decoded);
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return cleanText(parts.join("\n"));
}

function getHtmlBody(payload: GmailPayload): string {
  let html = "";
  const walk = (part: GmailPayload) => {
    if (part.mimeType === "text/html" && part.body?.data) {
      let raw = decodeBase64Url(part.body.data);
      // Gmail API returns raw transfer-encoded bytes; decode QP if detected
      if (raw.includes("=3D") || raw.includes("=\r\n") || raw.includes("=\n")) {
        raw = decodeQuotedPrintable(raw);
      }
      html = raw;
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return html;
}

function stripHtml(text: string): string {
  return text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|table|tbody|thead|tfoot|h[1-6])[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

// ── Outlook API helpers ───────────────────────────────────────────────────────

async function getValidOutlookToken({
  supabase,
  outlookAccount,
}: {
  supabase: SupabaseClient;
  outlookAccount: OutlookAccount;
}) {
  if (!outlookAccount.refresh_token || !outlookAccount.token_expiry || !outlookAccount.access_token) {
    return outlookAccount.access_token ?? "";
  }
  const expiresAt = new Date(outlookAccount.token_expiry);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now() + 60_000) {
    return outlookAccount.access_token;
  }
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth env vars missing");

  const olController = new AbortController();
  const olTimeout = setTimeout(() => olController.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: outlookAccount.refresh_token,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: olController.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    throw new Error(`Outlook token refresh failed (${msg}). Reconnect Outlook in Connections.`);
  } finally {
    clearTimeout(olTimeout);
  }
  const tokenData = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description ?? tokenData.error ?? "Failed to refresh Outlook token");
  }
  const nextExpiry = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : outlookAccount.token_expiry;
  await supabase
    .from("gmail_accounts")
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? outlookAccount.refresh_token,
      token_expiry: nextExpiry,
      status: "Ready",
    })
    .eq("id", outlookAccount.id);
  return tokenData.access_token;
}

async function outlookGraphRequest<T>(accessToken: string, input: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    throw new Error(`Graph API request failed (${msg})`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) throw new Error(`Outlook token expired or revoked (${res.status}). Reconnect Outlook in Connections.`);
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function ensureOutlookFolders(
  accessToken: string,
): Promise<{ transfers: string; payouts: string }> {
  const data = await outlookGraphRequest<{ value?: Array<{ id: string; displayName: string }> }>(
    accessToken,
    "https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&$select=id,displayName",
  );
  const folders = data.value ?? [];

  async function getOrCreate(name: string): Promise<string> {
    const existing = folders.find((f) => f.displayName.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await outlookGraphRequest<{ id: string }>(
      accessToken,
      "https://graph.microsoft.com/v1.0/me/mailFolders",
      { method: "POST", body: JSON.stringify({ displayName: name }) },
    );
    return created.id;
  }

  const [transfers, payouts] = await Promise.all([getOrCreate("Transfers"), getOrCreate("Payouts")]);
  return { transfers, payouts };
}

async function moveOutlookMessage(accessToken: string, messageId: string, folderId: string): Promise<void> {
  await outlookGraphRequest(
    accessToken,
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/move`,
    { method: "POST", body: JSON.stringify({ destinationId: folderId }) },
  );
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/(?:=[0-9A-F]{2})+/gi, (match) => {
      const bytes = match.split("=").filter(Boolean).map((h) => parseInt(h, 16));
      return Buffer.from(bytes).toString("utf8");
    });
}

function outlookStripHtml(text: string): string {
  return text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|table|tbody|thead|tfoot|h[1-6])[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, ": ")
    .replace(/<t[dh][^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
