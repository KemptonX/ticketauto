"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";

type Order = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  account_email: string | null;
  section: string | null;
  listing_status: string | null;
  total_cost: number | null;
  sold_total: number | null;
  qty_bought: number | null;
};

type Sale = {
  id: number;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  account_email: string | null;
  qty_sold: number | null;
  sale_total: number | null;
  inventory_order_id: number | null;
  sold_at: string | null;
};

const navItems = [
  { label: "Dashboard", href: "/", active: true },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
];

export default function DeskClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void autoArchivePastEvents().then(() => loadData());
  }, []);

  async function autoArchivePastEvents() {
    const { data } = await supabase
      .from("orders")
      .select("id, event_date, listing_status")
      .neq("listing_status", "Archived");

    if (!data) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const toArchive = (data as { id: number; event_date: string | null; listing_status: string | null }[])
      .filter((o) => {
        if (!o.event_date) return false;
        const d = parseAnyDate(o.event_date);
        return d !== null && d < today;
      })
      .map((o) => o.id);

    if (toArchive.length === 0) return;

    await supabase
      .from("orders")
      .update({ listing_status: "Archived" })
      .in("id", toArchive);
  }

  function parseAnyDate(value: string): Date | null {
    // ISO format: 2025-06-14
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, m, d] = value.slice(0, 10).split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    // Natural format: 14 Jun 2025
    const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
    if (match) {
      const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
      const monthIndex = months.indexOf(match[2].slice(0, 3).toLowerCase());
      if (monthIndex !== -1) return new Date(Number(match[3]), monthIndex, Number(match[1]));
    }
    return null;
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadData() {
    setLoading(true);
    const [ordersResult, salesResult] = await Promise.all([
      supabase
        .from("orders")
        .select("id, event_name, venue, event_date, account_email, section, listing_status, total_cost, sold_total, qty_bought")
        .or("listing_status.is.null,listing_status.neq.Archived"),
      supabase
        .from("sales")
        .select("id, event_name, venue, event_date, account_email, qty_sold, sale_total, inventory_order_id, sold_at")
        .neq("sale_status", "Archived"),
    ]);
    if (ordersResult.data) setOrders(ordersResult.data as Order[]);
    if (salesResult.data) setSales(salesResult.data as Sale[]);
    setLoading(false);
  }

  const riskTickets = useMemo(() => {
    return orders
      .filter((order) => {
        const date = parseDate(order.event_date);
        if (!date) return false;
        const daysAway = getDaysAway(date);
        if (daysAway == null || daysAway < 0 || daysAway > 7) return false;
        return order.listing_status !== "Sold" && order.listing_status !== "Archived";
      })
      .sort((a, b) => {
        const da = parseDate(a.event_date);
        const db = parseDate(b.event_date);
        return da && db ? da.getTime() - db.getTime() : 0;
      });
  }, [orders]);

  const unmatchedSales = useMemo(() => {
    return sales
      .filter((s) => s.inventory_order_id == null)
      .sort((a, b) =>
        a.sold_at && b.sold_at ? new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime() : 0,
      );
  }, [sales]);

  const metrics = useMemo(() => {
    const capitalIn = orders
      .filter((o) => o.listing_status !== "Sold" && o.listing_status !== "Archived")
      .reduce((sum, o) => sum + (o.total_cost ?? 0), 0);

    const closedProfit = orders
      .filter((o) => (o.sold_total ?? 0) > 0)
      .reduce((sum, o) => sum + ((o.sold_total ?? 0) - (o.total_cost ?? 0)), 0);

    const availableCount = orders.filter(
      (o) => o.listing_status !== "Sold" && o.listing_status !== "Archived",
    ).length;

    const soldCount = orders.filter((o) => o.listing_status === "Sold").length;

    return { capitalIn, closedProfit, availableCount, soldCount };
  }, [orders]);

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <div className="brand-mark">TA</div>
          <div className="sidebar-brand">
            <h1>TicketAuto</h1>
          </div>
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-item${item.active ? " nav-item-active" : ""}`}
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-settings-box">
            <p className="sidebar-settings-title">Settings</p>
            <Link href="/connections" className="sidebar-settings-link">Connections</Link>
            <button className="sidebar-settings-link sidebar-settings-button" type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Overview</p>
            <h2>Dashboard</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => void loadData()}>
              Refresh
            </button>
          </div>
        </header>

        <section className="kpi-grid">
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Tickets Available</p>
            <strong>{metrics.availableCount}</strong>
            <span>not yet sold</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Tickets Sold</p>
            <strong>{metrics.soldCount}</strong>
            <span>closed positions</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Capital In</p>
            <strong>{formatCurrency(metrics.capitalIn)}</strong>
            <span>tied up in unsold stock</span>
          </article>
          <article className={`kpi-card${metrics.closedProfit >= 0 ? " analytics-kpi-profit" : " analytics-kpi-risk"}`}>
            <span className="kpi-accent" />
            <p>Closed Profit</p>
            <strong>{formatCurrency(metrics.closedProfit)}</strong>
            <span>net across sold tickets</span>
          </article>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Action required</p>
              <h4>Unsold — event within 7 days</h4>
            </div>
            {riskTickets.length > 0 && (
              <span className="table-count risk-count">{riskTickets.length} at risk</span>
            )}
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading</h5>
            </div>
          ) : riskTickets.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No near-term risk</h5>
              <p>No unsold tickets with events in the next 7 days.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Account</th>
                    <th>Section</th>
                    <th>Qty</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th>Days left</th>
                  </tr>
                </thead>
                <tbody>
                  {riskTickets.map((order) => {
                    const date = parseDate(order.event_date);
                    const daysAway = getDaysAway(date);
                    return (
                      <tr key={order.id}>
                        <td>
                          <div className="event-cell">
                            <strong>{order.event_name || "Untitled"}</strong>
                            <span>{order.venue || "—"}</span>
                            <small>{formatEventDate(order.event_date)}</small>
                          </div>
                        </td>
                        <td>
                          <span className="truncate-text" title={order.account_email || ""}>
                            {order.account_email || "—"}
                          </span>
                        </td>
                        <td>{order.section || "—"}</td>
                        <td>{order.qty_bought ?? "—"}</td>
                        <td>{formatCurrency(order.total_cost)}</td>
                        <td>
                          <span className={`status-badge status-static ${getStatusTone(order.listing_status)}`}>
                            {order.listing_status || "Unlisted"}
                          </span>
                        </td>
                        <td>
                          <strong className={daysAway != null && daysAway <= 2 ? "delta-down" : ""}>
                            {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `${daysAway ?? "?"} days`}
                          </strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Sales</p>
              <h4>Unmatched sales</h4>
            </div>
            {unmatchedSales.length > 0 && (
              <Link href="/sales" className="ghost-button">Review in Sales →</Link>
            )}
          </div>

          {loading ? null : unmatchedSales.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>All sales matched</h5>
              <p>Every sale is linked to a ticket.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Account</th>
                    <th>Qty</th>
                    <th>Sale total</th>
                    <th>Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <div className="event-cell">
                          <strong>{sale.event_name || "Untitled sale"}</strong>
                          <span>{sale.venue || "—"}</span>
                          <small>{sale.event_date || "—"}</small>
                        </div>
                      </td>
                      <td>
                        <span className="truncate-text" title={sale.account_email || ""}>
                          {sale.account_email || "—"}
                        </span>
                      </td>
                      <td>{sale.qty_sold ?? "—"}</td>
                      <td>{formatCurrency(sale.sale_total)}</td>
                      <td>{sale.sold_at ? formatShortDate(sale.sold_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const monthIndex = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(monthName.slice(0,3).toLowerCase());
  if (monthIndex === -1) return null;
  return new Date(Number(year), monthIndex, Number(day));
}

function getDaysAway(date: Date | null): number | null {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatEventDate(value: string | null): string {
  if (!value) return "Date missing";
  const date = parseDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(parsed);
}

function getStatusTone(status: string | null) {
  switch (status) {
    case "Listed": return "status-listed";
    case "Sold": return "status-sold";
    case "Problem / Missing": return "status-problem";
    default: return "status-unlisted";
  }
}
