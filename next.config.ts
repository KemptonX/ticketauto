import type { NextConfig } from "next";

// SEC-003 remediation. Deliberately conservative rather than a strict,
// nonce-based CSP — this app has no staging environment to verify a
// stricter policy against, and a few real, verified-necessary external
// destinations: Supabase (REST calls from the browser), frankfurter.app
// (the Calculator's live FX rate fetch), and Discord/Whop (full-page OAuth
// *navigations*, not embedded content, so they don't need a CSP allowance
// here at all — navigations aren't governed by connect-src/frame-src).
// img-src is intentionally permissive (any https: + data:) because
// Forward Mail renders real, externally-authored confirmation emails
// inside a sandboxed iframe, and a real ticket email can legitimately
// reference images from almost any domain — a strict img-src would risk
// breaking that rendering in a way that's hard to catch without manually
// viewing many real emails across many platforms.
const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  `connect-src 'self' ${SUPABASE_HOST} https://api.frankfurter.app`,
  "img-src 'self' data: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
