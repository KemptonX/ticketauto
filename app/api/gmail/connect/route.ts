import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings", request.url));
  }

  const requestUrl = new URL(request.url);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/settings?error=missing-google-client", request.url));
  }

  const callbackUrl = new URL("/api/gmail/callback", request.url).toString();

  const state = randomUUID();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId.trim());
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  authUrl.searchParams.set("state", state);

  if (requestUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({
      clientId: clientId.trim(),
      callbackUrl,
      scopes: GOOGLE_SCOPES,
      authUrl: authUrl.toString(),
    });
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: callbackUrl.startsWith("https://"),
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
