"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when it processes the reset token from the URL
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    // Fallback: if session already exists from token exchange, show form
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    // If no token in URL at all after a moment, show invalid state
    const timer = setTimeout(() => {
      setReady((r) => {
        if (!r) setInvalid(true);
        return r;
      });
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/orders"), 1500);
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
          </div>
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✓</div>
            <h2 style={{ margin: "0 0 6px", fontSize: "1.1rem" }}>Password updated</h2>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>Taking you to the dashboard…</p>
          </div>
        </div>
      </main>
    );
  }

  // ── Invalid / expired link ─────────────────────────────────────────────────
  if (invalid) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
          </div>
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: "1.1rem" }}>Link expired</h2>
            <p style={{ margin: "0 0 1.25rem", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              This password reset link has expired or already been used.
            </p>
            <a href="/login" className="primary-button" style={{ display: "inline-block" }}>
              Back to sign in
            </a>
          </div>
        </div>
      </main>
    );
  }

  // ── Loading / waiting for token ────────────────────────────────────────────
  if (!ready) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
          </div>
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>Verifying reset link…</p>
          </div>
        </div>
      </main>
    );
  }

  // ── Set new password form ──────────────────────────────────────────────────
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
        </div>

        <div style={{ marginBottom: "1.25rem", textAlign: "center" }}>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>Set new password</h2>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>Choose a new password for your account</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>New password</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
              autoFocus
            />
          </label>

          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your new password"
              required
              minLength={6}
            />
          </label>

          {error ? <div className="auth-error">{error}</div> : null}

          <button className="primary-button auth-submit" type="submit" disabled={loading}>
            {loading ? "Updating…" : "Update password"}
          </button>

          <a href="/login" className="auth-forgot" style={{ display: "block", textAlign: "center" }}>
            Back to sign in
          </a>
        </form>
      </div>
    </main>
  );
}
