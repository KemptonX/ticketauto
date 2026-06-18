import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const WHOP_SESSION_COOKIE = "ticketauto_session";

const PUBLIC_PATHS = ["/login", "/update-password", "/whop-verify"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes, Next.js internals, and static assets
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    /\.(?:ico|png|jpg|jpeg|svg|gif|webp|css|js|woff2?)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Skip public auth pages
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Build a response object that Supabase can attach refreshed cookies to
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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Layer 1: Supabase session (validates JWT with Supabase server)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Layer 2: Whop license session (cookie presence — signature verified server-side)
  const hasWhopSession = !!request.cookies.get(WHOP_SESSION_COOKIE)?.value;

  if (!hasWhopSession) {
    const verifyUrl = request.nextUrl.clone();
    verifyUrl.pathname = "/whop-verify";
    verifyUrl.search = "";
    return NextResponse.redirect(verifyUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
