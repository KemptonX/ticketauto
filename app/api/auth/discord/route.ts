import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

// Server-side OAuth initiation — stores the PKCE code verifier in a proper
// HTTP Set-Cookie response header instead of via document.cookie, which is
// unreliable in Next.js SSR environments with cross-domain redirects.
export async function GET() {
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
            cookieStore.set(name, value, {
              ...options,
              domain: process.env.NODE_ENV === "production" ? ".tixtracker.app" : undefined,
              sameSite: "lax",
            });
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: "https://tixtracker.app/auth/callback",
      scopes: "identify email",
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      `https://tixtracker.app/login?error=${encodeURIComponent(error?.message ?? "oauth-failed")}`,
    );
  }

  return NextResponse.redirect(data.url);
}
