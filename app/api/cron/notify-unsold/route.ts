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

function formatDate(value: string | null): string {
  const d = parseAnyDate(value);
  if (!d) return value ?? "Unknown date";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "Listed":         return "🟢 Listed";
    case "Unlisted":       return "⚪ Unlisted";
    case "Partially Sold": return "🟡 Partially Sold";
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
    throw new Error(`Discord webhook failed ${res.status}: ${text}`);
  }
}

function buildEmbed(threshold: Threshold, orders: Order[], targetDate: Date) {
  const dateStr = targetDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const totalQty = orders.reduce((s, o) => s + (o.qty_bought ?? 1), 0);
  const totalCost = orders.reduce((s, o) => s + (o.total_cost ?? 0), 0);

  const description =
    `**${orders.length} event${orders.length !== 1 ? "s" : ""} · ${totalQty} ticket${totalQty !== 1 ? "s" : ""} · ${formatCurrency(totalCost)} at risk**\n` +
    `Event date: ${dateStr}`;

  // Discord embeds: max 25 fields, 1024 chars per value
  const displayOrders = orders.slice(0, 20);
  const fields = displayOrders.map((o) => ({
    name: `🎫 ${o.event_name ?? "Untitled"} ${o.venue ? `— ${o.venue}` : ""}`.slice(0, 256),
    value: [
      `${o.qty_bought ?? 1} ticket${(o.qty_bought ?? 1) !== 1 ? "s" : ""} · Cost: ${formatCurrency(o.total_cost)}`,
      `${statusLabel(o.listing_status)}`,
      o.account_email ? `📧 ${o.account_email}` : null,
    ].filter(Boolean).join("\n"),
    inline: false,
  }));

  if (orders.length > 20) {
    fields.push({
      name: "…and more",
      value: `${orders.length - 20} more event${orders.length - 20 !== 1 ? "s" : ""} not shown`,
      inline: false,
    });
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

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ ok: true, skipped: true, reason: "DISCORD_WEBHOOK_URL not set" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, event_name, venue, event_date, qty_bought, total_cost, listing_status, account_email")
    .not("listing_status", "in", '("Sold","Archived","Ignored","Personal")');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const summary: Record<string, number> = {};
  const errors: string[] = [];
  let totalNotified = 0;

  for (const threshold of THRESHOLDS) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + threshold.days);
    targetDate.setHours(0, 0, 0, 0);

    const matching = (orders as Order[]).filter((o) => {
      const d = parseAnyDate(o.event_date);
      return d !== null && d.getTime() === targetDate.getTime();
    });

    if (matching.length === 0) {
      summary[`${threshold.days}d`] = 0;
      continue;
    }

    try {
      const embed = buildEmbed(threshold, matching, targetDate);
      await sendDiscordMessage(webhookUrl, { embeds: [embed] });
      summary[`${threshold.days}d`] = matching.length;
      totalNotified += matching.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${threshold.days}d: ${msg}`);
      summary[`${threshold.days}d`] = 0;
    }
  }

  return NextResponse.json({ ok: true, totalNotified, summary, errors });
}
