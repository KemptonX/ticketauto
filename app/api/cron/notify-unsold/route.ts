import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Order = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  listing_status: string | null;
  account_email: string | null;
};

type UserSetting = {
  user_id: string;
  discord_webhook_url: string;
};

type Threshold = {
  days: number;
  label: string;
  emoji: string;
  color: number;
};

const THRESHOLDS: Threshold[] = [
  { days: 7, label: "7 Days Left to Sell", emoji: "⚠️",  color: 0xFFB84F },
  { days: 3, label: "3 Days Left to Sell", emoji: "🔶", color: 0xFF7D2C },
  { days: 2, label: "2 Days Left to Sell", emoji: "🚨", color: 0xFF4500 },
  { days: 1, label: "1 Day Left to Sell",  emoji: "🔴", color: 0xFF2244 },
];

function parseAnyDate(value: string | null): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (match) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.indexOf(match[2].slice(0, 3).toLowerCase());
    if (idx !== -1) {
      const date = new Date(Number(match[3]), idx, Number(match[1]));
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }
  return null;
}

function fmtCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "Listed":            return "🟢 Listed";
    case "Unlisted":          return "⚪ Unlisted";
    case "Partially Sold":    return "🟡 Partially Sold";
    case "Problem / Missing": return "❌ Problem";
    default: return status ?? "Unknown";
  }
}

async function sendDiscordMessage(webhookUrl: string, body: unknown): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text.slice(0, 200)}`);
  }
}

function buildEmbed(threshold: Threshold, orders: Order[], targetDate: Date) {
  const dateStr = targetDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const totalQty = orders.reduce((s, o) => s + (o.qty_bought ?? 1), 0);
  const totalCost = orders.reduce((s, o) => s + (o.total_cost ?? 0), 0);

  const description =
    `**${orders.length} event${orders.length !== 1 ? "s" : ""} · ${totalQty} ticket${totalQty !== 1 ? "s" : ""} · ${fmtCurrency(totalCost)} at risk**\n` +
    `Event date: ${dateStr}`;

  const displayOrders = orders.slice(0, 20);
  const fields = displayOrders.map((o) => ({
    name: `🎫 ${o.event_name ?? "Untitled"}${o.venue ? ` — ${o.venue}` : ""}`.slice(0, 256),
    value: [
      `${o.qty_bought ?? 1} ticket${(o.qty_bought ?? 1) !== 1 ? "s" : ""} · Cost: ${fmtCurrency(o.total_cost)}`,
      statusLabel(o.listing_status),
      o.account_email ? `📧 ${o.account_email}` : null,
    ].filter(Boolean).join("\n"),
    inline: false,
  }));

  if (orders.length > 20) {
    fields.push({ name: "…and more", value: `${orders.length - 20} more events not shown`, inline: false });
  }

  return {
    title: `${threshold.emoji} ${threshold.label}`,
    description,
    color: threshold.color,
    fields,
    footer: { text: "TixTracker · Unsold Alerts" },
    timestamp: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Fetch all users who have a Discord webhook configured
  const { data: userSettings, error: settingsError } = await supabase
    .from("user_settings")
    .select("user_id, discord_webhook_url")
    .not("discord_webhook_url", "is", null)
    .neq("discord_webhook_url", "");

  if (settingsError) {
    // Table may not exist yet — exit cleanly
    return NextResponse.json({ ok: true, skipped: true, reason: settingsError.message });
  }

  if (!userSettings || userSettings.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "No users have Discord webhooks configured" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalNotified = 0;
  const errors: string[] = [];

  for (const setting of userSettings as UserSetting[]) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, event_name, venue, event_date, qty_bought, total_cost, listing_status, account_email")
      .eq("user_id", setting.user_id)
      .not("listing_status", "in", '("Sold","Archived","Ignored","Personal")');

    if (ordersError || !orders) continue;

    for (const threshold of THRESHOLDS) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + threshold.days);
      targetDate.setHours(0, 0, 0, 0);

      const matching = (orders as Order[]).filter((o) => {
        const d = parseAnyDate(o.event_date);
        return d !== null && d.getTime() === targetDate.getTime();
      });

      if (matching.length === 0) continue;

      try {
        const embed = buildEmbed(threshold, matching, targetDate);
        await sendDiscordMessage(setting.discord_webhook_url, { embeds: [embed] });
        totalNotified += matching.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`user ${setting.user_id.slice(0, 8)} ${threshold.days}d: ${msg}`);
      }
    }
  }

  return NextResponse.json({ ok: true, usersNotified: userSettings.length, totalNotified, errors });
}
