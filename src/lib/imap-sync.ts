import type { SupabaseClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { processNormalisedEmail, stripHtml, cleanText } from "./gmail-sync";
import type { NormalisedEmail } from "./gmail-sync";

export type ImapAccount = {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  use_tls: boolean;
  mailbox: string;
  unread_only: boolean;
  mark_read: boolean;
};

type SyncResult = {
  scanned: number;
  inserted: number;
  updated: number;
  insertedRefs: string[];
  updatedRefs: string[];
  email: string;
};

// Keywords used to pre-filter IMAP messages before running full parsing
const KEYWORDS = [
  "ticketmaster",
  "order confirmation",
  "ticket confirmation",
  "you're in",
  "you got tickets",
  "order number",
  "axs mobile id",
  "confirmacion de compra",
  "order confirm",
];

// Extract raw headers from RFC 2822 message source
function extractRawHeaders(source: Buffer): Array<{ name: string; value: string }> {
  const text = source.toString("binary");
  const end = text.indexOf("\r\n\r\n");
  const section = end >= 0 ? text.slice(0, end) : text;
  // Unfold continuation lines
  const unfolded = section.replace(/\r\n([ \t])/g, " $1");
  const headers: Array<{ name: string; value: string }> = [];
  for (const line of unfolded.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      headers.push({
        name: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
      });
    }
  }
  return headers;
}

function buildImapClient(account: ImapAccount) {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.use_tls,
    auth: {
      user: account.username,
      pass: account.password,
    },
    logger: false,
    disableAutoIdle: true,
  });
}

// Sanitise error messages so passwords are never leaked
function safeError(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  // Remove password if it somehow appears
  if (password) {
    msg = msg.split(password).join("***");
  }
  // Strip raw IMAP response codes that may contain auth details
  msg = msg.replace(/\[.+?\]\s*/g, "").trim();
  return msg.slice(0, 300);
}

export async function testImapConnection(account: Omit<ImapAccount, "id">): Promise<void> {
  const client = buildImapClient({ ...account, id: "" });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(account.mailbox || "INBOX");
    lock.release();
  } finally {
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }
}

export async function syncImapInbox({
  supabase,
  imapAccount,
  userId,
}: {
  supabase: SupabaseClient;
  imapAccount: ImapAccount;
  userId: string;
}): Promise<SyncResult> {
  const client = buildImapClient(imapAccount);
  await client.connect();

  let inserted = 0;
  let updated = 0;
  let scanned = 0;
  const insertedRefs: string[] = [];
  const updatedRefs: string[] = [];

  try {
    const lock = await client.getMailboxLock(imapAccount.mailbox || "INBOX");
    try {
      const since = new Date();
      since.setDate(since.getDate() - 14);

      const searchCriteria = imapAccount.unread_only
        ? { unseen: true, since }
        : { since };

      const uidResult = await client.search(searchCriteria, { uid: true });
      const uids = Array.isArray(uidResult) ? uidResult : [];

      if (uids.length > 0) {
        for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
          const source = msg.source as Buffer;
          const parsed = await simpleParser(source, { skipHtmlToText: false });

          const subject = parsed.subject || "";
          const textBody = parsed.text || "";
          const lc = `${subject}\n${textBody}`.toLowerCase();

          if (!KEYWORDS.some((kw) => lc.includes(kw))) continue;

          scanned++;

          const headers = extractRawHeaders(source);

          // Use date from parsed mail if the Date header is missing or garbled
          if (parsed.date && !headers.some((h) => h.name.toLowerCase() === "date")) {
            headers.push({ name: "Date", value: parsed.date.toUTCString() });
          }

          const rawHtml = typeof parsed.html === "string" ? parsed.html : null;

          let body: string;
          if (textBody) {
            body = cleanText(textBody);
          } else if (rawHtml) {
            body = cleanText(stripHtml(rawHtml));
          } else {
            body = "";
          }

          let htmlBody: string | null;
          if (rawHtml) {
            htmlBody = rawHtml;
          } else if (textBody) {
            const escaped = textBody
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            htmlBody = `<!DOCTYPE html><html><body><pre style="font-family:sans-serif;white-space:pre-wrap;padding:20px;color:#222">${escaped}</pre></body></html>`;
          } else {
            htmlBody = null;
          }

          const normEmail: NormalisedEmail = {
            from: parsed.from?.text || "",
            subject,
            body,
            htmlBody,
            headers,
          };

          const result = await processNormalisedEmail(
            supabase,
            normEmail,
            userId,
            imapAccount.username,
          );

          if (result.action === "no_ref") { scanned--; continue; }

          if (imapAccount.mark_read && result.action !== "ignored") {
            try {
              await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
            } catch { /* mark-read is best-effort */ }
          }

          if (result.action === "inserted") {
            inserted++;
            insertedRefs.push(result.bookingRef!);
          } else if (result.action === "updated") {
            updated++;
            updatedRefs.push(result.bookingRef!);
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
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", imapAccount.id);

  return {
    scanned,
    inserted,
    updated,
    insertedRefs,
    updatedRefs,
    email: imapAccount.username,
  };
}

export { safeError };
