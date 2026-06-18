import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cookie-based storage so the PKCE verifier survives the cross-site OAuth redirect.
// Safari ITP and Firefox ETP can wipe localStorage when the user navigates through
// external domains (Discord → Supabase → back here), breaking PKCE.
const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${key}=`));
    return match ? decodeURIComponent(match.slice(key.length + 1)) : null;
  },
  setItem(key: string, value: string): void {
    if (typeof document === "undefined") return;
    // PKCE verifier is short-lived; session tokens persist for 30 days
    const maxAge = key.endsWith("-code-verifier") ? 600 : 60 * 60 * 24 * 30;
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  },
  removeItem(key: string): void {
    if (typeof document === "undefined") return;
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
  },
};

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: cookieStorage },
});
