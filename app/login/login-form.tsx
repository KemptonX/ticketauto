"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

type Mode = "signin" | "signup" | "reset" | "update-password";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/orders", [searchParams]);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");


  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const trimmedEmail = email.trim().toLowerCase();

    try {
      if (mode === "update-password") {
        if (newPassword !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        if (newPassword.length < 6) {
          setError("Password must be at least 6 characters.");
          setLoading(false);
          return;
        }
        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
        if (updateError) {
          setError(updateError.message);
        } else {
          setMessage("Password updated. Signing you in…");
          setTimeout(() => {
            router.push("/orders");
            router.refresh();
          }, 1200);
        }
        setLoading(false);
        return;
      }

      if (mode === "reset") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (resetError) {
          if (resetError.message.toLowerCase().includes("rate limit") || resetError.status === 429) {
            setError("Too many reset requests. Please wait a few minutes and try again, or check your spam folder — the email may already be on its way.");
          } else {
            setError(resetError.message);
          }
        } else {
          setMessage("Check your email for a password reset link. If it doesn't arrive within a minute, check your spam folder.");
        }
        setLoading(false);
        return;
      }

      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
          setLoading(false);
          return;
        }
        setMessage("Account created. You can sign in now.");
        setMode("signin");
        setLoading(false);
        return;
      }

      // Sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Unable to continue right now");
    }

    setLoading(false);
  }

  // ── Update password form (after clicking reset link) ──────────────────────
  if (mode === "update-password") {
    return (
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
          {error   ? <div className="auth-error">{error}</div>     : null}
          {message ? <div className="auth-message">{message}</div> : null}
          <button className="primary-button auth-submit" type="submit" disabled={loading}>
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    );
  }

  // ── Normal sign-in / sign-up / reset form ─────────────────────────────────
  return (
    <div className="auth-card">
      <div className="auth-brand">
        <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
      </div>

      {mode !== "reset" && (
        <div className="auth-toggle">
          <button
            type="button"
            className={`auth-toggle-button${mode === "signin" ? " auth-toggle-button-active" : ""}`}
            onClick={() => { setMode("signin"); setError(""); setMessage(""); }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`auth-toggle-button${mode === "signup" ? " auth-toggle-button-active" : ""}`}
            onClick={() => { setMode("signup"); setError(""); setMessage(""); }}
          >
            Create account
          </button>
        </div>
      )}

      {mode === "reset" && (
        <div style={{ marginBottom: "1.25rem", textAlign: "center" }}>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>Reset password</h2>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>We&apos;ll email you a reset link</p>
        </div>
      )}

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
          />
        </label>

        {mode !== "reset" && (
          <label className="auth-field">
            <span>Password</span>
            <input
              className="field"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              minLength={6}
            />
          </label>
        )}

        {error   ? <div className="auth-error">{error}</div>     : null}
        {message ? <div className="auth-message">{message}</div> : null}

        <button className="primary-button auth-submit" type="submit" disabled={loading}>
          {loading
            ? "Working…"
            : mode === "signin"
            ? "Open dashboard"
            : mode === "reset"
            ? "Send reset link"
            : "Create account"}
        </button>

        {mode === "signin" && (
          <button
            type="button"
            className="auth-forgot"
            onClick={() => { setMode("reset"); setError(""); setMessage(""); }}
          >
            Forgot password?
          </button>
        )}
        {mode === "reset" && (
          <button
            type="button"
            className="auth-forgot"
            onClick={() => { setMode("signin"); setError(""); setMessage(""); }}
          >
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
