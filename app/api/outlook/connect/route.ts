import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

const MS_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
].join(" ");

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings", request.url));
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/settings?error=missing-microsoft-client", request.url));
  }

  const callbackUrl = new URL("/api/outlook/callback", request.url).toString();
  const state = randomUUID();

  const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authUrl.searchParams.set("client_id", clientId.trim());
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", MS_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("outlook_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: callbackUrl.startsWith("https://"),
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
