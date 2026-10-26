"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";
import { formatCurrency } from "@/src/lib/currency";
import { PLATFORM_LABELS, STATUS_LABELS, type AccountStatus, type Platform, type TicketAccount } from "@/src/lib/account-manager";
import EditAccountModal from "../edit-account-modal";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Tax & Accounts", href: "/tax-accounts", active: false },
  { label: "Accounts", href: "/account-manager", active: true },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Presale & Codes", href: "/presale", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

type Purchase = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  sold_total: number | null;
  listing_status: string | null;
  booking_ref: string | null;
  created_at: string;
};

function platformTag(platform: Platform) {
  const cls = platform === "ticketmaster" ? "am-tag-blue" : platform === "axs" ? "am-tag-purple" : "am-tag-neutral";
  return <span className={`am-tag ${cls}`}>{PLATFORM_LABELS[platform]}</span>;
}

function statusTag(status: AccountStatus) {
  const cls = status === "active" ? "am-tag-green" : status === "needs_attention" ? "am-tag-amber" : "am-tag-neutral";
  return <span className={`am-tag ${cls}`}>{STATUS_LABELS[status]}</span>;
}

export default function AccountDetailsClient({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [account, setAccount] = useState<TicketAccount | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState("");
  const [showEdit, setShowEdit] = useState(false);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "event" | "cost">("recent");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/account-manager/purchases?accountId=${accountId}`);
      const data = await res.json();
      if (!res.ok) { setNotFound(true); return; }
      setAccount(data.account);
      setPurchases(data.purchases ?? []);
    } catch {
      setMessage("Network error loading account");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function toggleArchive() {
    if (!account) return;
    const nextStatus: AccountStatus = account.status === "archived" ? "active" : "archived";
    const res = await fetch("/api/account-manager", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id, status: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? "Update failed"); return; }
    setAccount(data.account);
    setMessage(nextStatus === "archived" ? "Account archived — its purchase history is preserved" : "Account restored");
  }

  async function deleteAccount() {
    if (!account) return;
    if (!window.confirm(`Permanently delete ${account.account_name || account.email}? This only removes the saved account record — none of its linked ticket purchases are affected.`)) return;
    const res = await fetch(`/api/account-manager?id=${account.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? "Delete failed"); return; }
    router.push("/account-manager");
  }

  const stats = useMemo(() => {
    const totalSpend = purchases.reduce((sum, p) => sum + (p.total_cost ?? 0), 0);
    const totalQty = purchases.reduce((sum, p) => sum + (p.qty_bought ?? 0), 0);
    const lastPurchase = purchases.reduce((latest, p) => (p.created_at > latest ? p.created_at : latest), "");
    return { totalPurchases: purchases.length, totalQty, totalSpend, lastPurchase: lastPurchase || null };
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    let rows = purchases;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) =>
        (p.event_name ?? "").toLowerCase().includes(q) ||
        (p.venue ?? "").toLowerCase().includes(q) ||
        (p.booking_ref ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...rows];
    if (sortBy === "event") sorted.sort((a, b) => (a.event_name ?? "").localeCompare(b.event_name ?? ""));
    else if (sortBy === "cost") sorted.sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0));
    else sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sorted;
  }, [purchases, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filteredPurchases.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <a key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`} target={item.target} rel={item.rel}>
                <NavIcon href={item.href} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main">
        <Link href="/account-manager" style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none" }}>&larr; Back to Account Manager</Link>

        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
        ) : notFound || !account ? (
          <section className="table-card" style={{ padding: "1.5rem" }}>
            <p>This account couldn&apos;t be found, or doesn&apos;t belong to your account.</p>
          </section>
        ) : (
          <>
            {message && (
              <div className="feedback-banner" role="status">
                <span className="feedback-dot" /><span>{message}</span>
              </div>
            )}

            <header className="topbar">
              <div>
                <p className="eyebrow">{PLATFORM_LABELS[account.platform]} account</p>
                <h2>{account.account_name || account.email}</h2>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {platformTag(account.platform)}
                  {statusTag(account.status)}
                  {account.email && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{account.email}</span>}
                </div>
              </div>
              <div className="topbar-actions">
                <button className="ghost-button" type="button" onClick={() => void toggleArchive()}>
                  {account.status === "archived" ? "Restore" : "Archive"}
                </button>
                <button className="ghost-button" type="button" onClick={() => void deleteAccount()}>Delete</button>
                <button className="primary-button" type="button" onClick={() => setShowEdit(true)}>Edit Account</button>
              </div>
            </header>

            <section className="kpi-grid" style={{ marginBottom: "1rem" }}>
              <article className="kpi-card">
                <p className="kpi-label">Total Purchases</p>
                <strong className="kpi-value">{stats.totalPurchases}</strong>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Tickets Purchased</p>
                <strong className="kpi-value">{stats.totalQty}</strong>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Total Spend</p>
                <strong className="kpi-value">{formatCurrency(stats.totalSpend)}</strong>
              </article>
              <article className="kpi-card">
                <p className="kpi-label">Last Purchase</p>
                <strong className="kpi-value">{stats.lastPurchase ? new Date(stats.lastPurchase).toLocaleDateString("en-GB") : "—"}</strong>
              </article>
            </section>

            <section className="command-card" style={{ marginBottom: "1rem" }}>
              <div className="command-header">
                <h4 style={{ margin: 0 }}>Account details</h4>
              </div>
              <div className="drawer-grid" style={{ padding: "0 1.5rem 1.5rem" }}>
                <FieldView label="Phone" value={account.phone ?? ""} />
                <FieldView label="Country" value={account.country ?? ""} />
                <FieldView label="Browser profile number" value={account.browser_profile_number ?? ""} />
                <FieldView label="Browser profile tool" value={account.browser_profile_tool ?? ""} />
                <FieldView label="Proxy reference" value={account.proxy_reference ?? ""} />
                <FieldView label="Tags" value={account.tags.join(", ")} />
                <FieldView label="Account created" value={account.account_created_at ? new Date(account.account_created_at).toLocaleDateString("en-GB") : ""} />
                <FieldView label="Last checked" value={account.last_checked_at ? new Date(account.last_checked_at).toLocaleDateString("en-GB") : ""} />
                <FieldView label="Notes" value={account.notes ?? ""} span />
              </div>
            </section>

            <section className="command-card">
              <div className="command-header" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                <h4 style={{ margin: 0, flex: 1 }}>Purchase history</h4>
                <input className="field" style={{ maxWidth: 240 }} placeholder="Search purchases..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                <select className="field" style={{ maxWidth: 170 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as never)}>
                  <option value="recent">Most recent</option>
                  <option value="event">Event name</option>
                  <option value="cost">Highest cost</option>
                </select>
              </div>

              {purchases.length === 0 ? (
                <div className="am-empty">
                  <h4>No linked purchases</h4>
                  <p>No orders found for this account&apos;s email on {PLATFORM_LABELS[account.platform]}.</p>
                </div>
              ) : filteredPurchases.length === 0 ? (
                <div className="am-empty">
                  <h4>No purchases match this search</h4>
                </div>
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="premium-table">
                      <thead>
                        <tr><th>Event</th><th>Venue</th><th>Event Date</th><th>Order Ref</th><th>Qty</th><th>Cost</th><th>Status</th><th></th></tr>
                      </thead>
                      <tbody>
                        {pageRows.map((p) => (
                          <tr key={p.id}>
                            <td>{p.event_name || "—"}</td>
                            <td>{p.venue || "—"}</td>
                            <td>{p.event_date ? new Date(p.event_date).toLocaleDateString("en-GB") : "—"}</td>
                            <td>{p.booking_ref || "—"}</td>
                            <td>{p.qty_bought ?? "—"}</td>
                            <td>{formatCurrency(p.total_cost)}</td>
                            <td>{p.listing_status || "—"}</td>
                            <td>
                              {p.booking_ref ? (
                                <a className="ghost-button" style={{ padding: "4px 10px", fontSize: "0.8125rem", textDecoration: "none" }} href={`/orders?search=${encodeURIComponent(p.booking_ref)}`}>
                                  View in Tickets
                                </a>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="am-pagination">
                      <button className="ghost-button" type="button" disabled={pageClamped === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {pageClamped} of {totalPages}</span>
                      <button className="ghost-button" type="button" disabled={pageClamped === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>

      {showEdit && account && (
        <EditAccountModal
          account={account}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setAccount(updated); setShowEdit(false); setMessage("Account updated"); void load(); }}
        />
      )}
    </div>
  );
}

function FieldView({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, gridColumn: span ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 14 }}>{value || "—"}</span>
    </div>
  );
}
