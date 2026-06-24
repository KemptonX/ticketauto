import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { processNormalisedEmail } from "@/src/lib/gmail-sync";
import type { NormalisedEmail } from "@/src/lib/gmail-sync";
import {
  isTransferEmail,
  isPayoutEmail,
  parseTransferEmail,
  parsePayoutEmail,
  processTransferEmail,
  processPayoutOrderLine,
} from "@/src/lib/sales-lifecycle-sync";
import { processSingleSaleEmail } from "@/src/lib/viagogo-sales-sync";

export const runtime = "nodejs";

// ─── Constants ────────────────────────────────────────────────────────────────

const INBOUND_DOMAIN = "inbound.tixtracker.app";
const FORWARDING_PREFIX = "scan+";

// ─── Postmark payload shape ───────────────────────────────────────────────────

type PostmarkHeader = { Name: string; Value: string };

type PostmarkInboundPayload = {
  MessageID?: string;
  From?: string;
  FromName?: string;
  To?: string;
  OriginalRecipient?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Date?: string;
  MailboxHash?: string;
  Headers?: PostmarkHeader[];
  ToFull?: Array<{ Email: string; Name?: string }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractToken(address: string): string | null {
  // Handle display-name format: "Some Name <email@host>"
  const angleMatch = address.match(/<([^>]+)>/);
  const raw = (angleMatch ? angleMatch[1] : address).trim();
  const at = raw.indexOf("@");
  if (at === -1) return null;
  // Only lowercase the domain for comparison — tokens are case-sensitive base64url
  if (raw.slice(at + 1).toLowerCase() !== INBOUND_DOMAIN) return null;
  const local = raw.slice(0, at);
  if (!local.toLowerCase().startsWith(FORWARDING_PREFIX)) return null;
  const token = local.slice(FORWARDING_PREFIX.length);
  return token || null;
}

function isGmailVerification(from: string, subject: string): boolean {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  return (
    f.includes("forwarding-noreply@google.com") ||
    (s.includes("gmail forwarding confirmation") && f.includes("google.com")) ||
    (s.includes("confirmation code") && f.includes("google.com"))
  );
}

function extractVerificationCode(text: string): string | null {
  const match = text.match(/\b(\d{9,})\b/);
  return match ? match[1] : null;
}

function extractVerificationLink(text: string): string | null {
  const match = text.match(/https:\/\/mail\.google\.com\/mail\/vf-[^\s"<>]+/);
  return match ? match[0] : null;
}

function computeNormalizedHash(
  from: string,
  subject: string,
  date: string,
  bodySnippet: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${from}|${subject}|${date}|${bodySnippet.slice(0, 200)}`)
    .digest("hex")
    .slice(0, 32);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // --- Webhook secret validation ---
  const url = new URL(request.url);
  const providedSecret = url.searchParams.get("secret");
  const expectedSecret = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET?.trim();
  if (expectedSecret && providedSecret !== expectedSecret) {
    // Return 200 to Postmark to avoid endless retries on auth failure.
    // Log nothing sensitive in the response.
    return NextResponse.json({ ok: false, status: "unauthorized" }, { status: 200 });
  }

  let payload: PostmarkInboundPayload;
  try {
    payload = (await request.json()) as PostmarkInboundPayload;
  } catch {
    return NextResponse.json({ ok: false, status: "bad_payload" }, { status: 200 });
  }

  // Service role bypasses RLS — required since this webhook has no user session.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const from = (payload.From ?? "").trim();
  const subject = (payload.Subject ?? "").trim();
  const textBody = payload.TextBody ?? "";
  const htmlBody = payload.HtmlBody ?? null;
  const postmarkMessageId = payload.MessageID ?? null;
  const receivedAt = payload.Date
    ? new Date(payload.Date).toISOString()
    : new Date().toISOString();

  console.log("[inbound] from:", from, "| subject:", subject, "| mailboxHash:", payload.MailboxHash, "| textLen:", textBody.length, "| htmlLen:", (htmlBody ?? "").length);

  // --- Resolve token from all available recipient fields ---
  // MailboxHash = the +tag portion of the inbound address — use it directly (no parsing needed).
  // Fall back to extracting from recipient address fields for edge cases.
  let token: string | null = payload.MailboxHash || null;
  const recipientEmail = token
    ? `${FORWARDING_PREFIX}${token}@${INBOUND_DOMAIN}`
    : (payload.OriginalRecipient ?? payload.To ?? null);

  if (!token) {
    const candidates: string[] = [];
    if (payload.OriginalRecipient) candidates.push(payload.OriginalRecipient);
    if (payload.To) candidates.push(payload.To);
    for (const t of payload.ToFull ?? []) {
      if (t.Email) candidates.push(t.Email);
    }
    for (const addr of candidates) {
      token = extractToken(addr);
      if (token) break;
    }
  }
  const normalizedHash = computeNormalizedHash(from, subject, payload.Date ?? "", textBody);

  // --- Internal log helper ---
  // Never logs tokens, email bodies or PII in error messages.
  async function logEvent(
    status: string,
    userId: string | null,
    settingId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await supabase.from("inbound_email_events").insert({
        user_id: userId,
        forwarding_setting_id: settingId,
        postmark_message_id: postmarkMessageId,
        original_message_id:
          (payload.Headers ?? []).find((h) => h.Name === "Message-ID")?.Value ?? null,
        recipient_email: recipientEmail,
        sender_email: from || null,
        subject: subject || null,
        received_at: receivedAt,
        normalized_hash: normalizedHash,
        processing_status: status,
        ...extra,
      });
    } catch {
      // Log failures must never break the webhook response.
    }
  }

  // --- Unknown token ---
  if (!token) {
    await logEvent("unknown_token", null, null);
    return NextResponse.json({ ok: true, status: "unknown_token" });
  }

  // --- Find forwarding setting ---
  const { data: setting, error: settingError } = await supabase
    .from("email_forwarding_settings")
    .select("id, user_id, status")
    .eq("forwarding_token", token)
    .maybeSingle();

  if (settingError || !setting) {
    await logEvent("unknown_token", null, null, {
      error_message: settingError?.message ?? "token not found in db",
    });
    return NextResponse.json({ ok: true, status: "unknown_token" });
  }

  if (setting.status !== "active") {
    await logEvent("disabled_token", setting.user_id as string, setting.id as string);
    return NextResponse.json({ ok: true, status: "disabled_token" });
  }

  const userId = setting.user_id as string;
  const settingId = setting.id as string;

  // Update last_received_at (non-blocking)
  void supabase
    .from("email_forwarding_settings")
    .update({ last_received_at: receivedAt, updated_at: new Date().toISOString() })
    .eq("id", settingId);

  // --- Postmark-level duplicate check ---
  // Catches the same Postmark delivery arriving twice (retry/webhook duplication)
  if (postmarkMessageId) {
    const { data: existing } = await supabase
      .from("inbound_email_events")
      .select("id")
      .eq("postmark_message_id", postmarkMessageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      await logEvent("duplicate", userId, settingId);
      return NextResponse.json({ ok: true, status: "duplicate" });
    }
  }

  // --- Gmail forwarding verification email ---
  if (isGmailVerification(from, subject)) {
    const fullText = `${textBody}\n${htmlBody ?? ""}`;
    const code = extractVerificationCode(fullText);
    const link = extractVerificationLink(fullText);
    await supabase
      .from("email_forwarding_settings")
      .update({
        latest_verification_code: code,
        latest_verification_link: link,
        latest_verification_received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", settingId);
    await logEvent("verification_email", userId, settingId);
    return NextResponse.json({ ok: true, status: "verification_email" });
  }

  // --- Viagogo sales lifecycle emails (transfer confirmation / payout) ---
  const isTransfer = isTransferEmail(subject);
  const isPayout = isPayoutEmail(subject);
  console.log("[inbound] isTransfer:", isTransfer, "| isPayout:", isPayout);

  if (isTransfer || isPayout) {
    const rawHeaders = (payload.Headers ?? []).map((h) => ({ name: h.Name, value: h.Value }));

    try {
      if (isTransfer) {
        const data = parseTransferEmail(subject, textBody, rawHeaders, "", receivedAt);
        console.log("[inbound] parseTransferEmail result:", data ? JSON.stringify({ orderId: data.orderId, eventName: data.eventName, qty: data.qty }) : "null");
        if (!data) {
          await logEvent("failed", userId, settingId, { error_message: "transfer email parse failed — no order # in subject" });
          return NextResponse.json({ ok: true, status: "failed" });
        }
        const result = await processTransferEmail(supabase, userId, data, null);
        console.log("[inbound] processTransferEmail result:", JSON.stringify(result));
        void supabase.from("email_forwarding_settings")
          .update({ last_successful_import_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", settingId);
        await logEvent("imported", userId, settingId, { error_message: `matchStatus=${result.matchStatus} action=${result.actionTaken}` });
        return NextResponse.json({ ok: true, status: "imported" });
      } else {
        const data = parsePayoutEmail(subject, textBody, htmlBody ?? "", rawHeaders, receivedAt);
        console.log("[inbound] parsePayoutEmail result:", data ? JSON.stringify({ ref: data.paymentReference, lines: data.orderLines.length }) : "null");
        if (!data || data.orderLines.length === 0) {
          await logEvent("failed", userId, settingId, { error_message: "payout email parse failed or no order lines found" });
          return NextResponse.json({ ok: true, status: "failed" });
        }
        for (const line of data.orderLines) {
          const result = await processPayoutOrderLine(supabase, userId, line, data.paymentDate, null);
          console.log("[inbound] processPayoutOrderLine:", JSON.stringify(result));
        }
        void supabase.from("email_forwarding_settings")
          .update({ last_successful_import_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", settingId);
        await logEvent("imported", userId, settingId);
        return NextResponse.json({ ok: true, status: "imported" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "sales processing error";
      console.error("[inbound] sales pipeline error:", msg);
      await logEvent("failed", userId, settingId, { error_message: msg });
      return NextResponse.json({ ok: true, status: "failed" });
    }
  }

  // --- Viagogo / StubHub / Ticombo sale notification emails ---
  // ("Please transfer the tickets for sale #...", "You sold your ticket for", etc.)
  // These are the initial sale alert emails — different from the lifecycle emails above.
  try {
    const saleResult = await processSingleSaleEmail({
      supabase,
      userId,
      subject,
      textBody,
      htmlBody,
      receivedAt,
      sourceMessageId: postmarkMessageId ?? normalizedHash,
      accountEmail: from,
    });
    console.log("[inbound] processSingleSaleEmail result:", saleResult ? JSON.stringify(saleResult) : "not a sale email");
    if (saleResult !== null) {
      void supabase.from("email_forwarding_settings")
        .update({ last_successful_import_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", settingId);
      await logEvent(saleResult.inserted ? "imported" : "updated", userId, settingId, {
        error_message: `source=${saleResult.source} matched=${saleResult.matched}`,
      });
      return NextResponse.json({ ok: true, status: saleResult.inserted ? "imported" : "updated" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "sale sync error";
    console.error("[inbound] processSingleSaleEmail error:", msg);
    await logEvent("failed", userId, settingId, { error_message: msg });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  // --- Build NormalisedEmail — same shape the existing Gmail scanner uses ---
  // Passthrough headers from the original email (forwarded by Gmail, contain
  // Ticketmaster/AXS/Viagogo headers that the parser uses for account extraction).
  const passthroughHeaders = (payload.Headers ?? []).map((h) => ({
    name: h.Name,
    value: h.Value,
  }));
  // Synthetic headers ensure From/To/Subject/Date are always present even if
  // the original forwarded email didn't pass them through.
  const syntheticHeaders = [
    { name: "From", value: from },
    { name: "To", value: payload.To ?? "" },
    { name: "Subject", value: subject },
    { name: "Date", value: payload.Date ?? "" },
    ...(postmarkMessageId ? [{ name: "Message-ID", value: postmarkMessageId }] : []),
  ];

  const normEmail: NormalisedEmail = {
    from,
    subject,
    body: textBody,
    htmlBody,
    // Passthrough first (original forwarded headers), synthetic appended so
    // the existing extractAccount() function has both sets to work with.
    headers: [...passthroughHeaders, ...syntheticHeaders],
  };

  // --- Pass through the existing parser/import pipeline ---
  // processNormalisedEmail handles provider detection, parsing, deduplication
  // (unique constraint on user_id+booking_ref), and all DB writes.
  // We make zero changes to that function.
  let processResult;
  try {
    processResult = await processNormalisedEmail(supabase, normEmail, userId, from);
    console.log("[inbound] processNormalisedEmail action:", processResult.action, "| bookingRef:", processResult.bookingRef);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "processing error";
    console.error("[inbound] processNormalisedEmail error:", msg);
    await logEvent("failed", userId, settingId, { error_message: msg });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  // --- Map parse result to event status ---
  const eventStatus =
    processResult.action === "inserted"
      ? "imported"
      : processResult.action === "updated"
        ? "updated"
        : processResult.action === "ignored"
          ? "duplicate"
          : "no_ref_ignored"; // processResult.action === "no_ref"

  if (processResult.action === "inserted" || processResult.action === "updated") {
    void supabase
      .from("email_forwarding_settings")
      .update({
        last_successful_import_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", settingId);
  }

  await logEvent(eventStatus, userId, settingId, {
    booking_ref_detected: processResult.bookingRef ?? null,
  });

  return NextResponse.json({ ok: true, status: eventStatus });
}
