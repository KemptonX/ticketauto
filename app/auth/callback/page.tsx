"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Signing you in…");

  useEffect(() => {
    async function handleCallback() {
      const code = searchParams.get("code");
      const next = searchParams.get("next") ?? "/orders";

      if (!code) {
        router.push("/login?error=missing-code");
        return;
      }

      // Exchange the PKCE code for a session using the browser client
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.user) {
        router.push(`/login?error=${encodeURIComponent(error?.message ?? "auth-failed")}`);
        return;
      }

      // Only run Whop check for Discord logins
      const isDiscord = data.user.identities?.some((i) => i.provider === "discord");
      if (isDiscord) {
        setStatus("Verifying membership…");
        try {
          const res = await fetch("/api/auth/whop-check", { method: "POST" });
          const json = (await res.json()) as { ok?: boolean; error?: string };
          if (!json.ok) {
            await supabase.auth.signOut();
            router.push(`/login?error=${encodeURIComponent(json.error ?? "Access denied")}`);
            return;
          }
        } catch {
          await supabase.auth.signOut();
          router.push(`/login?error=${encodeURIComponent("Could not verify Whop membership. Please try again.")}`);
          return;
        }
      }

      router.push(next);
    }

    void handleCallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg, #0f0f10)",
      }}
    >
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.875rem" }}>{status}</p>
    </main>
  );
}
