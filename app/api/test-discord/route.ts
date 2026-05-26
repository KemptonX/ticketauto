import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "DISCORD_WEBHOOK_URL is not set in environment variables" }, { status: 400 });
  }

  // Allow client to override with a custom URL for testing before it's saved to env
  let targetUrl = webhookUrl;
  try {
    const body = await request.json() as { webhookUrl?: string };
    if (body.webhookUrl && body.webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      targetUrl = body.webhookUrl;
    }
  } catch { /* use env var */ }

  const payload = {
    embeds: [{
      title: "✅ TixTracker — Discord Connected",
      description: "Your Discord notifications are working correctly. You will receive unsold ticket alerts at **7 days**, **3 days**, **2 days**, and **1 day** before the event.",
      color: 0x9B5CFF,
      fields: [
        { name: "Alert Types", value: "⚠️ 7 days · 🔶 3 days · 🚨 2 days · 🔴 1 day", inline: false },
        { name: "Schedule", value: "Checks run daily at 09:00 UTC", inline: false },
      ],
      footer: { text: "TixTracker · Unsold Alerts" },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Discord returned ${res.status}: ${text}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
