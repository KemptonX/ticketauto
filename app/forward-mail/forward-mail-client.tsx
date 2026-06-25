"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

const navItems = [
  { label: "Dashboard",    href: "/",                   active: false },
  { label: "Tickets",      href: "/orders",             active: false },
  { label: "Sales",        href: "/sales",              active: false },
  { label: "Analytics",   href: "/analytics",          active: false },
  { label: "Cash Flow",    href: "/cash-flow",          active: false },
  { label: "Costs",        href: "/costs",              active: false },
  { label: "Calculator",   href: "/viagogo-calculator", active: false },
  { label: "Scans",        href: "/scans",              active: false },
  { label: "Forward Mail", href: "/forward-mail",       active: true  },
  { label: "FAQ",          href: "/faq",                active: false, target: "_blank", rel: "noopener noreferrer" },
];

type MailEvent = {
  id: number;
  sender_email: string | null;
  subject: string | null;
  received_at: string | null;
  processing_status: string | null;
  booking_ref_detected: string | null;
  error_message: string | null;
  postmark_message_id: string | null;
};

type FilterType = "all" | "imported" | "failed" | "duplicate" | "skipped" | "verification";

const STATUS_LABELS: Record<string, string> = {
  imported:           "Imported",
  updated:            "Updated",
  duplicate:          "Duplicate",
  failed:             "Failed",
  verification_email: "Verification",
  no_ref_ignored:     "No Ref",
  unknown_token:      "Bad Token",
  disabled_token:     "Disabled",
  received:           "Received",
};

function statusBadge(status: string | null) {
  const s = status ?? "received";
  const label = STATUS_LABELS[s] ?? s;
  const cls =
    s === "imported"           ? "status-sold" :
    s === "updated"            ? "status-listed" :
    s === "duplicate"          ? "status-unlisted" :
    s === "failed"             ? "status-problem" :
    s === "verification_email" ? "status-personal" :
    s === "no_ref_ignored"     ? "status-unlisted" :
    "status-unlisted";
  return (
    <span className={`status-badge status-static ${cls}`}>{label}</span>
  );
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ForwardMailClient() {
  const [events, setEvents] = useState<MailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("inbound_email_events")
      .select("id, sender_email, subject, received_at, processing_status, booking_ref_detected, error_message, postmark_message_id")
      .order("received_at", { ascending: false })
      .limit(500);
    setEvents((data as MailEvent[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const total        = events.length;
  const imported     = events.filter((e) => e.processing_status === "imported" || e.processing_status === "updated").length;
  const failed       = events.filter((e) => e.processing_status === "failed").length;
  const duplicates   = events.filter((e) => e.processing_status === "duplicate").length;
  const lastReceived = events[0] ? timeAgo(events[0].received_at!) : "—";
  const lastFull     = events[0] ? formatTs(events[0].received_at!) : "No emails yet";

  const filtered = events.filter((e) => {
    const s = e.processing_status ?? "";
    if (filter === "imported")     return s === "imported" || s === "updated";
    if (filter === "failed")       return s === "failed";
    if (filter === "duplicate")    return s === "duplicate";
    if (filter === "verification") return s === "verification_email";
    if (filter === "skipped")      return s === "no_ref_ignored" || s === "unknown_token" || s === "disabled_token";
    return true;
  });

  const filterTabs: { key: FilterType; label: string; count: number }[] = [
    { key: "all",          label: "All",          count: total },
    { key: "imported",     label: "Imported",     count: imported },
    { key: "failed",       label: "Failed",       count: failed },
    { key: "duplicate",    label: "Duplicate",    count: duplicates },
    { key: "verification", label: "Verification", count: events.filter((e) => e.processing_status === "verification_email").length },
    { key: "skipped",      label: "Skipped",      count: events.filter((e) => ["no_ref_ignored","unknown_token","disabled_token"].includes(e.processing_status ?? "")).length },
  ];

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
                {...(item.target ? { target: item.target, rel: item.rel } : {})}
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
            <p className="eyebrow">Email Forwarding</p>
            <h2>Forward Mail</h2>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary-button" onClick={() => void load()}>
              Refresh
            </button>
            <Link href="/settings" className="secondary-button">
              Settings
            </Link>
          </div>
        </header>

        <section className="hero-card connections-hero" style={{ marginBottom: "1rem" }}>
          <div>
            <p className="section-tag">Overview</p>
            <h3>Forwarded emails</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: "0.25rem" }}>{lastFull}</p>
          </div>
          <div className="hero-meta">
            <div><span className="hero-meta-label">Last received</span><strong>{lastReceived}</strong></div>
            <div><span className="hero-meta-label">Total received</span><strong>{total}</strong></div>
            <div><span className="hero-meta-label">Imported</span><strong style={{ color: "#22c55e" }}>{imported}</strong></div>
          </div>
        </section>

        <section className="kpi-grid connections-kpi-grid" style={{ marginBottom: "1.25rem" }}>
          <article className="kpi-card">
            <p className="kpi-label">Total emails</p>
            <strong className="kpi-value">{total}</strong>
            <span className="kpi-trend">all time</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Imported</p>
            <strong className="kpi-value" style={{ color: "#22c55e" }}>{imported}</strong>
            <span className="kpi-trend">tickets &amp; sales added</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Failed</p>
            <strong className="kpi-value" style={{ color: failed > 0 ? "#f87171" : undefined }}>{failed}</strong>
            <span className="kpi-trend">{failed === 0 ? "All clean" : "Check details below"}</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Duplicates</p>
            <strong className="kpi-value">{duplicates}</strong>
            <span className="kpi-trend">already imported</span>
          </article>
        </section>

        {/* Filter tabs */}
        <div className="filter-bar" style={{ marginBottom: "0.75rem" }}>
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`filter-btn${filter === tab.key ? " active" : ""}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="filter-btn-count">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="table-card">
          <div className="table-scroll">
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: "0.875rem" }}>
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: "0.875rem" }}>
                {total === 0
                  ? "No emails received yet. Forward a ticket confirmation email to your scan address to get started."
                  : "No emails match this filter."}
              </div>
            ) : (
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>From</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ev) => {
                    const isExpanded = expanded.has(ev.id);
                    const hasDetail  = !!(ev.error_message);
                    return (
                      <>
                        <tr
                          key={ev.id}
                          className={`table-row${hasDetail ? " row-clickable" : ""}`}
                          onClick={() => hasDetail && toggleExpand(ev.id)}
                          style={hasDetail ? { cursor: "pointer" } : undefined}
                        >
                          <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: "0.8125rem" }}>
                            {ev.received_at ? (
                              <>
                                <span title={formatTs(ev.received_at)}>{timeAgo(ev.received_at)}</span>
                                <br />
                                <span style={{ fontSize: "0.75rem" }}>{formatTs(ev.received_at)}</span>
                              </>
                            ) : "—"}
                          </td>
                          <td style={{ fontSize: "0.8125rem", maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.sender_email ?? "—"}
                          </td>
                          <td style={{ fontSize: "0.8125rem", maxWidth: "20rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.subject ?? <span style={{ color: "var(--muted)" }}>(no subject)</span>}
                            {hasDetail && (
                              <span style={{ marginLeft: "0.5rem", color: "var(--muted)", fontSize: "0.7rem" }}>
                                {isExpanded ? "▲" : "▼"}
                              </span>
                            )}
                          </td>
                          <td>{statusBadge(ev.processing_status)}</td>
                          <td style={{ fontSize: "0.8125rem" }}>
                            {ev.booking_ref_detected ? (
                              <Link
                                href={`/orders?ref=${encodeURIComponent(ev.booking_ref_detected)}`}
                                className="table-link"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {ev.booking_ref_detected}
                              </Link>
                            ) : (
                              <span style={{ color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && hasDetail && (
                          <tr key={`${ev.id}-detail`}>
                            <td colSpan={5} style={{ padding: "0.5rem 1rem 0.75rem", background: "var(--surface-2, rgba(255,255,255,0.04))" }}>
                              <pre style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {ev.error_message}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
