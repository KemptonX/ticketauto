"use client";

import { useEffect, useState } from "react";
import { ACCOUNT_STATUSES, STATUS_LABELS, PLATFORM_LABELS, type Platform, type AccountStatus, type TicketAccount } from "@/src/lib/account-manager";

type FormState = {
  platform: Platform;
  account_name: string;
  email: string;
  phone: string;
  browser_profile_number: string;
  browser_profile_tool: string;
  proxy_reference: string;
  country: string;
  status: AccountStatus;
  notes: string;
  tags: string;
  account_created_at: string;
  last_checked_at: string;
};

function toForm(a: TicketAccount): FormState {
  return {
    platform: a.platform,
    account_name: a.account_name ?? "",
    email: a.email ?? "",
    phone: a.phone ?? "",
    browser_profile_number: a.browser_profile_number ?? "",
    browser_profile_tool: a.browser_profile_tool ?? "",
    proxy_reference: a.proxy_reference ?? "",
    country: a.country ?? "",
    status: a.status,
    notes: a.notes ?? "",
    tags: a.tags.join(", "),
    account_created_at: a.account_created_at ? a.account_created_at.slice(0, 10) : "",
    last_checked_at: a.last_checked_at ? a.last_checked_at.slice(0, 10) : "",
  };
}

function isDirty(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// Centred overlay modal (reuses the app's established .add-sale-overlay/
// .add-sale-sheet pattern, used by the Sales/Presale import modals) —
// deliberately NOT the .details-drawer sticky-sidebar pattern. That
// pattern only renders at a sane width when its parent grid also adds
// the matching `orders-shell-drawer-open` class to reserve a 420px
// column (see globals.css's .orders-shell-drawer-open rule); this page
// never added that class, so the drawer collapsed to an unpredictable
// sliver with the rest of the grid empty — a structural layout bug, not
// a sizing tweak. A fixed-position overlay has no such dependency.
export default function EditAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: TicketAccount;
  onClose: () => void;
  onSaved: (updated: TicketAccount) => void;
}) {
  const [form, setForm] = useState<FormState>(toForm(account));
  const initial = toForm(account);
  const dirty = isDirty(form, initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving]);

  async function handleSave() {
    if (saving) return; // prevents a double submit from a fast double-click
    const email = form.email.trim();
    if (!email) { setError("An email address is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("That doesn't look like a valid email address"); return; }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/account-manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: account.id,
          platform: form.platform,
          account_name: form.account_name.trim() || null,
          email,
          phone: form.phone.trim() || null,
          browser_profile_number: form.browser_profile_number.trim() || null,
          browser_profile_tool: form.browser_profile_tool.trim() || null,
          proxy_reference: form.proxy_reference.trim() || null,
          country: form.country.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          account_created_at: form.account_created_at || null,
          last_checked_at: form.last_checked_at ? new Date(form.last_checked_at).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); return; }
      onSaved(data.account as TicketAccount);
    } catch {
      setError("Network error saving account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="add-sale-overlay" onClick={requestClose}>
      <div className="add-sale-sheet" style={{ maxWidth: 880 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit account">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Edit Account</p>
            <h4>{PLATFORM_LABELS[form.platform]} · {form.email || "—"}</h4>
          </div>
          <button className="drawer-close" type="button" onClick={requestClose} aria-label="Close">✕</button>
        </div>

        <div className="add-sale-body">
          {error && (
            <div className="feedback-banner" role="alert">
              <span className="feedback-dot" /><span>{error}</span>
            </div>
          )}

          <div className="add-sale-section">
            <p className="add-sale-section-title">Account information</p>
            <div className="drawer-grid">
              <label>
                <span>Platform</span>
                <select className="field" value={form.platform} onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value as Platform }))}>
                  <option value="ticketmaster">Ticketmaster</option>
                  <option value="axs">AXS</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span>Account Email</span>
                <input className="field" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label>
                <span>Account Name</span>
                <input className="field" value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
              </label>
              <label>
                <span>Phone Number</span>
                <input className="field" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label>
                <span>Country / Region</span>
                <input className="field" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
              </label>
              <label>
                <span>Account Status</span>
                <select className="field" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AccountStatus }))}>
                  {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="add-sale-section">
            <p className="add-sale-section-title">Browser & profile</p>
            <div className="drawer-grid">
              <label>
                <span>Browser Profile Number</span>
                <input className="field" value={form.browser_profile_number} onChange={(e) => setForm((f) => ({ ...f, browser_profile_number: e.target.value }))} />
              </label>
              <label>
                <span>Browser Profile Tool</span>
                <input className="field" placeholder="e.g. AdsPower, GoLogin" value={form.browser_profile_tool} onChange={(e) => setForm((f) => ({ ...f, browser_profile_tool: e.target.value }))} />
              </label>
              <label>
                <span>Proxy Reference</span>
                <input className="field" placeholder="e.g. UK-residential-03" value={form.proxy_reference} onChange={(e) => setForm((f) => ({ ...f, proxy_reference: e.target.value }))} />
              </label>
            </div>
          </div>

          <div className="add-sale-section">
            <p className="add-sale-section-title">Additional details</p>
            <div className="drawer-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Tags (comma separated)</span>
                <input className="field" placeholder="e.g. priority, UK" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              </label>
              <label>
                <span>Account Created Date</span>
                <input className="field" type="date" value={form.account_created_at} onChange={(e) => setForm((f) => ({ ...f, account_created_at: e.target.value }))} />
              </label>
              <label>
                <span>Last Checked Date</span>
                <input className="field" type="date" value={form.last_checked_at} onChange={(e) => setForm((f) => ({ ...f, last_checked_at: e.target.value }))} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Notes</span>
                <textarea className="field" rows={4} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
          </div>
        </div>

        <div className="add-sale-sheet drawer-actions" style={{ padding: "16px 24px", borderTop: "1px solid rgba(38,38,47,0.7)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{dirty ? "Unsaved changes" : ""}</span>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="ghost-button" type="button" onClick={requestClose}>Cancel</button>
            <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
