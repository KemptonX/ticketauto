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
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: true },
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

export default function ScansClient() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<Set<number>>(new Set());

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function load() {
    setLoading(true);
    // Try with detail columns first; fall back if they don't exist yet
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
      setLogs((basic as SyncLog[]) || []);
    } else {
      setLogs((data as SyncLog[]) || []);
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

  const orderLogs = logs.filter((l) => l.scan_type === "orders");
  const salesLogs = logs.filter((l) => l.scan_type === "sales");
  const failedCount = logs.filter((l) => !!l.error).length;
  const ticketsAdded = orderLogs.reduce((s, l) => s + (l.inserted ?? 0), 0);
  const ticketsUpdated = orderLogs.reduce((s, l) => s + (l.updated ?? 0), 0);
  const salesMatched = salesLogs.reduce((s, l) => s + (l.matched ?? 0), 0);
  const lastScan = logs[0] ? timeAgo(logs[0].created_at) : "—";
  const lastScanFull = logs[0] ? formatTs(logs[0].created_at) : "No scans yet";

  const filtered = logs.filter((l) => {
    if (filter === "orders") return l.scan_type === "orders";
    if (filter === "sales") return l.scan_type === "sales";
    if (filter === "failed") return !!l.error;
    return true;
  });

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
            <h2>Scan History</h2>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button>
            {logs.length > 0 && (
              <button type="button" className="ghost-button danger-button" onClick={() => void clearAll()}>Clear all</button>
            )}
          </div>
        </header>

        {/* Hero */}
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

        {/* KPIs */}
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

        {/* Table */}
        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Log</p>
              <h4>Recent scan runs</h4>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span className="table-count">{filtered.length} entries</span>
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
          ) : filtered.length === 0 ? (
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
                  {filtered.map((log) => {
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
                          {/* Time */}
                          <td>
                            <div style={{ fontWeight: 500, fontSize: "13px" }}>{formatTs(log.created_at)}</div>
                            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>{timeAgo(log.created_at)}</div>
                          </td>

                          {/* Type */}
                          <td>
                            <span className={`status-badge ${isOrders ? "badge-listed" : "badge-unlisted"}`}>
                              {isOrders ? "Tickets" : "Sales"}
                            </span>
                          </td>

                          {/* Status */}
                          <td>
                            {isFailed
                              ? <span className="status-badge badge-problem">Failed</span>
                              : <span className="status-badge badge-sold">OK</span>}
                          </td>

                          {/* Scanned */}
                          <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                            {log.scanned ?? 0}
                          </td>

                          {/* Added */}
                          <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                            {hasAdded
                              ? <strong style={{ color: "#22c55e" }}>+{log.inserted}</strong>
                              : <span style={{ color: "var(--muted)", opacity: 0.4 }}>0</span>}
                          </td>

                          {/* Updated */}
                          <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                            {(log.updated ?? 0) > 0
                              ? <span>{log.updated}</span>
                              : <span style={{ color: "var(--muted)", opacity: 0.4 }}>—</span>}
                          </td>

                          {/* Matched */}
                          <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                            {(log.matched ?? 0) > 0
                              ? <span style={{ color: "#a78bfa" }}>{log.matched}</span>
                              : <span style={{ color: "var(--muted)", opacity: 0.4 }}>—</span>}
                          </td>

                          {/* Actions */}
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

                        {/* Expanded detail row */}
                        {isExp && (
                          <tr style={{ background: "rgba(255,255,255,0.015)" }}>
                            <td colSpan={8} style={{ padding: "0 1.5rem 1.25rem" }}>
                              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

                                {/* Per-account breakdown */}
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
                                            {ar.inserted > 0 && (
                                              <span style={{ color: "#22c55e", fontWeight: 600 }}>+{ar.inserted} new</span>
                                            )}
                                            {ar.updated > 0 && (
                                              <span style={{ color: "var(--text-primary)" }}>{ar.updated} updated</span>
                                            )}
                                            {ar.inserted === 0 && ar.updated === 0 && (
                                              <span style={{ opacity: 0.5 }}>no changes</span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Errors from detail column */}
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
                                            fontSize: "12px",
                                            color: "#fca5a5",
                                            background: "rgba(239,68,68,0.07)",
                                            padding: "0.4rem 0.75rem",
                                            borderRadius: "6px",
                                            border: "1px solid rgba(239,68,68,0.18)",
                                            fontFamily: "monospace",
                                            wordBreak: "break-all",
                                          }}
                                        >
                                          {err}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Legacy error field */}
                                {log.error && !(log.errors_detail?.length) && (
                                  <div>
                                    <p className="section-tag" style={{ marginBottom: "0.5rem", color: "#f87171" }}>Error</p>
                                    <div
                                      style={{
                                        fontSize: "12px",
                                        color: "#fca5a5",
                                        background: "rgba(239,68,68,0.07)",
                                        padding: "0.4rem 0.75rem",
                                        borderRadius: "6px",
                                        border: "1px solid rgba(239,68,68,0.18)",
                                        fontFamily: "monospace",
                                        wordBreak: "break-all",
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
      </main>
    </div>
  );
}
