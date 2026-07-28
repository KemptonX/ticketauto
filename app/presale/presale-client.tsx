"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

// Campaign metadata — keep in sync with presale-sync.ts CAMPAIGN_DEFS
const CAMPAIGNS: Record<string, { label: string; emoji: string; accountBound: boolean }> = {
  la28_olympics: { label: "LA28 Olympics", emoji: "🏅", accountBound: true },
};

type PresaleEntry = {
  id: number;
  campaign: string;
  account_email: string;
  presale_code: string | null;
  slot_start: string | null;
  slot_end: string | null;
  notes: string | null;
  created_at: string;
};

const navItems = [
  { label: "Dashboard",       href: "/",                   active: false },
  { label: "Tickets",         href: "/orders",             active: false },
  { label: "Sales",           href: "/sales",              active: false },
  { label: "Analytics",       href: "/analytics",          active: false },
  { label: "Cash Flow",       href: "/cash-flow",          active: false },
  { label: "Costs",           href: "/costs",              active: false },
  { label: "Calculator",      href: "/viagogo-calculator", active: false },
  { label: "Scans",           href: "/scans",              active: false },
  { label: "Presale & Codes", href: "/presale",            active: true  },
  { label: "Forward Mail",    href: "/forward-mail",       active: false },
  { label: "Settings",        href: "/settings",           active: false },
];

function fmtSlot(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function isSlotActive(entry: PresaleEntry): boolean {
  const now = Date.now();
  const start = entry.slot_start ? new Date(entry.slot_start).getTime() : null;
  const end   = entry.slot_end   ? new Date(entry.slot_end).getTime()   : null;
  if (start == null && end == null) return false;
  if (start != null && now < start) return false;
  if (end != null && now > end) return false;
  return true;
}

function isSlotExpired(entry: PresaleEntry): boolean {
  if (!entry.slot_end) return false;
  return Date.now() > new Date(entry.slot_end).getTime();
}

function SlotStatusBadge({ entry }: { entry: PresaleEntry }) {
  const live    = isSlotActive(entry);
  const expired = isSlotExpired(entry);
  const upcoming = entry.slot_start && !live && !expired;
  if (live)     return <span className="status-badge status-static status-sold">🟢 Live now</span>;
  if (expired)  return <span className="status-badge status-static status-unlisted">Expired</span>;
  if (upcoming) return <span className="status-badge status-static status-listed">Upcoming</span>;
  return <span className="status-badge status-static status-unlisted">Account-bound</span>;
}

export default function PresaleClient() {
  const [entries, setEntries] = useState<PresaleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState("");
  const [activeCampaign, setActiveCampaign] = useState("la28_olympics");
  const [copied, setCopied] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const res = await fetch("/api/presale");
    if (res.ok) {
      const json = await res.json() as { entries: PresaleEntry[] };
      setEntries(json.entries ?? []);
    }
    setLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function handleRescan() {
    setRescanning(true);
    setRescanMsg("");
    const res = await fetch("/api/presale/rescan", { method: "POST" });
    const json = await res.json() as { inserted?: number; scanned?: number; errors?: string[] };
    if (res.ok) {
      const n = json.inserted ?? 0;
      setRescanMsg(n > 0 ? `Found ${n} new entr${n !== 1 ? "ies" : "y"}` : "No new emails found");
      if (n > 0) void load();
    } else {
      setRescanMsg("Rescan failed");
    }
    setRescanning(false);
  }

  async function handleDelete(id: number) {
    await fetch("/api/presale", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleUpdateEmail(id: number, email: string) {
    const res = await fetch("/api/presale", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, account_email: email }),
    });
    if (res.ok) {
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, account_email: email } : e));
    }
  }

  function copyCode(id: number, code: string) {
    void navigator.clipboard.writeText(code);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  const campaigns = Object.keys(CAMPAIGNS);
  const filtered = entries.filter((e) => e.campaign === activeCampaign);
  const campaignMeta = CAMPAIGNS[activeCampaign];
  const activeEntries  = filtered.filter((e) => !isSlotExpired(e));
  const expiredEntries = filtered.filter((e) => isSlotExpired(e));

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-item${item.active ? " nav-item-active" : ""}`}
              >
                <NavIcon href={item.href} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Presale Access</p>
            <h2>Presale &amp; Codes</h2>
          </div>
          <div className="topbar-actions">
            {rescanMsg && (
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{rescanMsg}</span>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleRescan()}
              disabled={rescanning}
            >
              {rescanning ? "Scanning…" : "Rescan Emails"}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => setAddOpen(true)}
            >
              + Add Entry
            </button>
          </div>
        </header>

        {/* Campaign tabs */}
        <div className="view-toggle" style={{ alignSelf: "flex-start" }}>
          {campaigns.map((id) => {
            const meta = CAMPAIGNS[id];
            const count = entries.filter((e) => e.campaign === id).length;
            return (
              <button
                key={id}
                type="button"
                className={`toggle-btn${activeCampaign === id ? " toggle-btn-active" : ""}`}
                onClick={() => setActiveCampaign(id)}
              >
                {meta.emoji} {meta.label}{count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        <div className="table-card">
          <div className="table-card-header">
            <h4>{campaignMeta?.emoji} {campaignMeta?.label}</h4>
            <span className="table-count">
              {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>Loading…</h5>
            </div>
          ) : filtered.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No {campaignMeta?.label} entries yet</h5>
              <p>Click <strong>Rescan Emails</strong> to pull from your forwarded mail, or use <strong>+ Add Entry</strong> to add manually.</p>
            </div>
          ) : (
            <div className="table-scroll">
              {activeEntries.length > 0 && expiredEntries.length > 0 && (
                <div style={{ padding: "14px 18px 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                  Active / Upcoming
                </div>
              )}
              {activeEntries.length > 0 && (
                <PresaleTable
                  entries={activeEntries}
                  campaignMeta={campaignMeta}
                  copied={copied}
                  onCopy={copyCode}
                  onDelete={handleDelete}
                  onUpdateEmail={handleUpdateEmail}
                />
              )}
              {expiredEntries.length > 0 && (
                <>
                  <div style={{ padding: "14px 18px 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", opacity: 0.5 }}>
                    Expired
                  </div>
                  <PresaleTable
                    entries={expiredEntries}
                    campaignMeta={campaignMeta}
                    copied={copied}
                    onCopy={copyCode}
                    onDelete={handleDelete}
                    onUpdateEmail={handleUpdateEmail}
                    dimmed
                  />
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {addOpen && (
        <AddEntryModal
          campaign={activeCampaign}
          onAdded={() => { setAddOpen(false); void load(); }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

function AccountEmailCell({ value, onSave }: { value: string; onSave: (email: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className="field"
        type="email"
        value={draft}
        autoFocus
        style={{ fontSize: "0.8rem", padding: "4px 8px", minWidth: 190, display: "inline-block" }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  return (
    <span
      className={value ? "mono-text" : undefined}
      style={{
        cursor: "pointer",
        color: value ? undefined : "var(--accent)",
        fontSize: "0.8rem",
        opacity: value ? 1 : 0.8,
        textDecoration: value ? undefined : "underline dotted",
      }}
      onClick={() => { setDraft(value); setEditing(true); }}
      title={value ? "Click to edit" : "Click to set account email"}
    >
      {value || "+ Set email"}
    </span>
  );
}

function PresaleTable({
  entries, campaignMeta, copied, onCopy, onDelete, onUpdateEmail, dimmed = false,
}: {
  entries: PresaleEntry[];
  campaignMeta: typeof CAMPAIGNS[string] | undefined;
  copied: number | null;
  onCopy: (id: number, code: string) => void;
  onDelete: (id: number) => void;
  onUpdateEmail: (id: number, email: string) => void;
  dimmed?: boolean;
}) {
  return (
    <table className="premium-table" style={{ opacity: dimmed ? 0.55 : 1 }}>
      <thead>
        <tr>
          <th>Account Email</th>
          {!campaignMeta?.accountBound && <th>Code</th>}
          <th>Slot Opens</th>
          <th>Slot Closes</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>
              <AccountEmailCell
                value={entry.account_email}
                onSave={(email) => onUpdateEmail(entry.id, email)}
              />
            </td>
            {!campaignMeta?.accountBound && (
              <td>
                {entry.presale_code ? (
                  <button
                    type="button"
                    className="sale-id-chip"
                    style={{ cursor: "pointer" }}
                    onClick={() => onCopy(entry.id, entry.presale_code!)}
                    title="Click to copy"
                  >
                    {copied === entry.id ? "Copied!" : entry.presale_code}
                  </button>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                )}
              </td>
            )}
            <td><span className="timestamp-text">{fmtSlot(entry.slot_start)}</span></td>
            <td><span className="timestamp-text">{fmtSlot(entry.slot_end)}</span></td>
            <td><SlotStatusBadge entry={entry} /></td>
            <td>
              <button
                type="button"
                className="danger-button"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => { if (confirm("Remove this entry?")) void onDelete(entry.id); }}
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AddEntryModal({
  campaign, onAdded, onClose,
}: {
  campaign: string;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [email, setEmail]         = useState("");
  const [code, setCode]           = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd]     = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  const meta = CAMPAIGNS[campaign];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError("Email is required"); return; }
    setSaving(true);
    setError("");
    const res = await fetch("/api/presale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign,
        account_email: email.trim(),
        presale_code: code.trim() || null,
        slot_start: slotStart || null,
        slot_end: slotEnd || null,
        notes: notes.trim() || null,
      }),
    });
    if (res.ok) {
      onAdded();
    } else {
      const json = await res.json() as { error?: string };
      setError(json.error ?? "Save failed");
      setSaving(false);
    }
  }

  return (
    <div
      className="add-sale-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="add-sale-sheet">
        <div className="add-sale-sheet drawer-header">
          <h4 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>
            Add {meta?.emoji} {meta?.label} entry
          </h4>
          <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <form id="presale-add-form" onSubmit={(e) => void handleSubmit(e)} className="add-sale-body">
          {error && (
            <div style={{ padding: "10px 14px", background: "rgba(255,79,79,0.1)", border: "1px solid rgba(255,79,79,0.3)", borderRadius: 10, fontSize: 13, color: "#ffb4b4" }}>
              {error}
            </div>
          )}

          <div className="add-sale-section">
            <p className="add-sale-section-title">Account Details</p>
            <div className="drawer-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Account email *</span>
                <input
                  className="field"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="account@gmail.com"
                  required
                  style={{ marginTop: 6, display: "block", width: "100%" }}
                />
              </label>
              {!meta?.accountBound && (
                <label style={{ gridColumn: "1 / -1" }}>
                  <span>Presale code</span>
                  <input
                    className="field"
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="ABC123"
                    style={{ marginTop: 6, display: "block", width: "100%" }}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="add-sale-section">
            <p className="add-sale-section-title">
              Time Slot <span className="add-sale-optional">(if applicable)</span>
            </p>
            <div className="drawer-grid">
              <label>
                <span>Slot opens</span>
                <input
                  className="field"
                  type="datetime-local"
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                  style={{ marginTop: 6, display: "block", width: "100%" }}
                />
              </label>
              <label>
                <span>Slot closes</span>
                <input
                  className="field"
                  type="datetime-local"
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                  style={{ marginTop: 6, display: "block", width: "100%" }}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Notes</span>
                <input
                  className="field"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  style={{ marginTop: 6, display: "block", width: "100%" }}
                />
              </label>
            </div>
          </div>
        </form>

        <div className="add-sale-sheet drawer-actions" style={{ padding: "18px 24px", borderTop: "1px solid rgba(38,38,47,0.7)", display: "flex", gap: 12 }}>
          <button
            type="submit"
            form="presale-add-form"
            className="primary-button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save entry"}
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
