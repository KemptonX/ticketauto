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
  last_synced_at?: string | null;
};

type SyncResult = {
  scanned: number;
  inserted: number;
  updated: number;
  insertedRefs: string[];
  updatedRefs: string[];
  email: string;
};

// Subject-line keywords used to filter at envelope stage (before downloading bodies)
const SUBJECT_KEYWORDS = [
  "ticketmaster",
  "order confirmation",
  "ticket confirmation",
  "you're in",
  "you got tickets",
  "order number",
  "order confirm",
  "confirmacion de compra",
  "confirmación de compra",
  "confirmation de votre commande",
  "axs mobile id",
  "thank you for purchasing tickets",
  "ticket order confirmation",
  "eventim-bestellung",
  "eventim order",
];

// From-domain keywords — always download these regardless of subject
const FROM_KEYWORDS = ["ticketmaster", "axs.com", "axs.co.uk", "seetickets.com", "gigsandtours.com", "eventim.de", "eventim.co.uk", "royalalberthall.com"];

const BATCH_SIZE = 10;

// Extract raw headers from RFC 2822 message source
function extractRawHeaders(source: Buffer): Array<{ name: string; value: string }> {
  const text = source.toString("binary");
  const end = text.indexOf("\r\n\r\n");
  const section = end >= 0 ? text.slice(0, end) : text;
  const unfolded = section.replace(/\r\n([ \t])/g, " $1");
  const headers: Array<{ name: string; value: string }> = [];
  for (const line of unfolded.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      headers.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
    }
  }
  return headers;
}

function buildImapClient(account: ImapAccount) {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.use_tls,
    auth: { user: account.username, pass: account.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 30000,
  });
}

export function safeError(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (password) msg = msg.split(password).join("***");
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
    try { await client.logout(); } catch { /* ignore */ }
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
      let searchCriteria: Record<string, unknown>;
      if (imapAccount.unread_only) {
        // Unread-only: search all unseen messages within a fixed 14-day cap.
        // Do NOT use incremental since here — unread emails can be any age and
        // the incremental window (last_synced_at - 2h) would skip old unread mail.
        const since14 = new Date();
        since14.setDate(since14.getDate() - 14);
        searchCriteria = { seen: false, since: since14 };
      } else {
        // All-mail: use incremental since (last_synced_at - 2h) for efficiency,
        // falling back to 14-day lookback on first scan.
        const since = new Date();
        if (imapAccount.last_synced_at) {
          since.setTime(new Date(imapAccount.last_synced_at).getTime() - 2 * 60 * 60 * 1000);
        } else {
          since.setDate(since.getDate() - 14);
        }
        searchCriteria = { since };
      }

      const uidResult = await client.search(searchCriteria, { uid: true });
      const allUids = Array.isArray(uidResult) ? uidResult : [];

      if (allUids.length === 0) {
        return { scanned: 0, inserted: 0, updated: 0, insertedRefs: [], updatedRefs: [], email: imapAccount.username };
      }

      // ── Phase 1: envelope pre-filter ──────────────────────────────────────
      // Fetch only Subject + From for all matching UIDs so we can discard
      // irrelevant messages before downloading their full bodies.
      const candidateUids: number[] = [];

      for await (const msg of client.fetch(allUids, { envelope: true }, { uid: true })) {
        const subject = (msg.envelope?.subject ?? "").toLowerCase();
        const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const relevant =
          SUBJECT_KEYWORDS.some((kw) => subject.includes(kw)) ||
          FROM_KEYWORDS.some((kw) => from.includes(kw));
        if (relevant) candidateUids.push(msg.uid);
      }

      if (candidateUids.length === 0) {
        return { scanned: 0, inserted: 0, updated: 0, insertedRefs: [], updatedRefs: [], email: imapAccount.username };
      }

      // ── Phase 2: batch-fetch full source for candidates only ──────────────
      // Mirror Gmail's parallel-batch approach: collect a batch of sources,
      // then process them sequentially (DB writes can't safely parallelise).
      for (let i = 0; i < candidateUids.length; i += BATCH_SIZE) {
        const batchUids = candidateUids.slice(i, i + BATCH_SIZE);
        const batchSources = new Map<number, Buffer>();
        for await (const msg of client.fetch(batchUids, { source: true }, { uid: true })) {
          batchSources.set(msg.uid, msg.source as Buffer);
        }

        // Process sequentially (same pattern as syncGmailInbox)
        for (const uid of batchUids) {
          const source = batchSources.get(uid);
          if (!source) continue;

          try {
            // skipHtmlToText: true — prevents mailparser from using html-to-text,
            // which outputs image src URLs inline and corrupts venue extraction
            const parsed = await simpleParser(source, { skipHtmlToText: true });
            const subject = parsed.subject || "";

            scanned++;

            const headers = extractRawHeaders(source);
            if (parsed.date && !headers.some((h) => h.name.toLowerCase() === "date")) {
              headers.push({ name: "Date", value: parsed.date.toUTCString() });
            }

            // Mirror Gmail's getBody(): join text/plain + stripHtml(text/html)
            const plainPart = parsed.text || "";
            const rawHtml = typeof parsed.html === "string" ? parsed.html : "";
            const bodyParts: string[] = [];
            if (plainPart) bodyParts.push(plainPart);
            if (rawHtml) bodyParts.push(stripHtml(rawHtml));
            const body = cleanText(bodyParts.join("\n"));

            const htmlBody: string | null = rawHtml
              ? rawHtml
              : plainPart
              ? `<!DOCTYPE html><html><body><pre style="font-family:sans-serif;white-space:pre-wrap;padding:20px;color:#222">${plainPart.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`
              : null;

            const normEmail: NormalisedEmail = {
              from: parsed.from?.text || "",
              subject,
              body,
              htmlBody,
              headers,
            };

            const result = await processNormalisedEmail(supabase, normEmail, userId, imapAccount.username);

            if (result.action === "no_ref") { scanned--; continue; }

            if (imapAccount.mark_read && result.action !== "ignored") {
              try {
                await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
              } catch { /* best-effort */ }
            }

            if (result.action === "inserted") { inserted++; insertedRefs.push(result.bookingRef!); }
            else if (result.action === "updated") { updated++; updatedRefs.push(result.bookingRef!); }
          } catch {
            // Isolate per-message failures — don't abort the whole scan
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
    .update({ last_synced_at: new Date().toISOString(), status: "Ready" })
    .eq("id", imapAccount.id);

  return { scanned, inserted, updated, insertedRefs, updatedRefs, email: imapAccount.username };
}
