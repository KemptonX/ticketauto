import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const protectedRoutes = [
  "/orders",
  "/sales",
  "/archived-sales",
  "/inventory",
  "/analytics",
  "/connections",
  "/scans",
  "/viagogo-calculator",
  "/costs",
  "/settings",
  "/api/scan-gmail",
  "/api/scan-sales",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));

  if (!user && isProtected) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/orders", request.url));
  }

  return response;
}

// Next.js only reads an export named `config`. This was previously exported
// as `proxyConfig`, which Next silently ignored, so the proxy ran on EVERY
// request — including every JS/CSS chunk, font and image — and each run
// called supabase.auth.getUser() (a Supabase Auth round-trip for any
// signed-in visitor).
//
// The matcher deliberately covers every page and API route (not just the
// protectedRoutes list above): the session refresh must also run on
// /auth/callback and every other page, or the Discord OAuth PKCE flow and
// session-cookie refresh break. That is exactly the behaviour production
// already had (via the ignored export), minus static assets. It is the
// matcher the deleted middleware.ts used for the same reason.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf)$).*)",
  ],
};
