"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { formatCurrency } from "@/src/lib/currency";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

type Order = {
  id: number;
  booking_ref: string | null;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  purchased_at: string | null;
  account_email: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  sold_total: number | null;
  listing_status: string | null;
  source_type: string | null;
  created_at: string | null;
};

type MetricCard = {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "profit" | "risk";
};

type SaleMetrics = {
  revenueReceived: number;
  revenuePending: number;
  awaitingTransfer: number;
  transferCompleted: number;
  paidSalesCount: number;
  totalSalesCount: number;
};

type SeriesPoint = {
  label: string;
  profit: number;
  cost: number;
  sales: number;
};

type EventProfit = {
  key: string;
  name: string;
  profit: number;
  sales: number;
  cost: number;
  tickets: number;
  venue: string;
  roi: number;
};

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: true },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Presale & Codes", href: "/presale", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

const accentColors = ["#FF4FA3", "#9B5CFF", "#4FC3FF", "#67F0A5", "#FFB84F", "#FF7D7D"];

type DatePreset = "all" | "this-week" | "this-month" | "this-year" | "last-year" | "custom";

export default function AnalyticsClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [saleMetrics, setSaleMetrics] = useState<SaleMetrics | null>(null);
  const [soldAtMap, setSoldAtMap] = useState<Record<number, string>>({});
  const [soldQtyByOrderId, setSoldQtyByOrderId] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [inlineEdits, setInlineEdits] = useState<Record<number, string>>({});
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [eventSortCol, setEventSortCol] = useState<"profit" | "roi" | "sales" | "cost" | "tickets">("profit");
  const [eventSortDir, setEventSortDir] = useState<"desc" | "asc">("desc");
  const [summaryView, setSummaryView] = useState<"closed" | "portfolio">("closed");

  useEffect(() => {
    void loadOrders();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function setInlineEdit(id: number, value: string) {
    setInlineEdits((prev) => ({ ...prev, [id]: value }));
  }

  async function saveSoldTotal(order: Order, raw: string) {
    const numeric = raw === "" ? null : Number(raw);
    const newStatus =
      numeric != null && numeric > 0 && order.listing_status !== "Sold" ? "Sold" : order.listing_status;

    const { error } = await supabase
      .from("orders")
      .update({ sold_total: numeric, listing_status: newStatus })
      .eq("id", order.id);

    if (error) { setMessage(error.message); return; }

    setOrders((current) =>
      current.map((o) =>
        o.id === order.id ? { ...o, sold_total: numeric, listing_status: newStatus } : o,
      ),
    );
    setMessage("Sold total updated");
  }

  async function saveStatus(order: Order, status: string) {
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: status })
      .eq("id", order.id);

    if (error) { setMessage(error.message); return; }

    setOrders((current) =>
      current.map((o) => (o.id === order.id ? { ...o, listing_status: status } : o)),
    );
    setMessage("Status updated");
  }

  function exportCSV() {
    const soldOrders = orders.filter((order) => isSold(order));

    if (soldOrders.length === 0) {
      setMessage("No sold tickets to export");
      return;
    }

    const headers = ["Event", "Venue", "Event Date", "Account", "Section", "Row", "Seat From", "Seat To", "Qty", "Source", "Booking Ref", "Cost (£)", "Sold For (£)", "Profit (£)", "ROI (%)"];

    const rows = soldOrders.map((order) => {
      const cost = getProportionalCost(order.total_cost, order.qty_bought, soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0), order.listing_status);
      const soldFor = order.sold_total ?? 0;
      const profit = soldFor - cost;
      const roi = cost > 0 ? ((profit / cost) * 100).toFixed(1) : "";
      return [
        order.event_name ?? "",
        order.venue ?? "",
        order.event_date ?? "",
        order.account_email ?? "",
        order.section ?? "",
        order.row ?? "",
        order.seat_from ?? "",
        order.seat_to ?? "",
        order.qty_bought ?? "",
        order.source_type ?? "",
        order.booking_ref ?? "",
        cost.toFixed(2),
        soldFor.toFixed(2),
        profit.toFixed(2),
        roi,
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ticketauto-sold-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadOrders(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const [ordersResult, salesResult, saleMetricsResult] = await Promise.all([
      supabase.from("orders").select("*").or("listing_status.is.null,listing_status.not.in.(Ignored,Personal)").order("created_at", { ascending: true }),
      supabase.from("sales").select("inventory_order_id, sold_at, qty_sold").not("inventory_order_id", "is", null),
      supabase.from("sales").select("payment_status, transfer_status, payout_total, sale_total").not("sale_status", "in", '("Archived","Deleted","Cancelled / Issue")'),
    ]);

    if (ordersResult.error) {
      setMessage(ordersResult.error.message);
    } else {
      setOrders((ordersResult.data as Order[]) || []);
      if (showRefreshing) {
        setMessage("Analytics refreshed");
      }
    }

    if (!saleMetricsResult.error && saleMetricsResult.data) {
      const sm = saleMetricsResult.data as { payment_status: string | null; transfer_status: string | null; payout_total: number | null; sale_total: number | null }[];
      let revenueReceived = 0, revenuePending = 0, awaitingTransfer = 0, transferCompleted = 0, paidSalesCount = 0;
      for (const s of sm) {
        const amount = s.payout_total ?? s.sale_total ?? 0;
        if (s.payment_status === "Paid") { revenueReceived += amount; paidSalesCount++; }
        else revenuePending += amount;
        if ((s.transfer_status || "Awaiting Transfer") === "Awaiting Transfer") awaitingTransfer++;
        else transferCompleted++;
      }
      setSaleMetrics({ revenueReceived, revenuePending, awaitingTransfer, transferCompleted, paidSalesCount, totalSalesCount: sm.length });
    }

    if (!salesResult.error && salesResult.data) {
      const map: Record<number, string> = {};
      const qtyMap = new Map<number, number>();
      for (const row of salesResult.data as { inventory_order_id: number; sold_at: string | null; qty_sold: number | null }[]) {
        if (row.inventory_order_id) {
          if (row.sold_at) {
            const existing = map[row.inventory_order_id];
            if (!existing || row.sold_at < existing) {
              map[row.inventory_order_id] = row.sold_at;
            }
          }
          qtyMap.set(row.inventory_order_id, (qtyMap.get(row.inventory_order_id) ?? 0) + (row.qty_sold ?? 0));
        }
      }
      setSoldAtMap(map);
      setSoldQtyByOrderId(qtyMap);
    }

    setLoading(false);
    setRefreshing(false);
  }

  const dateRange = useMemo(() => {
    const now = new Date();
    if (datePreset === "this-week") {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === "this-month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === "this-year") {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === "last-year") {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === "custom" && customFrom && customTo) {
      const start = parseDMY(customFrom);
      const end = parseDMY(customTo);
      if (!start || !end) return null;
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    return null;
  }, [datePreset, customFrom, customTo]);

  const filteredOrders = useMemo(() => {
    if (!dateRange) return orders;
    return orders.filter((order) => {
      const date = parseEventDate(order.event_date);
      if (!date) return false;
      return date >= dateRange.start && date <= dateRange.end;
    });
  }, [orders, dateRange]);

  const analytics = useMemo(() => {
    const soldOrders = filteredOrders.filter((order) => isSold(order));
    const soldTickets = soldOrders.reduce((sum, order) => sum + getTicketQuantity(order), 0);
    const totalProfit = soldOrders.reduce((sum, order) => sum + getProfit(order, soldQtyByOrderId), 0);
    const totalSales = soldOrders.reduce((sum, order) => sum + (order.sold_total ?? 0), 0);
    const totalCost = soldOrders.reduce((sum, order) => sum + getProportionalCost(order.total_cost, order.qty_bought, soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0), order.listing_status), 0);
    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    const avgTimeToSellDays = soldOrders
      .map((order) => getApproxDaysToSell(order, soldAtMap[order.id] ?? null))
      .filter((value): value is number => value != null);
    const avgTimeToSell = avgTimeToSellDays.length
      ? avgTimeToSellDays.reduce((sum, value) => sum + value, 0) / avgTimeToSellDays.length
      : null;

    const profitSeries = buildMonthlyProfitSeries(soldOrders, soldAtMap, soldQtyByOrderId);
    const eventRows = buildEventProfit(soldOrders, soldQtyByOrderId);

    const metrics: MetricCard[] = [
      {
        label: "Total Profit",
        value: formatCurrency(totalProfit),
        detail: totalProfit >= 0 ? "Net across sold tickets" : "Losses on closed tickets",
        tone: totalProfit >= 0 ? "profit" : "risk",
      },
      {
        label: "ROI %",
        value: `${roi.toFixed(1)}%`,
        detail: totalCost > 0 ? `From ${formatCurrency(totalCost)} cost` : "No sold cost yet",
        tone: roi >= 0 ? "profit" : "risk",
      },
      {
        label: "Tickets Sold",
        value: String(soldTickets),
        detail: soldTickets > 0 ? `${formatCurrency(totalSales)} total sales` : "No sold tickets yet",
      },
      {
        label: "Avg Time to Sell",
        value: avgTimeToSell != null ? `${avgTimeToSell.toFixed(1)} days` : "—",
        detail: avgTimeToSell != null ? "From purchase to actual sale date" : "Need matched sales to calculate",
      },
    ];

    return { metrics, profitSeries, eventRows };
  }, [filteredOrders, soldAtMap, soldQtyByOrderId]);

  const allTimeSummary = useMemo(() => {
    const soldOrders = orders.filter(isSold);

    // Closed view — only orders marked as Sold
    const closedInvested = soldOrders.reduce((sum, o) => sum + getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status), 0);
    const closedReturned = soldOrders.reduce((sum, o) => sum + (o.sold_total ?? 0), 0);
    const closedProfit = closedReturned - closedInvested;
    const closedRoi = closedInvested > 0 ? (closedProfit / closedInvested) * 100 : 0;
    const closedTickets = soldOrders.reduce((sum, o) => sum + getTicketQuantity(o), 0);
    const closedEvents = new Set(soldOrders.map((o) => `${o.event_name}__${o.venue}`)).size;

    // Full portfolio view — all orders, returns from sold only
    const portfolioInvested = orders.reduce((sum, o) => sum + (o.total_cost ?? 0), 0);
    const portfolioReturned = soldOrders.reduce((sum, o) => sum + (o.sold_total ?? 0), 0);
    const portfolioProfit = portfolioReturned - soldOrders.reduce((sum, o) => sum + getProportionalCost(o.total_cost, o.qty_bought, soldQtyByOrderId.get(o.id) ?? (o.qty_bought ?? 0), o.listing_status), 0);
    const portfolioRoi = portfolioInvested > 0 ? (portfolioProfit / portfolioInvested) * 100 : 0;
    const portfolioTickets = orders.reduce((sum, o) => sum + getTicketQuantity(o), 0);
    const portfolioEvents = new Set(orders.map((o) => `${o.event_name}__${o.venue}`)).size;

    return {
      closed: {
        totalInvested: closedInvested,
        totalReturned: closedReturned,
        totalProfit: closedProfit,
        roi: closedRoi,
        totalTickets: closedTickets,
        soldTickets: closedTickets,
        totalEvents: closedEvents,
      },
      portfolio: {
        totalInvested: portfolioInvested,
        totalReturned: portfolioReturned,
        totalProfit: portfolioProfit,
        roi: portfolioRoi,
        totalTickets: portfolioTickets,
        soldTickets: closedTickets,
        totalEvents: portfolioEvents,
      },
    };
  }, [orders, soldQtyByOrderId]);

  const sortedEventRows = useMemo(() => {
    const rows = [...analytics.eventRows];
    rows.sort((a, b) => {
      const diff = a[eventSortCol] - b[eventSortCol];
      return eventSortDir === "desc" ? -diff : diff;
    });
    return rows;
  }, [analytics.eventRows, eventSortCol, eventSortDir]);

  function handleEventSort(col: typeof eventSortCol) {
    if (col === eventSortCol) {
      setEventSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setEventSortCol(col);
      setEventSortDir("desc");
    }
  }

  return (
    <div className="orders-shell analytics-shell">
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

      <main className="orders-main analytics-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Performance desk</p>
            <h2>Analytics</h2>
          </div>

          <div className="topbar-actions">
            <button
              className="secondary-button"
              onClick={() => void loadOrders(true)}
              disabled={refreshing}
              type="button"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="secondary-button"
              onClick={exportCSV}
              disabled={loading || orders.length === 0}
              type="button"
            >
              Export CSV
            </button>
          </div>
        </header>

        <section className="hero-card analytics-hero-card">
          <div>
            <p className="section-tag">Analytics</p>
            <h3>See profit, margin, and sell-through at a glance.</h3>
          </div>
          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Closed profit</span>
              <strong>{analytics.metrics[0]?.value || "—"}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Tickets sold</span>
              <strong>{analytics.metrics[2]?.value || "0"}</strong>
            </div>
          </div>
        </section>

        {message ? (
          <div className="feedback-banner" role="status">
            <span className="feedback-dot" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">All time</p>
              <h4>Portfolio summary</h4>
            </div>
            <div className="view-toggle" style={{ marginLeft: "auto" }}>
              <button
                type="button"
                className={`toggle-btn${summaryView === "closed" ? " toggle-btn-active" : ""}`}
                onClick={() => setSummaryView("closed")}
              >
                Closed
              </button>
              <button
                type="button"
                className={`toggle-btn${summaryView === "portfolio" ? " toggle-btn-active" : ""}`}
                onClick={() => setSummaryView("portfolio")}
              >
                Full portfolio
              </button>
            </div>
          </div>
          {(() => {
            const s = allTimeSummary[summaryView];
            return (
              <div className="drawer-summary" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
                <div>
                  <span>Total invested</span>
                  <strong>{formatCurrency(s.totalInvested)}</strong>
                </div>
                <div>
                  <span>Total returned</span>
                  <strong>{formatCurrency(s.totalReturned)}</strong>
                </div>
                <div>
                  <span>Net profit</span>
                  <strong className={s.totalProfit >= 0 ? "value-up" : "value-down"}>
                    {formatCurrency(s.totalProfit)}
                  </strong>
                </div>
                <div>
                  <span>Overall ROI</span>
                  <strong className={s.roi >= 0 ? "value-up" : "value-down"}>
                    {s.totalReturned > 0 ? `${s.roi.toFixed(1)}%` : "—"}
                  </strong>
                </div>
                <div>
                  <span>Tickets sold</span>
                  <strong>{s.soldTickets}{summaryView === "portfolio" ? ` / ${s.totalTickets}` : ""}</strong>
                </div>
                <div>
                  <span>{summaryView === "portfolio" ? "Sell-through" : "Events"}</span>
                  <strong>
                    {summaryView === "portfolio"
                      ? s.totalTickets > 0
                        ? `${((s.soldTickets / s.totalTickets) * 100).toFixed(0)}%`
                        : "—"
                      : String(s.totalEvents)}
                  </strong>
                </div>
              </div>
            );
          })()}
        </section>

        <section className="command-card">
          <div className="command-header">
            <div className="view-toggle">
              {(["all", "this-week", "this-month", "this-year", "last-year", "custom"] as DatePreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`toggle-btn${datePreset === preset ? " toggle-btn-active" : ""}`}
                  onClick={() => setDatePreset(preset)}
                >
                  {preset === "all" ? "All Time" : preset === "this-week" ? "This Week" : preset === "this-month" ? "This Month" : preset === "this-year" ? "This Year" : preset === "last-year" ? "Last Year" : "Custom"}
                </button>
              ))}
            </div>
            <span className="table-count">
              {dateRange
                ? `${filteredOrders.length} of ${orders.length} tickets · ${dateRange.start.toLocaleDateString("en-GB")} – ${dateRange.end.toLocaleDateString("en-GB")}`
                : `${orders.length} tickets · All time`}
            </span>
          </div>
          {datePreset === "custom" && (
            <div className="analytics-date-range">
              <label className="filter-field">
                <span className="filter-label">From</span>
                <input className="field" type="text" placeholder="DDMMYYYY" maxLength={10} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="filter-field">
                <span className="filter-label">To</span>
                <input className="field" type="text" placeholder="DDMMYYYY" maxLength={10} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </div>
          )}
        </section>

        <section className="kpi-grid">
          {analytics.metrics.map((metric) => (
            <article key={metric.label} className={`kpi-card${metric.tone === "profit" ? " analytics-kpi-profit" : ""}${metric.tone === "risk" ? " analytics-kpi-risk" : ""}`}>
              <span className="kpi-accent" />
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <span>{metric.detail}</span>
            </article>
          ))}
        </section>

        {saleMetrics && (
          <section className="table-card">
            <div className="table-card-header">
              <div>
                <p className="section-tag">Sales operations</p>
                <h4>Payment &amp; transfer status</h4>
              </div>
              <span className="table-count">{saleMetrics.totalSalesCount} active sales</span>
            </div>
            <div className="drawer-summary" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
              <div>
                <span>Revenue received</span>
                <strong style={{ color: "#4ade80" }}>{formatCurrency(saleMetrics.revenueReceived)}</strong>
              </div>
              <div>
                <span>Revenue pending</span>
                <strong style={{ color: "#fbbf24" }}>{formatCurrency(saleMetrics.revenuePending)}</strong>
              </div>
              <div>
                <span>Awaiting transfer</span>
                <strong style={{ color: "#f97316" }}>{saleMetrics.awaitingTransfer}</strong>
              </div>
              <div>
                <span>Transfer completed</span>
                <strong style={{ color: "#4fc3ff" }}>{saleMetrics.transferCompleted}</strong>
              </div>
              <div>
                <span>Paid sales</span>
                <strong>{saleMetrics.paidSalesCount}</strong>
              </div>
              <div>
                <span>Unpaid sales</span>
                <strong>{saleMetrics.totalSalesCount - saleMetrics.paidSalesCount}</strong>
              </div>
            </div>
          </section>
        )}

        {loading ? (
          <section className="table-card">
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading analytics</h5>
            </div>
          </section>
        ) : (
          <>
            {analytics.eventRows.length >= 2 && (
              <>
                <section className="table-card">
                  <div className="table-card-header">
                    <div>
                      <p className="section-tag">Top performers</p>
                      <h4>Best events</h4>
                    </div>
                    <span className="table-count">Top 3</span>
                  </div>
                  <div className="table-scroll">
                    <table className="premium-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Event</th>
                          <th>Tickets</th>
                          <th>Cost</th>
                          <th>Sold For</th>
                          <th>Profit</th>
                          <th>ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.eventRows.slice(0, 3).map((row, i) => (
                          <tr key={row.key}>
                            <td>{i + 1}</td>
                            <td>
                              <div className="event-cell">
                                <strong>{row.name}</strong>
                                <span>{row.venue}</span>
                              </div>
                            </td>
                            <td>{row.tickets}</td>
                            <td>{formatCurrency(row.cost)}</td>
                            <td>{formatCurrency(row.sales)}</td>
                            <td className={row.profit >= 0 ? "value-up" : "value-down"}>{formatCurrency(row.profit)}</td>
                            <td className={row.roi >= 0 ? "value-up" : "value-down"}>{row.cost > 0 ? `${row.roi.toFixed(1)}%` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="table-card">
                  <div className="table-card-header">
                    <div>
                      <p className="section-tag">Underperformers</p>
                      <h4>Worst events</h4>
                    </div>
                    <span className="table-count">Bottom 3</span>
                  </div>
                  <div className="table-scroll">
                    <table className="premium-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Event</th>
                          <th>Tickets</th>
                          <th>Cost</th>
                          <th>Sold For</th>
                          <th>Profit</th>
                          <th>ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...analytics.eventRows].reverse().slice(0, 3).map((row, i) => (
                          <tr key={row.key}>
                            <td>{i + 1}</td>
                            <td>
                              <div className="event-cell">
                                <strong>{row.name}</strong>
                                <span>{row.venue}</span>
                              </div>
                            </td>
                            <td>{row.tickets}</td>
                            <td>{formatCurrency(row.cost)}</td>
                            <td>{formatCurrency(row.sales)}</td>
                            <td className={row.profit >= 0 ? "value-up" : "value-down"}>{formatCurrency(row.profit)}</td>
                            <td className={row.roi >= 0 ? "value-up" : "value-down"}>{row.cost > 0 ? `${row.roi.toFixed(1)}%` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

<section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Events</p>
                  <h4>Breakdown by event</h4>
                </div>
                <span className="table-count">{analytics.eventRows.length} events</span>
              </div>
              {analytics.eventRows.length === 0 ? (
                <div className="state-card">
                  <div className="state-orb state-orb-muted" />
                  <h5>No sold events yet</h5>
                  <p>Mark tickets as sold to see event performance here.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th className="sortable-th" onClick={() => handleEventSort("tickets")}>
                          Tickets {eventSortCol === "tickets" ? (eventSortDir === "desc" ? "↓" : "↑") : ""}
                        </th>
                        <th className="sortable-th" onClick={() => handleEventSort("cost")}>
                          Cost {eventSortCol === "cost" ? (eventSortDir === "desc" ? "↓" : "↑") : ""}
                        </th>
                        <th className="sortable-th" onClick={() => handleEventSort("sales")}>
                          Sold For {eventSortCol === "sales" ? (eventSortDir === "desc" ? "↓" : "↑") : ""}
                        </th>
                        <th className="sortable-th" onClick={() => handleEventSort("profit")}>
                          Profit {eventSortCol === "profit" ? (eventSortDir === "desc" ? "↓" : "↑") : ""}
                        </th>
                        <th className="sortable-th" onClick={() => handleEventSort("roi")}>
                          ROI {eventSortCol === "roi" ? (eventSortDir === "desc" ? "↓" : "↑") : ""}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEventRows.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <div className="event-cell">
                              <strong>{row.name}</strong>
                              <span>{row.venue}</span>
                            </div>
                          </td>
                          <td>{row.tickets}</td>
                          <td>{formatCurrency(row.cost)}</td>
                          <td>{formatCurrency(row.sales)}</td>
                          <td className={row.profit >= 0 ? "value-up" : "value-down"}>
                            {formatCurrency(row.profit)}
                          </td>
                          <td className={row.roi >= 0 ? "value-up" : "value-down"}>
                            {row.cost > 0 ? `${row.roi.toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {!loading && (
          <section className="table-card">
            <div className="table-card-header">
              <div>
                <p className="section-tag">Sold tickets</p>
                <h4>Edit sold totals &amp; status</h4>
              </div>
              <span className="table-count">
                {filteredOrders.filter(isSold).length} sold
              </span>
            </div>

            {filteredOrders.filter(isSold).length === 0 ? (
              <div className="state-card">
                <div className="state-orb state-orb-muted" />
                <h5>No sold tickets yet</h5>
                <p>Mark tickets as sold on the Tickets page to see them here.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Ref</th>
                      <th>Seat</th>
                      <th>Qty</th>
                      <th>Cost</th>
                      <th>Sold For</th>
                      <th>Profit</th>
                      <th>ROI</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.filter(isSold).map((order) => {
                      const cost = getProportionalCost(order.total_cost, order.qty_bought, soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0), order.listing_status);
                      const soldVal = inlineEdits[order.id] !== undefined
                        ? (inlineEdits[order.id] === "" ? 0 : Number(inlineEdits[order.id]))
                        : (order.sold_total ?? 0);
                      const profit = soldVal - cost;
                      const roi = cost > 0 ? (profit / cost) * 100 : null;

                      return (
                        <tr key={order.id}>
                          <td>
                            <div className="event-cell">
                              <strong>{order.event_name || "Untitled"}</strong>
                              <span>{order.venue || "—"}</span>
                              <small>{order.event_date || "—"}</small>
                            </div>
                          </td>
                          <td><span className="mono-text">{order.booking_ref || "—"}</span></td>
                          <td>
                            <div className="seat-stack">
                              <strong>{order.section || "—"}</strong>
                              <span>{order.row ? `Row ${order.row}` : "—"}</span>
                            </div>
                          </td>
                          <td>{order.qty_bought ?? "—"}</td>
                          <td>{formatCurrency(order.total_cost)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact"
                              type="number"
                              step="0.01"
                              value={inlineEdits[order.id] !== undefined ? inlineEdits[order.id] : (order.sold_total ?? "")}
                              onChange={(e) => setInlineEdit(order.id, e.target.value)}
                              onBlur={(e) => void saveSoldTotal(order, e.target.value)}
                            />
                          </td>
                          <td className={profit > 0 ? "value-up" : profit < 0 ? "value-down" : ""}>
                            {formatCurrency(profit)}
                          </td>
                          <td className={roi != null && roi > 0 ? "value-up" : ""}>
                            {roi != null ? `${roi.toFixed(1)}%` : "—"}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select
                              className="field field-compact"
                              value={order.listing_status ?? "Sold"}
                              onChange={(e) => void saveStatus(order, e.target.value)}
                            >
                              <option value="Unlisted">Unlisted</option>
                              <option value="Listed">Listed</option>
                              <option value="Sold">Sold</option>
                              <option value="Problem / Missing">Problem / Missing</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

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

function isSold(order: Order) {
  return normalizeStatus(order.listing_status) === "Sold" || (order.sold_total ?? 0) > 0;
}

function normalizeStatus(status: string | null) {
  if (status === "Listed") {
    return "Listed";
  }
  if (status === "Sold") {
    return "Sold";
  }
  if (status === "Problem / Missing") {
    return "Problem / Missing";
  }
  return "Unlisted";
}

function getTicketQuantity(order: Order) {
  if (order.qty_bought && order.qty_bought > 0) {
    return order.qty_bought;
  }
  return 1;
}

function getProfit(order: Order, soldQtyByOrderId: Map<number, number>) {
  const effCost = getProportionalCost(order.total_cost, order.qty_bought, soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0), order.listing_status);
  return (order.sold_total ?? 0) - effCost;
}

function getApproxDaysToSell(order: Order, soldAt: string | null) {
  const buyDate = parseDate(order.purchased_at) ?? parseDate(order.created_at);
  if (!buyDate) return null;
  const soldDate = soldAt ? parseDate(soldAt) : null;
  if (!soldDate) return null;
  return Math.max(0, Math.round((soldDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));
}

function parseDMY(value: string): Date | null {
  const clean = value.replace(/\//g, "").trim();
  if (clean.length !== 8 || !/^\d{8}$/.test(clean)) return null;
  const d = Number(clean.slice(0, 2));
  const m = Number(clean.slice(2, 4));
  const y = Number(clean.slice(4, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function parseEventDate(value: string | null): Date | null {
  if (!value) return null;
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  // "Friday 29 May 2026 18:30" or "29 May 2026" — day first
  const dayFirst = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (dayFirst) {
    const mi = MONTHS.indexOf(dayFirst[2].slice(0,3).toLowerCase());
    if (mi !== -1) return new Date(Number(dayFirst[3]), mi, Number(dayFirst[1]));
  }
  // "Sunday, July 20, 2025" or "July 20, 2025" — month first
  const monthFirst = value.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthFirst) {
    const mi = MONTHS.indexOf(monthFirst[1].slice(0,3).toLowerCase());
    if (mi !== -1) return new Date(Number(monthFirst[3]), mi, Number(monthFirst[2]));
  }
  return null;
}

function buildMonthlyProfitSeries(orders: Order[], soldAtMap: Record<number, string>, soldQtyByOrderId: Map<number, number>): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();
  const todayKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  })();

  for (const order of orders) {
    // Use actual sale date if available, otherwise purchase date — not event date
    const raw = soldAtMap[order.id] ?? order.purchased_at ?? order.created_at;
    const date = parseDate(raw);
    if (!date) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    // Skip future months that have no completed sales yet
    if (key > todayKey) continue;
    const label = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(date);
    const current = map.get(key) ?? { label, profit: 0, cost: 0, sales: 0 };
    current.profit += getProfit(order, soldQtyByOrderId);
    current.cost += getProportionalCost(order.total_cost, order.qty_bought, soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0), order.listing_status);
    current.sales += order.sold_total ?? 0;
    map.set(key, current);
  }

  const sorted = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  // Cap at 12 most recent months so bars stay wide and readable
  return sorted.slice(-12);
}

function buildEventProfit(orders: Order[], soldQtyByOrderId: Map<number, number>): EventProfit[] {
  const map = new Map<string, EventProfit>();

  for (const order of orders) {
    const name = order.event_name || "Untitled event";
    const key = `${name}__${order.venue || "Venue missing"}`;
    const current = map.get(key) ?? {
      key,
      name,
      venue: order.venue || "Venue missing",
      profit: 0,
      sales: 0,
      cost: 0,
      tickets: 0,
      roi: 0,
    };

    current.profit += getProfit(order, soldQtyByOrderId);
    current.sales += order.sold_total ?? 0;
    current.cost += getProportionalCost(order.total_cost, order.qty_bought, soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0), order.listing_status);
    current.tickets += getTicketQuantity(order);
    map.set(key, current);
  }

  return Array.from(map.values()).map((row) => ({
    ...row,
    roi: row.cost > 0 ? (row.profit / row.cost) * 100 : 0,
  }));
}



function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// ── Chart components ──────────────────────────────────────────────────────────

function getDonutSegments(data: { label: string; value: number }[]) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;

  return data.map((item, index) => {
    const ratio = total > 0 ? item.value / total : 0;
    const dash = ratio * 282.6;
    const segment = {
      ...item,
      color: accentColors[index % accentColors.length],
      dash,
      offset,
    };
    offset += dash;
    return segment;
  });
}

function BarChartCard({ data }: { data: SeriesPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return <EmptyChartState label="No monthly data yet" />;
  }

  const W = 760;
  const H = 380;
  const PAD_L = 60;
  const PAD_R = 16;
  const PAD_T = 20;
  const PAD_B = 8;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const rawMax = Math.max(...data.map((p) => p.profit), 0);
  const rawMin = Math.min(...data.map((p) => p.profit), 0);
  const { gridLines, domainMin, domainMax } = computeNiceGrid(rawMin, rawMax, 5);
  const domainRange = domainMax - domainMin || 1;

  const toY = (v: number) => PAD_T + ((domainMax - v) / domainRange) * chartH;
  const zeroY = toY(0);

  const slotW = chartW / data.length;
  const barW = Math.max(8, Math.min(52, slotW * 0.55));

  return (
    <div className="analytics-chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="analytics-line-chart"
        role="img"
        aria-label="Monthly profit"
        style={{ overflow: "visible" }}
      >
        {/* Gridlines + Y-axis labels */}
        {gridLines.map((v) => {
          const y = toY(v);
          const isZero = v === 0;
          return (
            <g key={v}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke={isZero ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.07)"}
                strokeWidth="1"
              />
              <text
                x={PAD_L - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="rgba(255,255,255,0.4)"
              >
                {formatCompactCurrency(v)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((point, i) => {
          const cx = PAD_L + slotW * i + slotW / 2;
          const isPos = point.profit >= 0;
          const barTop = toY(point.profit);
          const barBot = zeroY;
          const rectY = Math.min(barTop, barBot);
          const barH = Math.max(2, Math.abs(barTop - barBot));
          const isHovered = hoveredIdx === i;

          // Clamp tooltip so it doesn't go off left/right edge
          const tooltipW = 80;
          const rawTipX = cx - tooltipW / 2;
          const tipX = Math.max(PAD_L, Math.min(W - PAD_R - tooltipW, rawTipX));
          const tipY = isPos ? rectY - 34 : rectY + barH + 6;

          return (
            <g
              key={point.label}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "default" }}
            >
              <rect
                x={cx - barW / 2}
                y={rectY}
                width={barW}
                height={barH}
                rx={4}
                fill={isPos ? "#67F0A5" : "#FF7D7D"}
                opacity={isHovered ? 1 : 0.75}
              />
              {barH >= 24 && !isHovered && (
                <text
                  x={cx}
                  y={isPos ? rectY - 6 : rectY + barH + 14}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isPos ? "#67F0A5" : "#FF7D7D"}
                  fontWeight="600"
                >
                  {formatCompactCurrency(point.profit)}
                </text>
              )}
              {isHovered && (
                <g>
                  <rect
                    x={tipX}
                    y={tipY}
                    width={tooltipW}
                    height={24}
                    rx={5}
                    fill="rgba(15,15,25,0.95)"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1"
                  />
                  <text
                    x={tipX + tooltipW / 2}
                    y={tipY + 16}
                    textAnchor="middle"
                    fontSize="12"
                    fill="white"
                    fontWeight="700"
                  >
                    {formatCurrency(point.profit)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Month labels aligned under bars */}
      <div
        style={{
          display: "flex",
          paddingLeft: PAD_L,
          paddingRight: PAD_R,
          marginTop: 6,
        }}
      >
        {data.map((point) => (
          <span
            key={point.label}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 11,
              color: "rgba(255,255,255,0.45)",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function computeNiceGrid(rawMin: number, rawMax: number, targetCount: number) {
  const range = rawMax - rawMin || 1;
  const roughStep = range / (targetCount - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = nice * mag;

  const domainMin = Math.floor(rawMin / step) * step;
  const domainMax = Math.ceil(rawMax / step) * step;

  const gridLines: number[] = [];
  for (let v = domainMin; v <= domainMax + step * 0.01; v += step) {
    gridLines.push(Math.round(v * 100) / 100);
  }

  return { gridLines, domainMin, domainMax };
}

function LineChartCard({ data }: { data: SeriesPoint[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="No profit history yet" />;
  }

  const width = 760;
  const height = 260;
  const padding = 24;
  const values = data.map((point) => point.profit);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = data
    .map((point, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1);
      const y = height - padding - ((point.profit - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;
  const peak = data.reduce((best, current) => (current.profit > best.profit ? current : best), data[0]);

  return (
    <div className="analytics-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="analytics-line-chart" role="img" aria-label="Profit over time">
        <defs>
          <linearGradient id="analyticsLineFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,79,163,0.3)" />
            <stop offset="100%" stopColor="rgba(255,79,163,0.02)" />
          </linearGradient>
        </defs>
        <polyline fill="url(#analyticsLineFill)" stroke="none" points={areaPoints} />
        <polyline fill="none" stroke="#FF4FA3" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={points} />
        {data.map((point, index) => {
          const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1);
          const y = height - padding - ((point.profit - min) / range) * (height - padding * 2);
          const isPeak = point.label === peak.label && point.profit === peak.profit;
          return (
            <g key={point.label}>
              <circle cx={x} cy={y} r={isPeak ? 7 : 4} fill={isPeak ? "#4FC3FF" : "#FF4FA3"} />
            </g>
          );
        })}
      </svg>
      <div className="analytics-axis-labels">
        {data.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function ComparisonBarChart({ data }: { data: EventProfit[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="No sold event data yet" />;
  }

  const max = Math.max(...data.map((item) => Math.max(item.sales, item.cost)), 1);

  return (
    <div className="comparison-bars">
      {data.map((item) => (
        <div key={item.name} className="comparison-row">
          <div className="comparison-meta">
            <strong>{item.name}</strong>
            <span>{item.venue}</span>
          </div>
          <div className="comparison-track-group">
            <div className="comparison-track comparison-track-cost">
              <div className="comparison-fill comparison-fill-cost" style={{ width: `${(item.cost / max) * 100}%` }} />
            </div>
            <div className="comparison-track comparison-track-sales">
              <div className="comparison-fill comparison-fill-sales" style={{ width: `${(item.sales / max) * 100}%` }} />
            </div>
          </div>
          <div className="comparison-values">
            <span>Cost {formatCompactCurrency(item.cost)}</span>
            <span>Sales {formatCompactCurrency(item.sales)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChartCard({
  data,
  centerLabel,
}: {
  data: { label: string; value: number }[];
  centerLabel: string;
}) {
  if (data.length === 0) {
    return <EmptyChartState label="No data yet" />;
  }

  const segments = getDonutSegments(data);
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="analytics-donut-wrap">
      <svg viewBox="0 0 120 120" className="analytics-donut" role="img" aria-label={centerLabel}>
        <circle cx="60" cy="60" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
        {segments.map((segment) => (
          <circle
            key={segment.label}
            cx="60"
            cy="60"
            r="45"
            fill="none"
            stroke={segment.color}
            strokeWidth="12"
            strokeDasharray={`${segment.dash} 282.6`}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 60 60)"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="analytics-donut-center">
        <strong>{total}</strong>
        <span>{centerLabel}</span>
      </div>
      <div className="analytics-legend">
        {segments.map((segment) => (
          <div key={segment.label} className="analytics-legend-item">
            <span className="analytics-legend-dot" style={{ background: segment.color }} />
            <label>{segment.label}</label>
            <strong>{segment.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankingBars({ data }: { data: EventProfit[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="No profit ranking yet" />;
  }

  const max = Math.max(...data.map((item) => Math.abs(item.profit)), 1);

  return (
    <div className="ranking-bars">
      {data.map((item, index) => (
        <div key={item.name} className="ranking-row">
          <div className="ranking-meta">
            <strong>{item.name}</strong>
            <span>{item.venue}</span>
          </div>
          <div className="ranking-track">
            <div
              className={`ranking-fill${item.profit >= 0 ? " ranking-fill-up" : " ranking-fill-down"}`}
              style={{ width: `${(Math.abs(item.profit) / max) * 100}%`, background: item.profit >= 0 ? accentColors[index % accentColors.length] : "#FF7D7D" }}
            />
          </div>
          <strong className={item.profit >= 0 ? "delta-up" : "delta-down"}>{formatCurrency(item.profit)}</strong>
        </div>
      ))}
    </div>
  );
}

function WorstPerformersList({ data }: { data: EventProfit[] }) {
  if (data.length === 0) {
    return <EmptyChartState label="No weak performers yet" />;
  }

  return (
    <div className="worst-list">
      {data.map((item) => (
        <div key={item.name} className="worst-item">
          <div>
            <strong>{item.name}</strong>
            <span>{item.venue}</span>
          </div>
          <div className="worst-metrics">
            <strong className={item.profit >= 0 ? "delta-up" : "delta-down"}>{formatCurrency(item.profit)}</strong>
            <span>{item.tickets} tickets</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="analytics-empty-state">
      <div className="state-orb state-orb-muted" />
      <p>{label}</p>
    </div>
  );
}





