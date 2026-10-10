import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { encryptCredential, encryptionKeyConfigured } from "@/src/lib/marketplace/encryption";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("sms_pass_accounts")
    .select("api_key_encrypted, discord_webhook_url, is_active, last_seen_at, last_polled_at, last_error")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Never return the encrypted key itself — only whether one is configured.
  return NextResponse.json({
    configured: !!data?.api_key_encrypted,
    discordWebhookUrl: data?.discord_webhook_url ?? "",
    isActive: data?.is_active ?? false,
    lastSeenAt: data?.last_seen_at ?? null,
    lastPolledAt: data?.last_polled_at ?? null,
    lastError: data?.last_error ?? null,
  });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!encryptionKeyConfigured()) {
    return NextResponse.json({ error: "Server encryption key is not configured — contact support" }, { status: 500 });
  }

  const body = (await request.json()) as { apiKey?: string; discordWebhookUrl?: string; isActive?: boolean };
  // Defensive: SMSPass's own docs/UI show the key embedded in a full URL
  // (https://api.smspass.io/getSMS?APIKEY=xxx), so pasting the whole URL
  // instead of just the key is an easy, likely mistake — extract the bare
  // value if that shape is detected, rather than silently storing (and
  // later failing to authenticate with) a garbled key.
  const rawApiKey = body.apiKey?.trim();
  const urlMatch = rawApiKey?.match(/APIKEY=([^&\s]+)/i);
  const apiKey = urlMatch ? decodeURIComponent(urlMatch[1]) : rawApiKey;
  const discordWebhookUrl = body.discordWebhookUrl?.trim() || null;

  if (discordWebhookUrl && !discordWebhookUrl.startsWith("https://discord.com/api/webhooks/")) {
    return NextResponse.json({ error: "Discord webhook URL looks invalid" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    user_id: user.id,
    discord_webhook_url: discordWebhookUrl,
    is_active: body.isActive ?? true,
    updated_at: new Date().toISOString(),
  };

  // Only overwrite the stored key if a new non-empty one was actually
  // submitted — lets the user update the webhook/active toggle alone
  // without having to re-paste their API key every time.
  if (apiKey) {
    update.api_key_encrypted = encryptCredential(apiKey);
    // A fresh key means a fresh account's SMS history is unknown — reset
    // the dedupe cursor so the next poll seeds from "now" rather than
    // reusing a cursor that belonged to a different key.
    update.last_seen_at = null;
    update.recent_signatures = [];
    update.last_error = null;
  }

  const { error } = await supabase.from("sms_pass_accounts").upsert(update, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await supabase.from("sms_pass_accounts").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
