"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

// Minimal email/password sign-in, nothing else — no signup, no password
// reset. This is a temporary, unlisted recovery path for existing
// accounts only (see page.tsx for why). Not meant to be a second
// permanent login method.
export default function AccountAccessForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.push("/orders");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
      </div>
      <div style={{ marginBottom: "1.25rem", textAlign: "center" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>Sign in to your existing account</h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
          For existing TixTracker accounts created before Discord sign-in.
        </p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <input
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="primary-button auth-submit" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
