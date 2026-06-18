"use client";

import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import type { User } from "@supabase/supabase-js";

async function checkWhop(user: User): Promise<string | null> {
  const isDiscord = user.identities?.some((i) => i.provider === "discord");
  if (!isDiscord) return null;
  try {
    const res = await fetch("/api/auth/whop-check", { method: "POST" });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    return json.ok ? null : (json.error ?? "Access denied");
  } catch {
    return "Could not verify Whop membership. Please try again.";
  }
}

function AuthCallbackInner() {
  const [status, setStatus] = useState("Signing you in…");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleCallback() {
      const code = new URLSearchParams(window.location.search).get("code");

      if (!code) {
        setErrorMsg("No auth code received. Please try the Discord login again.");
        return;
      }

      // Restore the PKCE verifier from our backup cookie (set before the OAuth redirect)
      // in case the browser cleared localStorage during the cross-site navigation.
      try {
        const getCookie = (name: string) => {
          const c = document.cookie.split("; ").find((r) => r.startsWith(`${name}=`));
          return c ? decodeURIComponent(c.slice(name.length + 1)) : null;
        };
        const key = getCookie("pkce_k");
        const verifier = getCookie("pkce_v");
        if (key && verifier) {
          localStorage.setItem(key, verifier);
          // Also write as a cookie in case @supabase/ssr reads from there
          document.cookie = `${key}=${encodeURIComponent(verifier)}; path=/; max-age=60; SameSite=Lax`;
        }
      } catch { /* non-fatal */ }

      setStatus("Exchanging code for session…");
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.user) {
        setErrorMsg(`Sign-in error: ${error?.message ?? "unknown error"}`);
        return;
      }

      setStatus("Verifying access…");
      const whopError = await checkWhop(data.user);
      if (whopError) {
        await supabase.auth.signOut();
        setErrorMsg(whopError);
        return;
      }

      // Full page reload so the server picks up the new session cookies
      window.location.href = "/orders";
    }

    void handleCallback();
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
