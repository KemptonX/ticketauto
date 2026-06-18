import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

const WHOP_API_BASE = process.env.WHOP_API_BASE_URL || "https://api.whop.com/api/v2";
const ALLOWED_STATUSES = new Set(["active", "trialing", "canceling"]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const urlError = searchParams.get("error");
  const next = searchParams.get("next") ?? "/orders";

  if (urlError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(urlError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing-code`);
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

  const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

  if (sessionError || !data.user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(sessionError?.message ?? "auth-failed")}`,
    );
  }

  // Whop membership check — only runs for Discord logins and only if keys are configured
  const apiKey = process.env.WHOP_API_KEY;
  const allowedProductId = process.env.WHOP_ALLOWED_PRODUCT_ID;

  // Comma-separated Discord IDs that bypass the Whop check (for owners/admins who don't have a membership)
  const ownerDiscordIds = new Set(
    (process.env.WHOP_OWNER_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );

  if (apiKey) {
    const discordIdentity = data.user.identities?.find((i) => i.provider === "discord");

    if (discordIdentity) {
      const discordId = discordIdentity.id;

      // Owners bypass the membership check
      if (!ownerDiscordIds.has(discordId)) {
        try {
          const params = new URLSearchParams({ discord_account_id: discordId, status: "active" });
          if (allowedProductId) params.set("product_id", allowedProductId);

          const whopRes = await fetch(`${WHOP_API_BASE}/memberships?${params.toString()}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: "no-store",
          });

          if (!whopRes.ok) {
            await supabase.auth.signOut();
            return NextResponse.redirect(`${origin}/login?error=whop-check-failed`);
          }

          const whopData = (await whopRes.json()) as {
            data?: { id: string; status: string }[];
          };

          const activeMembership = whopData.data?.find((m) => ALLOWED_STATUSES.has(m.status));

          if (!activeMembership) {
            await supabase.auth.signOut();
            return NextResponse.redirect(
              `${origin}/login?error=${encodeURIComponent("No active Whop membership found for this Discord account.")}`,
            );
          }
        } catch {
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${origin}/login?error=${encodeURIComponent("Could not verify Whop membership. Please try again.")}`,
          );
        }
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
