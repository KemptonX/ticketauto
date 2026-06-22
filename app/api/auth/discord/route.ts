import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();

  type PendingCookie = {
    name: string;
    value: string;
    options: Record<string, unknown>;
  };
  const outgoing: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            outgoing.push({ name, value, options: options as Record<string, unknown> });
          }
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

  const isProd = process.env.NODE_ENV === "production";
  const response = NextResponse.redirect(data.url);

  for (const { name, value, options } of outgoing) {
    const maxAge = typeof options.maxAge === "number" ? options.maxAge : 34560000;
    response.cookies.set(name, value, {
      path: "/",
      sameSite: "lax" as const,
      httpOnly: false,
      maxAge,
      ...(isProd ? { domain: ".tixtracker.app", secure: true } : {}),
    });
  }

  // Debug: encode what we set so it appears in the error if cookie doesn't arrive
  response.cookies.set("pkce_debug", JSON.stringify({ count: outgoing.length, names: outgoing.map(c => c.name) }), {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 300,
    ...(isProd ? { domain: ".tixtracker.app", secure: true } : {}),
  });

  return response;
}
