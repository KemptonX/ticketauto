"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Discord is the only supported sign-in/sign-up method — see the prior
// email/password + signup + reset form this replaced in git history if
// the full old implementation is ever needed for reference. Everything
// about an account's identity now flows through Discord OAuth
// (/api/auth/discord -> /auth/callback), which also runs the Whop
// membership check. Nothing here talks to Supabase directly any more.
export default function LoginForm() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Show errors forwarded from the OAuth callback (e.g. Whop membership
  // check failures, or "Discord required" if an old session had none).
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) setError(decodeURIComponent(urlError));
  }, [searchParams]);

  function handleDiscordLogin() {
    setLoading(true);
    setError("");
    // Navigate to the server-side OAuth route so the PKCE code verifier is
    // stored as an HTTP Set-Cookie header rather than via document.cookie,
    // which is unreliable across Next.js SSR / redirect chains.
    window.location.href = "/api/auth/discord";
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
      </div>

      <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.1rem" }}>TixTracker</h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
          The all-in-one platform for ticket resellers.
        </p>
      </div>

      {error ? <div className="auth-error" style={{ marginBottom: "12px" }}>{error}</div> : null}

      <button
        type="button"
        disabled={loading}
        onClick={() => handleDiscordLogin()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          width: "100%",
          padding: "12px 16px",
          marginBottom: "14px",
          background: "rgba(88,101,242,0.15)",
          border: "1px solid rgba(88,101,242,0.45)",
          borderRadius: "8px",
          color: "#a5aaff",
          fontSize: "0.9rem",
          fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "background 0.15s",
        }}
      >
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
          <path d="M15.245 1.175A14.91 14.91 0 0 0 11.567 0c-.167.302-.362.71-.496 1.033a13.784 13.784 0 0 0-4.143 0A11.124 11.124 0 0 0 6.431 0 14.968 14.968 0 0 0 2.75 1.179C.395 4.753-.242 8.238.076 11.674c1.54 1.148 3.033 1.846 4.502 2.303a10.8 10.8 0 0 0 .95-1.57 9.723 9.723 0 0 1-1.495-.73c.125-.093.248-.19.366-.29 2.884 1.353 6.016 1.353 8.866 0 .12.1.243.197.366.29a9.72 9.72 0 0 1-1.499.731c.28.558.604 1.086.952 1.57 1.47-.457 2.965-1.155 4.505-2.304.37-3.955-.627-7.408-2.644-10.499zM6.013 9.554c-.895 0-1.63-.835-1.63-1.857 0-1.022.717-1.859 1.63-1.859.914 0 1.647.836 1.63 1.859 0 1.022-.715 1.857-1.63 1.857zm6.025 0c-.896 0-1.63-.835-1.63-1.857 0-1.022.716-1.859 1.63-1.859.913 0 1.646.836 1.63 1.859 0 1.022-.716 1.857-1.63 1.857z" fill="currentColor" />
        </svg>
        {loading ? "Redirecting…" : "Continue with Discord"}
      </button>

      <a
        href="https://whop.com/x-f5f1/x-63-e499/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          textAlign: "center",
          fontSize: "0.8125rem",
          color: "var(--text-muted)",
          textDecoration: "none",
        }}
      >
        Don&apos;t have access? <span style={{ color: "#c792ff", fontWeight: 600 }}>Get started — £20/month</span>
      </a>
    </div>
  );
}
