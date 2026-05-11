"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number | null>(() => {
    const slots = txMonths(currentTY());
    const now = new Date();
    const idx = slots.findIndex(s => s.year === now.getFullYear() && s.month === now.getMonth());
    return idx >= 0 ? idx : 0;
  });

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const slots = txMonths(selectedTY);
    const now = new Date();
    const idx = slots.findIndex(s => s.year === now.getFullYear() && s.month === now.getMonth());
    setSelectedMonthIdx(idx >= 0 ? idx : 0);
  }, [selectedTY]);

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
            <span className="table-count">April → March</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading</h5>
            </div>
          ) : (
            <MonthBreakdown
              monthRows={monthRows}
              selectedMonthIdx={selectedMonthIdx}
              onMonthClick={idx => setSelectedMonthIdx(prev => (prev === idx ? null : idx))}
              tyEvents={tyEvents}
            />
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

// ── Month breakdown (tab row + detail panel) ─────────────────────────────────

function MonthBreakdown({
  monthRows,
  selectedMonthIdx,
  onMonthClick,
  tyEvents,
}: {
  monthRows: MonthRow[];
  selectedMonthIdx: number | null;
  onMonthClick: (idx: number) => void;
  tyEvents: CashEvent[];
}) {
  const row = selectedMonthIdx !== null ? monthRows[selectedMonthIdx] : null;

  const panelEvents = useMemo(() => {
    if (!row) return [];
    return tyEvents.filter(
      ev => ev.dateValue.getFullYear() === row.year && ev.dateValue.getMonth() === row.month,
    );
  }, [row, tyEvents]);

  const isOpen = selectedMonthIdx !== null;

  // track previous idx so detail panel content stays rendered during close animation
  const prevIdxRef = useRef(selectedMonthIdx);
  if (isOpen) prevIdxRef.current = selectedMonthIdx;
  const displayRow = isOpen ? row : (prevIdxRef.current !== null ? monthRows[prevIdxRef.current] : null);
  const displayEvents = isOpen ? panelEvents : (prevIdxRef.current !== null
    ? tyEvents.filter(ev => {
        const r = monthRows[prevIdxRef.current!];
        return ev.dateValue.getFullYear() === r.year && ev.dateValue.getMonth() === r.month;
      })
    : []);

  return (
    <div style={{ paddingTop: 8 }}>
      {/* ── Tab row — CSS grid guarantees 12 equal columns edge-to-edge ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(12, 1fr)",
        width: "100%",
      }}>
        {monthRows.map((r, idx) => {
          const isSelected = selectedMonthIdx === idx;
          const bc = monthBarColor(r);
          const bg = monthBarGlow(r);

          return (
            <button
              key={`tab-${idx}`}
              type="button"
              onClick={() => onMonthClick(idx)}
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                padding: "18px 2px 14px",
                borderRadius: 8,
                cursor: "pointer",
                border: "none",
                background: isSelected
                  ? "rgba(255,255,255,0.1)"
                  : "transparent",
                transition: "background 150ms ease",
                boxSizing: "border-box",
              }}
            >
              {/* Now badge slot — fixed height keeps all tabs identical */}
              <span style={{ height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {r.isCurrentMonth && (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#4fc3ff",
                    background: "rgba(79,195,255,0.18)",
                    border: "1px solid rgba(79,195,255,0.35)",
                    padding: "1px 5px",
                    borderRadius: 999,
                    whiteSpace: "nowrap",
                  }}>
                    Now
                  </span>
                )}
              </span>

              {/* Month name */}
              <span style={{
                fontSize: 13,
                fontWeight: isSelected ? 700 : 400,
                letterSpacing: isSelected ? "-0.02em" : "0",
                color: isSelected
                  ? "#ffffff"
                  : r.isCurrentMonth
                  ? "rgba(255,255,255,0.55)"
                  : "rgba(255,255,255,0.28)",
              }}>
                {shortMonth(r.month)}
              </span>

              {/* Coloured underline bar */}
              <span style={{
                width: "50%",
                height: 3,
                borderRadius: 999,
                background: bc,
                opacity: isSelected ? 1 : 0.22,
                boxShadow: isSelected ? bg : "none",
                transition: "opacity 150ms ease, box-shadow 150ms ease",
                flexShrink: 0,
              }} />
            </button>
          );
        })}
      </div>

      {/* Legend — left-aligned, directly below the tab row */}
      <div style={{
        display: "flex",
        gap: 20,
        paddingTop: 14,
        paddingLeft: 4,
        paddingBottom: 10,
      }}>
        {[
          { color: "#9ef5c6", label: "Received" },
          { color: "#fde68a", label: "Mixed" },
          { color: "#4fc3ff", label: "Projected" },
          { color: "rgba(255,255,255,0.2)", label: "No sales" },
        ].map(({ color, label }) => (
          <span key={label} style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11,
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
          }}>
            <span style={{
              width: 20,
              height: 3,
              borderRadius: 999,
              background: color,
              display: "inline-block",
              flexShrink: 0,
            }} />
            {label}
          </span>
        ))}
      </div>

      {/* ── Detail panel (animated) ── */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: isOpen ? 1400 : 0,
          transition: "max-height 380ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          style={{
            opacity: isOpen ? 1 : 0,
            transform: isOpen ? "translateY(0)" : "translateY(-6px)",
            transition: isOpen
              ? "opacity 240ms ease 60ms, transform 240ms ease 60ms"
              : "opacity 180ms ease, transform 180ms ease",
          }}
        >
          {displayRow && (
            <MonthDetailPanel row={displayRow} events={displayEvents} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Month detail panel ────────────────────────────────────────────────────────

function MonthDetailPanel({ row, events }: { row: MonthRow; events: CashEvent[] }) {
  const { label: statusLabel, cls: statusClass } = monthStatus(row);
  const hasBoth = row.receivedCash > 0 && row.projectedCash > 0;
  const hasCash = row.totalCash > 0;

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
    <div style={{
      margin: "10px 0 6px",
      borderRadius: 16,
      border: "1px solid var(--border)",
      background: "rgba(255,255,255,0.014)",
      overflow: "hidden",
    }}>
      {/* Header — everything left-aligned, total stacked directly below heading */}
      <div style={{
        padding: "20px 24px 20px",
        borderBottom: "1px solid rgba(35,35,42,0.5)",
        width: "100%",
        boxSizing: "border-box",
      }}>
        {/* Row 1: month name + badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <h4 style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: "var(--text-primary)",
          }}>
            {row.monthLabel} {row.year}
          </h4>
          <span
            className={`status-badge status-static ${statusClass}`}
            style={{ fontSize: 11, padding: "4px 11px" }}
          >
            {statusLabel}
          </span>
        </div>

        {/* Row 2: total — block element, explicitly left-anchored */}
        <div style={{ marginBottom: 6 }}>
          <span style={{
            display: "block",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.055em",
            color: amountColor,
            lineHeight: 1.1,
          }}>
            {hasCash ? formatCurrency(row.totalCash) : "—"}
          </span>
        </div>

        {/* Row 3: event count */}
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {row.eventCount === 0
            ? "No events this month"
            : row.eventCount === 1
            ? "1 event"
            : `${row.eventCount} events`}
          {row.soldCount > 0 && row.soldCount < row.eventCount
            ? ` · ${row.soldCount} with sales`
            : ""}
        </div>

        {/* Row 4: received / projected split (only when mixed) */}
        {hasBoth && (
          <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: "#9ef5c6" }}>
              {formatCurrency(row.receivedCash)} received
            </span>
            <span style={{ fontSize: 13, color: "#4fc3ff" }}>
              {formatCurrency(row.projectedCash)} projected
            </span>
          </div>
        )}
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div style={{
          padding: "32px 24px",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 14,
        }}>
          No events in {row.monthLabel} {row.year}
        </div>
      ) : (
        <div>
          {/* Column header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "56px minmax(0,1fr) 72px 110px",
            gap: 8,
            padding: "10px 24px",
            borderBottom: "1px solid rgba(35,35,42,0.4)",
          }}>
            {["Date", "Event", "Tickets", "Cash in"].map(h => (
              <span key={h} style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                textAlign: h === "Tickets" || h === "Cash in" ? "right" : "left",
              }}>
                {h}
              </span>
            ))}
          </div>

          {events.map((ev, idx) => (
            <div
              key={ev.key}
              style={{
                display: "grid",
                gridTemplateColumns: "56px minmax(0,1fr) 72px 110px",
                gap: 8,
                alignItems: "center",
                padding: "12px 24px",
                borderBottom: idx < events.length - 1 ? "1px solid rgba(35,35,42,0.28)" : "none",
                transition: "background 150ms ease",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Date */}
              <span style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.01em" }}>
                {formatShortDate(ev.dateValue)}
              </span>

              {/* Event name + venue */}
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <strong style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.015em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {ev.eventName}
                </strong>
                {ev.venue && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.venue}
                  </span>
                )}
              </div>

              {/* Tickets sold */}
              <span style={{
                fontSize: 12,
                color: ev.soldQty > 0 ? "var(--text-secondary)" : "var(--text-muted)",
                textAlign: "right",
              }}>
                {ev.soldQty > 0 ? `${ev.soldQty} / ${ev.totalQty}` : (
                  <span style={{ opacity: 0.45 }}>0 / {ev.totalQty}</span>
                )}
              </span>

              {/* Cash */}
              <div style={{ textAlign: "right" }}>
                {ev.cashIn > 0 ? (
                  <strong style={{
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    color: ev.isPast ? "#9ef5c6" : "#4fc3ff",
                  }}>
                    {formatCurrency(ev.cashIn)}
                  </strong>
                ) : (
                  <span style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                    opacity: 0.7,
                  }}>
                    No sales yet
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers for month tabs ────────────────────────────────────────────────────

function shortMonth(month: number): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(2024, month, 1));
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

function monthBarColor(row: MonthRow): string {
  if (row.eventCount === 0) return "rgba(255,255,255,0.12)";
  if (row.receivedCash > 0 && row.projectedCash > 0) return "#fde68a";
  if (row.receivedCash > 0) return "#9ef5c6";
  if (row.projectedCash > 0) return "#4fc3ff";
  return "rgba(255,255,255,0.2)";
}

function monthBarGlow(row: MonthRow): string {
  if (row.receivedCash > 0 && row.projectedCash > 0) return "0 0 5px rgba(253,230,138,0.6)";
  if (row.receivedCash > 0) return "0 0 5px rgba(158,245,198,0.6)";
  if (row.projectedCash > 0) return "0 0 5px rgba(79,195,255,0.6)";
  return "none";
}

function monthStatus(row: MonthRow): { label: string; cls: string } {
  const hasCash = row.totalCash > 0;
  const hasBoth = row.receivedCash > 0 && row.projectedCash > 0;
  if (row.eventCount === 0) return { label: "No events", cls: "status-unlisted" };
  if (row.isPastMonth) return hasCash ? { label: "Received", cls: "status-sold" } : { label: "No sales", cls: "status-unlisted" };
  if (row.isFutureMonth) return hasCash ? { label: "Projected", cls: "status-listed" } : { label: "No sales yet", cls: "status-unlisted" };
  if (hasBoth) return { label: "Mixed", cls: "status-partial" };
  if (row.receivedCash > 0) return { label: "Received", cls: "status-sold" };
  if (row.projectedCash > 0) return { label: "Projected", cls: "status-listed" };
  return { label: "No sales yet", cls: "status-unlisted" };
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
