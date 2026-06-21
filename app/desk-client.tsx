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

function getProportionalCost(
  totalCost: number | null,
  qtyBought: number | null,
  qtySold: number,
  status: string | null,
): number {
  const cost = totalCost ?? 0;
  if (status !== "Partially Sold" || (qtyBought ?? 0) <= 0 || qtySold <= 0) return cost;
  return Math.min(cost, (qtySold / qtyBought!) * cost);
}

const navItems = [
  { label: "Dashboard", href: "/", active: true },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
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
  const [exporting, setExporting] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number }>(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const monthOptions = useMemo(() => {
    const n = new Date();
    const opts: { year: number; month: number; label: string }[] = [];
    for (let i = -12; i <= 6; i++) {
      const d = new Date(n.getFullYear(), n.getMonth() + i, 1);
      const isCurrent = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
      opts.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleString("en-GB", { month: "long", year: "numeric" }) + (isCurrent ? " (current)" : ""),
      });
    }
    return opts.reverse();
  }, []);

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
      .neq("listing_status", "Archived")
      .neq("listing_status", "Personal")
      .neq("listing_status", "Ignored");

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

  async function exportMatchedCSV() {
    setExporting(true);
    try {
      // Fetch ALL orders and ALL non-deleted sales in parallel
      const [{ data: ordersData }, { data: salesData }] = await Promise.all([
        supabase
          .from("orders")
          .select("id, booking_ref, event_name, venue, event_date, account_email, section, row, seat_from, seat_to, qty_bought, total_cost, listing_status, source_type")
          .order("event_date", { ascending: true }),
        supabase
          .from("sales")
          .select("id, external_sale_id, inventory_order_id, event_name, venue, event_date, sold_at, qty_sold, sale_total, payout_total, marketplace, buyer_name, buyer_email, sale_status, transfer_status, transfer_date, payment_status, expected_payout_date, payout_date, notes, account_email, section, row, seat_from, seat_to")
          .not("sale_status", "eq", "Deleted")
          .order("event_date", { ascending: true }),
      ]);

      const csv = (rows: (string | number | null | undefined)[][]) => {
        const esc = (v: string | number | null | undefined) => {
          const s = v == null ? "" : String(v);
          return s.includes(",") || s.includes('"') || s.includes("\n")
            ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return rows.map((r) => r.map(esc).join(",")).join("\n");
      };

      const headers = [
        "Booking Ref", "Event Name", "Venue", "Event Date", "Account Email",
        "Section", "Row", "Seat From", "Seat To", "Qty Bought", "Total Cost", "Ticket Status", "Source",
        "Sale Reference", "Sale Date", "Qty Sold", "Sale Total", "Payout Total",
        "Platform", "Buyer Name", "Buyer Email", "Sale Status",
        "Transfer Status", "Transfer Date", "Payment Status",
        "Expected Payout Date", "Payout Date", "Notes",
      ];

      // Build order map and track which orders have sales
      const orderMap = new Map<number, Record<string, unknown>>();
      for (const o of (ordersData ?? [])) {
        orderMap.set((o as { id: number }).id, o as Record<string, unknown>);
      }
      const ordersWithSales = new Set<number>();

      // Rows from sales (matched + unmatched)
      const saleRows = (salesData ?? []).map((s) => {
        const orderId = s.inventory_order_id as number | null;
        const o = orderId ? (orderMap.get(orderId) ?? {}) : {};
        if (orderId) ordersWithSales.add(orderId);
        return [
          o.booking_ref ?? null, o.event_name ?? s.event_name, o.venue ?? s.venue,
          o.event_date ?? s.event_date, o.account_email ?? s.account_email,
          o.section ?? s.section, o.row ?? s.row,
          o.seat_from ?? s.seat_from, o.seat_to ?? s.seat_to,
          o.qty_bought ?? null, o.total_cost ?? null, o.listing_status ?? null, o.source_type ?? null,
          s.external_sale_id, s.sold_at, s.qty_sold, s.sale_total, s.payout_total,
          s.marketplace, s.buyer_name, s.buyer_email, s.sale_status,
          s.transfer_status, s.transfer_date, s.payment_status,
          s.expected_payout_date, s.payout_date, s.notes,
        ];
      });

      // Rows from orders with no sales (personal / unsold tickets)
      const personalRows = (ordersData ?? [])
        .filter((o) => !ordersWithSales.has((o as { id: number }).id))
        .map((o) => {
          const order = o as Record<string, unknown>;
          return [
            order.booking_ref, order.event_name, order.venue, order.event_date, order.account_email,
            order.section, order.row, order.seat_from, order.seat_to,
            order.qty_bought, order.total_cost, order.listing_status, order.source_type,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
          ];
        });

      const allRows = [...saleRows, ...personalRows];
      if (allRows.length === 0) {
        alert("Nothing to export.");
        return;
      }

      const blob = new Blob([csv([headers, ...allRows])], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tixtracker-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function loadData() {
    setLoading(true);
    const [ordersResult, salesResult] = await Promise.all([
      supabase
        .from("orders")
        .select("id, event_name, venue, event_date, account_email, section, listing_status, total_cost, sold_total, qty_bought")
        .or("listing_status.is.null,listing_status.not.in.(Ignored,Personal)"),
      supabase
        .from("sales")
        .select("id, event_name, venue, event_date, account_email, qty_sold, sale_total, payout_total, inventory_order_id, sold_at")
        .not("sale_status", "in", '("Archived","Deleted")'),
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
    const now = new Date();
    const monthStart = new Date(selectedMonth.year, selectedMonth.month, 1);
    const nextMonth = new Date(selectedMonth.year, selectedMonth.month + 1, 1);

    // Financial year: April 1 → March 31
    const fyStart = now.getMonth() >= 3
      ? new Date(now.getFullYear(), 3, 1)       // Apr 1 this year
      : new Date(now.getFullYear() - 1, 3, 1);  // Apr 1 last year
    const fyEnd = new Date(fyStart.getFullYear() + 1, 3, 1);

    // Build qty sold and sale_total per order from linked sales
    const soldQtyByOrderId = new Map<number, number>();
    const saleTotalByOrderId = new Map<number, number>();
    for (const s of sales) {
      if (s.inventory_order_id == null) continue;
      soldQtyByOrderId.set(s.inventory_order_id, (soldQtyByOrderId.get(s.inventory_order_id) ?? 0) + (s.qty_sold ?? 0));
      if (s.sale_total != null) {
        saleTotalByOrderId.set(s.inventory_order_id, (saleTotalByOrderId.get(s.inventory_order_id) ?? 0) + s.sale_total);
      }
    }

    // Effective sold total: use orders.sold_total, fall back to sum of linked sales.sale_total
    const effectiveSoldTotal = (o: Order) => (o.sold_total ?? 0) > 0
      ? (o.sold_total ?? 0)
      : (saleTotalByOrderId.get(o.id) ?? 0);

    const monthlyRevenue = orders
      .filter((o) => {
        if (effectiveSoldTotal(o) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
      })
      .reduce((sum, o) => sum + effectiveSoldTotal(o), 0);

    const monthlyCost = orders
      .filter((o) => {
        if (effectiveSoldTotal(o) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
      })
      .reduce((sum, o) => sum + getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status), 0);

    const monthlyProfit = orders
      .filter((o) => {
        if (effectiveSoldTotal(o) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
      })
      .reduce((sum, o) => sum + (effectiveSoldTotal(o) - getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status)), 0);

    const monthlyROI = monthlyCost > 0 ? (monthlyProfit / monthlyCost) * 100 : null;

    // Yearly profit (April to April FY)
    const yearlyProfit = orders
      .filter((o) => {
        if (effectiveSoldTotal(o) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= fyStart && d < fyEnd;
      })
      .reduce((sum, o) => sum + (effectiveSoldTotal(o) - getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status)), 0);

    // Projections based on daily run rate
    const daysInMonth = new Date(selectedMonth.year, selectedMonth.month + 1, 0).getDate();
    const isCurrentMonth = selectedMonth.year === now.getFullYear() && selectedMonth.month === now.getMonth();
    const isPastMonth = selectedMonth.year < now.getFullYear() || (selectedMonth.year === now.getFullYear() && selectedMonth.month < now.getMonth());
    const dayOfMonth = isCurrentMonth ? now.getDate() : isPastMonth ? daysInMonth : 0;
    const monthlyProjected = dayOfMonth > 0 ? (monthlyProfit / dayOfMonth) * daysInMonth : 0;

    const fyDaysElapsed = Math.max(1, Math.floor((now.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24)));
    const fyTotalDays = Math.floor((fyEnd.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24));
    const yearlyProjected = (yearlyProfit / fyDaysElapsed) * fyTotalDays;

    // Best performing event (all time) by profit
    const eventProfitMap = new Map<string, number>();
    for (const o of orders) {
      if (effectiveSoldTotal(o) <= 0) continue;
      const name = o.event_name ?? "Untitled";
      const effCost = getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status);
      const profit = effectiveSoldTotal(o) - effCost;
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
    const thisMonthPayout = orders
      .filter((o) => {
        if (o.listing_status !== "Sold" && (o.sold_total ?? 0) <= 0) return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
      })
      .reduce((sum, o) => sum + (o.sold_total ?? 0), 0);
    // Include archived so sold tickets that have been auto-archived are counted
    const thisMonthAllOrders = orders.filter((o) => {
      const d = parseDate(o.event_date);
      if (!d) return false;
      return d >= monthStart && d < nextMonth;
    });
    const thisMonthTickets = thisMonthAllOrders.reduce((sum, o) => sum + (o.qty_bought ?? 1), 0);
    const thisMonthTicketsSold = thisMonthAllOrders
      .filter((o) => o.listing_status === "Sold" || o.listing_status === "Archived")
      .reduce((sum, o) => sum + (o.qty_bought ?? 1), 0);
    const thisMonthTicketsRemaining = thisMonthAllOrders
      .filter((o) => o.listing_status !== "Sold" && o.listing_status !== "Archived")
      .reduce((sum, o) => sum + (o.qty_bought ?? 1), 0);

    // Unsold stock value this month: cost of active (non-sold, non-archived) orders with events in the selected month
    const unsoldStockValue = thisMonthAllOrders
      .filter((o) => o.listing_status !== "Sold" && o.listing_status !== "Archived")
      .reduce((sum, o) => sum + (o.total_cost ?? 0), 0);

    const capitalIn = orders
      .filter((o) => o.listing_status !== "Sold" && o.listing_status !== "Archived")
      .reduce((sum, o) => sum + (o.total_cost ?? 0), 0);

    const closedProfit = orders
      .filter((o) => effectiveSoldTotal(o) > 0)
      .reduce((sum, o) => sum + (effectiveSoldTotal(o) - getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status)), 0);

    const availableCount = orders.filter(
      (o) => o.listing_status !== "Sold" && o.listing_status !== "Archived",
    ).length;

    const soldCount = orders.filter((o) => o.listing_status === "Sold").length;

    return { capitalIn, closedProfit, availableCount, soldCount, monthlyRevenue, monthlyProfit, monthlyROI, unsoldStockValue, bestEvent, bestProfit, thisMonthCount, thisMonthSold, thisMonthPayout, thisMonthTickets, thisMonthTicketsSold, thisMonthTicketsRemaining, yearlyProfit, fyStart, fyEnd, monthlyProjected, yearlyProjected };
  }, [orders, sales, selectedMonth]);

  const ticketsLeftThisMonth = useMemo(() => {
    const monthStart = new Date(selectedMonth.year, selectedMonth.month, 1);
    const nextMonth = new Date(selectedMonth.year, selectedMonth.month + 1, 1);
    const soldQtyMap = new Map<number, number>();
    for (const s of sales) {
      if (s.inventory_order_id == null) continue;
      soldQtyMap.set(s.inventory_order_id, (soldQtyMap.get(s.inventory_order_id) ?? 0) + (s.qty_sold ?? 0));
    }
    return orders
      .filter((o) => {
        if (o.listing_status === "Sold" || o.listing_status === "Archived") return false;
        const d = parseDate(o.event_date);
        if (!d) return false;
        return d >= monthStart && d < nextMonth;
      })
      .map((o) => {
        const bought = o.qty_bought ?? 1;
        const sold = soldQtyMap.get(o.id) ?? 0;
        return { ...o, qtySold: sold, qtyLeft: Math.max(0, bought - sold), dateValue: parseDate(o.event_date) };
      })
      .sort((a, b) => {
        if (a.dateValue && b.dateValue) return a.dateValue.getTime() - b.dateValue.getTime();
        return 0;
      });
  }, [orders, sales, selectedMonth]);

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
                target={item.target}
                rel={item.rel}
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
            <select
              className="month-select"
              value={`${selectedMonth.year}-${String(selectedMonth.month).padStart(2, "0")}`}
              onChange={e => {
                const [y, m] = e.target.value.split("-").map(Number);
                setSelectedMonth({ year: y, month: m });
              }}
            >
              {monthOptions.map(opt => (
                <option key={`${opt.year}-${opt.month}`} value={`${opt.year}-${String(opt.month).padStart(2, "0")}`}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              type="button"
              disabled={exporting}
              onClick={() => void exportMatchedCSV()}
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
            <button className="secondary-button" type="button" onClick={() => {
              const n = new Date();
              setSelectedMonth({ year: n.getFullYear(), month: n.getMonth() });
              void loadData();
            }}>
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
          const monthName = new Date(selectedMonth.year, selectedMonth.month, 1).toLocaleString("en-GB", { month: "long" });
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
          <article className={`kpi-card${metrics.monthlyRevenue >= 0 ? " analytics-kpi-profit" : " analytics-kpi-risk"}`}>
            <span className="kpi-accent" />
            <p>Revenue this month</p>
            <strong>{formatCurrency(metrics.monthlyRevenue)}</strong>
            <span>gross income in {new Date(selectedMonth.year, selectedMonth.month, 1).toLocaleString("en-GB", { month: "long" })}</span>
          </article>
          <article className={`kpi-card${metrics.monthlyROI != null && metrics.monthlyROI >= 0 ? " analytics-kpi-profit" : ""}`}>
            <span className="kpi-accent" />
            <p>ROI this month</p>
            <strong>{metrics.monthlyROI != null ? `${metrics.monthlyROI.toFixed(1)}%` : "—"}</strong>
            <span>return on sold {new Date(selectedMonth.year, selectedMonth.month, 1).toLocaleString("en-GB", { month: "long" })} tickets</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Unsold stock</p>
            <strong>{formatCurrency(metrics.unsoldStockValue)}</strong>
            <span>cost of unsold {new Date(selectedMonth.year, selectedMonth.month, 1).toLocaleString("en-GB", { month: "long" })} tickets</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Tickets this month</p>
            <strong>{metrics.thisMonthTickets}</strong>
            <span>{metrics.thisMonthTicketsSold} tickets sold · {metrics.thisMonthTicketsRemaining} still to sell</span>
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

        {(!loading && unmatchedSales.length > 0) && (
        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Sales</p>
              <h4>Unmatched sales</h4>
            </div>
            <Link href="/sales" className="ghost-button">Review in Sales →</Link>
          </div>

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
        </section>
        )}


        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">{new Date(selectedMonth.year, selectedMonth.month, 1).toLocaleString("en-GB", { month: "long" })}</p>
              <h4>Tickets left to sell</h4>
            </div>
            {ticketsLeftThisMonth.length > 0 && (
              <span className="table-count">
                {ticketsLeftThisMonth.reduce((s, o) => s + o.qtyLeft, 0)} tickets left
              </span>
            )}
          </div>

          {loading ? null : ticketsLeftThisMonth.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>All sold</h5>
              <p>No tickets left to sell in {new Date(selectedMonth.year, selectedMonth.month, 1).toLocaleString("en-GB", { month: "long" })}.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Section</th>
                    <th>Bought</th>
                    <th>Sold</th>
                    <th>Left</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketsLeftThisMonth.map((order) => {
                    const daysAway = getDaysAway(order.dateValue);
                    return (
                      <tr key={order.id}>
                        <td>
                          <div className="event-cell">
                            <strong>{order.event_name || "Untitled"}</strong>
                            <span>{order.venue || "—"}</span>
                          </div>
                        </td>
                        <td>{order.section || "—"}</td>
                        <td>{order.qty_bought ?? "—"}</td>
                        <td>{order.qtySold > 0 ? order.qtySold : <span className="text-muted">—</span>}</td>
                        <td>
                          <strong className={daysAway != null && daysAway <= 3 ? "delta-down" : "delta-up"}>
                            {order.qtyLeft}
                          </strong>
                        </td>
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
