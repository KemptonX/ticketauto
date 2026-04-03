"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/whop-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ licenseKey }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Unable to verify license key");
        setLoading(false);
        return;
      }

      router.push("/orders");
      router.refresh();
    } catch {
      setError("Unable to verify license key");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "#fff",
        borderRadius: "16px",
        padding: "24px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
        width: "100%",
        maxWidth: "420px",
      }}
    >
      <h1 style={{ marginTop: 0, marginBottom: "8px" }}>TicketAuto Login</h1>
      <p style={{ marginTop: 0, marginBottom: "20px", color: "#555" }}>
        Enter your Whop license key to access the dashboard.
      </p>

      <input
        value={licenseKey}
        onChange={(event) => setLicenseKey(event.target.value)}
        placeholder="Paste your Whop license key"
        style={{
          width: "100%",
          border: "1px solid #d1d5db",
          borderRadius: "10px",
          padding: "12px 14px",
          fontSize: "15px",
          boxSizing: "border-box",
        }}
      />

      {error ? (
        <div
          style={{
            marginTop: "14px",
            color: "#b91c1c",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading || !licenseKey.trim()}
        style={{
          marginTop: "18px",
          width: "100%",
          border: "none",
          borderRadius: "10px",
          background: "#111827",
          color: "#fff",
          padding: "12px 14px",
          fontWeight: 600,
          cursor: "pointer",
          opacity: loading || !licenseKey.trim() ? 0.7 : 1,
        }}
      >
        {loading ? "Checking..." : "Unlock Dashboard"}
      </button>
    </form>
  );
}
