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
};

function formatTs(ts: string): string {
  const d = new Date(ts);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = DAYS[d.getDay()];
  const date = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${date} ${month} ${year} ${hh}:${mm}`;
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
  const [filter, setFilter] = useState<"all" | "orders" | "sales">("all");

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("sync_log")
        .select("id, created_at, scan_type, scanned, inserted, updated, matched, accounts_scanned")
        .order("created_at", { ascending: false })
        .limit(200);
      setLogs((data as SyncLog[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.scan_type === filter);

  const totalOrders = logs.filter((l) => l.scan_type === "orders").reduce((s, l) => s + (l.inserted ?? 0), 0);
  const totalSales = logs.filter((l) => l.scan_type === "sales").reduce((s, l) => s + (l.inserted ?? 0), 0);
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
            <h2>Recent Scans</h2>
          </div>
        </header>

        <div className="orders-content">
          {/* Summary chips */}
          <div className="scans-summary-row">
            <div className="scans-stat-card">
              <span className="scans-stat-label">Last Scan</span>
              <span className="scans-stat-value">{lastScan}</span>
            </div>
            <div className="scans-stat-card">
              <span className="scans-stat-label">Total Scans</span>
              <span className="scans-stat-value">{logs.length}</span>
            </div>
            <div className="scans-stat-card">
              <span className="scans-stat-label">Tickets Added</span>
              <span className="scans-stat-value scans-stat-green">{totalOrders}</span>
            </div>
            <div className="scans-stat-card">
              <span className="scans-stat-label">Sales Added</span>
              <span className="scans-stat-value scans-stat-blue">{totalSales}</span>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="scans-filter-row">
            {(["all", "orders", "sales"] as const).map((f) => (
              <button
                key={f}
                className={`scans-filter-btn${filter === f ? " scans-filter-active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "orders" ? "Tickets" : "Sales"}
              </button>
            ))}
          </div>

          {/* Log table */}
          {loading ? (
            <div className="scans-empty">Loading scan logs…</div>
          ) : filtered.length === 0 ? (
            <div className="scans-empty">No scan logs found.</div>
          ) : (
            <div className="scans-table-wrap">
              <table className="scans-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Emails Scanned</th>
                    <th>Added</th>
                    <th>Updated / Matched</th>
                    <th>Accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log) => {
                    const isOrders = log.scan_type === "orders";
                    const secondaryLabel = isOrders ? "Updated" : "Matched";
                    const secondaryVal = isOrders ? (log.updated ?? 0) : (log.matched ?? 0);
                    const hasNew = (log.inserted ?? 0) > 0;
                    return (
                      <tr key={log.id} className={hasNew ? "scans-row-highlight" : ""}>
                        <td className="scans-td-time">
                          <span className="scans-ts">{formatTs(log.created_at)}</span>
                          <span className="scans-ago">{timeAgo(log.created_at)}</span>
                        </td>
                        <td>
                          <span className={`scans-type-badge scans-type-${log.scan_type}`}>
                            {isOrders ? "Tickets" : "Sales"}
                          </span>
                        </td>
                        <td className="scans-td-num">{log.scanned ?? 0}</td>
                        <td className="scans-td-num">
                          {hasNew ? (
                            <span className="scans-added-highlight">{log.inserted}</span>
                          ) : (
                            <span className="scans-zero">0</span>
                          )}
                        </td>
                        <td className="scans-td-num scans-td-secondary">
                          {secondaryVal > 0 ? secondaryVal : <span className="scans-zero">0</span>}
                          <span className="scans-secondary-label">{secondaryLabel}</span>
                        </td>
                        <td className="scans-td-num">
                          {log.accounts_scanned != null ? log.accounts_scanned : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
