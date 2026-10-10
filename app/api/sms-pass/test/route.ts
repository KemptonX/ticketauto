import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { decryptCredential } from "@/src/lib/marketplace/encryption";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: smsRow } = await supabase
    .from("sms_pass_accounts")
    .select("api_key_encrypted, discord_webhook_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!smsRow?.api_key_encrypted) {
    return NextResponse.json({ error: "Save your SMSPass API key first" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = decryptCredential(smsRow.api_key_encrypted);
  } catch {
    return NextResponse.json({ error: "Could not decrypt the stored API key — try saving it again" }, { status: 500 });
  }

  // Validate the key against SMSPass itself first.
  let numbers: string[] = [];
  try {
    const res = await fetch(`https://api.smspass.io/getNumbers?APIKEY=${encodeURIComponent(apiKey)}`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `SMSPass rejected the request (HTTP ${res.status}) — check the API key` }, { status: 400 });
    }
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) numbers = json as string[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not reach SMSPass: ${msg}` }, { status: 502 });
  }

  // Then confirm Discord delivery (webhook override, else the account's main webhook).
  let webhookUrl = smsRow.discord_webhook_url as string | null;
  if (!webhookUrl) {
    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("discord_webhook_url")
      .eq("user_id", user.id)
      .maybeSingle();
    webhookUrl = (userSettings as { discord_webhook_url?: string } | null)?.discord_webhook_url ?? null;
  }

  if (!webhookUrl) {
    return NextResponse.json({
      ok: true,
      numbersFound: numbers.length,
      warning: "API key is valid, but no Discord webhook is configured (set one here or on the main Discord webhook section above).",
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "✅ SMS Code Forwarding Connected",
          description: numbers.length > 0
            ? `Your SMSPass API key is valid. Monitoring **${numbers.length}** number${numbers.length === 1 ? "" : "s"} for new codes.`
            : "Your SMSPass API key is valid. No numbers are currently allocated to it yet.",
          color: 0x9B5CFF,
          footer: { text: "TixTracker · SMS Codes" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `API key is valid, but Discord rejected the test message (HTTP ${res.status}): ${text.slice(0, 200)}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `API key is valid, but could not reach Discord: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, numbersFound: numbers.length });
}
