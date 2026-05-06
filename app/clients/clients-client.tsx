"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/src/lib/supabase";
import { formatCurrency } from "@/src/lib/currency";
import { loadTemplate, interpolate } from "@/src/lib/email-template";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: true },
];

type SaleRecord = {
  id: number;
  buyer_email: string;
  event_name: string | null;
  event_date: string | null;
  qty_sold: number | null;
  payout_total: number | null;
  sale_total: number | null;
  sold_at: string | null;
};

type Client = {
  email: string;
  purchaseCount: number;
  ticketCount: number;
  totalSpend: number;
  lastPurchaseAt: string | null;
  sales: SaleRecord[];
};

type ConnectedAccount = { id: string; email: string; provider: string };

export default function ClientsClient() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "sent" | "notsent">("all");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sentClientEmails, setSentClientEmails] = useState<Record<string, true>>({});

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTargets, setEmailTargets] = useState<string[]>([]);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailProgress, setEmailProgress] = useState<{ sent: number; total: number } | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [emailFromAccountId, setEmailFromAccountId] = useState("");

  useEffect(() => {
    void loadSales();
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("sent_client_emails") || "[]") as string[];
      const rec: Record<string, true> = {};
      for (const email of stored) rec[email] = true;
      setSentClientEmails(rec);
    } catch { /* ignore */ }
  }, []);

  function markEmailsSent(emails: string[]) {
    setSentClientEmails((prev) => {
      const next = { ...prev };
      for (const e of emails) next[e.toLowerCase()] = true;
      try {
        localStorage.setItem("sent_client_emails", JSON.stringify(Object.keys(next)));
      } catch { /* ignore */ }
      return next;
    });
  }

  async function loadSales() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sales")
      .select("id, buyer_email, event_name, event_date, qty_sold, payout_total, sale_total, sold_at")
      .not("buyer_email", "is", null)
      .order("sold_at", { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      setSales((data as SaleRecord[]) || []);
    }
    setLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const clients = useMemo<Client[]>(() => {
    const map = new Map<string, Client>();
    for (const sale of sales) {
      const email = sale.buyer_email?.toLowerCase();
      if (!email) continue;
      if (!map.has(email)) {
        map.set(email, { email, purchaseCount: 0, ticketCount: 0, totalSpend: 0, lastPurchaseAt: null, sales: [] });
      }
      const c = map.get(email)!;
      c.purchaseCount += 1;
      c.ticketCount += sale.qty_sold ?? 0;
      c.totalSpend += sale.payout_total ?? sale.sale_total ?? 0;
      c.sales.push(sale);
      if (!c.lastPurchaseAt || (sale.sold_at && sale.sold_at > c.lastPurchaseAt)) {
        c.lastPurchaseAt = sale.sold_at;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.lastPurchaseAt) return 1;
      if (!b.lastPurchaseAt) return -1;
      return b.lastPurchaseAt.localeCompare(a.lastPurchaseAt);
    });
  }, [sales]);

  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        !search.trim() ||
        c.email.toLowerCase().includes(search.toLowerCase()) ||
        c.sales.some((s) => s.event_name?.toLowerCase().includes(search.toLowerCase()));

      const hasSent = !!sentClientEmails[c.email.toLowerCase()];
      const matchesFilter =
        filterType === "all" ||
        (filterType === "sent" && hasSent) ||
        (filterType === "notsent" && !hasSent);

      return matchesSearch && matchesFilter;
    });
  }, [clients, search, filterType, sentClientEmails]);

  const selectedClient = selectedEmail ? clients.find((c) => c.email === selectedEmail) ?? null : null;

  const sentCount = useMemo(() => clients.filter((c) => !!sentClientEmails[c.email.toLowerCase()]).length, [clients, sentClientEmails]);
  const notSentCount = clients.length - sentCount;
  async function loadAccountsAndOpenModal(targets: string[], subject: string, body: string) {
    setEmailTargets(targets);
    setEmailSubject(subject);
    setEmailBody(body);
    setEmailError("");
    setEmailProgress(null);

    const { data } = await supabase
      .from("gmail_accounts")
      .select("id, email, provider")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    const accounts = (data as ConnectedAccount[]) || [];
    setConnectedAccounts(accounts);
    setEmailFromAccountId(accounts[0]?.id ?? "");
    setShowEmailModal(true);
  }

  function openSingleEmail(client: Client) {
    const tmpl = loadTemplate();
    const lastSale = client.sales[0];
    const customerName = client.email.split("@")[0];
    const vars = {
      customer_name: customerName,
      event_name: lastSale?.event_name ?? "",
      event_date: lastSale?.event_date ?? "",
      venue: "",
      section: "",
      seats: "",
      quantity: lastSale?.qty_sold ?? "",
    };
    void loadAccountsAndOpenModal(
      [client.email],
      interpolate(tmpl.subject, vars),
      interpolate(tmpl.body, vars),
    );
  }

  function openBulkEmail() {
    const targets = filteredClients.map((c) => c.email);
    const tmpl = loadTemplate();
    void loadAccountsAndOpenModal(
      targets,
      tmpl.subject,
      tmpl.body,
    );
  }

  function closeEmailModal() {
    setShowEmailModal(false);
    setEmailTargets([]);
    setEmailSubject("");
    setEmailBody("");
    setEmailError("");
    setEmailProgress(null);
    setEmailFromAccountId("");
  }

  async function sendEmails() {
    if (!emailFromAccountId || emailTargets.length === 0) return;
    setSendingEmail(true);
    setEmailError("");

    let sent = 0;
    const errors: string[] = [];

    for (const to of emailTargets) {
      try {
        const res = await fetch("/api/send-client-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, accountId: emailFromAccountId, subject: emailSubject, body: emailBody }),
        });
        const result = await res.json();
        if (!res.ok) {
          errors.push(`${to}: ${result.error || "failed"}`);
        } else {
          sent++;
        }
      } catch {
        errors.push(`${to}: network error`);
      }
      setEmailProgress({ sent: sent + errors.length, total: emailTargets.length });
    }

    const successTargets = emailTargets.filter((t) => !errors.some((e) => e.startsWith(t)));
    if (successTargets.length > 0) markEmailsSent(successTargets);

    setSendingEmail(false);

    if (errors.length > 0) {
      setEmailError(
        `${errors.length} failed — ${errors.slice(0, 2).join(", ")}${errors.length > 2 ? `… (+${errors.length - 2} more)` : ""}`,
      );
    } else {
      closeEmailModal();
      setMessage(`Email sent to ${sent} client${sent !== 1 ? "s" : ""}`);
    }
  }

  return (
    <div className={`orders-shell${selectedClient ? " orders-shell-drawer-open" : ""}`}>
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
            <p className="eyebrow">Client management</p>
            <h2>Clients</h2>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary-button" onClick={() => void loadSales()}>
              Refresh
            </button>
            {filteredClients.length > 0 && (
              <button type="button" className="primary-button" onClick={openBulkEmail}>
                Email {filteredClients.length === clients.length ? "All" : filteredClients.length} Clients
              </button>
            )}
          </div>
        </header>

        {message && (
          <div className="feedback-banner" role="status">
            <span className="feedback-dot" />
            <span>{message}</span>
          </div>
        )}

        {/* Hero */}
        <section className="hero-card connections-hero" style={{ marginBottom: "1rem" }}>
          <div>
            <p className="section-tag">Overview</p>
            <h3>Your buyer network</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: "0.25rem" }}>
              Automatically built from your Viagogo sales
            </p>
          </div>
          <div className="hero-meta">
            <div><span className="hero-meta-label">Total clients</span><strong>{clients.length}</strong></div>
            <div><span className="hero-meta-label">Emailed</span><strong style={{ color: "#22c55e" }}>{sentCount}</strong></div>
            <div><span className="hero-meta-label">Not emailed</span><strong style={{ color: "#f59e0b" }}>{notSentCount}</strong></div>
          </div>
        </section>

        {/* KPIs */}
        <section className="kpi-grid connections-kpi-grid" style={{ marginBottom: "1.25rem" }}>
          <article className="kpi-card">
            <p className="kpi-label">Total clients</p>
            <strong className="kpi-value">{clients.length}</strong>
            <span className="kpi-trend">unique buyer emails</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Emailed</p>
            <strong className="kpi-value" style={{ color: "#22c55e" }}>{sentCount}</strong>
            <span className="kpi-trend">initial email sent</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Not emailed</p>
            <strong className="kpi-value" style={{ color: "#f59e0b" }}>{notSentCount}</strong>
            <span className="kpi-trend">yet to contact</span>
          </article>
        </section>

        {/* Filter + Search */}
        <section className="command-card">
          <div className="command-header">
            <div className="view-toggle">
              <button type="button" className={`toggle-btn${filterType === "all" ? " toggle-btn-active" : ""}`} onClick={() => setFilterType("all")}>
                All ({clients.length})
              </button>
              <button type="button" className={`toggle-btn${filterType === "sent" ? " toggle-btn-active" : ""}`} onClick={() => setFilterType("sent")}>
                Sent ({sentCount})
              </button>
              <button type="button" className={`toggle-btn${filterType === "notsent" ? " toggle-btn-active" : ""}`} onClick={() => setFilterType("notsent")}>
                Not Sent ({notSentCount})
              </button>
            </div>
            <button type="button" className="ghost-button" onClick={() => { setSearch(""); setFilterType("all"); }}>
              Reset
            </button>
          </div>
          <div className="sales-filter-grid">
            <label className="filter-field" style={{ gridColumn: "1 / -1" }}>
              <span className="filter-label">Search</span>
              <input
                className="field field-search"
                placeholder="Search by email or event name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
        </section>

        {/* Table */}
        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Directory</p>
              <h4>Buyer list</h4>
            </div>
            <span className="table-count">{filteredClients.length} clients</span>
          </div>

          {loading ? (
            <div className="empty-state compact-empty-state"><h5>Loading clients…</h5></div>
          ) : filteredClients.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>{clients.length === 0 ? "No clients yet" : "No clients match this filter"}</h5>
              <p>
                {clients.length === 0
                  ? "Clients are automatically added when sales with buyer emails are scanned."
                  : "Try clearing the search or switching to All."}
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th style={{ textAlign: "center" }}>Purchases</th>
                    <th style={{ textAlign: "center" }}>Tickets</th>
                    <th style={{ textAlign: "right" }}>Total Spent</th>
                    <th>Last Purchase</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => {
                    const isRepeat = client.purchaseCount > 1;
                    const hasBeenEmailed = !!sentClientEmails[client.email.toLowerCase()];
                    const isSelected = selectedEmail === client.email;
                    return (
                      <tr
                        key={client.email}
                        style={{ cursor: "pointer", background: isSelected ? "rgba(155,92,255,0.05)" : undefined }}
                        onClick={() => setSelectedEmail(isSelected ? null : client.email)}
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 500, fontSize: "13px" }}>{client.email}</span>
                            {hasBeenEmailed && <span className="status-badge badge-sold" style={{ fontSize: "10px", padding: "1px 6px" }}>✓ Emailed</span>}
                            {isRepeat && <span className="status-badge badge-unlisted" style={{ fontSize: "10px", padding: "1px 6px" }}>Repeat</span>}
                            <ProxyBadge email={client.email} />
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                            {client.sales.slice(0, 2).map((s) => s.event_name).filter(Boolean).join(" · ") || "No event name"}
                            {client.sales.length > 2 ? ` +${client.sales.length - 2} more` : ""}
                          </div>
                        </td>
                        <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                          <strong>{client.purchaseCount}</strong>
                        </td>
                        <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                          {client.ticketCount}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {formatCurrency(client.totalSpend)}
                        </td>
                        <td>
                          <div style={{ fontSize: "13px" }}>{client.lastPurchaseAt ? formatDate(client.lastPurchaseAt) : "—"}</div>
                          <div style={{ fontSize: "11px", color: "var(--muted)" }}>{client.lastPurchaseAt ? timeAgo(client.lastPurchaseAt) : ""}</div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className={hasBeenEmailed ? "ghost-button" : "secondary-button"}
                            style={{ fontSize: "12px", padding: "4px 10px" }}
                            onClick={(e) => { e.stopPropagation(); openSingleEmail(client); }}
                          >
                            {hasBeenEmailed ? "✓ Send Again" : "Send Email"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Detail Drawer */}
      {selectedClient && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">Client profile</p>
              <h4 style={{ wordBreak: "break-all", fontSize: "0.95rem" }}>{selectedClient.email}</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setSelectedEmail(null)}>×</button>
          </div>

          <div className="drawer-content">
            <section className="drawer-hero">
              <div className="drawer-hero-copy">
                <strong style={{ wordBreak: "break-all" }}>{selectedClient.email}</strong>
                <span style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                  {selectedClient.purchaseCount > 1 && <span className="status-badge badge-sold">Repeat buyer</span>}
                  {sentClientEmails[selectedClient.email.toLowerCase()] && <span className="status-badge badge-sold">✓ Emailed</span>}
                  <ProxyBadge email={selectedClient.email} />
                </span>
              </div>
              <div className="drawer-hero-meta">
                <strong style={{ fontSize: "1.25rem" }}>{formatCurrency(selectedClient.totalSpend)}</strong>
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>total spent</span>
              </div>
            </section>

            <div className="drawer-summary">
              <div><span>Purchases</span><strong>{selectedClient.purchaseCount}</strong></div>
              <div><span>Tickets</span><strong>{selectedClient.ticketCount}</strong></div>
              <div><span>Last purchase</span><strong>{selectedClient.lastPurchaseAt ? formatDate(selectedClient.lastPurchaseAt) : "—"}</strong></div>
              <div><span>Total spent</span><strong>{formatCurrency(selectedClient.totalSpend)}</strong></div>
            </div>

            <div className="drawer-actions">
              <button
                type="button"
                className="primary-button"
                style={{ width: "100%" }}
                onClick={() => openSingleEmail(selectedClient)}
              >
                {sentClientEmails[selectedClient.email.toLowerCase()] ? "✓ Send Again" : "Send Email"}
              </button>
            </div>

            <section style={{ marginTop: "1.25rem" }}>
              <p className="section-tag" style={{ marginBottom: "0.5rem" }}>Purchase history</p>
              <div className="inventory-ticket-stack">
                <div className="inventory-ticket-header">
                  <span>Event</span>
                  <span>Date</span>
                  <span>Qty</span>
                  <span>Value</span>
                </div>
                {selectedClient.sales.map((sale) => (
                  <div key={sale.id} className="inventory-ticket-row">
                    <div className="inventory-ticket-seat">
                      <strong>{sale.event_name || "Untitled"}</strong>
                    </div>
                    <span style={{ fontSize: "12px" }}>{sale.event_date ? formatShortDate(sale.event_date) : "—"}</span>
                    <span>{sale.qty_sold ?? "—"}</span>
                    <strong className="inventory-cost-value">
                      {formatCurrency(sale.payout_total ?? sale.sale_total)}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>
      )}

      {/* Email Compose Modal */}
      {showEmailModal && createPortal(
        <div className="add-sale-overlay" onClick={closeEmailModal}>
          <div className="add-sale-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="eyebrow">
                  {emailTargets.length === 1 ? "Send email" : `Send to ${emailTargets.length} clients`}
                </p>
                <h4>{emailTargets.length === 1 ? emailTargets[0] : `${emailTargets.length} recipients`}</h4>
              </div>
              <button className="drawer-close" type="button" onClick={closeEmailModal} disabled={sendingEmail}>✕</button>
            </div>

            <div className="add-sale-body">
              <div className="add-sale-section">
                <div className="drawer-grid">
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>From</span>
                    <select
                      className="field"
                      value={emailFromAccountId}
                      onChange={(e) => setEmailFromAccountId(e.target.value)}
                      disabled={sendingEmail}
                    >
                      {connectedAccounts.length === 0 && <option value="">No connected inboxes</option>}
                      {connectedAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.email} ({a.provider === "outlook" ? "Outlook" : "Gmail"})
                        </option>
                      ))}
                    </select>
                  </label>

                  {emailTargets.length > 1 && (
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span>To</span>
                      <div className="field" style={{ color: "var(--muted)", fontSize: "12px", lineHeight: "1.6" }}>
                        {emailTargets.slice(0, 5).join(", ")}
                        {emailTargets.length > 5 ? ` … and ${emailTargets.length - 5} more` : ""}
                      </div>
                    </label>
                  )}

                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>Subject</span>
                    <input
                      className="field"
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Email subject..."
                      disabled={sendingEmail}
                    />
                  </label>

                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>Message</span>
                    <textarea
                      className="field"
                      rows={10}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder="Write your message..."
                      style={{ resize: "vertical", fontFamily: "inherit" }}
                      disabled={sendingEmail}
                    />
                  </label>
                </div>
              </div>
            </div>

            {emailProgress && (
              <div style={{ padding: "0 1.5rem 0.75rem" }}>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "0.4rem" }}>
                  Sending {emailProgress.sent} / {emailProgress.total}…
                </div>
                <div style={{ height: "4px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((emailProgress.sent / emailProgress.total) * 100)}%`,
                      background: "var(--accent)",
                      borderRadius: "2px",
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              </div>
            )}

            {emailError && (
              <div style={{ padding: "0 1.5rem 0.75rem", color: "#f87171", fontSize: "0.85rem" }}>
                {emailError}
              </div>
            )}

            <div className="drawer-actions">
              <button className="secondary-button" type="button" onClick={closeEmailModal} disabled={sendingEmail}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={sendingEmail || !emailFromAccountId || !emailSubject.trim() || !emailBody.trim()}
                onClick={() => void sendEmails()}
              >
                {sendingEmail
                  ? `Sending${emailTargets.length > 1 ? ` (${emailProgress?.sent ?? 0}/${emailTargets.length})` : ""}…`
                  : emailTargets.length === 1
                  ? "Send Email"
                  : `Send to ${emailTargets.length} clients`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function formatShortDate(value: string) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
  }
  const m = value.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : value;
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const KNOWN_PROVIDERS = new Set([
  "gmail.com","googlemail.com",
  "outlook.com","outlook.co.uk","outlook.fr","outlook.de","outlook.es","outlook.it","outlook.com.au",
  "hotmail.com","hotmail.co.uk","hotmail.fr","hotmail.de","hotmail.es","hotmail.it","hotmail.com.au",
  "live.com","live.co.uk","live.fr","live.de","live.com.au","live.nl",
  "msn.com",
  "yahoo.com","yahoo.co.uk","yahoo.fr","yahoo.de","yahoo.es","yahoo.it","yahoo.co.jp","yahoo.com.au","ymail.com",
  "icloud.com","me.com","mac.com",
  "aol.com","aol.co.uk",
  "protonmail.com","proton.me",
  "mail.com","gmx.com","gmx.de","gmx.net",
  "zoho.com",
  "yandex.com","yandex.ru",
  "web.de","t-online.de",
  "orange.fr","wanadoo.fr","free.fr","laposte.net","sfr.fr",
  "bt.com","btinternet.com","sky.com","ntlworld.com","virginmedia.com","talktalk.net","blueyonder.co.uk",
  "comcast.net","att.net","verizon.net","sbcglobal.net","cox.net","bellsouth.net","earthlink.net",
  "shaw.ca","rogers.com","telus.net","bell.net",
  "tiscali.it","libero.it","virgilio.it","alice.it",
  "seznam.cz","centrum.cz",
  "wp.pl","onet.pl","interia.pl",
]);

function getProxyScore(email: string): number {
  const lower = email.toLowerCase();
  const at = lower.indexOf("@");
  if (at === -1) return 0;
  const domain = lower.slice(at + 1);
  const local = lower.slice(0, at);

  if (domain.includes("viagogo")) return 98;
  if (KNOWN_PROVIDERS.has(domain)) return 0;

  // Score by how random the local part looks
  const digits = (local.match(/\d/g) || []).length;
  const isHexLike = /^[a-f0-9]{8,}$/.test(local);
  const noWords = !/[a-z]{4,}/.test(local);

  if (isHexLike || (local.length >= 10 && digits >= 5 && noWords)) return 85;
  if (local.length >= 8 && digits >= 3) return 72;
  return 60;
}

function ProxyBadge({ email }: { email: string }) {
  const score = getProxyScore(email);
  if (score === 0) return null;
  const isViagogoKnown = email.toLowerCase().includes("viagogo");
  const color = score >= 90 ? "#ef4444" : score >= 70 ? "#f59e0b" : "#94a3b8";
  const label = isViagogoKnown ? "Viagogo email" : `~${score}% proxy`;
  return (
    <span style={{
      fontSize: "10px",
      padding: "1px 6px",
      background: `${color}22`,
      color,
      border: `1px solid ${color}55`,
      borderRadius: "4px",
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}
