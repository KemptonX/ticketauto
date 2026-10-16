import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkWhopMembership, upsertEntitlement } from "@/src/lib/whop-entitlement";

export const runtime = "nodejs";
// PERF-002 fix — see app/api/cron/scan/route.ts for the full reasoning.
export const maxDuration = 60;

// SEC-001 remediation: the periodic re-check that was previously entirely
// missing. Whop membership was only ever checked once, inline in the OAuth
// callback, at login — this is what actually detects a later cancellation
// instead of a user keeping access for as long as their session happens
// to stay alive. Every Discord-login user gets a row in whop_entitlements
// at their first login (app/auth/callback/route.ts); this route re-checks
// every existing row on vercel.json's schedule (currently once daily —
// RECHECK_INTERVAL_HOURS in src/lib/whop-entitlement.ts documents the
// actual cadence and why it isn't the originally-intended 6 hours: this
// Vercel account is on the Hobby plan, which only permits daily crons).

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: true, reason: "WHOP_API_KEY not set — nothing to check against" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const ownerIds = new Set((process.env.WHOP_OWNER_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const allowedProductIds = new Set((process.env.WHOP_ALLOWED_PRODUCT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  const { data: rows, error } = await supabase
    .from("whop_entitlements")
    .select("user_id, discord_id, status");
  if (error) {
    return NextResponse.json({ ok: true, skipped: true, reason: error.message });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "No entitlement rows to refresh yet" });
  }

  let checked = 0, revoked = 0, restored = 0, failed = 0;
  const errors: string[] = [];

  for (const row of rows as { user_id: string; discord_id: string | null; status: string }[]) {
    if (row.status === "owner_bypass") continue; // owners never re-checked against Whop

    checked += 1;
    const isOwner = row.discord_id && ownerIds.has(row.discord_id);
    if (isOwner) continue;

    // Need the user's email for the fallback-match path — not stored on
    // whop_entitlements itself (deliberately minimal — no need to
    // duplicate auth.users' own data), so look it up only when needed.
    const { data: userRes } = await supabase.auth.admin.getUserById(row.user_id);
    const email: string | undefined = userRes?.user?.email ?? undefined;

    const result = await checkWhopMembership({ discordId: row.discord_id ?? undefined, email }, apiKey, allowedProductIds);

    if (!result.ok) {
      failed += 1;
      errors.push(`${row.user_id.slice(0, 8)}: ${result.error}`);
    } else if (!result.isEntitled) {
      revoked += 1;
    }

    const { data: before } = await supabase.from("whop_entitlements").select("is_entitled").eq("user_id", row.user_id).maybeSingle();
    await upsertEntitlement(supabase, row.user_id, row.discord_id, result);
    if (before && !before.is_entitled && result.ok && result.isEntitled) restored += 1;
  }

  return NextResponse.json({ ok: true, checked, revoked, restored, failed, errors });
}
