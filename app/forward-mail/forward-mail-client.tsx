"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
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
  { label: "Presale & Codes", href: "/presale", active: false },
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
  text_body: string | null;
  html_body: string | null;
  x_forwarded_to: string | null;
};

type FilterType = "all" | "imported" | "failed" | "duplicate" | "skipped" | "verification";

const STATUS_LABELS: Record<string, string> = {
  imported:           "Imported",
  updated:            "Updated",
  duplicate:          "Duplicate",
  failed:             "Failed",
  verification_email: "Verification",
  no_ref_ignored:     "No Ref",
  presale_imported:   "Presale",
  unknown_token:      "Bad Token",
  disabled_token:     "Disabled",
  received:           "Received",
};

function statusBadge(status: string | null) {
  const s = status ?? "received";
  const label = STATUS_LABELS[s] ?? s;
  const cls =
    s === "imported"           ? "status-sold"     :
    s === "updated"            ? "status-listed"   :
    s === "presale_imported"   ? "status-personal" :
    s === "duplicate"          ? "status-unlisted" :
    s === "failed"             ? "status-problem"  :
    s === "verification_email" ? "status-personal" :
    "status-unlisted";
  return <span className={`status-badge status-static ${cls}`}>{label}</span>;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function AutoResizeIframe({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  function onLoad() {
    const frame = ref.current;
    if (!frame) return;
    try {
      const h = frame.contentDocument?.documentElement?.scrollHeight;
      if (h) frame.style.height = `${Math.min(h + 16, 800)}px`;
    } catch { /* cross-origin guard */ }
  }
  return (
    <iframe
      ref={ref}
      srcDoc={html}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: "100%", height: "500px", border: "none", display: "block", background: "#fff", borderRadius: "6px" }}
      title="Email content"
      onLoad={onLoad}
    />
  );
}

function BodyPanel({ ev }: { ev: MailEvent }) {
  const [view, setView] = useState<"html" | "text">(ev.html_body ? "html" : "text");
  const [copied, setCopied] = useState(false);

  function copyText() {
    const txt = ev.text_body ?? "";
    void navigator.clipboard.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const hasHtml = !!ev.html_body;
  const hasText = !!ev.text_body;

  if (!hasHtml && !hasText) {
    return (
      <div style={{ padding: "1rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
        No email body stored. Emails scanned after the migration will show full content here.
        {ev.error_message && (
          <pre style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ev.error_message}</pre>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "0.75rem 1rem 1rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {hasHtml && (
          <button
            type="button"
            className={`filter-btn${view === "html" ? " active" : ""}`}
            onClick={() => setView("html")}
          >
            Rendered
          </button>
        )}
        {hasText && (
          <button
            type="button"
            className={`filter-btn${view === "text" ? " active" : ""}`}
            onClick={() => setView("text")}
          >
            Plain text
          </button>
        )}
        {hasText && (
          <button type="button" className="secondary-button" style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }} onClick={copyText}>
            {copied ? "Copied!" : "Copy text"}
          </button>
        )}
        {ev.error_message && (
          <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--muted)" }}>
            {ev.error_message}
          </span>
        )}
      </div>

      {/* Body */}
      {view === "html" && ev.html_body && (
        <AutoResizeIframe html={ev.html_body} />
      )}
      {view === "text" && ev.text_body && (
        <pre style={{
          margin: 0,
          padding: "0.75rem",
          fontSize: "0.8125rem",
          color: "var(--foreground)",
          background: "var(--surface-2, rgba(255,255,255,0.04))",
          borderRadius: "6px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: "600px",
          overflowY: "auto",
          fontFamily: "ui-monospace, monospace",
          lineHeight: 1.6,
        }}>
          {ev.text_body}
        </pre>
      )}
    </div>
  );
}

const IMPORTED_STATUSES = ["imported", "updated", "presale_imported"];
const SKIPPED_STATUSES  = ["no_ref_ignored", "unknown_token", "disabled_token"];

type Stats = {
  total: number;
  imported: number;
  failed: number;
  duplicates: number;
  verification: number;
  skipped: number;
};

export default function ForwardMailClient() {
  const [events, setEvents] = useState<MailEvent[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, imported: 0, failed: 0, duplicates: 0, verification: 0, skipped: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function load() {
    setLoading(true);

    // Stats query — lightweight, no limit, just the status column for accurate KPIs.
    const { data: allStatuses } = await supabase
      .from("inbound_email_events")
      .select("processing_status");
    if (allStatuses) {
      const s = allStatuses.map((r) => r.processing_status ?? "");
      setStats({
        total:        s.length,
        imported:     s.filter((v) => IMPORTED_STATUSES.includes(v)).length,
        failed:       s.filter((v) => v === "failed").length,
        duplicates:   s.filter((v) => v === "duplicate").length,
        verification: s.filter((v) => v === "verification_email").length,
        skipped:      s.filter((v) => SKIPPED_STATUSES.includes(v)).length,
      });
    }

    // Display query — most recent 1000 rows with full fields for the table.
    let rows: MailEvent[] = [];
    try {
      const { data, error } = await supabase
        .from("inbound_email_events")
        .select("id, sender_email, subject, received_at, processing_status, booking_ref_detected, error_message, postmark_message_id, text_body, html_body, x_forwarded_to")
        .order("received_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      rows = (data as MailEvent[]) ?? [];
    } catch {
      const { data } = await supabase
        .from("inbound_email_events")
        .select("id, sender_email, subject, received_at, processing_status, booking_ref_detected, error_message, postmark_message_id")
        .order("received_at", { ascending: false })
        .limit(1000);
      rows = (data as MailEvent[]) ?? [];
    }
    setEvents(rows);
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

  const lastFull = events[0]?.received_at ? formatTs(events[0].received_at) : "No emails yet";
  const lastAgo  = events[0]?.received_at ? timeAgo(events[0].received_at) : "—";

  const filtered = events.filter((e) => {
    const s = e.processing_status ?? "";
    if (filter === "imported")     return IMPORTED_STATUSES.includes(s);
    if (filter === "failed")       return s === "failed";
    if (filter === "duplicate")    return s === "duplicate";
    if (filter === "verification") return s === "verification_email";
    if (filter === "skipped")      return SKIPPED_STATUSES.includes(s);
    return true;
  });

  const filterTabs: { key: FilterType; label: string; count: number }[] = [
    { key: "all",          label: "All",          count: stats.total },
    { key: "imported",     label: "Imported",     count: stats.imported },
    { key: "failed",       label: "Failed",       count: stats.failed },
    { key: "duplicate",    label: "Duplicate",    count: stats.duplicates },
    { key: "verification", label: "Verification", count: stats.verification },
    { key: "skipped",      label: "Skipped",      count: stats.skipped },
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
            <button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button>
            <Link href="/settings" className="secondary-button">Settings</Link>
          </div>
        </header>

        <section className="hero-card connections-hero" style={{ marginBottom: "1rem" }}>
          <div>
            <p className="section-tag">Overview</p>
            <h3>Forwarded emails</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: "0.25rem" }}>{lastFull}</p>
          </div>
          <div className="hero-meta">
            <div><span className="hero-meta-label">Last received</span><strong>{lastAgo}</strong></div>
            <div><span className="hero-meta-label">Total received</span><strong>{stats.total}</strong></div>
            <div><span className="hero-meta-label">Imported</span><strong style={{ color: "#22c55e" }}>{stats.imported}</strong></div>
          </div>
        </section>

        <section className="kpi-grid connections-kpi-grid" style={{ marginBottom: "1.25rem" }}>
          <article className="kpi-card">
            <p className="kpi-label">Total emails</p>
            <strong className="kpi-value">{stats.total}</strong>
            <span className="kpi-trend">all time</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Imported</p>
            <strong className="kpi-value" style={{ color: "#22c55e" }}>{stats.imported}</strong>
            <span className="kpi-trend">tickets, sales &amp; presale</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Failed</p>
            <strong className="kpi-value" style={{ color: stats.failed > 0 ? "#f87171" : undefined }}>{stats.failed}</strong>
            <span className="kpi-trend">{stats.failed === 0 ? "All clean" : "Check details below"}</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Duplicates</p>
            <strong className="kpi-value">{stats.duplicates}</strong>
            <span className="kpi-trend">already imported</span>
          </article>
        </section>

        <div className="filter-bar" style={{ marginBottom: "0.75rem" }}>
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`filter-btn${filter === tab.key ? " active" : ""}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              {tab.count > 0 && <span className="filter-btn-count">{tab.count}</span>}
            </button>
          ))}
        </div>

        <div className="table-card">
          <div className="table-scroll">
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: "0.875rem" }}>Loading…</div>
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
                    <th>Account</th>
                    <th>From</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ev) => {
                    const isExpanded = expanded.has(ev.id);
                    return (
                      <Fragment key={ev.id}>
                        <tr
                          className="table-row row-clickable"
                          onClick={() => toggleExpand(ev.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: "0.8125rem" }}>
                            {ev.received_at ? (
                              <>
                                <span>{timeAgo(ev.received_at)}</span>
                                <br />
                                <span style={{ fontSize: "0.75rem" }}>{formatTs(ev.received_at)}</span>
                              </>
                            ) : "—"}
                          </td>
                          <td style={{ fontSize: "0.8125rem", maxWidth: "13rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.x_forwarded_to && !ev.x_forwarded_to.includes("inbound.tixtracker.app")
                              ? <span className="mono-text" style={{ fontSize: "0.8rem" }}>{ev.x_forwarded_to}</span>
                              : <span style={{ color: "var(--text-muted)" }}>—</span>}
                          </td>
                          <td style={{ fontSize: "0.8125rem", maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.sender_email ?? "—"}
                          </td>
                          <td style={{ fontSize: "0.8125rem", maxWidth: "20rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.subject ?? <span style={{ color: "var(--muted)" }}>(no subject)</span>}
                            <span style={{ marginLeft: "0.4rem", color: "var(--muted)", fontSize: "0.7rem" }}>
                              {isExpanded ? "▲" : "▼"}
                            </span>
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
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ padding: 0, background: "var(--surface-1, rgba(0,0,0,0.15))", borderTop: "1px solid var(--border)" }}>
                              <BodyPanel ev={ev} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
