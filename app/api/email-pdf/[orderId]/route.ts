import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractHtml(payload: {
  mimeType?: string;
  body?: { data?: string };
  parts?: unknown[];
}): string {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of (payload.parts ?? []) as typeof payload[]) {
    const html = extractHtml(part);
    if (html) return html;
  }
  return "";
}

function toSearchQuery(bookingRef: string) {
  const stripped = bookingRef.replace(/^[A-Z]{2}-/, "");
  return `"${stripped.replace(/"/g, "")}"`;
}

function withPrintScript(html: string) {
  const script = `<script>window.onload=function(){setTimeout(window.print,400)}<\/script>`;
  return html.includes("</body>")
    ? html.replace(/<\/body>/i, `${script}</body>`)
    : html + script;
}

function errorPage(ref: string, reason: string) {
  return `<!DOCTYPE html><html><head><title>Not found</title></head><body style="font-family:sans-serif;padding:40px;color:#333"><h2>Email confirmation not available</h2><p>Booking ref: <strong>${ref}</strong></p><p style="color:#999;font-size:14px">${reason}</p></body></html>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { orderId: orderIdParam } = await params;
  const orderId = parseInt(orderIdParam, 10);
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("booking_ref, account_email, email_html")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (orderError) {
    // email_html column missing — migration not yet run
    if (orderError.message?.includes("email_html")) {
      return new Response(
        errorPage("—", "Run this in your Supabase SQL editor first: ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_html TEXT;"),
        { headers: { "Content-Type": "text/html" } },
      );
    }
    return new Response(errorPage("—", orderError.message), { headers: { "Content-Type": "text/html" } });
  }

  if (!order) return new Response(errorPage("—", `Order #${orderId} not found.`), { status: 404, headers: { "Content-Type": "text/html" } });

  // Serve from database if already stored
  if (order.email_html) {
    return new Response(withPrintScript(order.email_html), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Fallback: fetch live from Gmail
  if (!order.account_email || !order.booking_ref) {
    return new Response(
      errorPage(order.booking_ref ?? "—", "No email stored yet — run a scan first."),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const { data: account } = await supabase
    .from("gmail_accounts")
    .select("access_token, provider")
    .eq("email", order.account_email)
    .eq("is_active", true)
    .maybeSingle();

  if (!account?.access_token) {
    return new Response(
      errorPage(order.booking_ref, "No email stored yet — run a scan to save the confirmation."),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  if (account.provider === "outlook") {
    return new Response(
      errorPage(order.booking_ref, "Outlook email download coming soon — run a scan to cache it."),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const q = toSearchQuery(order.booking_ref);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("maxResults", "5");

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${account.access_token}` },
    cache: "no-store",
  });

  if (!listRes.ok) {
    return new Response(
      errorPage(order.booking_ref, "Could not search Gmail — try scanning again to refresh the token."),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  const messages = listData.messages ?? [];

  if (messages.length === 0) {
    return new Response(
      errorPage(order.booking_ref, "Email not found in Gmail. Run a scan to cache it before it is deleted."),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const msgUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messages[0].id}`);
  msgUrl.searchParams.set("format", "full");
  const msgRes = await fetch(msgUrl.toString(), {
    headers: { Authorization: `Bearer ${account.access_token}` },
    cache: "no-store",
  });

  const msg = (await msgRes.json()) as { payload: Parameters<typeof extractHtml>[0] };
  const html = extractHtml(msg.payload);

  if (!html) {
    return new Response(
      errorPage(order.booking_ref, "Email found but has no printable HTML content."),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  // Save to DB for next time
  await supabase.from("orders").update({ email_html: html }).eq("id", orderId);

  return new Response(withPrintScript(html), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
