import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Set domain=.tixtracker.app so the PKCE verifier cookie is sent on the cross-subdomain
// redirect from www.tixtracker.app (login) back to tixtracker.app (auth callback).
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  cookieOptions: {
    domain: process.env.NODE_ENV === "production" ? ".tixtracker.app" : undefined,
    sameSite: "lax",
  },
});
