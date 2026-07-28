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
  { label: "Dashboard",  href: "/" },
  { label: "Tickets",    href: "/orders" },
  { label: "Sales",      href: "/sales" },
  { label: "Analytics",  href: "/analytics" },
  { label: "Cash Flow",  href: "/cash-flow" },
  { label: "Costs",      href: "/costs" },
  { label: "Calculator", href: "/viagogo-calculator" },
  { label: "Scans",      href: "/scans" },
  { label: "Presale & Codes", href: "/presale", active: true },
  { label: "Forward Mail", href: "/forward-mail" },
  { label: "Settings",   href: "/settings" },
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

export default function PresaleClient() {
  const [entries, setEntries] = useState<PresaleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState("");
  const [activeCampaign, setActiveCampaign] = useState("la28_olympics");
  const [copied, setCopied] = useState<number | null>(null);

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

  async function handleRescan() {
    setRescanning(true);
    setRescanMsg("");
    const res = await fetch("/api/presale/rescan", { method: "POST" });
    const json = await res.json() as { inserted?: number; scanned?: number; errors?: string[] };
    if (res.ok) {
      const n = json.inserted ?? 0;
      setRescanMsg(n > 0 ? `Found ${n} new entry${n !== 1 ? "ies" : "y"} ✓` : "No new emails found");
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

  function copyCode(id: number, code: string) {
    void navigator.clipboard.writeText(code);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  const campaigns = Object.keys(CAMPAIGNS);
  const filtered = entries.filter((e) => e.campaign === activeCampaign);
  const campaignMeta = CAMPAIGNS[activeCampaign];

  // Split into active/upcoming and expired
  const activeEntries  = filtered.filter((e) => !isSlotExpired(e));
  const expiredEntries = filtered.filter((e) => isSlotExpired(e));

  return (
    <div className="desk-layout">
      {/* ── Sidebar ── */}
      <aside className="desk-sidebar">
        <SidebarLogo />
        <nav className="desk-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`desk-nav-item${"active" in item && item.active ? " desk-nav-item-active" : ""}`}
            >
              <NavIcon href={item.href} />
              {item.label}
            </Link>
          ))}
        </nav>
        <SidebarFooter onLogout={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} />
      </aside>

      {/* ── Main ── */}
      <main className="desk-main">
        <div className="desk-header">
          <div>
            <h1 className="desk-title">Presale &amp; Codes</h1>
            <p className="desk-subtitle">Track presale access by account — account-bound or code-based</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => void handleRescan()}
            disabled={rescanning}
          >
            {rescanning ? "Scanning…" : "Rescan Emails"}
          </button>
        </div>

        {rescanMsg && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>{rescanMsg}</div>
        )}

        {/* Campaign tabs */}
        <div className="tabs-row" style={{ marginBottom: 20 }}>
          {campaigns.map((id) => {
            const meta = CAMPAIGNS[id];
            const count = entries.filter((e) => e.campaign === id).length;
            return (
              <button
                key={id}
                className={`tab-btn${activeCampaign === id ? " tab-btn-active" : ""}`}
                onClick={() => setActiveCampaign(id)}
              >
                {meta.emoji} {meta.label}
                {count > 0 && <span className="tab-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>No {campaignMeta?.label} presale entries yet.</p>
            <p className="empty-hint">Click <strong>Rescan Emails</strong> to pull from Gmail, or add manually below.</p>
            <AddEntryForm campaign={activeCampaign} onAdded={load} />
          </div>
        ) : (
          <>
            {activeEntries.length > 0 && (
              <section style={{ marginBottom: 32 }}>
                <h2 className="section-heading">Active / Upcoming</h2>
                <PresaleTable
                  entries={activeEntries}
                  campaignMeta={campaignMeta}
                  copied={copied}
                  onCopy={copyCode}
                  onDelete={handleDelete}
                />
              </section>
            )}

            {expiredEntries.length > 0 && (
              <section style={{ marginBottom: 32 }}>
                <h2 className="section-heading" style={{ opacity: 0.5 }}>Expired</h2>
                <PresaleTable
                  entries={expiredEntries}
                  campaignMeta={campaignMeta}
                  copied={copied}
                  onCopy={copyCode}
                  onDelete={handleDelete}
                  dimmed
                />
              </section>
            )}

            <AddEntryForm campaign={activeCampaign} onAdded={load} />
          </>
        )}
      </main>
    </div>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────────

function PresaleTable({
  entries, campaignMeta, copied, onCopy, onDelete, dimmed = false,
}: {
  entries: PresaleEntry[];
  campaignMeta: typeof CAMPAIGNS[string] | undefined;
  copied: number | null;
  onCopy: (id: number, code: string) => void;
  onDelete: (id: number) => void;
  dimmed?: boolean;
}) {
  return (
    <div className={`table-wrap${dimmed ? " opacity-60" : ""}`}>
      <table className="data-table">
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
          {entries.map((entry) => {
            const live   = isSlotActive(entry);
            const expired = isSlotExpired(entry);
            const upcoming = entry.slot_start && !live && !expired;
            return (
              <tr key={entry.id}>
                <td className="font-mono text-sm">{entry.account_email}</td>
                {!campaignMeta?.accountBound && (
                  <td>
                    {entry.presale_code ? (
                      <button
                        className="code-pill"
                        onClick={() => onCopy(entry.id, entry.presale_code!)}
                        title="Click to copy"
                      >
                        {copied === entry.id ? "Copied!" : entry.presale_code}
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                )}
                <td className="text-sm">{fmtSlot(entry.slot_start)}</td>
                <td className="text-sm">{fmtSlot(entry.slot_end)}</td>
                <td>
                  {live ? (
                    <span className="badge badge-green">🟢 Live now</span>
                  ) : expired ? (
                    <span className="badge badge-grey">Expired</span>
                  ) : upcoming ? (
                    <span className="badge badge-blue">Upcoming</span>
                  ) : (
                    <span className="badge badge-grey">Account-bound</span>
                  )}
                </td>
                <td>
                  <button
                    className="btn-icon btn-icon-danger"
                    onClick={() => { if (confirm("Remove this entry?")) void onDelete(entry.id); }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Manual add form ────────────────────────────────────────────────────────────

function AddEntryForm({ campaign, onAdded }: { campaign: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      setEmail(""); setCode(""); setSlotStart(""); setSlotEnd(""); setNotes("");
      setOpen(false);
      onAdded();
    } else {
      const json = await res.json() as { error?: string };
      setError(json.error ?? "Save failed");
    }
    setSaving(false);
  }

  if (!open) {
    return (
      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        + Add manually
      </button>
    );
  }

  return (
    <form className="add-entry-form" onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: 20 }}>
      <h3 className="form-title">Add {meta?.label} entry</h3>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="form-row">
        <label className="form-label">Account email *</label>
        <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="account@gmail.com" required />
      </div>

      {!meta?.accountBound && (
        <div className="form-row">
          <label className="form-label">Presale code</label>
          <input className="form-input" type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABC123" />
        </div>
      )}

      <div className="form-row">
        <label className="form-label">Slot opens</label>
        <input className="form-input" type="datetime-local" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} />
      </div>

      <div className="form-row">
        <label className="form-label">Slot closes</label>
        <input className="form-input" type="datetime-local" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} />
      </div>

      <div className="form-row">
        <label className="form-label">Notes</label>
        <input className="form-input" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
