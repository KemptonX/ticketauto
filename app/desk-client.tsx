"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { formatCurrency } from "@/src/lib/currency";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

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
  payout_total: number | null;
  inventory_order_id: number | null;
  sold_at: string | null;
};

const navItems = [
  { label: "Dashboard", href: "/", active: true },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: false },
];

export default function DeskClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState<number>(5000);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [yearlyGoal, setYearlyGoal] = useState<number>(50000);
  const [editingYearlyGoal, setEditingYearlyGoal] = useState(false);
  const [yearlyGoalInput, setYearlyGoalInput] = useState("");

  useEffect(() => {
    const storedGoal = localStorage.getItem("monthly_profit_goal");
    if (storedGoal) setGoal(Number(storedGoal));
    const storedYearly = localStorage.getItem("yearly_profit_goal");
    if (storedYearly) setYearlyGoal(Number(storedYearly));
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

  function saveGoal() {
    const val = parseFloat(goalInput);
    if (!isNaN(val) && val > 0) {
      setGoal(val);
      localStorage.setItem("monthly_profit_goal", String(val));
    }
    setEditingGoal(false);
  }

  function saveYearlyGoal() {
    const val = parseFloat(yearlyGoalInput);
    if (!isNaN(val) && val > 0) {
      setYearlyGoal(val);
      localStorage.setItem("yearly_profit_goal", String(val));
    }
    setEditingYearlyGoal(false);
  }

  async function loadData() {
    setLoading(true);
    const [ordersResult, salesResult] = await Promise.all([
      supabase
        .from("orders")
        .select("id, event_name, venue, event_date, account_email, section, listing_status, total_cost, sold_total, qty_bought"),
      supabase
        .from("sales")
        .select("id, event_name, venue, event_date, account_email, qty_sold, sale_total, payout_total, inventory_order_id, sold_at")
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

  const aprilUnsold = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return orders
      .filter((o) => {
        if (o.listing_status === "Sold" || o.listing_status === "Archived") return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
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
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Financial year: April 1 → March 31
    const fyStart = now.getMonth() >= 3
      ? new Date(now.getFullYear(), 3, 1)       // Apr 1 this year
      : new Date(now.getFullYear() - 1, 3, 1);  // Apr 1 last year
    const fyEnd = new Date(fyStart.getFullYear() + 1, 3, 1);

    // Profit from orders: use sold_total (any order with sold_total > 0 was sold)
    // Group by event_date so monthly/yearly goals reflect when the event was, not when it sold

    const monthlyProfit = orders
      .filter((o) => {
        if ((o.sold_total ?? 0) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
      })
      .reduce((sum, o) => sum + ((o.sold_total ?? 0) - (o.total_cost ?? 0)), 0);

    // Yearly profit (April to April FY)
    const yearlyProfit = orders
      .filter((o) => {
        if ((o.sold_total ?? 0) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= fyStart && d < fyEnd;
      })
      .reduce((sum, o) => sum + ((o.sold_total ?? 0) - (o.total_cost ?? 0)), 0);

    // Projections based on daily run rate
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthlyProjected = dayOfMonth > 0 ? (monthlyProfit / dayOfMonth) * daysInMonth : 0;

    const fyDaysElapsed = Math.max(1, Math.floor((now.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24)));
    const fyTotalDays = Math.floor((fyEnd.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24));
    const yearlyProjected = (yearlyProfit / fyDaysElapsed) * fyTotalDays;

    // Best performing event (all time) by profit
    const eventProfitMap = new Map<string, number>();
    for (const o of orders) {
      if ((o.sold_total ?? 0) <= 0) continue;
      const name = o.event_name ?? "Untitled";
      const profit = (o.sold_total ?? 0) - (o.total_cost ?? 0);
      eventProfitMap.set(name, (eventProfitMap.get(name) ?? 0) + profit);
    }
    let bestEvent = "";
    let bestProfit = -Infinity;
    for (const [name, profit] of eventProfitMap) {
      if (profit > bestProfit) { bestProfit = profit; bestEvent = name; }
    }

    // Events this month (by event_date, non-archived)
    const thisMonthOrders = orders.filter((o) => {
      if (o.listing_status === "Archived") return false;
      const d = parseDate(o.event_date);
      if (!d) return false;
      return d >= monthStart && d < nextMonth;
    });
    const thisMonthCount = thisMonthOrders.length;
    const thisMonthSold = thisMonthOrders.filter((o) => o.listing_status === "Sold").length;
    const thisMonthPayout = thisMonthOrders
      .filter((o) => o.listing_status === "Sold")
      .reduce((sum, o) => sum + (o.sold_total ?? 0), 0);

    // Open positions: actively listed
    const openCount = orders.filter((o) => o.listing_status === "Listed").length;

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

    return { capitalIn, closedProfit, availableCount, soldCount, monthlyProfit, openCount, bestEvent, bestProfit, thisMonthCount, thisMonthSold, thisMonthPayout, yearlyProfit, fyStart, fyEnd, monthlyProjected, yearlyProjected };
  }, [orders]);

  const eventPnL = useMemo(() => {
    // Build payout map: order id → total payout from matched sales
    const payoutByOrder = new Map<number, number>();
    for (const sale of sales) {
      if (sale.inventory_order_id == null) continue;
      const payout = sale.payout_total ?? sale.sale_total ?? 0;
      payoutByOrder.set(sale.inventory_order_id, (payoutByOrder.get(sale.inventory_order_id) ?? 0) + payout);
    }

    // Group orders by event
    const map = new Map<string, {
      eventName: string;
      venue: string;
      eventDate: string | null;
      dateValue: Date | null;
      totalCost: number;
      totalPayout: number;
      totalQty: number;
      soldQty: number;
    }>();

    for (const order of orders) {
      if (order.listing_status === "Archived") continue;
      const key = `${order.event_name ?? ""}__${order.venue ?? ""}__${order.event_date ?? ""}`;
      if (!map.has(key)) {
        map.set(key, {
          eventName: order.event_name ?? "Untitled event",
          venue: order.venue ?? "",
          eventDate: order.event_date ?? null,
          dateValue: parseDate(order.event_date),
          totalCost: 0,
          totalPayout: 0,
          totalQty: 0,
          soldQty: 0,
        });
      }
      const group = map.get(key)!;
      group.totalCost += order.total_cost ?? 0;
      group.totalPayout += payoutByOrder.get(order.id) ?? 0;
      group.totalQty += order.qty_bought ?? 1;
      if (order.listing_status === "Sold") group.soldQty += order.qty_bought ?? 1;
    }

    return Array.from(map.values())
      .filter((g) => g.totalCost > 0 || g.totalPayout > 0)
      .map((g) => ({
        ...g,
        profit: g.totalPayout - g.totalCost,
        roi: g.totalCost > 0 ? ((g.totalPayout - g.totalCost) / g.totalCost) * 100 : null,
      }))
      .sort((a, b) => {
        if (a.dateValue && b.dateValue) return a.dateValue.getTime() - b.dateValue.getTime();
        if (a.dateValue) return -1;
        if (b.dateValue) return 1;
        return 0;
      });
  }, [orders, sales]);

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
            <p className="eyebrow">Overview</p>
            <h2>Dashboard</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => void loadData()}>
              Refresh
            </button>
          </div>
        </header>

        {/* Monthly profit goal */}
        {(() => {
          const profit = metrics.monthlyProfit;
          const projected = metrics.monthlyProjected;
          const pct = goal > 0 ? Math.min((profit / goal) * 100, 100) : 0;
          const over = profit > goal;
          const monthName = new Date().toLocaleString("en-GB", { month: "long" });
          return (
            <section className="goal-card">
              <div className="goal-card-top">
                <div>
                  <p className="section-tag">{monthName} goal</p>
                  <div className="goal-card-figures">
                    <span className={`goal-card-profit${over ? " value-up" : ""}`}>{formatCurrency(profit)}</span>
                    <span className="goal-card-divider">/</span>
                    <span className="goal-card-target">{formatCurrency(goal)}</span>
                  </div>
                </div>
                {editingGoal ? (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      className="field"
                      type="number"
                      min="0"
                      step="100"
                      placeholder={String(goal)}
                      value={goalInput}
                      onChange={e => setGoalInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveGoal(); if (e.key === "Escape") setEditingGoal(false); }}
                      autoFocus
                      style={{ width: "120px" }}
                    />
                    <button type="button" className="primary-button" onClick={saveGoal}>Save</button>
                    <button type="button" className="ghost-button" onClick={() => setEditingGoal(false)}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" className="ghost-button" onClick={() => { setGoalInput(String(goal)); setEditingGoal(true); }}>
                    Edit goal
                  </button>
                )}
              </div>
              <div className="goal-progress-track">
                <div
                  className={`goal-progress-fill${over ? " goal-progress-over" : ""}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <div className="goal-progress-footer">
                <span>{pct.toFixed(1)}% of target</span>
                <span className="goal-projected">Projected: {formatCurrency(projected)}</span>
                <span>{over ? `${formatCurrency(profit - goal)} over target` : `${formatCurrency(goal - profit)} to go`}</span>
              </div>
            </section>
          );
        })()}

        {/* Yearly profit goal */}
        {(() => {
          const profit = metrics.yearlyProfit;
          const projected = metrics.yearlyProjected;
          const pct = yearlyGoal > 0 ? Math.min((profit / yearlyGoal) * 100, 100) : 0;
          const over = profit > yearlyGoal;
          const fyLabel = `Apr ${metrics.fyStart.getFullYear()} – Mar ${metrics.fyEnd.getFullYear()}`;
          return (
            <section className="goal-card">
              <div className="goal-card-top">
                <div>
                  <p className="section-tag">Yearly goal · {fyLabel}</p>
                  <div className="goal-card-figures">
                    <span className={`goal-card-profit${over ? " value-up" : ""}`}>{formatCurrency(profit)}</span>
                    <span className="goal-card-divider">/</span>
                    <span className="goal-card-target">{formatCurrency(yearlyGoal)}</span>
                  </div>
                </div>
                {editingYearlyGoal ? (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      className="field"
                      type="number"
                      min="0"
                      step="1000"
                      placeholder={String(yearlyGoal)}
                      value={yearlyGoalInput}
                      onChange={e => setYearlyGoalInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveYearlyGoal(); if (e.key === "Escape") setEditingYearlyGoal(false); }}
                      autoFocus
                      style={{ width: "140px" }}
                    />
                    <button type="button" className="primary-button" onClick={saveYearlyGoal}>Save</button>
                    <button type="button" className="ghost-button" onClick={() => setEditingYearlyGoal(false)}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" className="ghost-button" onClick={() => { setYearlyGoalInput(String(yearlyGoal)); setEditingYearlyGoal(true); }}>
                    Edit goal
                  </button>
                )}
              </div>
              <div className="goal-progress-track">
                <div
                  className={`goal-progress-fill${over ? " goal-progress-over" : ""}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <div className="goal-progress-footer">
                <span>{pct.toFixed(1)}% of target</span>
                <span className="goal-projected">Projected: {formatCurrency(projected)}</span>
                <span>{over ? `${formatCurrency(profit - yearlyGoal)} over target` : `${formatCurrency(yearlyGoal - profit)} to go`}</span>
              </div>
            </section>
          );
        })()}

        <section className="kpi-grid">
          <article className={`kpi-card${metrics.monthlyProfit >= 0 ? " analytics-kpi-profit" : " analytics-kpi-risk"}`}>
            <span className="kpi-accent" />
            <p>Profit this month</p>
            <strong>{formatCurrency(metrics.monthlyProfit)}</strong>
            <span>from sales in {new Date().toLocaleString("en-GB", { month: "long" })}</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Events this month</p>
            <strong>{metrics.thisMonthCount}</strong>
            <span>{metrics.thisMonthSold} sold · {metrics.thisMonthCount - metrics.thisMonthSold} remaining</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Open positions</p>
            <strong>{metrics.openCount}</strong>
            <span>actively listed</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Projected payout</p>
            <strong>{formatCurrency(metrics.thisMonthPayout)}</strong>
            <span>from sold {new Date().toLocaleString("en-GB", { month: "long" })} events</span>
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


        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">{new Date().toLocaleString("en-GB", { month: "long" })} events</p>
              <h4>Unsold this month</h4>
            </div>
            <span className="table-count">{aprilUnsold.length} remaining</span>
          </div>

          {loading ? null : aprilUnsold.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>All {new Date().toLocaleString("en-GB", { month: "long" })} events sold</h5>
              <p>Nothing left to shift this month.</p>
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
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {aprilUnsold.map((order) => {
                    const date = parseDate(order.event_date);
                    const daysAway = getDaysAway(date);
                    return (
                      <tr key={order.id}>
                        <td>
                          <div className="event-cell">
                            <strong>{order.event_name || "Untitled"}</strong>
                            <span>{order.venue || "—"}</span>
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
                          <strong className={daysAway != null && daysAway <= 3 ? "delta-down" : ""}>
                            {formatEventDate(order.event_date)}
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
              <p className="section-tag">P&amp;L</p>
              <h4>Event breakdown</h4>
            </div>
            <span className="table-count">{eventPnL.length} events</span>
          </div>

          {loading ? null : eventPnL.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No data yet</h5>
              <p>Scan your inbox and match sales to see P&amp;L per event.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Qty</th>
                    <th>Cost In</th>
                    <th>Payout</th>
                    <th>Profit</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {eventPnL.map((row) => (
                    <tr key={`${row.eventName}__${row.eventDate}`}>
                      <td>
                        <div className="event-cell">
                          <strong>{row.eventName}</strong>
                          <span>{row.venue || "—"}</span>
                          <small>{formatEventDate(row.eventDate)}</small>
                        </div>
                      </td>
                      <td>{row.soldQty}/{row.totalQty}</td>
                      <td>{formatCurrency(row.totalCost)}</td>
                      <td>{row.totalPayout > 0 ? formatCurrency(row.totalPayout) : <span className="text-muted">—</span>}</td>
                      <td>
                        {row.totalPayout > 0 ? (
                          <strong className={row.profit >= 0 ? "value-up" : "value-down"}>
                            {row.profit >= 0 ? "+" : ""}{formatCurrency(row.profit)}
                          </strong>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        {row.roi != null && row.totalPayout > 0 ? (
                          <strong className={row.roi >= 0 ? "value-up" : "value-down"}>
                            {row.roi >= 0 ? "+" : ""}{row.roi.toFixed(1)}%
                          </strong>
                        ) : <span className="text-muted">—</span>}
                      </td>
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
