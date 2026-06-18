"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WhopVerifyForm() {
  const router = useRouter();
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/whop-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey: licenseKey.trim() }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok) {
        setError(data.error || "Invalid license key");
        setLoading(false);
        return;
      }

      router.push("/orders");
      router.refresh();
    } catch {
      setError("Unable to verify — check your connection and try again");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <img src="/logo.png" alt="TixTracker" style={{ height: "40px", width: "auto" }} />
      </div>
      <div style={{ marginBottom: "1.25rem", textAlign: "center" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>Activate your access</h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Enter the license key from your Whop purchase
        </p>
      </div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>License key</span>
          <input
            className="field"
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="e.g. XXXX-XXXX-XXXX-XXXX"
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="primary-button auth-submit" type="submit" disabled={loading}>
          {loading ? "Verifying…" : "Activate"}
        </button>
        <button
          type="button"
          className="auth-forgot"
          onClick={() => void handleSignOut()}
        >
          Wrong account? Sign out
        </button>
      </form>
    </div>
  );
}
