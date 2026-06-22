import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

const WHOP_API_BASE = process.env.WHOP_API_BASE_URL ?? "https://api.whop.com/api/v2";
// Free Whop products may return "completed" instead of "active"/"trialing".
// Also accept past_due/pastDue so payment-grace members aren't locked out.
const ALLOWED_STATUSES = new Set([
  "active",
  "trialing",
  "completed",
  "canceling",
  "past_due",
  "pastDue",
]);

type WhopMembership = {
  id: string;
  product?: string;   // Whop API v2 uses "product" not "product_id"
  status: string;
  valid?: boolean;
  email?: string;
  discord?: { id?: string; username?: string } | null;
  [key: string]: unknown;
};

async function fetchWhopMemberships(
  params: URLSearchParams,
  apiKey: string,
): Promise<WhopMembership[]> {
  const url = `${WHOP_API_BASE}/memberships?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  const raw = await res.text();
  console.log("[whop] GET %s → %d | %s", url, res.status, raw.slice(0, 3000));
  if (!res.ok) return [];
  const parsed = JSON.parse(raw) as { data?: WhopMembership[] };
  return parsed.data ?? [];
}

// Whop API v2 returns all company memberships regardless of query params,
// so we must filter locally by identity (discordId or email) and product.
function pickActiveMembership(
  memberships: WhopMembership[],
  allowedProductIds: Set<string>,
  identity?: { discordId?: string; email?: string },
): WhopMembership | undefined {
  memberships.forEach((m) =>
    console.log(
      "[whop] membership id=%s product=%s status=%s valid=%s email=%s discord_id=%s",
      m.id,
      m.product,
      m.status,
      m.valid,
      m.email,
      m.discord?.id ?? "none",
    ),
  );
  return memberships.find((m) => {
    // Ensure membership belongs to this user
    if (identity?.discordId && m.discord?.id !== identity.discordId) return false;
    if (identity?.email && !identity.discordId && m.email !== identity.email) return false;
    const productMatch = allowedProductIds.size === 0 || allowedProductIds.has(m.product ?? "");
    const accessOk = m.valid === true || ALLOWED_STATUSES.has(m.status);
    return productMatch && accessOk;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const urlError = searchParams.get("error");
  // mode=link means an existing user is linking their Discord — skip Whop check
  const isLinkMode = searchParams.get("mode") === "link";
  const next = searchParams.get("next") ?? "/settings?tab=connections";

  if (urlError) {
    return NextResponse.redirect(
      `https://tixtracker.app/login?error=${encodeURIComponent(urlError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect("https://tixtracker.app/login?error=no-code");
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  console.log("[auth/callback] incoming cookie names:", allCookies.map((c) => c.name));
  const pkce = allCookies.find((c) => c.name.includes("code-verifier"));
  console.log("[auth/callback] pkce cookie present:", !!pkce, pkce?.name);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !data.user) {
    return NextResponse.redirect(
      `https://tixtracker.app/login?error=${encodeURIComponent(
        exchangeError?.message ?? "auth-failed",
      )}`,
    );
  }

  // Linking flow: user already has a valid session and is just adding Discord identity
  if (isLinkMode) {
    return NextResponse.redirect(`https://tixtracker.app/${next.replace(/^\//, "")}?linked=true`);
  }

  const apiKey = process.env.WHOP_API_KEY;
  if (apiKey) {
    const discordIdentity = data.user.identities?.find((i) => i.provider === "discord");

    // identity_data.sub / provider_id is the actual Discord snowflake;
    // identity.id may be a Supabase-internal UUID in newer projects
    const discordId =
      (discordIdentity?.identity_data?.sub as string | undefined) ??
      (discordIdentity?.identity_data?.provider_id as string | undefined) ??
      discordIdentity?.id;

    const userEmail = data.user.email;

    console.log(
      "[auth] supabase discord_id=%s email=%s WHOP_ALLOWED_PRODUCT_ID=%s",
      discordId,
      userEmail,
      process.env.WHOP_ALLOWED_PRODUCT_ID ?? "not-set",
    );

    const ownerIds = new Set(
      (process.env.WHOP_OWNER_DISCORD_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

    // Comma-separated product IDs — supports old + new products simultaneously
    const allowedProductIds = new Set(
      (process.env.WHOP_ALLOWED_PRODUCT_ID ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

    const isOwner = !!discordId && ownerIds.has(discordId);
    console.log("[auth] owner_bypass=%s allowed_products=%s", isOwner, [...allowedProductIds].join(","));

    if (discordIdentity && !isOwner) {
      let activeMembership: WhopMembership | undefined;

      // 1. Primary: match by Discord account ID (API returns all company memberships,
      //    so we filter locally by discordId to match only this user's memberships)
      if (discordId) {
        const memberships = await fetchWhopMemberships(
          new URLSearchParams({ discord_account_id: discordId }),
          apiKey,
        );
        activeMembership = pickActiveMembership(memberships, allowedProductIds, { discordId });
      }

      // 2. Fallback: match by email (catches Whop accounts with Discord not linked)
      if (!activeMembership && userEmail) {
        console.log("[auth] discord lookup found nothing — trying email fallback email=%s", userEmail);
        const memberships = await fetchWhopMemberships(
          new URLSearchParams({ email: userEmail }),
          apiKey,
        );
        activeMembership = pickActiveMembership(memberships, allowedProductIds, { email: userEmail });
        if (activeMembership) {
          console.log("[auth] matched via email fallback membership=%s", activeMembership.id);
        }
      }

      if (!activeMembership) {
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `https://tixtracker.app/login?error=${encodeURIComponent(
            "No active TixTracker Whop membership found. Make sure you joined the TixTracker Whop product and connected the same Discord account to Whop.",
          )}`,
        );
      }
    }
  }

  return NextResponse.redirect(`https://tixtracker.app/dashboard`);
}
