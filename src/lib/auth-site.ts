// Where auth redirects go and which cookie domain auth cookies use.
//
// Production behaviour is deliberately unchanged: on tixtracker.app (and on
// ANY host that is not positively identified as a Vercel *preview*
// deployment) this returns exactly the values that used to be hardcoded.
// Only on a Vercel preview deployment (VERCEL_ENV === "preview", set by
// Vercel itself) do redirects stay on the preview's own origin with
// host-only cookies, so Discord sign-in can be tested end to end before a
// change reaches production. A preview origin must also be added to
// Supabase Auth -> URL Configuration -> Redirect URLs, or Supabase will
// fall back to the production Site URL and the flow fails safely.

export type AuthSite = {
  /** Origin used for /auth/callback and /login error redirects. */
  origin: string;
  /** Origin used for the post-login landing redirect. */
  appOrigin: string;
  /** Cookie domain for auth cookies; undefined = host-only. */
  cookieDomain: string | undefined;
};

export const PRODUCTION_AUTH_SITE: AuthSite = {
  origin: "https://tixtracker.app",
  appOrigin: "https://www.tixtracker.app",
  cookieDomain: ".tixtracker.app",
};

function isProductionHost(host: string): boolean {
  return host === "tixtracker.app" || host.endsWith(".tixtracker.app");
}

// Vercel preview hostnames are lowercase letters, digits and hyphens under
// vercel.app. Anything else (ports, odd characters) falls back to production.
const PREVIEW_HOST = /^[a-z0-9-]+\.vercel\.app$/;

export function resolveAuthSite(host: string | null | undefined, vercelEnv: string | undefined): AuthSite {
  const h = (host ?? "").toLowerCase().trim();
  if (!h || isProductionHost(h)) return PRODUCTION_AUTH_SITE;
  if (vercelEnv === "preview" && PREVIEW_HOST.test(h)) {
    const origin = `https://${h}`;
    return { origin, appOrigin: origin, cookieDomain: undefined };
  }
  return PRODUCTION_AUTH_SITE;
}

/**
 * For browser code. NEXT_PUBLIC_VERCEL_ENV is inlined at build time by
 * Vercel ("preview" on preview builds); if it isn't exposed this resolves
 * to production values, i.e. today's behaviour. During server prerender
 * there is no window, which also resolves to production values.
 */
export function browserAuthSite(): AuthSite {
  const host = typeof window !== "undefined" ? window.location.hostname : null;
  return resolveAuthSite(host, process.env.NEXT_PUBLIC_VERCEL_ENV);
}

/** For route handlers: resolves from the incoming request's Host header. */
export function authSiteForRequest(request: Request): AuthSite {
  return resolveAuthSite(request.headers.get("host"), process.env.VERCEL_ENV);
}
