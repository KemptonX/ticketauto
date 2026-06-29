"use client";

import { useEffect, useState } from "react";

type AccountStatus =
  | "connected"
  | "disconnected"
  | "needs_reconnect"
  | "verification_required"
  | "login_failed"
  | "error";

type MarketplaceAccount = {
  id: string;
  marketplace: string;
  display_email: string | null;
  status: AccountStatus;
  can_list: boolean;
  last_login_at: string | null;
  last_checked_at: string | null;
  last_error_message: string | null;
  pending_2fa_since: string | null;
  created_at: string;
  disconnected_at: string | null;
};

const STATUS_LABELS: Record<AccountStatus, string> = {
  connected:             "Connected",
  disconnected:          "Disconnected",
  needs_reconnect:       "Needs reconnect",
  verification_required: "Verification required",
  login_failed:          "Login failed",
  error:                 "Error",
};

const STATUS_COLORS: Record<AccountStatus, string> = {
  connected:             "#22c55e",
  disconnected:          "#6b7280",
  needs_reconnect:       "#f59e0b",
  verification_required: "#f59e0b",
  login_failed:          "#ef4444",
  error:                 "#ef4444",
};

function statusColor(s: AccountStatus) {
  return STATUS_COLORS[s] ?? "#6b7280";
}
function statusLabel(s: AccountStatus) {
  return STATUS_LABELS[s] ?? s;
}

function formatDate(ts: string | null) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export default function AccountsTab() {
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [reconnectId, setReconnectId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/marketplace/accounts");
    if (res.ok) {
      const json = await res.json() as { accounts: MarketplaceAccount[] };
      setAccounts(json.accounts ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function disconnect(id: string) {
    if (!confirm("Disconnect this Viagogo account? Existing listings will not be affected.")) return;
    await fetch(`/api/marketplace/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    await load();
  }

  const viagogoAccount = accounts.find((a) => a.marketplace === "viagogo") ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Hero */}
      <section className="hero-card connections-hero">
        <div>
          <p className="section-tag">Marketplace Accounts</p>
          <h3>External marketplace connections</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.8125rem", marginTop: "0.25rem" }}>
            Connect your Viagogo seller account to enable ticket listing from TixTracker.
          </p>
        </div>
      </section>

      {/* Viagogo card */}
      <section className="table-card">
        <div className="table-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: "#0066cc",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, color: "#fff", fontSize: "0.75rem", letterSpacing: "-0.02em",
            }}>
              VG
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: "1rem" }}>Viagogo</h4>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                Secondary ticket marketplace
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "1.5rem", color: "var(--muted)", fontSize: "0.875rem" }}>
            Loading…
          </div>
        ) : viagogoAccount ? (
          <ViagogoAccountDetails
            account={viagogoAccount}
            onDisconnect={() => void disconnect(viagogoAccount.id)}
            onReconnect={() => { setReconnectId(viagogoAccount.id); setShowAddModal(true); }}
          />
        ) : (
          <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#6b7280", display: "inline-block",
              }} />
              <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>Not connected</span>
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
              Add your Viagogo seller account to start listing tickets directly from TixTracker.
              Your credentials are encrypted and never stored in plaintext.
            </p>
            <div>
              <button
                type="button"
                className="primary-button"
                onClick={() => { setReconnectId(null); setShowAddModal(true); }}
              >
                Add Viagogo account
              </button>
            </div>
          </div>
        )}
      </section>

      {showAddModal && (
        <AddViagogoModal
          existingId={reconnectId}
          onClose={() => { setShowAddModal(false); setReconnectId(null); }}
          onSaved={() => { setShowAddModal(false); setReconnectId(null); void load(); }}
        />
      )}
    </div>
  );
}

function ViagogoAccountDetails({
  account,
  onDisconnect,
  onReconnect,
}: {
  account: MarketplaceAccount;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const color = statusColor(account.status);
  const [otp, setOtp] = useState("");
  const [otpSaving, setOtpSaving] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  async function submitOtp() {
    if (!otp.trim()) return;
    setOtpSaving(true);
    await fetch(`/api/marketplace/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_otp", otp: otp.trim() }),
    });
    setOtpSaving(false);
    setOtpSent(true);
    setOtp("");
  }

  return (
    <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <InfoRow label="Status">
          <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
            <span style={{ color, fontWeight: 600, fontSize: "0.875rem" }}>{statusLabel(account.status)}</span>
          </span>
        </InfoRow>
        <InfoRow label="Email">
          <span style={{ fontSize: "0.875rem" }}>{account.display_email ?? "—"}</span>
        </InfoRow>
        <InfoRow label="Can list">
          <span style={{ fontSize: "0.875rem", color: account.can_list ? "#22c55e" : "var(--muted)", fontWeight: 600 }}>
            {account.can_list ? "Yes" : "No"}
          </span>
        </InfoRow>
        <InfoRow label="Last checked">
          <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>{formatDate(account.last_checked_at)}</span>
        </InfoRow>
        <InfoRow label="Last login">
          <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>{formatDate(account.last_login_at)}</span>
        </InfoRow>
        {account.last_error_message && (
          <InfoRow label="Last error">
            <span style={{ fontSize: "0.8125rem", color: "#ef4444" }}>{account.last_error_message}</span>
          </InfoRow>
        )}
      </div>

      {account.status === "needs_reconnect" && (
        <div style={{
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          fontSize: "0.8125rem",
          color: "#f59e0b",
          lineHeight: 1.6,
        }}>
          <strong>Waiting for worker verification.</strong> Your credentials are saved.
          The Railway worker will verify the connection and update the status automatically.
          If it stays on this status, check the worker is running.
        </div>
      )}

      {account.status === "verification_required" && (
        <div style={{
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          fontSize: "0.8125rem",
          color: "#f59e0b",
          lineHeight: 1.6,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}>
          <div>
            <strong>Viagogo requires email/SMS verification.</strong> Check your inbox for a code from Viagogo and enter it below.
            The worker will pick it up automatically.
          </div>
          {otpSent ? (
            <div style={{ color: "#22c55e", fontWeight: 600 }}>Code submitted — the worker will use it now.</div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                className="field"
                type="text"
                inputMode="numeric"
                placeholder="123456"
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                style={{ width: 120, letterSpacing: "0.15em", fontWeight: 600 }}
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => void submitOtp()}
                disabled={otpSaving || !otp.trim()}
              >
                {otpSaving ? "Sending…" : "Submit code"}
              </button>
            </div>
          )}
        </div>
      )}

      {(account.status === "login_failed" || account.status === "error") && (
        <div style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          fontSize: "0.8125rem",
          color: "#ef4444",
          lineHeight: 1.6,
        }}>
          <strong>Login failed.</strong> {account.last_error_message ?? "Check your credentials and try reconnecting."}
        </div>
      )}

      {account.status === "disconnected" && (
        <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0 }}>
          This account is disconnected. Reconnect to enable listing.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", paddingTop: "0.25rem" }}>
        <button type="button" className="secondary-button" onClick={onReconnect}>
          {account.status === "connected" ? "Update credentials" : "Reconnect"}
        </button>
        <button type="button" className="secondary-button" onClick={onDisconnect}
          style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ margin: "0 0 2px", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function AddViagogoModal({
  existingId,
  onClose,
  onSaved,
}: {
  existingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isReconnect = !!existingId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }
    setSaving(true);
    setError("");

    try {
      const url = isReconnect
        ? `/api/marketplace/accounts/${existingId}`
        : "/api/marketplace/accounts";
      const body = isReconnect
        ? { action: "reconnect", email: email.trim(), password }
        : { marketplace: "viagogo", email: email.trim(), password };

      const res = await fetch(url, {
        method: isReconnect ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to save account");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--surface-card, #1a1a1a)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        width: "100%", maxWidth: 440,
        padding: "1.75rem",
        display: "flex", flexDirection: "column", gap: "1.25rem",
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.125rem" }}>
            {isReconnect ? "Reconnect Viagogo account" : "Add Viagogo account"}
          </h3>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Your credentials are encrypted with AES-256 and never stored in plaintext.
            The password is never shown again after saving.
          </p>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <label className="filter-field">
            <span className="filter-label">Viagogo email</span>
            <input
              className="field"
              type="email"
              autoComplete="off"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="filter-field">
            <span className="filter-label">Viagogo password</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.75rem",
            fontSize: "0.75rem",
            color: "var(--muted)",
            lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--foreground)" }}>Security:</strong>{" "}
            Your password is encrypted server-side before storage. It is never logged, returned to the
            browser, or stored in plaintext. If Viagogo requires 2FA, you will be prompted to enter
            the code in TixTracker.
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "#ef4444" }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", paddingTop: "0.25rem" }}>
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? "Saving…" : isReconnect ? "Save credentials" : "Add account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
