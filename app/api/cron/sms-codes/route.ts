import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential } from "@/src/lib/marketplace/encryption";

export const runtime = "nodejs";

// This endpoint is deliberately NOT a Vercel cron entry — verification
// codes need to be delivered within seconds, and Vercel's own scheduler on
// this project's plan only runs once a day (and even on a paid plan, no
// finer than once a minute). Instead, the always-on Railway worker
// (worker/src/index.ts, startSmsPollLoop) hits this URL every ~3 seconds.
// A free external scheduler (e.g. cron-job.org) can be used as a fallback,
// but its minimum interval is 60s — confirmed directly, not assumed — so
// it's far slower on its own; claimAccount() below makes it safe to run
// both at once without duplicate Discord sends if one is left on. Secured
// by its own dedicated secret (SMS_POLL_SECRET) — intentionally separate
// from CRON_SECRET, since this one is shared with a process outside
// Vercel entirely.

type SmsPassAccount = {
  id: number;
  user_id: string;
  api_key_encrypted: string;
  discord_webhook_url: string | null;
  last_seen_at: string | null;
  recent_signatures: string[];
  last_polled_at: string | null;
};

type SmsMessage = {
  from: string;
  to: string;
  message: string;
  timestamp: string;
};

// Claim window: an in-flight claim on a row is considered valid for this
// long before another invocation is allowed to re-claim it (safety net in
// case a previous invocation crashed mid-cycle and never released it).
// This is NOT the primary duplicate-prevention mechanism — see claimAccount
// below for that. It only needs to outlast one real poll cycle
// (SMSPass fetch + Discord posts), not match the poll interval.
const CLAIM_WINDOW_SECONDS = 10;

function fingerprint(m: SmsMessage): string {
  return `${m.from}|${m.to}|${m.message}|${m.timestamp}`;
}

// Best-effort pull-out of the verification code itself (most of these
// messages are "123456 is your X code" or similar) so Discord can show it
// prominently — falls back to just showing the full message if no clear
// numeric code is found.
function extractCode(message: string): string | null {
  const match = message.match(/\b(\d{4,8})\b/);
  return match ? match[1] : null;
}

// Atomically claims a row for processing: the UPDATE only succeeds (and
// returns a row) if last_polled_at is null or older than the claim window
// AT THE MOMENT POSTGRES EXECUTES THE WRITE — not at the moment we read it
// earlier. This closes the race the previous read-then-write-separately
// approach had: if two invocations overlap (e.g. a leftover external
// scheduler poll landing at the same moment as the worker's tight loop),
// only the first one's UPDATE can match the WHERE condition: the instant
// it commits, last_polled_at is bumped forward, so the second invocation's
// UPDATE finds no matching row and gets nothing back — it skips this
// account entirely rather than both proceeding to fetch the same new SMS
// and both forwarding it to Discord.
async function claimAccount(
  supabase: SupabaseClient,
  accountId: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - CLAIM_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("sms_pass_accounts")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", accountId)
    .or(`last_polled_at.is.null,last_polled_at.lt.${cutoff}`)
    .select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}

async function sendDiscordEmbed(webhookUrl: string, m: SmsMessage): Promise<void> {
  const code = extractCode(m.message);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: code ? `📩 Code: ${code}` : "📩 New SMS Received",
        description: m.message,
        color: 0x4FC3FF,
        fields: [
          { name: "From", value: m.from || "Unknown", inline: true },
          { name: "To", value: m.to || "Unknown", inline: true },
        ],
        footer: { text: "TixTracker · SMS Codes" },
        timestamp: m.timestamp,
      }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secretParam = request.nextUrl.searchParams.get("secret");
  const expected = process.env.SMS_POLL_SECRET;

  if (!expected || (authHeader !== `Bearer ${expected}` && secretParam !== expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: accounts, error: accountsError } = await supabase
    .from("sms_pass_accounts")
    .select("id, user_id, api_key_encrypted, discord_webhook_url, last_seen_at, recent_signatures, last_polled_at")
    .eq("is_active", true);

  if (accountsError) {
    return NextResponse.json({ ok: true, skipped: true, reason: accountsError.message });
  }
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "No active SMSPass accounts configured" });
  }

  let usersChecked = 0;
  let totalForwarded = 0;
  const errors: string[] = [];

  for (const account of accounts as SmsPassAccount[]) {
    const claimed = await claimAccount(supabase, account.id);
    if (!claimed) continue; // another invocation is already processing (or just processed) this account

    usersChecked += 1;
    const userTag = account.user_id.slice(0, 8);

    let apiKey: string;
    try {
      apiKey = decryptCredential(account.api_key_encrypted);
    } catch {
      errors.push(`${userTag}: could not decrypt stored API key`);
      continue;
    }

    const isFirstPoll = !account.last_seen_at;
    const url = new URL("https://api.smspass.io/getSMS");
    url.searchParams.set("APIKEY", apiKey);
    if (!isFirstPoll) {
      url.searchParams.set("timestamp", account.last_seen_at!);
    }
    // First-ever poll: deliberately no `all`/`timestamp` param — this uses
    // SMSPass's default (messages from the last 5 minutes only), so turning
    // the feature on doesn't dump a user's entire historic SMS inbox into
    // Discord at once.

    let messages: SmsMessage[] = [];
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      if (Array.isArray(json)) messages = json as SmsMessage[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${userTag}: SMSPass fetch failed — ${msg}`);
      await supabase.from("sms_pass_accounts").update({ last_polled_at: new Date().toISOString(), last_error: msg }).eq("id", account.id);
      continue;
    }

    // Defensive filtering even though the `timestamp` param should already
    // exclude these: never trust an external API's boundary semantics
    // completely, and recent_signatures catches exact-timestamp collisions.
    const lastSeenMs = account.last_seen_at ? new Date(account.last_seen_at).getTime() : 0;
    const knownSignatures = new Set(account.recent_signatures ?? []);
    const newMessages = messages
      .filter((m) => {
        const t = new Date(m.timestamp).getTime();
        if (isNaN(t) || t < lastSeenMs) return false;
        if (t === lastSeenMs && knownSignatures.has(fingerprint(m))) return false;
        return true;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let webhookUrl = account.discord_webhook_url;
    if (!webhookUrl) {
      const { data: userSettings } = await supabase
        .from("user_settings")
        .select("discord_webhook_url")
        .eq("user_id", account.user_id)
        .maybeSingle();
      webhookUrl = (userSettings as { discord_webhook_url?: string } | null)?.discord_webhook_url ?? null;
    }

    let forwardError: string | null = null;
    if (newMessages.length > 0) {
      if (webhookUrl) {
        for (const m of newMessages) {
          try {
            await sendDiscordEmbed(webhookUrl, m);
            totalForwarded += 1;
          } catch (err) {
            forwardError = err instanceof Error ? err.message : "Unknown Discord error";
            errors.push(`${userTag}: ${forwardError}`);
            break; // stop forwarding further messages for this user this cycle; cursor still advances below
          }
        }
      } else {
        forwardError = "New SMS received but no Discord webhook is configured";
        errors.push(`${userTag}: ${forwardError}`);
      }
    }

    // Advance the cursor to the newest message seen this cycle regardless
    // of whether forwarding succeeded, so a persistently-broken webhook
    // doesn't cause the same messages to be retried forever — the error is
    // surfaced via last_error instead.
    const maxTimestamp = messages.reduce<string | null>((max, m) => {
      const t = new Date(m.timestamp).getTime();
      if (isNaN(t)) return max;
      return !max || t > new Date(max).getTime() ? m.timestamp : max;
    }, account.last_seen_at);

    const newSignatures = messages
      .filter((m) => m.timestamp === maxTimestamp)
      .map(fingerprint)
      .slice(0, 20);

    await supabase.from("sms_pass_accounts").update({
      last_seen_at: maxTimestamp ?? (isFirstPoll ? new Date().toISOString() : account.last_seen_at),
      recent_signatures: newSignatures,
      last_polled_at: new Date().toISOString(),
      last_error: forwardError,
    }).eq("id", account.id);
  }

  return NextResponse.json({ ok: true, usersChecked, totalForwarded, errors });
}
