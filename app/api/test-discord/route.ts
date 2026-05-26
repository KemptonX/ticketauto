import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Accept URL from request body (for testing before saving) or fall back to saved URL
  let webhookUrl = "";
  try {
    const body = await request.json() as { webhookUrl?: string };
    if (body.webhookUrl?.startsWith("https://discord.com/api/webhooks/")) {
      webhookUrl = body.webhookUrl;
    }
  } catch { /* no body */ }

  if (!webhookUrl) {
    // Load from DB
    const { data } = await supabase
      .from("user_settings")
      .select("discord_webhook_url")
      .eq("user_id", user.id)
      .single();
    webhookUrl = (data as { discord_webhook_url?: string } | null)?.discord_webhook_url ?? "";
  }

  if (!webhookUrl) {
    return NextResponse.json({ error: "No Discord webhook URL configured" }, { status: 400 });
  }

  const payload = {
    embeds: [{
      title: "✅ TixTracker — Discord Connected",
      description: "Your Discord notifications are working correctly. You will receive unsold ticket alerts at **7 days**, **3 days**, **2 days**, and **1 day** before the event.",
      color: 0x9B5CFF,
      fields: [
        { name: "Alert Types", value: "⚠️ 7 days · 🔶 3 days · 🚨 2 days · 🔴 1 day", inline: false },
        { name: "Schedule",    value: "Checks run daily at 09:00 UTC", inline: false },
      ],
      footer: { text: "TixTracker · Unsold Alerts" },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Discord returned ${res.status}: ${text.slice(0, 200)}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
