import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";

function generateVerifier(): string {
  // 43-128 chars of URL-safe chars — RFC 7636 compliant
  return randomBytes(32).toString("base64url");
}

function generateChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function GET() {
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // Build the Supabase authorize URL — browser navigates here, Supabase
  // redirects to Discord, Discord redirects back to our /auth/callback.
  const params = new URLSearchParams({
    provider: "discord",
    redirect_to: "https://tixtracker.app/auth/callback",
    scopes: "identify email",
    code_challenge: challenge,
    code_challenge_method: "s256",
  });

  const oauthUrl = `${supabaseUrl}/auth/v1/authorize?${params.toString()}`;

  const isProd = process.env.NODE_ENV === "production";
  const response = NextResponse.redirect(oauthUrl);

  // Store the raw verifier in a plain cookie — avoids @supabase/ssr's
  // base64 encoding step that was silently producing empty cookie values.
  response.cookies.set("pkce_verifier", verifier, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: isProd,
    maxAge: 300, // 5 min — enough for the OAuth round-trip
    ...(isProd ? { domain: ".tixtracker.app" } : {}),
  });

  return response;
}
