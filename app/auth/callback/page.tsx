"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [status, setStatus] = useState("Signing you in…");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // With implicit flow, createBrowserClient automatically parses the URL hash
    // and fires SIGNED_IN through onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event !== "SIGNED_IN" || !session?.user) return;
        subscription.unsubscribe();

        setStatus("Verifying access…");
        const whopError = await checkWhop(session.user);

        if (whopError) {
          await supabase.auth.signOut();
          setErrorMsg(whopError);
          return;
        }

        setStatus("All good — redirecting…");
        window.location.href = "/orders";
      },
    );

    // Fallback: if the session was already set before the listener attached
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      subscription.unsubscribe();

      setStatus("Verifying access…");
      const whopError = await checkWhop(session.user);

      if (whopError) {
        await supabase.auth.signOut();
        setErrorMsg(whopError);
        return;
      }

      setStatus("All good — redirecting…");
      window.location.href = "/orders";
    });

    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      setErrorMsg("Sign-in timed out — no session was established. Please try again.");
    }, 15000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
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
