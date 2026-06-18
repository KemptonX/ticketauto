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

export const proxyConfig = {
  matcher: [
    "/login",
    "/dashboard",
    "/orders/:path*",
    "/sales/:path*",
    "/archived-sales/:path*",
    "/inventory/:path*",
    "/analytics/:path*",
    "/connections/:path*",
    "/scans/:path*",
    "/viagogo-calculator/:path*",
    "/costs/:path*",
    "/settings/:path*",
    "/api/scan-gmail",
    "/api/scan-sales",
  ],
};
