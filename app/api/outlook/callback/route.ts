import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type MsTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type MsUserProfile = {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const storedState = request.cookies.get("outlook_oauth_state")?.value;

  const redirectToConnections = (params: Record<string, string>) => {
    const nextUrl = new URL("/connections", request.url);
    for (const [key, value] of Object.entries(params)) {
      nextUrl.searchParams.set(key, value);
    }
    const response = NextResponse.redirect(nextUrl);
    response.cookies.set("outlook_oauth_state", "", { path: "/", maxAge: 0 });
    return response;
  };

  if (oauthError) {
    return redirectToConnections({ error: oauthError });
  }

  if (!code || !state || !storedState || state !== storedState) {
    return redirectToConnections({ error: "state-mismatch" });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const callbackUrl = new URL("/api/outlook/callback", request.url).toString();

  if (!clientId || !clientSecret) {
    return redirectToConnections({ error: "missing-microsoft-config" });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToConnections({ error: "not-signed-in" });
  }

  const tokenResponse = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    },
  );

  const tokenData = (await tokenResponse.json()) as MsTokenResponse;

  if (!tokenResponse.ok || !tokenData.access_token) {
    return redirectToConnections({
      error: tokenData.error_description || tokenData.error || "token-exchange-failed",
    });
  }

  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    cache: "no-store",
  });

  const profile = (await profileResponse.json()) as MsUserProfile;

  if (!profileResponse.ok) {
    return redirectToConnections({ error: "outlook-profile-failed" });
  }

  const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
  if (!email) {
    return redirectToConnections({ error: "outlook-no-email" });
  }

  const { data: existingAccount } = await supabase
    .from("gmail_accounts")
    .select("id, refresh_token, is_primary")
    .eq("email", email)
    .eq("user_id", user.id)
    .maybeSingle();

  const { count } = await supabase
    .from("gmail_accounts")
    .select("id", { count: "exact", head: true });

  const payload = {
    email,
    display_name: profile.displayName || email,
    provider: "outlook",
    status: "Ready",
    sync_mode: "oauth",
    is_primary: existingAccount?.is_primary ?? ((count || 0) === 0),
    is_active: true,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || existingAccount?.refresh_token || null,
    token_expiry: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null,
    scope: tokenData.scope || null,
    google_subject: null,
    last_synced_at: null,
  };

  const mutation = existingAccount
    ? supabase.from("gmail_accounts").update(payload).eq("id", existingAccount.id)
    : supabase.from("gmail_accounts").insert({ ...payload, user_id: user.id });

  const { error } = await mutation;

  if (error) {
    return redirectToConnections({ error: error.message });
  }

  return redirectToConnections({ connected: email, provider: "outlook" });
}
