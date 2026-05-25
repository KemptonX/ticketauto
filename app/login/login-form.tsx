"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/orders", [searchParams]);

  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      if (mode === "reset") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (resetError) {
          setError(resetError.message);
        } else {
          setMessage("Check your email for a password reset link.");
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
      setLoading(false);
      return;
    }

    setLoading(false);
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <img src="/logo.png" alt="TicketX" style={{ height: "40px", width: "auto" }} />
      </div>

      <div className="auth-toggle">
        <button
          type="button"
          className={`auth-toggle-button${mode === "signin" ? " auth-toggle-button-active" : ""}`}
          onClick={() => setMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`auth-toggle-button${mode === "signup" ? " auth-toggle-button-active" : ""}`}
          onClick={() => setMode("signup")}
        >
          Create account
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <input
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="auth-field">
          <span>Password</span>
          <input
            className="field"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
            minLength={6}
          />
        </label>

        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-message">{message}</div> : null}

        <button className="primary-button auth-submit" type="submit" disabled={loading}>
          {loading ? "Working..." : mode === "signin" ? "Open dashboard" : mode === "reset" ? "Send reset link" : "Create account"}
        </button>

        {mode === "signin" && (
          <button type="button" className="auth-forgot" onClick={() => { setMode("reset"); setError(""); setMessage(""); }}>
            Forgot password?
          </button>
        )}
        {mode === "reset" && (
          <button type="button" className="auth-forgot" onClick={() => { setMode("signin"); setError(""); setMessage(""); }}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
