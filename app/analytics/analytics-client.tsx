"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";

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

type SeriesPoint = {
  label: string;
  profit: number;
  cost: number;
  sales: number;
};

type EventProfit = {
  name: string;
  profit: number;
  sales: number;
  cost: number;
  tickets: number;
  venue: string;
};

const navItems = [
  { label: "Dashboard", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Inventory", href: "/inventory", active: false },
  { label: "Analytics", href: "/analytics", active: true },
];

const accentColors = ["#FF4FA3", "#9B5CFF", "#4FC3FF", "#67F0A5", "#FFB84F", "#FF7D7D"];

export default function AnalyticsClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadOrders();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  async function loadOrders(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setMessage(error.message);
    } else {
      setOrders((data as Order[]) || []);
      if (showRefreshing) {
        setMessage("Analytics refreshed");
      }
    }

    setLoading(false);
    setRefreshing(false);
  }

  const analytics = useMemo(() => {
    const soldOrders = orders.filter((order) => isSold(order));
    const soldTickets = soldOrders.reduce((sum, order) => sum + getTicketQuantity(order), 0);
    const totalProfit = soldOrders.reduce((sum, order) => sum + getProfit(order), 0);
    const totalSales = soldOrders.reduce((sum, order) => sum + (order.sold_total ?? 0), 0);
    const totalCost = soldOrders.reduce((sum, order) => sum + (order.total_cost ?? 0), 0);
    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    const avgTimeToSellDays = soldOrders
      .map((order) => getApproxDaysToSell(order))
      .filter((value): value is number => value != null);
    const avgTimeToSell = avgTimeToSellDays.length
      ? avgTimeToSellDays.reduce((sum, value) => sum + value, 0) / avgTimeToSellDays.length
      : null;

    const profitSeries = buildProfitSeries(soldOrders);
    const eventProfit = buildEventProfit(soldOrders);
    const topEvents = [...eventProfit].sort((a, b) => b.profit - a.profit);
    const worstEvents = [...eventProfit].sort((a, b) => a.profit - b.profit).slice(0, 5);
    const statusBreakdown = buildStatusBreakdown(orders);

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
        detail: avgTimeToSell != null ? "Estimated from buy date to today" : "Need sold tickets to calculate",
      },
    ];

    return {
      metrics,
      profitSeries,
      comparisonSeries: topEvents.slice(0, 6),
      donutSeries: topEvents.slice(0, 5),
      rankingSeries: topEvents.slice(0, 6),
      worstEvents,
      statusBreakdown,
    };
  }, [orders]);

  return (
    <div className="orders-shell analytics-shell">
      <aside className="orders-sidebar">
        <div>
          <div className="brand-mark">TA</div>
          <div className="sidebar-brand">
            <h1>TicketAuto</h1>
          </div>
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

        <div className="sidebar-panel">
          <p className="sidebar-panel-label">Analytics</p>
          <strong>Profit visibility</strong>
          <span>See what wins, what drags, and where money is tied up.</span>
          <Link href="/connections" className="sidebar-panel-link">
            Open connections
          </Link>
        </div>
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
            <Link href="/orders" className="primary-button">
              Back to Dashboard
            </Link>
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

        {loading ? (
          <section className="table-card">
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading analytics</h5>
              <p>Crunching profit, sales, and stock performance.</p>
            </div>
          </section>
        ) : (
          <section className="analytics-grid">
            <article className="table-card analytics-card analytics-card-wide">
              <div className="table-card-header analytics-card-header">
                <div>
                  <p className="section-tag">Trend</p>
                  <h4>Profit over time</h4>
                </div>
                <span className="table-count">By week</span>
              </div>
              <LineChartCard data={analytics.profitSeries} />
            </article>

            <article className="table-card analytics-card">
              <div className="table-card-header analytics-card-header">
                <div>
                  <p className="section-tag">Status</p>
                  <h4>Inventory status</h4>
                </div>
              </div>
              <DonutChartCard data={analytics.statusBreakdown} centerLabel="Stock" />
            </article>

            <article className="table-card analytics-card analytics-card-wide">
              <div className="table-card-header analytics-card-header">
                <div>
                  <p className="section-tag">Margin</p>
                  <h4>Sales vs cost</h4>
                </div>
                <span className="table-count">Top events</span>
              </div>
              <ComparisonBarChart data={analytics.comparisonSeries} />
            </article>

            <article className="table-card analytics-card">
              <div className="table-card-header analytics-card-header">
                <div>
                  <p className="section-tag">Winners</p>
                  <h4>Profit by event</h4>
                </div>
              </div>
              <DonutChartCard
                data={analytics.donutSeries.map((item) => ({ label: item.name, value: Math.max(item.profit, 0) }))}
                centerLabel="Profit"
              />
            </article>

            <article className="table-card analytics-card analytics-card-wide">
              <div className="table-card-header analytics-card-header">
                <div>
                  <p className="section-tag">Ranking</p>
                  <h4>Profit by artist</h4>
                </div>
                <span className="table-count">Highest to lowest</span>
              </div>
              <RankingBars data={analytics.rankingSeries} />
            </article>

            <article className="table-card analytics-card">
              <div className="table-card-header analytics-card-header">
                <div>
                  <p className="section-tag">Drag</p>
                  <h4>Worst performers</h4>
                </div>
              </div>
              <WorstPerformersList data={analytics.worstEvents} />
            </article>
          </section>
        )}
      </main>
    </div>
  );
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

function getProfit(order: Order) {
  return (order.sold_total ?? 0) - (order.total_cost ?? 0);
}

function getApproxDaysToSell(order: Order) {
  const buyDate = parseDate(order.purchased_at) ?? parseDate(order.created_at);
  if (!buyDate) {
    return null;
  }
  const now = new Date();
  return Math.max(0, Math.round((now.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return null;
}

function buildProfitSeries(orders: Order[]): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();

  for (const order of orders) {
    const date = parseDate(order.purchased_at) ?? parseDate(order.created_at);
    if (!date) {
      continue;
    }
    const weekLabel = getWeekLabel(date);
    const current = map.get(weekLabel) ?? { label: weekLabel, profit: 0, cost: 0, sales: 0 };
    current.profit += getProfit(order);
    current.cost += order.total_cost ?? 0;
    current.sales += order.sold_total ?? 0;
    map.set(weekLabel, current);
  }

  return Array.from(map.values()).slice(-8);
}

function buildEventProfit(orders: Order[]): EventProfit[] {
  const map = new Map<string, EventProfit>();

  for (const order of orders) {
    const name = order.event_name || "Untitled event";
    const key = `${name}__${order.venue || "Venue missing"}`;
    const current = map.get(key) ?? {
      name,
      venue: order.venue || "Venue missing",
      profit: 0,
      sales: 0,
      cost: 0,
      tickets: 0,
    };

    current.profit += getProfit(order);
    current.sales += order.sold_total ?? 0;
    current.cost += order.total_cost ?? 0;
    current.tickets += getTicketQuantity(order);
    map.set(key, current);
  }

  return Array.from(map.values());
}

function buildStatusBreakdown(orders: Order[]) {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const status = normalizeStatus(order.listing_status);
    counts.set(status, (counts.get(status) ?? 0) + getTicketQuantity(order));
  }

  return ["Unlisted", "Listed", "Sold", "Problem / Missing"]
    .map((label) => ({ label, value: counts.get(label) ?? 0 }))
    .filter((item) => item.value > 0);
}

function getWeekLabel(date: Date) {
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(start);
}

function formatCurrency(value: number | null) {
  if (value == null) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

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





