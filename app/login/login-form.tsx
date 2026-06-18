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

  // Show errors forwarded from the OAuth callback (e.g. Whop membership check failures)
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) setError(decodeURIComponent(urlError));
  }, [searchParams]);


  async function handleDiscordLogin() {
    setLoading(true);
    setError("");
    setMessage("");

    // skipBrowserRedirect so we can back up the PKCE verifier before navigating away
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });

    if (oauthError || !data.url) {
      setError(oauthError?.message ?? "Failed to start Discord login");
      setLoading(false);
      return;
    }

    // Back up the PKCE verifier to a cookie before leaving this domain.
    // Safari ITP / Firefox ETP can wipe localStorage during cross-site redirects
    // (Discord → Supabase → back here), so we persist it ourselves.
    try {
      const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
      const key = `sb-${ref}-auth-token-code-verifier`;
      const verifier = localStorage.getItem(key)
        ?? document.cookie.split("; ").find((c) => c.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
      if (verifier) {
        document.cookie = `pkce_k=${encodeURIComponent(key)}; path=/; max-age=600; SameSite=Lax`;
        document.cookie = `pkce_v=${encodeURIComponent(verifier)}; path=/; max-age=600; SameSite=Lax`;
      }
    } catch { /* non-fatal */ }

    window.location.href = data.url;
  }

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

      {mode !== "reset" && (
        <>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleDiscordLogin()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              width: "100%",
              padding: "10px 16px",
              marginBottom: "10px",
              background: "rgba(88,101,242,0.15)",
              border: "1px solid rgba(88,101,242,0.45)",
              borderRadius: "8px",
              color: "#a5aaff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
              <path d="M15.245 1.175A14.91 14.91 0 0 0 11.567 0c-.167.302-.362.71-.496 1.033a13.784 13.784 0 0 0-4.143 0A11.124 11.124 0 0 0 6.431 0 14.968 14.968 0 0 0 2.75 1.179C.395 4.753-.242 8.238.076 11.674c1.54 1.148 3.033 1.846 4.502 2.303a10.8 10.8 0 0 0 .95-1.57 9.723 9.723 0 0 1-1.495-.73c.125-.093.248-.19.366-.29 2.884 1.353 6.016 1.353 8.866 0 .12.1.243.197.366.29a9.72 9.72 0 0 1-1.499.731c.28.558.604 1.086.952 1.57 1.47-.457 2.965-1.155 4.505-2.304.37-3.955-.627-7.408-2.644-10.499zM6.013 9.554c-.895 0-1.63-.835-1.63-1.857 0-1.022.717-1.859 1.63-1.859.914 0 1.647.836 1.63 1.859 0 1.022-.715 1.857-1.63 1.857zm6.025 0c-.896 0-1.63-.835-1.63-1.857 0-1.022.716-1.859 1.63-1.859.913 0 1.646.836 1.63 1.859 0 1.022-.716 1.857-1.63 1.857z" fill="currentColor" />
            </svg>
            Continue with Discord
          </button>

          <a
            href="https://whop.com/x-f5f1/x-63-e499/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              width: "100%",
              padding: "10px 16px",
              marginBottom: "16px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "8px",
              color: "rgba(255,255,255,0.75)",
              fontSize: "0.875rem",
              fontWeight: 600,
              textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            Get access — £20/month
          </a>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>or sign in with email</span>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
          </div>
        </>
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
