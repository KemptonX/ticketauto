import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

const WHOP_API_BASE = process.env.WHOP_API_BASE_URL || "https://api.whop.com/api/v2";
const ALLOWED_STATUSES = new Set([
  "active", "trialing", "completed", "canceling", "past_due", "pastDue",
]);

export async function POST() {
  const apiKey = process.env.WHOP_API_KEY;

  // No Whop key configured — allow through
  if (!apiKey) return NextResponse.json({ ok: true });

  const allowedIds = new Set(
    (process.env.WHOP_ALLOWED_PRODUCT_ID ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const ownerIds = new Set(
    (process.env.WHOP_OWNER_DISCORD_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const discordIdentity = user.identities?.find((i) => i.provider === "discord");

  // Not a Discord login — allow through
  if (!discordIdentity) return NextResponse.json({ ok: true });

  const discordId = discordIdentity.id;

  // Owner bypass
  if (ownerIds.has(discordId)) return NextResponse.json({ ok: true });

  try {
    const params = new URLSearchParams({ discord_account_id: discordId });

    const whopRes = await fetch(`${WHOP_API_BASE}/memberships?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });

    if (!whopRes.ok) {
      return NextResponse.json({ error: "Could not verify Whop membership" }, { status: 502 });
    }

    const whopData = (await whopRes.json()) as {
      data?: { id: string; status: string; valid?: boolean; product?: string; plan?: string }[];
    };

    const active = whopData.data?.find((m) => {
      const planId = String(m.plan ?? "");
      const productMatch =
        allowedIds.size === 0 ||
        allowedIds.has(m.product ?? "") ||
        allowedIds.has(planId);
      const accessOk = m.valid === true || ALLOWED_STATUSES.has(m.status);
      return productMatch && accessOk;
    });

    if (!active) {
      return NextResponse.json(
        { error: "No active Whop membership found for this Discord account." },
        { status: 403 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not verify Whop membership. Please try again." },
      { status: 502 },
    );
  }
}
