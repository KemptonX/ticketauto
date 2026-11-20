import { createBrowserClient } from "@supabase/ssr";
import { browserAuthSite } from "@/src/lib/auth-site";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Set domain=.tixtracker.app so the PKCE verifier cookie is sent on the cross-subdomain
// redirect from www.tixtracker.app (login) back to tixtracker.app (auth callback).
// On a Vercel preview deployment browserAuthSite() returns host-only cookies
// instead (a browser rejects a .tixtracker.app cookie on *.vercel.app).
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  cookieOptions: {
    domain: process.env.NODE_ENV === "production" ? browserAuthSite().cookieDomain : undefined,
    sameSite: "lax",
  },
});
