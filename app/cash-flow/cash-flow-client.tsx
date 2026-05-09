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
  qty_bought: number | null;
  total_cost: number | null;
  sold_total: number | null;
  listing_status: string | null;
};

type CashEvent = {
  key: string;
  eventName: string;
  venue: string;
  eventDate: string;
  dateValue: Date;
  cashIn: number;
  costOut: number;
  profit: number;
  totalQty: number;
  soldQty: number;
  isPast: boolean;
};

type ChartBucket = {
  label: string;
  received: number;
  upcoming: number;
};

type DatePreset = "all" | "this-week" | "this-month" | "this-quarter" | "this-year" | "custom";
type StatusFilter = "all" | "completed" | "upcoming";
type ChartGroup = "monthly" | "weekly";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: true },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: false },
];

export default function CashFlowClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [chartGroup, setChartGroup] = useState<ChartGroup>("monthly");

  useEffect(() => {
    void loadData();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadData(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select("id, event_name, venue, event_date, qty_bought, total_cost, sold_total, listing_status")
      .or("listing_status.is.null,listing_status.not.in.(Ignored,Personal)")
      .order("event_date", { ascending: true });

    if (error) {
      setMessage(error.message);
    } else {
      setOrders((data as Order[]) || []);
      if (showRefreshing) setMessage("Refreshed");
    }
    setLoading(false);
    setRefreshing(false);
  }

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const cashEvents = useMemo((): CashEvent[] => {
    const map = new Map<string, CashEvent>();

    for (const order of orders) {
      if (!order.event_date) continue;
      const dateValue = parseEventDate(order.event_date);
      if (!dateValue) continue;

      const key = `${order.event_name ?? ""}__${order.venue ?? ""}__${order.event_date}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          eventName: order.event_name ?? "Untitled event",
          venue: order.venue ?? "",
          eventDate: order.event_date,
          dateValue,
          cashIn: 0,
          costOut: 0,
          profit: 0,
          totalQty: 0,
          soldQty: 0,
          isPast: dateValue < today,
        });
      }

      const ev = map.get(key)!;
      ev.totalQty += order.qty_bought ?? 1;

      if ((order.sold_total ?? 0) > 0) {
        ev.cashIn += order.sold_total ?? 0;
        ev.costOut += order.total_cost ?? 0;
        ev.soldQty += order.qty_bought ?? 1;
      }
    }

    return Array.from(map.values())
      .map(ev => ({ ...ev, profit: ev.cashIn - ev.costOut }))
      .sort((a, b) => a.dateValue.getTime() - b.dateValue.getTime());
  }, [orders, today]);

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
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    }
    if (datePreset === "this-quarter") {
      const q = Math.floor(now.getMonth() / 3);
      return {
        start: new Date(now.getFullYear(), q * 3, 1),
        end: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999),
      };
    }
    if (datePreset === "this-year") {
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
      };
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

  const filteredEvents = useMemo(() => {
    let evs = cashEvents;
    if (dateRange) {
      evs = evs.filter(ev => ev.dateValue >= dateRange.start && ev.dateValue <= dateRange.end);
    }
    if (statusFilter === "completed") evs = evs.filter(ev => ev.isPast);
    if (statusFilter === "upcoming") evs = evs.filter(ev => !ev.isPast);
    return evs;
  }, [cashEvents, dateRange, statusFilter]);

  const summary = useMemo(() => {
    const received = cashEvents.filter(ev => ev.isPast).reduce((s, ev) => s + ev.cashIn, 0);
    const upcoming = cashEvents.filter(ev => !ev.isPast).reduce((s, ev) => s + ev.cashIn, 0);
    const totalCost = cashEvents.reduce((s, ev) => s + ev.costOut, 0);
    const totalCash = received + upcoming;
    const roi = totalCost > 0 ? ((totalCash - totalCost) / totalCost) * 100 : null;
    const receivedProfit = cashEvents.filter(ev => ev.isPast).reduce((s, ev) => s + ev.profit, 0);
    return { received, upcoming, net: totalCash, roi, receivedProfit };
  }, [cashEvents]);

  const chartData = useMemo((): ChartBucket[] => {
    const map = new Map<string, ChartBucket>();

    for (const ev of cashEvents) {
      if (ev.cashIn <= 0) continue;

      let key: string;
      let label: string;

      if (chartGroup === "monthly") {
        key = `${ev.dateValue.getFullYear()}-${String(ev.dateValue.getMonth() + 1).padStart(2, "0")}`;
        label = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(ev.dateValue);
      } else {
        const monday = getWeekMonday(ev.dateValue);
        key = monday.toISOString().slice(0, 10);
        label = `${monday.getDate()} ${monday.toLocaleString("en-GB", { month: "short" })}`;
      }

      const current = map.get(key) ?? { label, received: 0, upcoming: 0 };
      if (ev.isPast) current.received += ev.cashIn;
      else current.upcoming += ev.cashIn;
      map.set(key, current);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
      .slice(-20);
  }, [cashEvents, chartGroup]);

  const upcomingSchedule = useMemo(() => {
    return cashEvents
      .filter(ev => !ev.isPast && ev.cashIn > 0)
      .slice(0, 10);
  }, [cashEvents]);

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
            <p className="eyebrow">Finance</p>
            <h2>Cash Flow</h2>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              onClick={() => void loadData(true)}
              disabled={refreshing}
              type="button"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {message && (
          <div className="feedback-banner" role="status">
            <span className="feedback-dot" />
            <span>{message}</span>
          </div>
        )}

        <section className="hero-card analytics-hero-card">
          <div>
            <p className="section-tag">Cash Flow</p>
            <h3>Revenue lands on event day — track exactly when cash arrives.</h3>
          </div>
          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Cash received</span>
              <strong>{formatCurrency(summary.received)}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Incoming</span>
              <strong>{formatCurrency(summary.upcoming)}</strong>
            </div>
          </div>
        </section>

        <section className="kpi-grid">
          <article className="kpi-card analytics-kpi-profit">
            <span className="kpi-accent" />
            <p>Cash received</p>
            <strong>{formatCurrency(summary.received)}</strong>
            <span>from past events</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Cash incoming</p>
            <strong style={{ color: "#4fc3ff" }}>{formatCurrency(summary.upcoming)}</strong>
            <span>from future sold tickets</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Total cash position</p>
            <strong>{formatCurrency(summary.net)}</strong>
            <span>received + projected</span>
          </article>
          <article className={`kpi-card${summary.roi != null && summary.roi >= 0 ? " analytics-kpi-profit" : " analytics-kpi-risk"}`}>
            <span className="kpi-accent" />
            <p>Overall ROI</p>
            <strong>{summary.roi != null ? `${summary.roi.toFixed(1)}%` : "—"}</strong>
            <span>across all ticket sales</span>
          </article>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Revenue timeline</p>
              <h4>Cash flow by event date</h4>
            </div>
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "14px", fontSize: 12, color: "var(--text-secondary)", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "#67F0A5", display: "inline-block" }} />
                  Received
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "#4FC3FF", display: "inline-block" }} />
                  Projected
                </span>
              </div>
              <div className="view-toggle">
                {(["monthly", "weekly"] as ChartGroup[]).map(g => (
                  <button
                    key={g}
                    type="button"
                    className={`toggle-btn${chartGroup === g ? " toggle-btn-active" : ""}`}
                    onClick={() => setChartGroup(g)}
                  >
                    {g === "monthly" ? "Monthly" : "Weekly"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading</h5>
            </div>
          ) : chartData.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No cash flow data yet</h5>
              <p>Sold tickets will appear here grouped by event date.</p>
            </div>
          ) : (
            <CashFlowChart data={chartData} />
          )}
        </section>

        <section className="command-card">
          <div className="command-header">
            <div className="view-toggle">
              {(["all", "this-week", "this-month", "this-quarter", "this-year", "custom"] as DatePreset[]).map(preset => (
                <button
                  key={preset}
                  type="button"
                  className={`toggle-btn${datePreset === preset ? " toggle-btn-active" : ""}`}
                  onClick={() => setDatePreset(preset)}
                >
                  {preset === "all" ? "All Time" : preset === "this-week" ? "This Week" : preset === "this-month" ? "This Month" : preset === "this-quarter" ? "This Quarter" : preset === "this-year" ? "This Year" : "Custom"}
                </button>
              ))}
            </div>
            <div className="view-toggle">
              {(["all", "upcoming", "completed"] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`toggle-btn${statusFilter === s ? " toggle-btn-active" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "All" : s === "upcoming" ? "Upcoming" : "Completed"}
                </button>
              ))}
            </div>
          </div>
          {datePreset === "custom" && (
            <div className="analytics-date-range">
              <label className="filter-field">
                <span className="filter-label">From</span>
                <input
                  className="field"
                  type="text"
                  placeholder="DDMMYYYY"
                  maxLength={10}
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
              </label>
              <label className="filter-field">
                <span className="filter-label">To</span>
                <input
                  className="field"
                  type="text"
                  placeholder="DDMMYYYY"
                  maxLength={10}
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
              </label>
            </div>
          )}
        </section>

        {upcomingSchedule.length > 0 && statusFilter !== "completed" && !dateRange && (
          <section className="table-card">
            <div className="table-card-header">
              <div>
                <p className="section-tag">Incoming</p>
                <h4>Upcoming cash schedule</h4>
              </div>
              <span className="table-count">{upcomingSchedule.length} upcoming</span>
            </div>
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Event date</th>
                    <th>Days away</th>
                    <th>Tickets sold</th>
                    <th>Expected cash</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingSchedule.map(ev => {
                    const daysAway = Math.round((ev.dateValue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <tr key={ev.key}>
                        <td>
                          <div className="event-cell">
                            <strong>{ev.eventName}</strong>
                            <span>{ev.venue || "—"}</span>
                          </div>
                        </td>
                        <td>{formatEventDate(ev.eventDate)}</td>
                        <td>
                          <span className={`days-chip ${daysAway <= 7 ? "days-urgent" : daysAway <= 30 ? "days-soon" : "days-ok"}`}>
                            {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `${daysAway}d`}
                          </span>
                        </td>
                        <td>{ev.soldQty} / {ev.totalQty}</td>
                        <td>
                          <strong style={{ color: "#4fc3ff" }}>{formatCurrency(ev.cashIn)}</strong>
                        </td>
                        <td className={ev.profit >= 0 ? "value-up" : "value-down"}>
                          {formatCurrency(ev.profit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Events</p>
              <h4>Per-event cash flow</h4>
            </div>
            <span className="table-count">{filteredEvents.length} events</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading</h5>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No events match filters</h5>
              <p>Try adjusting the date range or status filter.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Event date</th>
                    <th>Tickets sold</th>
                    <th>Cash in</th>
                    <th>Cost</th>
                    <th>Profit</th>
                    <th>ROI</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map(ev => {
                    const roi = ev.costOut > 0 ? (ev.profit / ev.costOut) * 100 : null;
                    return (
                      <tr key={ev.key}>
                        <td>
                          <div className="event-cell">
                            <strong>{ev.eventName}</strong>
                            <span>{ev.venue || "—"}</span>
                          </div>
                        </td>
                        <td>{formatEventDate(ev.eventDate)}</td>
                        <td>
                          {ev.soldQty > 0
                            ? `${ev.soldQty} / ${ev.totalQty}`
                            : <span style={{ color: "var(--text-muted)" }}>0 / {ev.totalQty}</span>}
                        </td>
                        <td>
                          <strong style={ev.cashIn > 0 ? { color: ev.isPast ? "#9ef5c6" : "#4fc3ff" } : { color: "var(--text-muted)" }}>
                            {ev.cashIn > 0 ? formatCurrency(ev.cashIn) : "—"}
                          </strong>
                        </td>
                        <td>{ev.costOut > 0 ? formatCurrency(ev.costOut) : "—"}</td>
                        <td className={ev.cashIn > 0 ? (ev.profit >= 0 ? "value-up" : "value-down") : ""}>
                          {ev.cashIn > 0 ? formatCurrency(ev.profit) : "—"}
                        </td>
                        <td className={roi != null && roi >= 0 ? "value-up" : roi != null ? "value-down" : ""}>
                          {roi != null ? `${roi.toFixed(1)}%` : "—"}
                        </td>
                        <td>
                          <span className={`status-badge status-static ${ev.isPast ? "status-sold" : "status-listed"}`}>
                            {ev.isPast ? (ev.cashIn > 0 ? "Received" : "Past") : "Upcoming"}
                          </span>
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

// ── Chart component ───────────────────────────────────────────────────────────

function CashFlowChart({ data }: { data: ChartBucket[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const rotate = data.length > 9;

  const W = 760;
  const PAD_L = 76;
  const PAD_R = 24;
  const PAD_T = 28;
  const PAD_B = rotate ? 60 : 32;
  const H = 400 + PAD_B;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const rawMax = Math.max(...data.map(d => d.received + d.upcoming), 1);
  const { gridLines, domainMax } = computeNiceGrid(0, rawMax, 5);
  const domainRange = domainMax || 1;

  const toY = (v: number) => PAD_T + ((domainMax - v) / domainRange) * chartH;
  const zeroY = toY(0);

  const slotW = chartW / data.length;
  const barW = Math.max(10, Math.min(56, slotW * 0.64));

  return (
    <div className="analytics-chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="analytics-line-chart"
        role="img"
        aria-label="Cash flow by period"
        style={{ display: "block", width: "100%", overflow: "visible" }}
      >
        <defs>
          {data.map((point, i) => {
            const total = point.received + point.upcoming;
            if (total <= 0) return null;
            const cx = PAD_L + slotW * i + slotW / 2;
            return (
              <clipPath key={i} id={`cf-clip-${i}`}>
                <rect
                  x={cx - barW / 2}
                  y={toY(total)}
                  width={barW}
                  height={Math.max(zeroY - toY(total), 2)}
                  rx={5}
                />
              </clipPath>
            );
          })}
        </defs>

        {/* Y-axis left border */}
        <line
          x1={PAD_L} x2={PAD_L}
          y1={PAD_T} y2={zeroY}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />

        {/* Gridlines + Y-axis labels */}
        {gridLines.map(v => {
          const y = toY(v);
          const isZero = v === 0;
          return (
            <g key={v}>
              <line
                x1={PAD_L} x2={W - PAD_R}
                y1={y} y2={y}
                stroke={isZero ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)"}
                strokeWidth={isZero ? 1 : 1}
                strokeDasharray={isZero ? undefined : "4 5"}
              />
              <text
                x={PAD_L - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill={isZero ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.35)"}
              >
                {formatCompactCurrency(v)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((point, i) => {
          const cx = PAD_L + slotW * i + slotW / 2;
          const total = point.received + point.upcoming;
          const isHovered = hoveredIdx === i;
          if (total <= 0) return null;

          const totalTopY = toY(total);
          // When received=0, receivedTopY = zeroY so blue fills the full bar via clipPath
          const receivedTopY = point.received > 0 ? toY(point.received) : zeroY;
          const barH = zeroY - totalTopY;

          // Tooltip dimensions depend on how many rows of info we show
          const hasBoth = point.received > 0 && point.upcoming > 0;
          const tooltipW = 186;
          const tooltipH = hasBoth ? 72 : 48;
          const rawTipX = cx - tooltipW / 2;
          const tipX = Math.max(PAD_L, Math.min(W - PAD_R - tooltipW, rawTipX));
          const tipY = Math.max(PAD_T + 4, totalTopY - tooltipH - 12);

          return (
            <g
              key={`bar-${i}`}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "default" }}
            >
              {/* Wide invisible hit target so thin bars are easy to hover */}
              <rect
                x={cx - Math.max(barW, 20) / 2}
                y={totalTopY}
                width={Math.max(barW, 20)}
                height={barH}
                fill="transparent"
              />

              {/* Stacked coloured sections clipped to rounded bar shape */}
              <g clipPath={`url(#cf-clip-${i})`}>
                {/* Received — green, lower portion */}
                {point.received > 0 && (
                  <rect
                    x={cx - barW / 2} y={receivedTopY}
                    width={barW} height={Math.max(zeroY - receivedTopY, 0)}
                    fill="#67F0A5"
                    opacity={isHovered ? 0.97 : 0.8}
                  />
                )}
                {/* Upcoming — blue, upper portion (or full bar if no received) */}
                {point.upcoming > 0 && (
                  <rect
                    x={cx - barW / 2} y={totalTopY}
                    width={barW} height={Math.max(receivedTopY - totalTopY, 0)}
                    fill="#4FC3FF"
                    opacity={isHovered ? 0.88 : 0.65}
                  />
                )}
              </g>

              {/* Value label above bar when tall enough and not hovered */}
              {barH > 30 && !isHovered && (
                <text
                  x={cx}
                  y={totalTopY - 7}
                  textAnchor="middle"
                  fontSize="11"
                  fill="rgba(255,255,255,0.5)"
                  fontWeight="600"
                >
                  {formatCompactCurrency(total)}
                </text>
              )}

              {/* Hover tooltip */}
              {isHovered && (
                <g>
                  <rect
                    x={tipX} y={tipY}
                    width={tooltipW} height={tooltipH}
                    rx={8}
                    fill="rgba(10,10,20,0.97)"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="1"
                  />
                  {/* Period label */}
                  <text x={tipX + 14} y={tipY + 18} fontSize="11" fill="rgba(255,255,255,0.5)">
                    {point.label}
                  </text>
                  {/* Total */}
                  <text x={tipX + tooltipW - 14} y={tipY + 18} textAnchor="end" fontSize="13" fill="white" fontWeight="700">
                    {formatCurrency(total)}
                  </text>
                  {/* Breakdown rows */}
                  {hasBoth ? (
                    <>
                      <text x={tipX + 14} y={tipY + 38} fontSize="11" fill="#67F0A5">
                        ● Received
                      </text>
                      <text x={tipX + tooltipW - 14} y={tipY + 38} textAnchor="end" fontSize="11" fill="#67F0A5" fontWeight="600">
                        {formatCurrency(point.received)}
                      </text>
                      <text x={tipX + 14} y={tipY + 56} fontSize="11" fill="#4FC3FF">
                        ● Projected
                      </text>
                      <text x={tipX + tooltipW - 14} y={tipY + 56} textAnchor="end" fontSize="11" fill="#4FC3FF" fontWeight="600">
                        {formatCurrency(point.upcoming)}
                      </text>
                    </>
                  ) : point.received > 0 ? (
                    <text x={tipX + 14} y={tipY + 34} fontSize="11" fill="#67F0A5">
                      ● Received
                    </text>
                  ) : (
                    <text x={tipX + 14} y={tipY + 34} fontSize="11" fill="#4FC3FF">
                      ● Projected
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}

        {/* X-axis labels — inside SVG so they align precisely with bars */}
        {data.map((point, i) => {
          const cx = PAD_L + slotW * i + slotW / 2;
          const labelY = zeroY + 14;

          if (rotate) {
            return (
              <text
                key={`lbl-${i}`}
                transform={`translate(${cx}, ${labelY}) rotate(-42)`}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="rgba(255,255,255,0.42)"
              >
                {point.label}
              </text>
            );
          }

          // Non-rotated: skip labels that would crowd each other
          const skipEvery = Math.ceil(data.length / 10);
          if (i % skipEvery !== 0 && i !== data.length - 1) return null;

          return (
            <text
              key={`lbl-${i}`}
              x={cx}
              y={labelY + 6}
              textAnchor="middle"
              fontSize="11"
              fill="rgba(255,255,255,0.42)"
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseEventDate(value: string | null): Date | null {
  if (!value) return null;
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const dayFirst = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (dayFirst) {
    const mi = MONTHS.indexOf(dayFirst[2].slice(0, 3).toLowerCase());
    if (mi !== -1) return new Date(Number(dayFirst[3]), mi, Number(dayFirst[1]));
  }
  const monthFirst = value.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthFirst) {
    const mi = MONTHS.indexOf(monthFirst[1].slice(0, 3).toLowerCase());
    if (mi !== -1) return new Date(Number(monthFirst[3]), mi, Number(monthFirst[2]));
  }
  return null;
}

function formatEventDate(value: string | null): string {
  if (!value) return "—";
  const d = parseEventDate(value);
  if (!d) return value;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
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

function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);
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
