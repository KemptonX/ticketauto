import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { checkWhopMembership, upsertEntitlement } from "@/src/lib/whop-entitlement";

export const runtime = "nodejs";

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

  // Our /api/auth/discord route stores the PKCE verifier directly in "pkce_verifier"
  // (bypassing @supabase/ssr's broken base64 cookie path). Inject it as the
  // synthetic code-verifier cookie that @supabase/ssr's exchangeCodeForSession expects.
  const ownVerifier = cookieStore.get("pkce_verifier")?.value ?? null;
  const supabaseRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const codeVerifierKey = `sb-${supabaseRef}-auth-token-code-verifier`;

  // Collect all cookies that auth operations write, so we can attach them
  // directly to the redirect response. cookieStore.set() alone is NOT carried
  // into NextResponse.redirect() — those are separate response objects.
  const outgoing: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const base = cookieStore.getAll().filter((c) => c.name !== codeVerifierKey);
          if (ownVerifier) {
            // JSON.stringify so getItemAsync can JSON.parse it back to the raw string
            base.push({ name: codeVerifierKey, value: JSON.stringify(ownVerifier) });
          }
          return base;
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Also write to cookieStore so in-request reads see the new values
            try { cookieStore.set(name, value, options); } catch { /* read-only guard */ }
            outgoing.push({ name, value, options: (options ?? {}) as Record<string, unknown> });
          });
        },
      },
    },
  );

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !data.user) {
    return NextResponse.redirect(
      `https://tixtracker.app/login?error=${encodeURIComponent(exchangeError?.message ?? "auth-failed")}`,
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
      const result = await checkWhopMembership({ discordId, email: userEmail ?? undefined }, apiKey, allowedProductIds);

      if (!result.ok || !result.isEntitled) {
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `https://tixtracker.app/login?error=${encodeURIComponent(
            "No active TixTracker Whop membership found. Make sure you joined the TixTracker Whop product and connected the same Discord account to Whop.",
          )}`,
        );
      }

      // Persist the result — this is the fix for SEC-001: previously this
      // check ran once, here, and was never looked at again. Now it's
      // stored, and app/api/cron/whop-refresh/route.ts re-checks it
      // periodically so a later cancellation is actually detected instead
      // of the user keeping access for as long as their session happens
      // to stay alive. Uses the service-role key since the authenticated
      // `supabase` client above doesn't have INSERT/UPDATE rights on this
      // table by design (see migration 0006's RLS policy).
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const serviceClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
        await upsertEntitlement(serviceClient, data.user.id, discordId ?? null, result);
      }
    } else if (isOwner && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Owners bypass the Whop check entirely but still get a row, so the
      // enforcement layer (middleware/page checks) has one consistent
      // thing to read rather than special-casing "no row at all".
      const serviceClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await upsertEntitlement(serviceClient, data.user.id, discordId ?? null, { ok: true, isEntitled: true, status: "owner_bypass", membershipId: null });
    }
  }

  // Redirect directly to www so cookies set by this handler (origin: tixtracker.app/auth/callback)
  // aren't dropped by a subsequent Vercel CDN redirect from tixtracker.app → www.tixtracker.app.
  // Explicitly copy session cookies onto the response — cookieStore.set() doesn't carry into
  // NextResponse.redirect() because they are separate response objects in Next.js.
  const successResponse = NextResponse.redirect("https://www.tixtracker.app/dashboard");
  for (const c of outgoing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    successResponse.cookies.set(c.name, c.value, {
      ...(c.options as any),
      // Ensure cookies work on both tixtracker.app and www.tixtracker.app
      domain: ".tixtracker.app",
    });
  }
  // Expire the PKCE verifier now that the code exchange is complete
  successResponse.cookies.set("pkce_verifier", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    domain: ".tixtracker.app",
  });
  return successResponse;
}
