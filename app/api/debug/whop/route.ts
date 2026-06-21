import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

// Temporary diagnostic endpoint — owner only
const OWNER_IDS = new Set(
  (process.env.WHOP_OWNER_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Only the owner can call this
  const discordIdentity = user.identities?.find((i) => i.provider === "discord");
  const callerId =
    (discordIdentity?.identity_data?.sub as string | undefined) ??
    (discordIdentity?.identity_data?.provider_id as string | undefined) ??
    discordIdentity?.id;
  if (!callerId || !OWNER_IDS.has(callerId)) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const discordId = searchParams.get("discord_id") ?? "1517294280513683481";
  const apiKey = process.env.WHOP_API_KEY!;
  const allowedProductId = process.env.WHOP_ALLOWED_PRODUCT_ID;

  const url = `https://api.whop.com/api/v2/memberships?discord_account_id=${discordId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  const raw = await res.json();

  return NextResponse.json({
    discord_id: discordId,
    whop_status: res.status,
    allowed_product_id: allowedProductId ?? "NOT SET",
    memberships: raw,
  });
}
