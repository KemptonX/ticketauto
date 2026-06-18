import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

const WHOP_API_BASE = process.env.WHOP_API_BASE_URL ?? "https://api.whop.com/api/v2";
const ALLOWED_STATUSES = new Set(["active", "trialing", "canceling"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const urlError = searchParams.get("error");

  if (urlError) {
    return NextResponse.redirect(
      `https://tixtracker.app/login?error=${encodeURIComponent(urlError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect("https://tixtracker.app/login?error=no-code");
  }

  const cookieStore = await cookies();

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

  // Whop membership check for Discord logins
  const apiKey = process.env.WHOP_API_KEY;
  if (apiKey) {
    const discordIdentity = data.user.identities?.find((i) => i.provider === "discord");
    const ownerIds = new Set(
      (process.env.WHOP_OWNER_DISCORD_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

    // identity_data.sub is the actual Discord snowflake; identity.id may be a Supabase UUID
    const discordId =
      (discordIdentity?.identity_data?.sub as string | undefined) ??
      (discordIdentity?.identity_data?.provider_id as string | undefined) ??
      discordIdentity?.id;

    if (discordIdentity && discordId && !ownerIds.has(discordId)) {
      const allowedProductId = process.env.WHOP_ALLOWED_PRODUCT_ID;
      try {
        const params = new URLSearchParams({ discord_account_id: discordId });
        if (allowedProductId) params.set("product_id", allowedProductId);

        const whopUrl = `${WHOP_API_BASE}/memberships?${params.toString()}`;
        const whopRes = await fetch(whopUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
        });

        const whopBody = await whopRes.text();
        console.log("[whop-check] discord_id=%s url=%s status=%d body=%s", discordId, whopUrl, whopRes.status, whopBody);

        if (!whopRes.ok) {
          await supabase.auth.signOut();
          return NextResponse.redirect("https://tixtracker.app/login?error=whop-check-failed");
        }

        const whopData = JSON.parse(whopBody) as {
          data?: { id: string; status: string }[];
        };

        const activeMembership = whopData.data?.find((m) => ALLOWED_STATUSES.has(m.status));

        if (!activeMembership) {
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `https://tixtracker.app/login?error=${encodeURIComponent(
              "No active Whop membership found for this Discord account.",
            )}`,
          );
        }
      } catch {
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `https://tixtracker.app/login?error=${encodeURIComponent(
            "Could not verify Whop membership. Please try again.",
          )}`,
        );
      }
    }
  }

  return NextResponse.redirect("https://tixtracker.app/dashboard");
}
