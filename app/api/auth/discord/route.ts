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

  console.log("[discord-oauth] outgoing cookies count:", outgoing.length);
  for (const { name, value, options } of outgoing) {
    const maxAge = typeof options.maxAge === "number" ? options.maxAge : 34560000;
    const cookieOpts = {
      path: "/",
      sameSite: "lax" as const,
      httpOnly: false,
      maxAge,
      ...(isProd ? { domain: ".tixtracker.app", secure: true } : {}),
    };
    console.log("[discord-oauth] setting cookie:", name, "len:", value.length, "opts:", JSON.stringify(cookieOpts));
    response.cookies.set(name, value, cookieOpts);
  }

  return response;
}
