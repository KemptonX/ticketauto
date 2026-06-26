import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
import type { TransferEmailData, PayoutEmailData } from "@/src/lib/sales-lifecycle-sync";

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

// ─── Discord notification helpers ─────────────────────────────────────────────

async function getDiscordWebhook(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("user_settings")
    .select("discord_webhook_url")
    .eq("user_id", userId)
    .maybeSingle();
  const url = (data as { discord_webhook_url?: string } | null)?.discord_webhook_url ?? "";
  return url.startsWith("https://discord.com/api/webhooks/") ? url : null;
}

async function postDiscord(webhookUrl: string, body: unknown): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`[inbound] Discord webhook ${res.status}`);
  } catch (err) {
    console.error("[inbound] Discord webhook error:", err instanceof Error ? err.message : err);
  }
}

function fmtMoney(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount);
}

function fmtSourceType(source: string | null | undefined): string {
  const map: Record<string, string> = {
    ticketmaster_direct: "Ticketmaster",
    ticketmaster_resale: "Ticketmaster Resale",
    ticketmaster_ie: "Ticketmaster IE",
    ticketmaster_de: "Ticketmaster DE",
    ticketmaster_es: "Ticketmaster ES",
    ticketmaster_it: "Ticketmaster IT",
    ticketmaster_us: "Ticketmaster US",
    axs: "AXS",
  };
  return map[source ?? ""] ?? source ?? "Unknown";
}

type OrderRow = {
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  source_type: string | null;
  section: string | null;
  row: string | null;
  account_email: string | null;
};

type SaleRow = {
  event_name: string | null;
  event_date: string | null;
  qty_sold: number | null;
  sale_total: number | null;
  payout_total: number | null;
  marketplace: string | null;
  section: string | null;
  row: string | null;
};

function buildOrderEmbed(order: OrderRow, bookingRef: string, action: "inserted" | "updated") {
  const isNew = action === "inserted";
  const fields = [
    order.venue    ? { name: "📍 Venue",   value: order.venue,                     inline: true  } : null,
    order.event_date ? { name: "📅 Date",  value: order.event_date,                inline: true  } : null,
    order.qty_bought != null ? { name: "🎫 Qty", value: String(order.qty_bought),  inline: true  } : null,
    order.total_cost != null ? { name: "💰 Cost", value: fmtMoney(order.total_cost), inline: true } : null,
    { name: "🏷️ Ref",    value: bookingRef,                                         inline: true  },
    { name: "📦 Source", value: fmtSourceType(order.source_type),                   inline: true  },
    order.section  ? { name: "💺 Section", value: order.section + (order.row ? ` / Row ${order.row}` : ""), inline: true } : null,
    order.account_email ? { name: "📧 Account", value: order.account_email,         inline: false } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    embeds: [{
      title: isNew ? "🎟️ New Ticket Order Imported" : "🔄 Ticket Order Updated",
      description: `**${order.event_name ?? "Unknown Event"}**`,
      color: isNew ? 0x2ECC71 : 0x3498DB,
      fields,
      footer: { text: "TixTracker · Scans" },
      timestamp: new Date().toISOString(),
    }],
  };
}

function buildSaleEmbed(sale: SaleRow) {
  const fields = [
    sale.event_date ? { name: "📅 Date", value: sale.event_date, inline: true } : null,
    sale.qty_sold != null ? { name: "🎫 Qty Sold", value: String(sale.qty_sold), inline: true } : null,
    sale.sale_total != null ? { name: "💰 Sale Total", value: fmtMoney(sale.sale_total), inline: true } : null,
    sale.payout_total != null ? { name: "💵 Payout", value: fmtMoney(sale.payout_total), inline: true } : null,
    sale.marketplace ? { name: "🏪 Marketplace", value: sale.marketplace, inline: true } : null,
    sale.section ? { name: "💺 Section", value: sale.section + (sale.row ? ` / Row ${sale.row}` : ""), inline: true } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    embeds: [{
      title: "💸 New Sale Scanned",
      description: `**${sale.event_name ?? "Unknown Event"}**`,
      color: 0xE67E22,
      fields,
      footer: { text: "TixTracker · Scans" },
      timestamp: new Date().toISOString(),
    }],
  };
}

function buildTransferEmbed(data: TransferEmailData) {
  const fields = [
    data.eventDate ? { name: "📅 Date", value: data.eventDate, inline: true } : null,
    data.qty != null ? { name: "🎫 Qty", value: String(data.qty), inline: true } : null,
    data.section ? { name: "💺 Section", value: data.section, inline: true } : null,
    data.venue ? { name: "📍 Venue", value: data.venue, inline: true } : null,
    { name: "🔢 Order #", value: data.orderId, inline: true },
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    embeds: [{
      title: "🚚 Tickets Delivered",
      description: `**${data.eventName || "Unknown Event"}**`,
      color: 0x2ECC71,
      fields,
      footer: { text: "TixTracker · Lifecycle" },
      timestamp: new Date().toISOString(),
    }],
  };
}

function buildPayoutEmbed(data: PayoutEmailData) {
  const total = data.orderLines.reduce((sum, l) => sum + l.amount, 0);
  const fields = [
    data.paymentDate ? { name: "📅 Payment Date", value: data.paymentDate.slice(0, 10), inline: true } : null,
    { name: "💵 Total Payout", value: fmtMoney(total), inline: true },
    { name: "📦 Orders", value: String(data.orderLines.length), inline: true },
    { name: "🔢 Payment Ref", value: data.paymentReference, inline: false },
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    embeds: [{
      title: "💰 Payout Received",
      description: `Payment **${data.paymentReference}** processed`,
      color: 0xF1C40F,
      fields,
      footer: { text: "TixTracker · Lifecycle" },
      timestamp: new Date().toISOString(),
    }],
  };
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
  async function logEvent(
    status: string,
    userId: string | null,
    settingId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const base = {
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
    };
    try {
      // Store email body so Forward Mail page can render full content.
      // Falls back to base insert if the columns don't exist yet.
      const { error } = await supabase.from("inbound_email_events").insert({
        ...base,
        text_body: textBody ? textBody.slice(0, 50000) : null,
        html_body: htmlBody ? htmlBody.slice(0, 500000) : null,
      });
      if (error) await supabase.from("inbound_email_events").insert(base);
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
        if (result.matchStatus === "matched") {
          void (async () => {
            const webhookUrl = await getDiscordWebhook(supabase, userId);
            if (webhookUrl) void postDiscord(webhookUrl, buildTransferEmbed(data));
          })();
        }
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
        void (async () => {
          const webhookUrl = await getDiscordWebhook(supabase, userId);
          if (webhookUrl) void postDiscord(webhookUrl, buildPayoutEmbed(data));
        })();
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

      if (saleResult.inserted) {
        void (async () => {
          const webhookUrl = await getDiscordWebhook(supabase, userId);
          if (!webhookUrl) return;
          const { data: sale } = await supabase
            .from("sales")
            .select("event_name, event_date, qty_sold, sale_total, payout_total, marketplace, section, row")
            .eq("user_id", userId)
            .eq("source_message_id", postmarkMessageId ?? normalizedHash)
            .maybeSingle();
          if (sale) void postDiscord(webhookUrl, buildSaleEmbed(sale as SaleRow));
        })();
      }

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

    if (processResult.bookingRef) {
      void (async () => {
        const webhookUrl = await getDiscordWebhook(supabase, userId);
        if (!webhookUrl) return;
        const { data: order } = await supabase
          .from("orders")
          .select("event_name, venue, event_date, qty_bought, total_cost, source_type, section, row, account_email")
          .eq("user_id", userId)
          .eq("booking_ref", processResult.bookingRef)
          .maybeSingle();
        if (order) void postDiscord(webhookUrl, buildOrderEmbed(order as OrderRow, processResult.bookingRef!, processResult.action as "inserted" | "updated"));
      })();
    }
  }

  await logEvent(eventStatus, userId, settingId, {
    booking_ref_detected: processResult.bookingRef ?? null,
  });

  return NextResponse.json({ ok: true, status: eventStatus });
}
