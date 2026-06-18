"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: true },
  { label: "Clients", href: "/clients", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail", outlook: "Outlook",
  ticketmaster_direct: "TM UK", ticketmaster_de: "TM DE",
  ticketmaster_es: "TM ES", ticketmaster_it: "TM IT",
  ticketmaster_us: "TM US", ticketmaster_fr: "TM FR",
  ticketmaster_nl: "TM NL", ticketmaster_au: "TM AU",
  ticketmaster_ca: "TM CA", axs: "AXS",
};

type AccountResult = { email: string; provider: string; inserted: number; updated: number };

type SyncLog = {
  id: number;
  created_at: string;
  scan_type: "orders" | "sales";
  scanned: number | null;
  inserted: number | null;
  updated: number | null;
  matched: number | null;
  accounts_scanned: number | null;
  error: string | null;
  account_results: AccountResult[] | null;
  errors_detail: string[] | null;
};

type FilterType = "all" | "orders" | "sales" | "failed";

type LifecycleResult = {
  id: number;
  scan_log_id: number;
  email_type: string;
  order_id: string | null;
  payment_reference: string | null;
  event_name: string | null;
  event_date: string | null;
  order_date: string | null;
  amount: number | null;
  qty: number | null;
  sale_id: number | null;
  match_status: string;
  action_taken: string | null;
  confidence: string | null;
  notes: string | null;
  created_at: string;
  sales_scan_log: {
    received_at: string | null;
    subject: string | null;
    account_email: string | null;
  } | null;
};

type LifecycleFilter = "all" | "transfer" | "payout" | "matched" | "review";

type ScanSummary = {
  scanned: number;
  processed: number;
  updated: number;
  needsReview: number;
  alreadyProcessed: number;
  errors: number;
  cutoffDate: string;
};

function formatTs(ts: string): string {
  const d = new Date(ts);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return "—";
  return `£${v.toFixed(2)}`;
}

export default function ScansClient() {
  const [activeTab, setActiveTab] = useState<"history" | "lifecycle">("history");

  // ── Scan history state ──────────────────────────────────────────────────────
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<Set<number>>(new Set());

  // ── Lifecycle scan state ────────────────────────────────────────────────────
  const [lcResults, setLcResults] = useState<LifecycleResult[]>([]);
  const [lcLoading, setLcLoading] = useState(false);
  const [lcScanning, setLcScanning] = useState(false);
  const [lcFilter, setLcFilter] = useState<LifecycleFilter>("all");
  const [lcError, setLcError] = useState<string | null>(null);
  const [lcLastScan, setLcLastScan] = useState<ScanSummary | null>(null);
  const [lcCutoffDate, setLcCutoffDate] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("lc_cutoff") ?? defaultCutoff();
    }
    return defaultCutoff();
  });
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [lcDeleting, setLcDeleting] = useState<Set<number>>(new Set());

  function defaultCutoff(): string {
    return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // ── Scan history functions ──────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sync_log")
      .select("id, created_at, scan_type, scanned, inserted, updated, matched, accounts_scanned, error, account_results, errors_detail")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      const { data: basic } = await supabase
        .from("sync_log")
        .select("id, created_at, scan_type, scanned, inserted, updated, matched, accounts_scanned, error")
        .order("created_at", { ascending: false })
        .limit(500);
      setLogs((basic as SyncLog[]) ?? []);
    } else {
      setLogs((data as SyncLog[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function deleteLog(id: number) {
    if (!window.confirm("Delete this scan log?")) return;
    setDeleting((prev) => new Set(prev).add(id));
    await supabase.from("sync_log").delete().eq("id", id);
    setLogs((prev) => prev.filter((l) => l.id !== id));
    setDeleting((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function clearAll() {
    if (!window.confirm("Delete all scan logs? This cannot be undone.")) return;
    await supabase.from("sync_log").delete().gt("id", 0);
    setLogs([]);
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Lifecycle scan functions ────────────────────────────────────────────────

  async function loadLifecycleResults() {
    setLcLoading(true);
    const { data } = await supabase
      .from("sales_scan_results")
      .select("*, sales_scan_log(received_at, subject, account_email)")
      .order("created_at", { ascending: false })
      .limit(500);
    setLcResults((data as LifecycleResult[]) ?? []);
    setLcLoading(false);
  }

  useEffect(() => {
    if (activeTab === "lifecycle") void loadLifecycleResults();
  }, [activeTab]);

  async function runLifecycleScan() {
    setLcScanning(true);
    setLcError(null);
    localStorage.setItem("lc_cutoff", lcCutoffDate);
    try {
      const res = await fetch("/api/scan-sales-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffDate: lcCutoffDate }),
      });
      const json = (await res.json()) as ScanSummary & { ok?: boolean; error?: string };
      if (!res.ok || json.error) {
        setLcError(json.error ?? "Scan failed");
      } else {
        setLcLastScan(json);
        await loadLifecycleResults();
      }
    } catch (e) {
      setLcError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLcScanning(false);
    }
  }

  async function linkToSale(resultId: number) {
    const saleId = parseInt(linkInput.trim(), 10);
    if (!saleId || Number.isNaN(saleId)) return;
    setLinkSaving(true);
    await supabase
      .from("sales_scan_results")
      .update({ sale_id: saleId, match_status: "matched", action_taken: "manual_link", confidence: "manual" })
      .eq("id", resultId);
    setLinkingId(null);
    setLinkInput("");
    setLinkSaving(false);
    await loadLifecycleResults();
  }

  async function ignoreResult(resultId: number) {
    await supabase
      .from("sales_scan_results")
      .update({ match_status: "ignored" })
      .eq("id", resultId);
    setLcResults((prev) =>
      prev.map((r) => (r.id === resultId ? { ...r, match_status: "ignored" } : r)),
    );
  }

  async function deleteLcResult(resultId: number) {
    setLcDeleting((prev) => new Set(prev).add(resultId));
    await supabase.from("sales_scan_results").delete().eq("id", resultId);
    setLcResults((prev) => prev.filter((r) => r.id !== resultId));
    setLcDeleting((prev) => { const s = new Set(prev); s.delete(resultId); return s; });
  }

  async function clearAllLifecycle() {
    if (!window.confirm("Clear all lifecycle scan results? This cannot be undone.")) return;
    await supabase.from("sales_scan_log").delete().gt("id", 0);
    setLcResults([]);
    setLcLastScan(null);
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const orderLogs = logs.filter((l) => l.scan_type === "orders");
  const salesLogs = logs.filter((l) => l.scan_type === "sales");
  const failedCount = logs.filter((l) => !!l.error).length;
  const ticketsAdded = orderLogs.reduce((s, l) => s + (l.inserted ?? 0), 0);
  const ticketsUpdated = orderLogs.reduce((s, l) => s + (l.updated ?? 0), 0);
  const salesMatched = salesLogs.reduce((s, l) => s + (l.matched ?? 0), 0);
  const lastScan = logs[0] ? timeAgo(logs[0].created_at) : "—";
  const lastScanFull = logs[0] ? formatTs(logs[0].created_at) : "No scans yet";

  const filteredLogs = logs.filter((l) => {
    if (filter === "orders") return l.scan_type === "orders";
    if (filter === "sales") return l.scan_type === "sales";
    if (filter === "failed") return !!l.error;
    return true;
  });

  const filteredLcResults = lcResults.filter((r) => {
    if (lcFilter === "transfer") return r.email_type === "transfer_complete";
    if (lcFilter === "payout") return r.email_type === "payout";
    if (lcFilter === "matched") return r.match_status === "matched";
    if (lcFilter === "review") return r.match_status === "unmatched" || r.match_status === "needs_review";
    return true;
  });

  const lcMatchedCount = lcResults.filter((r) => r.match_status === "matched").length;
  const lcReviewCount = lcResults.filter(
    (r) => r.match_status === "unmatched" || r.match_status === "needs_review",
  ).length;
  const lcTransferCount = lcResults.filter((r) => r.email_type === "transfer_complete").length;
  const lcPayoutCount = lcResults.filter((r) => r.email_type === "payout").length;

  function matchBadge(status: string) {
    switch (status) {
      case "matched": return <span className="status-badge badge-sold">Matched</span>;
      case "already_processed": return <span className="status-badge badge-listed">Done</span>;
      case "unmatched": return <span className="status-badge badge-problem">No Match</span>;
      case "needs_review": return <span className="status-badge badge-unlisted">Review</span>;
      case "ignored": return <span className="status-badge" style={{ background: "rgba(100,100,100,0.15)", color: "var(--muted)" }}>Ignored</span>;
      case "error": return <span className="status-badge badge-problem">Error</span>;
      default: return <span className="status-badge">{status}</span>;
    }
  }

  function actionBadge(action: string | null) {
    if (!action || action === "no_change") return <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>;
    if (action === "updated_transfer") return <span style={{ fontSize: "12px", color: "#60a5fa" }}>Transfer updated</span>;
    if (action === "updated_payment") return <span style={{ fontSize: "12px", color: "#34d399" }}>Payment updated</span>;
    if (action === "manual_link") return <span style={{ fontSize: "12px", color: "#a78bfa" }}>Manually linked</span>;
    if (action === "ignored") return <span style={{ fontSize: "12px", color: "var(--muted)" }}>Ignored</span>;
    return <span style={{ fontSize: "12px" }}>{action}</span>;
  }

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`}>
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
            <p className="eyebrow">Tools</p>
            <h2>Scans</h2>
          </div>
          <div className="topbar-actions">
            {activeTab === "history" && (
              <>
                <button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button>
                {logs.length > 0 && (
                  <button type="button" className="ghost-button danger-button" onClick={() => void clearAll()}>Clear all</button>
                )}
              </>
            )}
            {activeTab === "lifecycle" && lcResults.length > 0 && (
              <button type="button" className="ghost-button danger-button" onClick={() => void clearAllLifecycle()}>Clear results</button>
            )}
          </div>
        </header>

        {/* Top-level tab switcher */}
        <div className="view-toggle" style={{ marginBottom: "1.25rem" }}>
          <button
            type="button"
            className={`toggle-btn${activeTab === "history" ? " toggle-btn-active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            Scan History
          </button>
          <button
            type="button"
            className={`toggle-btn${activeTab === "lifecycle" ? " toggle-btn-active" : ""}`}
            onClick={() => setActiveTab("lifecycle")}
          >
            Lifecycle Scan
            {lcReviewCount > 0 && (
              <span style={{ marginLeft: "5px", background: "#f87171", color: "#fff", borderRadius: "10px", padding: "0 5px", fontSize: "10px", fontWeight: 700 }}>
                {lcReviewCount}
              </span>
            )}
          </button>
        </div>

        {/* ── SCAN HISTORY TAB ────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <>
            <section className="hero-card connections-hero" style={{ marginBottom: "1rem" }}>
              <div>
                <p className="section-tag">Overview</p>
                <h3>Email scan activity</h3>
                <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: "0.25rem" }}>{lastScanFull}</p>
              </div>
              <div className="hero-meta">
                <div><span className="hero-meta-label">Last scan</span><strong>{lastScan}</strong></div>
                <div><span className="hero-meta-label">Total runs</span><strong>{logs.length}</strong></div>
                <div><span className="hero-meta-label">Tickets found</span><strong style={{ color: "#22c55e" }}>{ticketsAdded}</strong></div>
              </div>
            </section>

            <section className="kpi-grid connections-kpi-grid" style={{ marginBottom: "1.25rem" }}>
              <article className="kpi-card">
                <p className="kpi-label">Ticket scans</p>
                <strong className="kpi-value">{orderLogs.length}</strong>
                <span className="kpi-trend">{ticketsAdded} tickets added all time</span>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Sales scans</p>
                <strong className="kpi-value">{salesLogs.length}</strong>
                <span className="kpi-trend">{salesMatched} sales matched all time</span>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Tickets updated</p>
                <strong className="kpi-value">{ticketsUpdated}</strong>
                <span className="kpi-trend">refreshed across all scans</span>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Failed scans</p>
                <strong className="kpi-value" style={{ color: failedCount > 0 ? "#f87171" : undefined }}>{failedCount}</strong>
                <span className="kpi-trend">{failedCount === 0 ? "All scans clean" : "Check error details below"}</span>
              </article>
            </section>

            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Log</p>
                  <h4>Recent scan runs</h4>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className="table-count">{filteredLogs.length} entries</span>
                  <div className="view-toggle">
                    {(["all", "orders", "sales", "failed"] as FilterType[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`toggle-btn${filter === f ? " toggle-btn-active" : ""}`}
                        onClick={() => setFilter(f)}
                      >
                        {f === "all" ? `All (${logs.length})` : f === "orders" ? "Tickets" : f === "sales" ? "Sales" : `Failed${failedCount > 0 ? ` (${failedCount})` : ""}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="empty-state compact-empty-state"><h5>Loading scan logs…</h5></div>
              ) : filteredLogs.length === 0 ? (
                <div className="empty-state compact-empty-state">
                  <div className="empty-orb" />
                  <h5>No scan logs found</h5>
                  <p>Run a scan from the Tickets page to see results here.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th style={{ textAlign: "center" }}>Scanned</th>
                        <th style={{ textAlign: "center" }}>Added</th>
                        <th style={{ textAlign: "center" }}>Updated</th>
                        <th style={{ textAlign: "center" }}>Matched</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.map((log) => {
                        const isOrders = log.scan_type === "orders";
                        const isFailed = !!log.error;
                        const isExp = expanded.has(log.id);
                        const hasAdded = (log.inserted ?? 0) > 0;
                        const hasDetail =
                          (log.account_results && log.account_results.length > 0) ||
                          (log.errors_detail && log.errors_detail.length > 0) ||
                          !!log.error;

                        return (
                          <Fragment key={log.id}>
                            <tr
                              style={{
                                background: isFailed
                                  ? "rgba(239,68,68,0.04)"
                                  : hasAdded
                                  ? "rgba(34,197,94,0.03)"
                                  : undefined,
                              }}
                            >
                              <td>
                                <div style={{ fontWeight: 500, fontSize: "13px" }}>{formatTs(log.created_at)}</div>
                                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>{timeAgo(log.created_at)}</div>
                              </td>
                              <td>
                                <span className={`status-badge ${isOrders ? "badge-listed" : "badge-unlisted"}`}>
                                  {isOrders ? "Tickets" : "Sales"}
                                </span>
                              </td>
                              <td>
                                {isFailed
                                  ? <span className="status-badge badge-problem">Failed</span>
                                  : <span className="status-badge badge-sold">OK</span>}
                              </td>
                              <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                                {log.scanned ?? 0}
                              </td>
                              <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                                {hasAdded
                                  ? <strong style={{ color: "#22c55e" }}>+{log.inserted}</strong>
                                  : <span style={{ color: "var(--muted)", opacity: 0.4 }}>0</span>}
                              </td>
                              <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                                {(log.updated ?? 0) > 0
                                  ? <span>{log.updated}</span>
                                  : <span style={{ color: "var(--muted)", opacity: 0.4 }}>—</span>}
                              </td>
                              <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                                {(log.matched ?? 0) > 0
                                  ? <span style={{ color: "#a78bfa" }}>{log.matched}</span>
                                  : <span style={{ color: "var(--muted)", opacity: 0.4 }}>—</span>}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", alignItems: "center" }}>
                                  {hasDetail && (
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      style={{ padding: "3px 10px", fontSize: "11px", minHeight: "unset" }}
                                      onClick={() => toggleExpand(log.id)}
                                    >
                                      {isExp ? "Hide" : "Details"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="ghost-button danger-button"
                                    style={{ padding: "3px 10px", fontSize: "11px", minHeight: "unset" }}
                                    disabled={deleting.has(log.id)}
                                    onClick={() => void deleteLog(log.id)}
                                  >
                                    {deleting.has(log.id) ? "…" : "Delete"}
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {isExp && (
                              <tr style={{ background: "rgba(255,255,255,0.015)" }}>
                                <td colSpan={8} style={{ padding: "0 1.5rem 1.25rem" }}>
                                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                                    {log.account_results && log.account_results.length > 0 && (
                                      <div>
                                        <p className="section-tag" style={{ marginBottom: "0.5rem" }}>Account breakdown</p>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                          {log.account_results.map((ar, i) => (
                                            <div
                                              key={i}
                                              style={{
                                                background: "var(--surface-2)",
                                                borderRadius: "8px",
                                                padding: "0.625rem 1rem",
                                                border: "1px solid var(--border)",
                                                minWidth: "200px",
                                                flex: "1 1 200px",
                                                maxWidth: "320px",
                                              }}
                                            >
                                              <div style={{ fontWeight: 600, fontSize: "12px", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {ar.email}
                                              </div>
                                              <div style={{ display: "flex", gap: "0.625rem", fontSize: "12px", color: "var(--muted)", flexWrap: "wrap" }}>
                                                <span className="status-badge badge-unlisted" style={{ fontSize: "10px", padding: "1px 6px" }}>
                                                  {PROVIDER_LABELS[ar.provider] ?? ar.provider}
                                                </span>
                                                {ar.inserted > 0 && <span style={{ color: "#22c55e", fontWeight: 600 }}>+{ar.inserted} new</span>}
                                                {ar.updated > 0 && <span style={{ color: "var(--text-primary)" }}>{ar.updated} updated</span>}
                                                {ar.inserted === 0 && ar.updated === 0 && <span style={{ opacity: 0.5 }}>no changes</span>}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {log.errors_detail && log.errors_detail.length > 0 && (
                                      <div>
                                        <p className="section-tag" style={{ marginBottom: "0.5rem", color: "#f87171" }}>
                                          Errors ({log.errors_detail.length})
                                        </p>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                          {log.errors_detail.map((err, i) => (
                                            <div
                                              key={i}
                                              style={{
                                                fontSize: "12px", color: "#fca5a5",
                                                background: "rgba(239,68,68,0.07)", padding: "0.4rem 0.75rem",
                                                borderRadius: "6px", border: "1px solid rgba(239,68,68,0.18)",
                                                fontFamily: "monospace", wordBreak: "break-all",
                                              }}
                                            >
                                              {err}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {log.error && !(log.errors_detail?.length) && (
                                      <div>
                                        <p className="section-tag" style={{ marginBottom: "0.5rem", color: "#f87171" }}>Error</p>
                                        <div
                                          style={{
                                            fontSize: "12px", color: "#fca5a5",
                                            background: "rgba(239,68,68,0.07)", padding: "0.4rem 0.75rem",
                                            borderRadius: "6px", border: "1px solid rgba(239,68,68,0.18)",
                                            fontFamily: "monospace", wordBreak: "break-all",
                                          }}
                                        >
                                          {log.error}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── LIFECYCLE SCAN TAB ────────────────────────────────────────────── */}
        {activeTab === "lifecycle" && (
          <>
            {/* Scan config */}
            <section className="table-card" style={{ marginBottom: "1.25rem" }}>
              <div style={{ padding: "1.25rem 1.5rem" }}>
                <p className="section-tag" style={{ marginBottom: "0.5rem" }}>Scan Configuration</p>
                <h4 style={{ marginBottom: "1rem" }}>Transfer & Payout Emails</h4>
                <div style={{ display: "flex", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>
                      Scan emails from date
                    </label>
                    <input
                      type="date"
                      value={lcCutoffDate}
                      onChange={(e) => setLcCutoffDate(e.target.value)}
                      className="form-input"
                      style={{ width: "180px" }}
                    />
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={lcScanning}
                    onClick={() => void runLifecycleScan()}
                  >
                    {lcScanning ? "Scanning…" : "Scan Now"}
                  </button>
                  {lcResults.length > 0 && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={lcLoading}
                      onClick={() => void loadLifecycleResults()}
                    >
                      Refresh
                    </button>
                  )}
                </div>
                {lcError && (
                  <div style={{ marginTop: "0.75rem", fontSize: "13px", color: "#f87171", background: "rgba(239,68,68,0.07)", padding: "0.5rem 0.75rem", borderRadius: "6px" }}>
                    {lcError}
                  </div>
                )}
                <p style={{ marginTop: "0.75rem", fontSize: "12px", color: "var(--muted)", maxWidth: "560px" }}>
                  Scans your connected email accounts for viagogo transfer confirmation and payout emails. Updates transfer status and payment status on matching sale records. Only emails on or after the cutoff date are scanned; already-processed emails are skipped automatically.
                </p>
              </div>
            </section>

            {/* Last scan summary */}
            {lcLastScan && (
              <section className="kpi-grid connections-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <article className="kpi-card">
                  <p className="kpi-label">Scanned</p>
                  <strong className="kpi-value">{lcLastScan.scanned}</strong>
                  <span className="kpi-trend">emails found</span>
                </article>
                <article className="kpi-card">
                  <p className="kpi-label">Updated</p>
                  <strong className="kpi-value" style={{ color: lcLastScan.updated > 0 ? "#22c55e" : undefined }}>
                    {lcLastScan.updated}
                  </strong>
                  <span className="kpi-trend">sale records updated</span>
                </article>
                <article className="kpi-card">
                  <p className="kpi-label">Needs Review</p>
                  <strong className="kpi-value" style={{ color: lcLastScan.needsReview > 0 ? "#f87171" : undefined }}>
                    {lcLastScan.needsReview}
                  </strong>
                  <span className="kpi-trend">no match found</span>
                </article>
                <article className="kpi-card">
                  <p className="kpi-label">Already Done</p>
                  <strong className="kpi-value">{lcLastScan.alreadyProcessed}</strong>
                  <span className="kpi-trend">skipped (duplicate)</span>
                </article>
              </section>
            )}

            {/* Results table */}
            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Results</p>
                  <h4>Lifecycle scan results</h4>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className="table-count">{filteredLcResults.length} rows</span>
                  <div className="view-toggle">
                    {([
                      ["all", `All (${lcResults.length})`],
                      ["transfer", `Transfer (${lcTransferCount})`],
                      ["payout", `Payout (${lcPayoutCount})`],
                      ["matched", `Matched (${lcMatchedCount})`],
                      ["review", lcReviewCount > 0 ? `Review (${lcReviewCount})` : "Review"],
                    ] as [LifecycleFilter, string][]).map(([f, label]) => (
                      <button
                        key={f}
                        type="button"
                        className={`toggle-btn${lcFilter === f ? " toggle-btn-active" : ""}`}
                        onClick={() => setLcFilter(f)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {lcLoading ? (
                <div className="empty-state compact-empty-state"><h5>Loading results…</h5></div>
              ) : filteredLcResults.length === 0 ? (
                <div className="empty-state compact-empty-state">
                  <div className="empty-orb" />
                  <h5>{lcResults.length === 0 ? "No results yet" : "No results match this filter"}</h5>
                  {lcResults.length === 0 && (
                    <p>Set a cutoff date and click Scan Now to scan transfer and payout emails.</p>
                  )}
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Email Date</th>
                        <th>Type</th>
                        <th>Order ID</th>
                        <th>Event</th>
                        <th style={{ textAlign: "center" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                        <th>Match</th>
                        <th>Action</th>
                        <th>Sale</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLcResults.map((r) => {
                        const receivedAt = r.sales_scan_log?.received_at ?? r.created_at;
                        const isLinking = linkingId === r.id;
                        const canLink = r.match_status === "unmatched" || r.match_status === "needs_review";

                        return (
                          <Fragment key={r.id}>
                            <tr>
                              <td>
                                <div style={{ fontSize: "13px", fontWeight: 500 }}>{fmtDate(receivedAt)}</div>
                                <div style={{ fontSize: "11px", color: "var(--muted)" }}>{r.sales_scan_log?.account_email ?? ""}</div>
                              </td>
                              <td>
                                {r.email_type === "transfer_complete" ? (
                                  <span className="status-badge badge-listed">Transfer</span>
                                ) : (
                                  <span className="status-badge badge-sold">Payout</span>
                                )}
                              </td>
                              <td>
                                <span style={{ fontFamily: "monospace", fontSize: "12px" }}>
                                  {r.order_id ?? r.payment_reference ?? "—"}
                                </span>
                                {r.payment_reference && r.order_id && r.payment_reference !== r.order_id && (
                                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>ref #{r.payment_reference}</div>
                                )}
                              </td>
                              <td>
                                <div style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px" }}>
                                  {r.event_name ?? "—"}
                                </div>
                                {r.event_date && (
                                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>{r.event_date}</div>
                                )}
                              </td>
                              <td style={{ textAlign: "center", fontSize: "13px" }}>{r.qty ?? "—"}</td>
                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "13px" }}>
                                {fmtAmount(r.amount)}
                              </td>
                              <td>{matchBadge(r.match_status)}</td>
                              <td>{actionBadge(r.action_taken)}</td>
                              <td>
                                {r.sale_id ? (
                                  <Link
                                    href={`/sales?highlight=${r.sale_id}`}
                                    style={{ fontSize: "12px", color: "#60a5fa", textDecoration: "none" }}
                                  >
                                    #{r.sale_id}
                                  </Link>
                                ) : (
                                  <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>
                                )}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end", alignItems: "center" }}>
                                  {canLink && !isLinking && (
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      style={{ padding: "3px 8px", fontSize: "11px", minHeight: "unset" }}
                                      onClick={() => { setLinkingId(r.id); setLinkInput(""); }}
                                    >
                                      Link
                                    </button>
                                  )}
                                  {canLink && (
                                    <button
                                      type="button"
                                      className="ghost-button"
                                      style={{ padding: "3px 8px", fontSize: "11px", minHeight: "unset", opacity: 0.6 }}
                                      onClick={() => void ignoreResult(r.id)}
                                    >
                                      Ignore
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="ghost-button danger-button"
                                    style={{ padding: "3px 8px", fontSize: "11px", minHeight: "unset" }}
                                    disabled={lcDeleting.has(r.id)}
                                    onClick={() => void deleteLcResult(r.id)}
                                  >
                                    {lcDeleting.has(r.id) ? "…" : "×"}
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* Inline link form */}
                            {isLinking && (
                              <tr style={{ background: "rgba(96,165,250,0.05)" }}>
                                <td colSpan={10} style={{ padding: "0.75rem 1.5rem" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                    <span style={{ fontSize: "13px" }}>Link to sale ID:</span>
                                    <input
                                      type="number"
                                      value={linkInput}
                                      onChange={(e) => setLinkInput(e.target.value)}
                                      className="form-input"
                                      style={{ width: "120px" }}
                                      placeholder="e.g. 42"
                                      autoFocus
                                      onKeyDown={(e) => { if (e.key === "Enter") void linkToSale(r.id); if (e.key === "Escape") setLinkingId(null); }}
                                    />
                                    <button
                                      type="button"
                                      className="primary-button"
                                      style={{ padding: "5px 12px", fontSize: "12px" }}
                                      disabled={linkSaving || !linkInput}
                                      onClick={() => void linkToSale(r.id)}
                                    >
                                      {linkSaving ? "Saving…" : "Confirm"}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost-button"
                                      style={{ padding: "5px 10px", fontSize: "12px" }}
                                      onClick={() => setLinkingId(null)}
                                    >
                                      Cancel
                                    </button>
                                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                                      Order ID: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{r.order_id}</strong>
                                      {r.event_name ? ` — ${r.event_name}` : ""}
                                    </span>
                                  </div>
                                  {r.notes && (
                                    <p style={{ marginTop: "0.4rem", fontSize: "12px", color: "#f87171" }}>{r.notes}</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
