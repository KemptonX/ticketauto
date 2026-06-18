"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Signing you in…");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleCallback() {
      const code = searchParams.get("code");
      const next = searchParams.get("next") ?? "/orders";

      if (!code) {
        setErrorMsg("No auth code received from Discord. Please try again.");
        return;
      }

      setStatus("Exchanging code for session…");
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.user) {
        setErrorMsg(`Session error: ${error?.message ?? "unknown"}`);
        return;
      }

      setStatus("Session established. Checking access…");

      const isDiscord = data.user.identities?.some((i) => i.provider === "discord");
      if (isDiscord) {
        setStatus("Verifying Whop membership…");
        try {
          const res = await fetch("/api/auth/whop-check", { method: "POST" });
          const json = (await res.json()) as { ok?: boolean; error?: string };
          if (!json.ok) {
            await supabase.auth.signOut();
            setErrorMsg(json.error ?? "Access denied");
            return;
          }
        } catch (e) {
          await supabase.auth.signOut();
          setErrorMsg(`Whop check failed: ${e instanceof Error ? e.message : "network error"}`);
          return;
        }
      }

      setStatus("All good — redirecting…");
      router.push(next);
    }

    void handleCallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        height: "100vh",
        background: "var(--bg, #0f0f10)",
      }}
    >
      {errorMsg ? (
        <>
          <p style={{ color: "#f87171", fontSize: "0.9rem", fontWeight: 600 }}>Login failed</p>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", maxWidth: 360, textAlign: "center" }}>
            {errorMsg}
          </p>
          <a href="/login" style={{ marginTop: 8, color: "#a5aaff", fontSize: "0.8rem" }}>
            Back to login
          </a>
        </>
      ) : (
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.875rem" }}>{status}</p>
      )}
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallbackInner />
    </Suspense>
  );
}
