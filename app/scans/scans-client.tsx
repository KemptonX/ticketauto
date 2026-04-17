"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
};

type FilterType = "all" | "success" | "failed";

function formatTs(ts: string): string {
  const d = new Date(ts);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ScansClient() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("sync_log")
        .select("id, created_at, scan_type, scanned, inserted, updated, matched, accounts_scanned, error")
        .order("created_at", { ascending: false })
        .limit(200);
      setLogs((data as SyncLog[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = logs.filter((l) => {
    if (filter === "success") return !l.error;
    if (filter === "failed") return !!l.error;
    return true;
  });

  const successCount = logs.filter((l) => !l.error).length;
  const failedCount = logs.filter((l) => !!l.error).length;
  const ticketsAdded = logs.filter((l) => l.scan_type === "orders").reduce((s, l) => s + (l.inserted ?? 0), 0);
  const salesAdded = logs.filter((l) => l.scan_type === "sales").reduce((s, l) => s + (l.inserted ?? 0), 0);
  const lastScan = logs[0] ? timeAgo(logs[0].created_at) : "—";

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
            <p className="eyebrow">Tools</p>
            <h2>Scan Logs</h2>
          </div>
        </header>

        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
          <div className="kpi-card">
            <span>Last Scan</span>
            <strong style={{ fontSize: "22px" }}>{lastScan}</strong>
          </div>
          <div className="kpi-card">
            <span>Total Runs</span>
            <strong>{logs.length}</strong>
          </div>
          <div className="kpi-card">
            <span>Successful</span>
            <strong style={{ color: "#22c55e" }}>{successCount}</strong>
          </div>
          <div className="kpi-card">
            <span>Tickets Added</span>
            <strong style={{ color: "#60a5fa" }}>{ticketsAdded}</strong>
          </div>
          <div className="kpi-card">
            <span>Sales Added</span>
            <strong style={{ color: "#a78bfa" }}>{salesAdded}</strong>
          </div>
        </div>

        {/* Table card */}
        <div className="command-card" style={{ borderRadius: "16px", padding: 0, overflow: "hidden" }}>
          {/* Header with toggles */}
          <div className="command-header" style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
            <h4 style={{ fontSize: "15px", fontWeight: 600, letterSpacing: "-0.02em" }}>Recent Scans</h4>
            <div className="view-toggle">
              {(["all", "success", "failed"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`toggle-btn${filter === f ? " toggle-btn-active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? `All (${logs.length})` : f === "success" ? `Success (${successCount})` : `Failed (${failedCount})`}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
              Loading scan logs…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
              No scan logs found.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Time", "Type", "Status", "Scanned", "Added", "Updated / Matched", "Accounts"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 20px",
                        textAlign: "left",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                        background: "rgba(255,255,255,0.02)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log, i) => {
                  const isOrders = log.scan_type === "orders";
                  const isFailed = !!log.error;
                  const hasNew = (log.inserted ?? 0) > 0;
                  const secondaryVal = isOrders ? (log.updated ?? 0) : (log.matched ?? 0);
                  const secondaryLabel = isOrders ? "upd" : "matched";
                  return (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: i < filtered.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                        background: isFailed
                          ? "rgba(239,68,68,0.04)"
                          : hasNew
                          ? "rgba(34,197,94,0.04)"
                          : "transparent",
                      }}
                    >
                      {/* Time */}
                      <td style={{ padding: "12px 20px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                          {formatTs(log.created_at)}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                          {timeAgo(log.created_at)}
                        </div>
                      </td>

                      {/* Type */}
                      <td style={{ padding: "12px 20px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            borderRadius: "20px",
                            fontSize: "11px",
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            background: isOrders ? "rgba(96,165,250,0.1)" : "rgba(167,139,250,0.1)",
                            color: isOrders ? "#60a5fa" : "#a78bfa",
                            border: `1px solid ${isOrders ? "rgba(96,165,250,0.25)" : "rgba(167,139,250,0.25)"}`,
                          }}
                        >
                          {isOrders ? "Tickets" : "Sales"}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 20px" }}>
                        {isFailed ? (
                          <span
                            title={log.error ?? undefined}
                            style={{
                              display: "inline-block",
                              padding: "2px 10px",
                              borderRadius: "20px",
                              fontSize: "11px",
                              fontWeight: 700,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              background: "rgba(239,68,68,0.1)",
                              color: "#f87171",
                              border: "1px solid rgba(239,68,68,0.25)",
                              cursor: "help",
                            }}
                          >
                            Failed
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 10px",
                              borderRadius: "20px",
                              fontSize: "11px",
                              fontWeight: 700,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              background: "rgba(34,197,94,0.1)",
                              color: "#22c55e",
                              border: "1px solid rgba(34,197,94,0.25)",
                            }}
                          >
                            OK
                          </span>
                        )}
                      </td>

                      {/* Scanned */}
                      <td style={{ padding: "12px 20px", textAlign: "center", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                        {log.scanned ?? 0}
                      </td>

                      {/* Added */}
                      <td style={{ padding: "12px 20px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                        {hasNew ? (
                          <span style={{ fontWeight: 700, color: "#22c55e" }}>{log.inserted}</span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>0</span>
                        )}
                      </td>

                      {/* Updated / Matched */}
                      <td style={{ padding: "12px 20px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                        {secondaryVal > 0 ? (
                          <span style={{ color: "var(--text-primary)" }}>
                            {secondaryVal}{" "}
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{secondaryLabel}</span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>—</span>
                        )}
                      </td>

                      {/* Accounts */}
                      <td style={{ padding: "12px 20px", textAlign: "center", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                        {log.accounts_scanned != null ? log.accounts_scanned : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
