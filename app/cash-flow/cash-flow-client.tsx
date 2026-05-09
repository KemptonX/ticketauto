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

type MonthRow = {
  year: number;
  month: number;
  monthLabel: string;
  eventCount: number;
  soldCount: number;
  receivedCash: number;
  projectedCash: number;
  totalCash: number;
  isPastMonth: boolean;
  isFutureMonth: boolean;
  isCurrentMonth: boolean;
};

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

// ── Tax-year helpers ──────────────────────────────────────────────────────────

function txStart(startYear: number): Date {
  return new Date(startYear, 3, 6); // April 6
}

function txEnd(startYear: number): Date {
  return new Date(startYear + 1, 3, 5, 23, 59, 59, 999); // April 5 end-of-day
}

function txLabel(startYear: number): string {
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

function currentTY(): number {
  const d = new Date();
  return d >= new Date(d.getFullYear(), 3, 6) ? d.getFullYear() : d.getFullYear() - 1;
}

function eventTY(date: Date): number {
  return date >= new Date(date.getFullYear(), 3, 6)
    ? date.getFullYear()
    : date.getFullYear() - 1;
}

function txMonths(startYear: number): Array<{ year: number; month: number; monthLabel: string }> {
  return Array.from({ length: 12 }, (_, i) => {
    const month = (3 + i) % 12; // April=3 … March=2
    const year = startYear + (month < 3 ? 1 : 0);
    return {
      year,
      month,
      monthLabel: new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(year, month, 1)),
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CashFlowClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedTY, setSelectedTY] = useState<number>(currentTY);

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

    for (const o of orders) {
      if (!o.event_date) continue;
      const dateValue = parseEventDate(o.event_date);
      if (!dateValue) continue;

      const key = `${o.event_name ?? ""}__${o.venue ?? ""}__${o.event_date}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          eventName: o.event_name ?? "Untitled event",
          venue: o.venue ?? "",
          eventDate: o.event_date,
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
      ev.totalQty += o.qty_bought ?? 1;
      if ((o.sold_total ?? 0) > 0) {
        ev.cashIn += o.sold_total ?? 0;
        ev.costOut += o.total_cost ?? 0;
        ev.soldQty += o.qty_bought ?? 1;
      }
    }

    return Array.from(map.values())
      .map(ev => ({ ...ev, profit: ev.cashIn - ev.costOut }))
      .sort((a, b) => a.dateValue.getTime() - b.dateValue.getTime());
  }, [orders, today]);

  const availableTYs = useMemo(() => {
    const set = new Set<number>([currentTY()]);
    for (const ev of cashEvents) set.add(eventTY(ev.dateValue));
    return Array.from(set).sort((a, b) => a - b);
  }, [cashEvents]);

  const tyEvents = useMemo(() => {
    const start = txStart(selectedTY);
    const end = txEnd(selectedTY);
    return cashEvents.filter(ev => ev.dateValue >= start && ev.dateValue <= end);
  }, [cashEvents, selectedTY]);

  const stats = useMemo(() => {
    const received = tyEvents.filter(ev => ev.isPast).reduce((s, ev) => s + ev.cashIn, 0);
    const incoming = tyEvents.filter(ev => !ev.isPast).reduce((s, ev) => s + ev.cashIn, 0);
    const totalCost = tyEvents.reduce((s, ev) => s + ev.costOut, 0);
    const totalCash = received + incoming;
    const roi = totalCost > 0 ? ((totalCash - totalCost) / totalCost) * 100 : null;
    return { received, incoming, totalCash, roi };
  }, [tyEvents]);

  const monthRows = useMemo((): MonthRow[] => {
    return txMonths(selectedTY).map(({ year, month, monthLabel }) => {
      const monthEvents = tyEvents.filter(
        ev => ev.dateValue.getFullYear() === year && ev.dateValue.getMonth() === month,
      );

      const receivedCash = monthEvents.filter(ev => ev.isPast).reduce((s, ev) => s + ev.cashIn, 0);
      const projectedCash = monthEvents.filter(ev => !ev.isPast).reduce((s, ev) => s + ev.cashIn, 0);
      const totalCash = receivedCash + projectedCash;
      const eventCount = monthEvents.length;
      const soldCount = monthEvents.filter(ev => ev.cashIn > 0).length;

      const lastDay = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const firstDay = new Date(year, month, 1);
      const isPastMonth = lastDay < today;
      const isFutureMonth = firstDay > today;
      const isCurrentMonth = !isPastMonth && !isFutureMonth;

      return {
        year,
        month,
        monthLabel,
        eventCount,
        soldCount,
        receivedCash,
        projectedCash,
        totalCash,
        isPastMonth,
        isFutureMonth,
        isCurrentMonth,
      };
    });
  }, [tyEvents, selectedTY, today]);

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map(item => (
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
            <select
              className="field field-compact"
              value={selectedTY}
              onChange={e => setSelectedTY(Number(e.target.value))}
              style={{ minWidth: 170 }}
            >
              {availableTYs.map(y => (
                <option key={y} value={y}>
                  Tax year {txLabel(y)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void loadData(true)}
              disabled={refreshing}
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
            <p className="section-tag">Tax year {txLabel(selectedTY)}</p>
            <h3>Revenue lands on event day — track exactly when cash arrives.</h3>
          </div>
          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Cash received</span>
              <strong>{formatCurrency(stats.received)}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Cash incoming</span>
              <strong style={{ color: "#4fc3ff" }}>{formatCurrency(stats.incoming)}</strong>
            </div>
          </div>
        </section>

        <section className="kpi-grid">
          <article className="kpi-card analytics-kpi-profit">
            <span className="kpi-accent" />
            <p>Cash received</p>
            <strong>{formatCurrency(stats.received)}</strong>
            <span>from past events in {txLabel(selectedTY)}</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Cash incoming</p>
            <strong style={{ color: "#4fc3ff" }}>{formatCurrency(stats.incoming)}</strong>
            <span>from future sold tickets</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-accent" />
            <p>Total cash position</p>
            <strong>{formatCurrency(stats.totalCash)}</strong>
            <span>received + projected</span>
          </article>
          <article
            className={`kpi-card${
              stats.roi != null && stats.roi >= 0
                ? " analytics-kpi-profit"
                : stats.roi != null
                ? " analytics-kpi-risk"
                : ""
            }`}
          >
            <span className="kpi-accent" />
            <p>Overall ROI</p>
            <strong>{stats.roi != null ? `${stats.roi.toFixed(1)}%` : "—"}</strong>
            <span>profit on capital spent</span>
          </article>
        </section>

        {/* ── Month-by-month breakdown ────────────────────────────────────── */}

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Month by month</p>
              <h4>{txLabel(selectedTY)} breakdown</h4>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--text-muted)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "#9ef5c6", display: "inline-block" }} />
                  Received
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "#4fc3ff", display: "inline-block" }} />
                  Projected
                </span>
              </div>
              <span className="table-count">April to March</span>
            </div>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading</h5>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {monthRows.map(row => (
                <MonthRowItem key={`${row.year}-${row.month}`} row={row} />
              ))}
            </div>
          )}
        </section>

        {/* ── Per-event detail ────────────────────────────────────────────── */}

        {!loading && tyEvents.length > 0 && (
          <section className="table-card">
            <div className="table-card-header">
              <div>
                <p className="section-tag">Events</p>
                <h4>All events in {txLabel(selectedTY)}</h4>
              </div>
              <span className="table-count">{tyEvents.length} events</span>
            </div>
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
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tyEvents.map(ev => (
                    <tr key={ev.key}>
                      <td>
                        <div className="event-cell">
                          <strong>{ev.eventName}</strong>
                          <span>{ev.venue || "—"}</span>
                        </div>
                      </td>
                      <td>{formatEventDate(ev.eventDate)}</td>
                      <td>
                        {ev.soldQty > 0 ? (
                          `${ev.soldQty} / ${ev.totalQty}`
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>0 / {ev.totalQty}</span>
                        )}
                      </td>
                      <td>
                        <strong
                          style={
                            ev.cashIn > 0
                              ? { color: ev.isPast ? "#9ef5c6" : "#4fc3ff" }
                              : { color: "var(--text-muted)" }
                          }
                        >
                          {ev.cashIn > 0 ? formatCurrency(ev.cashIn) : "—"}
                        </strong>
                      </td>
                      <td>{ev.costOut > 0 ? formatCurrency(ev.costOut) : "—"}</td>
                      <td className={ev.cashIn > 0 ? (ev.profit >= 0 ? "value-up" : "value-down") : ""}>
                        {ev.cashIn > 0 ? formatCurrency(ev.profit) : "—"}
                      </td>
                      <td>
                        <span
                          className={`status-badge status-static ${ev.isPast ? "status-sold" : "status-listed"}`}
                        >
                          {ev.isPast ? (ev.cashIn > 0 ? "Received" : "Past") : "Upcoming"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ── Month row ─────────────────────────────────────────────────────────────────

function MonthRowItem({ row }: { row: MonthRow }) {
  const hasCash = row.totalCash > 0;
  const isEmpty = row.eventCount === 0;
  const hasBoth = row.receivedCash > 0 && row.projectedCash > 0;

  let statusLabel: string;
  let statusClass: string;

  if (isEmpty) {
    statusLabel = "No events";
    statusClass = "status-unlisted";
  } else if (row.isPastMonth) {
    statusLabel = hasCash ? "Received" : "No sales";
    statusClass = hasCash ? "status-sold" : "status-unlisted";
  } else if (row.isFutureMonth) {
    statusLabel = hasCash ? "Projected" : "No sales yet";
    statusClass = hasCash ? "status-listed" : "status-unlisted";
  } else {
    // Current month — could be entirely received, projected, or a mix
    if (hasBoth) {
      statusLabel = "Mixed";
      statusClass = "status-partial";
    } else if (row.receivedCash > 0) {
      statusLabel = "Received";
      statusClass = "status-sold";
    } else if (row.projectedCash > 0) {
      statusLabel = "Projected";
      statusClass = "status-listed";
    } else {
      statusLabel = "No sales yet";
      statusClass = "status-unlisted";
    }
  }

  const amountColor = !hasCash
    ? "var(--text-muted)"
    : row.isPastMonth
    ? "#9ef5c6"
    : row.isFutureMonth
    ? "#bfeeff"
    : hasBoth || row.projectedCash > 0
    ? "#bfeeff"
    : "#9ef5c6";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "18px 20px",
        transition: "background 150ms ease",
        ...(row.isCurrentMonth
          ? {
              background: "rgba(79,195,255,0.04)",
              borderTop: "1px solid rgba(79,195,255,0.1)",
              borderBottom: "1px solid rgba(79,195,255,0.1)",
              margin: "4px 0",
            }
          : {
              borderBottom: "1px solid rgba(35,35,42,0.35)",
            }),
      }}
    >
      {/* Left: month name + event count */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            {row.monthLabel}
          </strong>
          <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}>
            {row.year}
          </span>
          {row.isCurrentMonth && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#4fc3ff",
                background: "rgba(79,195,255,0.12)",
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid rgba(79,195,255,0.2)",
              }}
            >
              Current
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {isEmpty
            ? "No events this month"
            : row.eventCount === 1
            ? "1 event"
            : `${row.eventCount} events`}
          {!isEmpty && row.soldCount > 0 && row.soldCount < row.eventCount
            ? ` · ${row.soldCount} with sales`
            : ""}
        </span>
      </div>

      {/* Centre: breakdown for mixed months */}
      {hasBoth && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            minWidth: 160,
          }}
        >
          <span style={{ fontSize: 12, color: "#9ef5c6" }}>
            {formatCurrency(row.receivedCash)} received
          </span>
          <span style={{ fontSize: 12, color: "#4fc3ff" }}>
            {formatCurrency(row.projectedCash)} projected
          </span>
        </div>
      )}

      {/* Right: total amount */}
      <div style={{ minWidth: 130, textAlign: "right" }}>
        <strong
          style={{
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: amountColor,
          }}
        >
          {hasCash ? formatCurrency(row.totalCash) : "—"}
        </strong>
      </div>

      {/* Far right: status badge */}
      <div style={{ minWidth: 108, textAlign: "right" }}>
        <span
          className={`status-badge status-static ${statusClass}`}
          style={{ fontSize: 11, padding: "5px 12px" }}
        >
          {statusLabel}
        </span>
      </div>
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
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}
