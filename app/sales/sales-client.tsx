"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";

type Sale = {
  id: number;
  external_sale_id: string | null;
  source: string;
  source_message_id: string;
  subject: string | null;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  sold_at: string | null;
  account_email: string | null;
  buyer_email: string | null;
  qty_sold: number | null;
  price_per_ticket: number | null;
  sale_total: number | null;
  payout_total: number | null;
  currency: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  sale_status: string | null;
  inventory_order_id: number | null;
  match_confidence: number | null;
  created_at: string | null;
};

type MatchedOrder = {
  id: number;
  booking_ref: string | null;
  total_cost: number | null;
  sold_total: number | null;
  qty_bought: number | null;
  account_email: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
};

type SaleGroup = {
  key: string;
  eventName: string;
  venue: string;
  eventDate: string;
  sales: Sale[];
  salesCount: number;
  ticketsSold: number;
  soldFor: number;
  profit: number;
  cost: number;
  matchedCount: number;
  unmatchedCount: number;
};

const navItems = [
  { label: "Dashboard", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: true },
  { label: "Inventory", href: "/inventory", active: false },
  { label: "Analytics", href: "/analytics", active: false },
];

const matchFilterOptions = ["All", "Matched", "Unmatched"];

export default function SalesClient() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [matchedOrders, setMatchedOrders] = useState<Record<number, MatchedOrder>>({});
  const [allOrders, setAllOrders] = useState<MatchedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [accountFilter, setAccountFilter] = useState("All");
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);

  useEffect(() => {
    void loadSales();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadSales(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const { data, error } = await supabase
      .from("sales")
      .select("*")
      .order("sold_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const nextSales = (data as Sale[]) || [];
    setSales(nextSales);

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("id, booking_ref, total_cost, sold_total, qty_bought, account_email, section, row, seat_from, seat_to, event_name, venue, event_date");

    if (orderError) {
      setMessage(orderError.message);
      setMatchedOrders({});
      setAllOrders([]);
    } else {
      const nextOrders = (orderData as MatchedOrder[]) || [];
      setAllOrders(nextOrders);
      const orderMap = nextOrders.reduce<Record<number, MatchedOrder>>((acc, order) => {
        acc[order.id] = order;
        return acc;
      }, {});
      setMatchedOrders(orderMap);
    }

    if (selectedSaleId != null && !nextSales.some((sale) => sale.id === selectedSaleId)) {
      setSelectedSaleId(null);
    }

    if (showRefreshing) {
      setMessage("Sales refreshed");
    }

    setLoading(false);
    setRefreshing(false);
  }

  async function scanSalesNow() {
    setScanning(true);
    setMessage("");

    try {
      const response = await fetch("/api/scan-sales", { method: "POST" });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Sales scan failed");
        setScanning(false);
        return;
      }

      await loadSales(true);
      setMessage(`Sales scan complete: ${result.inserted} new, ${result.matched} matched`);
    } catch {
      setMessage("Sales scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function deleteSale(id: number) {
    const confirmed = window.confirm("Delete this sale row?");
    if (!confirmed) {
      return;
    }

    setMessage("");

    const { error } = await supabase.from("sales").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSales((current) => current.filter((sale) => sale.id !== id));
    if (selectedSaleId === id) {
      setSelectedSaleId(null);
    }
    setMessage("Sale row deleted");
  }

  function toggleGroup(key: string) {
    setExpandedGroups((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  }

  function resetFilters() {
    setSearch("");
    setMatchFilter("All");
    setMonthFilter("All");
    setAccountFilter("All");
  }

  const monthOptions = useMemo(() => {
    const values = sales
      .map((sale) => getMonthLabel(sale.sold_at || sale.event_date))
      .filter((value): value is string => Boolean(value));

    return ["All", ...new Set(values)];
  }, [sales]);

  const accountOptions = useMemo(() => {
    const values = sales
      .map((sale) => sale.account_email)
      .filter((value): value is string => Boolean(value));

    return ["All", ...new Set(values)];
  }, [sales]);

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesSearch =
        search === "" ||
        [sale.event_name, sale.venue, sale.account_email, sale.external_sale_id, sale.section, sale.row]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search.toLowerCase()));

      const matchesMatch =
        matchFilter === "All" ||
        (matchFilter === "Matched" && sale.inventory_order_id != null) ||
        (matchFilter === "Unmatched" && sale.inventory_order_id == null);

      const matchesMonth =
        monthFilter === "All" || getMonthLabel(sale.sold_at || sale.event_date) === monthFilter;

      const matchesAccount = accountFilter === "All" || sale.account_email === accountFilter;

      return matchesSearch && matchesMatch && matchesMonth && matchesAccount;
    });
  }, [sales, search, matchFilter, monthFilter, accountFilter]);

  const groupedSales = useMemo(() => {
    const map = new Map<string, SaleGroup>();

    for (const sale of filteredSales) {
      const eventName = sale.event_name || "Untitled sale";
      const venue = sale.venue || "Venue missing";
      const eventDate = sale.event_date || "Date missing";
      const key = `${eventName}__${venue}__${eventDate}`;
      const ticketsSold = sale.qty_sold ?? 0;
      const soldFor = sale.sale_total ?? sale.payout_total ?? 0;
      const referenceOrder = getReferenceOrderForSale(sale, matchedOrders, allOrders);
      const profit = getSaleProfit(sale, referenceOrder);
      const cost = getSaleCost(sale, referenceOrder);

      if (!map.has(key)) {
        map.set(key, {
          key,
          eventName,
          venue,
          eventDate,
          sales: [],
          salesCount: 0,
          ticketsSold: 0,
          soldFor: 0,
          profit: 0,
          cost: 0,
          matchedCount: 0,
          unmatchedCount: 0,
        });
      }

      const group = map.get(key)!;
      group.sales.push(sale);
      group.salesCount += 1;
      group.ticketsSold += ticketsSold;
      if (sale.inventory_order_id != null) {
        group.matchedCount += 1;
        group.soldFor += soldFor;
        group.profit += profit ?? 0;
        group.cost += cost ?? 0;
      } else {
        group.unmatchedCount += 1;
        group.cost += cost ?? 0;
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.unmatchedCount !== b.unmatchedCount) {
        return b.unmatchedCount - a.unmatchedCount;
      }
      return b.soldFor - a.soldFor;
    });
  }, [filteredSales, matchedOrders, allOrders]);

  const metrics = useMemo(() => {
    const totalSales = filteredSales.length;
    const totalSoldFor = filteredSales.reduce((sum, sale) => {
      if (sale.inventory_order_id == null) {
        return sum;
      }
      return sum + (sale.sale_total ?? sale.payout_total ?? 0);
    }, 0);
    const ticketsSold = filteredSales.reduce((sum, sale) => sum + (sale.qty_sold ?? 0), 0);
    const totalProfit = filteredSales.reduce((sum, sale) => {
      const order = getReferenceOrderForSale(sale, matchedOrders, allOrders);
      return sum + (getSaleProfit(sale, order) ?? 0);
    }, 0);

    return [
      {
        label: "Sales Logged",
        value: String(totalSales),
        detail: totalSales > 0 ? `${groupedSales.length} events covered` : "No sales logged yet",
      },
      {
        label: "Total Sold For",
        value: formatCurrency(totalSoldFor),
        detail: totalSoldFor > 0 ? "Matched sales only" : "No matched sales yet",
      },
      {
        label: "Tickets Sold",
        value: String(ticketsSold),
        detail: ticketsSold > 0 ? "From Viagogo sales emails" : "No sold tickets yet",
      },
      {
        label: "Profit",
        value: renderDeltaValue(totalProfit, true),
        detail: totalProfit !== 0 ? "Matched sales only" : "No matched profit yet",
      },
    ];
  }, [filteredSales, groupedSales.length, matchedOrders, allOrders]);

  const selectedSale = sales.find((sale) => sale.id === selectedSaleId) || null;
  const selectedOrder = selectedSale ? getReferenceOrderForSale(selectedSale, matchedOrders, allOrders) : null;
  const selectedProfit = selectedSale ? getSaleProfit(selectedSale, selectedOrder) : null;

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
          <div className="sidebar-panel">
            <p className="sidebar-panel-label">Sales desk</p>
            <strong>Viagogo sync live</strong>
            <span>Import sold tickets, review matches, and keep sold numbers clean.</span>
          </div>

          <div className="sidebar-settings-box">
            <p className="sidebar-panel-label">Settings</p>
            <div className="sidebar-settings-actions">
              <Link href="/connections" className="sidebar-panel-link">
                Connections
              </Link>
              <button type="button" className="sidebar-panel-link sidebar-logout-button" onClick={handleLogout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Sales desk</p>
            <h2>Sales</h2>
          </div>

          <div className="topbar-actions">
            <button className="secondary-button" onClick={() => void loadSales(true)} disabled={refreshing} type="button">
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button className="secondary-button" onClick={() => void scanSalesNow()} disabled={scanning} type="button">
              {scanning ? "Scanning..." : "Scan Sales"}
            </button>
            <Link href="/orders" className="primary-button">
              Back to Dashboard
            </Link>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="section-tag">Sales</p>
            <h3>Log sold tickets, sold values, and profit.</h3>
          </div>
          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Profit</span>
              <strong>{metrics[3]?.value || "£0.00"}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Total sold for</span>
              <strong>{metrics[1]?.value || "£0.00"}</strong>
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
          {metrics.map((metric) => (
            <article key={metric.label} className="kpi-card">
              <span className="kpi-accent" />
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <span>{metric.detail}</span>
            </article>
          ))}
        </section>

        <section className="command-card">
          <div className="command-header">
            <div>
              <p className="section-tag">Filters</p>
              <h4>Filter sales instantly</h4>
            </div>
            <button className="ghost-button" type="button" onClick={resetFilters}>
              Reset Filters
            </button>
          </div>

          <div className="filter-grid">
            <label className="field-label">
              <span>Search</span>
              <input
                className="field field-search"
                placeholder="Search event, venue, account, section..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="field-label">
              <span>Match</span>
              <select className="field field-compact" value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)}>
                {matchFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>Month</span>
              <select className="field field-compact" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
                {monthOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>Account</span>
              <select className="field field-compact" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
                {accountOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="table-card inventory-board">
          <div className="table-card-header inventory-board-header">
            <div>
              <p className="section-tag">Sales</p>
              <h4>Sold tickets by event</h4>
            </div>
            <span className="table-count">{filteredSales.length} sales</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading sales</h5>
              <p>Pulling Viagogo sales into grouped event lines.</p>
            </div>
          ) : groupedSales.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No sales in this view</h5>
              <p>Run Scan Sales or reset filters to widen the view.</p>
            </div>
          ) : (
            <div className="inventory-group-list">
              {groupedSales.map((group) => {
                const expanded = expandedGroups.includes(group.key);
                const matchedRatio = group.salesCount > 0 ? (group.matchedCount / group.salesCount) * 100 : 0;

                return (
                  <article
                    key={group.key}
                    className={`inventory-group-card${group.unmatchedCount > 0 ? " inventory-group-risk" : ""}${expanded ? " inventory-group-open" : ""}`}
                  >
                    <button className="inventory-group-toggle" type="button" onClick={() => toggleGroup(group.key)}>
                      <div className="inventory-group-main">
                        <div className="inventory-group-title">
                          <strong>{group.eventName}</strong>
                          <span>{group.venue}</span>
                          <small>{formatEventDate(group.eventDate)}</small>
                        </div>

                        <div className="inventory-group-metrics">
                          <div className="inventory-metric-chip">
                            <span>Sales</span>
                            <strong>{group.salesCount}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Tickets</span>
                            <strong>{group.ticketsSold}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>{group.matchedCount > 0 ? "Sold for" : "Cost"}</span>
                            <strong>
                              {group.matchedCount > 0 ? formatCurrency(group.soldFor) : formatCurrency(group.cost)}
                            </strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Profit</span>
                            <strong className={getDeltaTone(group.profit)}>
                              {group.matchedCount > 0 ? renderDeltaValue(group.profit) : "—"}
                            </strong>
                          </div>
                          <div className="inventory-status-row">
                            <span className="status-badge status-static status-sold">Matched {group.matchedCount}</span>
                            <span className="status-badge status-static status-problem">Review {group.unmatchedCount}</span>
                          </div>
                        </div>
                      </div>

                      <div className="inventory-group-side">
                        {group.unmatchedCount > 0 ? <span className="inventory-risk-badge">Needs review</span> : null}
                        <div className="inventory-progress-block">
                          <span>{group.matchedCount}/{group.salesCount} matched</span>
                          <div className="inventory-progress-track">
                            <div className="inventory-progress-fill" style={{ width: `${Math.max(matchedRatio, 6)}%` }} />
                          </div>
                        </div>
                        <span className="inventory-chevron">{expanded ? "−" : "+"}</span>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="inventory-ticket-stack">
                        <div className="inventory-ticket-header">
                          <span>Seat</span>
                          <span>Account</span>
                          <span>Value</span>
                          <span>Match</span>
                        </div>
                        {group.sales.map((sale) => {
                          const matchedOrder = getReferenceOrderForSale(sale, matchedOrders, allOrders);
                          return (
                            <div
                              key={sale.id}
                              className="inventory-ticket-row"
                              onClick={() => setSelectedSaleId(sale.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedSaleId(sale.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              style={{ cursor: "pointer" }}
                            >
                              <div className="inventory-ticket-seat">
                                <strong>{sale.section || "Section —"}</strong>
                                <span>{formatSeatLabel(sale.row, sale.seat_from, sale.seat_to)}</span>
                              </div>
                              <span className="truncate-text" title={sale.account_email || ""}>
                                {sale.account_email || "No account"}
                              </span>
                              <strong className="inventory-cost-value">
                                {sale.inventory_order_id != null
                                  ? formatCurrency(sale.sale_total ?? sale.payout_total)
                                  : formatCurrency(getSaleCost(sale, matchedOrder))}
                              </strong>
                              <span className={`status-badge status-static ${sale.inventory_order_id != null ? "status-sold" : "status-problem"}`}>
                                {sale.inventory_order_id != null ? "Matched" : "Unmatched"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <aside className={`details-drawer${selectedSale ? " details-drawer-open" : ""}`}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Sale detail</p>
            <h4>{selectedSale?.event_name || "Select a sale"}</h4>
          </div>
          <button className="drawer-close" type="button" onClick={() => setSelectedSaleId(null)}>
            ×
          </button>
        </div>

        {selectedSale ? (
          <div className="drawer-content">
            <section className="drawer-hero">
              <div className="drawer-hero-copy">
                <strong>{selectedSale.event_name || "Untitled sale"}</strong>
                <span>{selectedSale.venue || "Venue missing"}</span>
                <small>{formatEventDate(selectedSale.event_date)}</small>
              </div>
              <div className="drawer-hero-meta">
                <span className={`status-badge status-static ${selectedSale.inventory_order_id != null ? "status-sold" : "status-problem"}`}>
                  {selectedSale.inventory_order_id != null ? "Matched" : "Needs review"}
                </span>
                <strong className={`drawer-profit ${getDeltaTone(selectedProfit)}`}>
                  {selectedSale.inventory_order_id != null ? renderDeltaValue(selectedProfit, true) : "Needs match"}
                </strong>
              </div>
            </section>

            <div className="drawer-grid">
              <label>
                <span>Sale ID</span>
                <div className="field">{selectedSale.external_sale_id || "—"}</div>
              </label>
              <label>
                <span>Sold at</span>
                <div className="field">{formatSoldAt(selectedSale.sold_at)}</div>
              </label>
              <label>
                <span>Seller account</span>
                <div className="field">{selectedSale.account_email || "—"}</div>
              </label>
              <label>
                <span>Buyer email</span>
                <div className="field">{selectedSale.buyer_email || "—"}</div>
              </label>
              <label>
                <span>Section</span>
                <div className="field">{selectedSale.section || "—"}</div>
              </label>
              <label>
                <span>Row / seats</span>
                <div className="field">{formatSeatLabel(selectedSale.row, selectedSale.seat_from, selectedSale.seat_to)}</div>
              </label>
              <label>
                <span>Tickets sold</span>
                <div className="field">{selectedSale.qty_sold ?? 0}</div>
              </label>
              <label>
                <span>Price per ticket</span>
                <div className="field">{formatCurrency(selectedSale.price_per_ticket)}</div>
              </label>
              <label>
                <span>{selectedSale.inventory_order_id != null ? "Total sold for" : "Cost"}</span>
                <div className="field">
                  {selectedSale.inventory_order_id != null
                    ? formatCurrency(selectedSale.sale_total ?? selectedSale.payout_total)
                    : formatCurrency(getSaleCost(selectedSale, selectedOrder))}
                </div>
              </label>
              <label>
                <span>Profit</span>
                <div className={`field ${getDeltaTone(selectedProfit)}`}>
                  {selectedSale.inventory_order_id != null ? renderDeltaValue(selectedProfit) : "—"}
                </div>
              </label>
              <label>
                <span>Match confidence</span>
                <div className="field">{selectedSale.match_confidence != null ? selectedSale.match_confidence.toFixed(2) : "—"}</div>
              </label>
            </div>

            <div className="drawer-summary">
              <div>
                <span>Matched order</span>
                <strong>{selectedOrder?.booking_ref || "No linked order"}</strong>
              </div>
              <div>
                <span>Order cost</span>
                <strong>{formatCurrency(selectedOrder?.total_cost)}</strong>
              </div>
              <div>
                <span>Seat match</span>
                <strong>{selectedOrder ? formatSeatLabel(selectedOrder.row, selectedOrder.seat_from, selectedOrder.seat_to) : "—"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{selectedSale.sale_status || "Sold"}</strong>
              </div>
            </div>

            <div className="drawer-actions">
              <button
                className="danger-button"
                type="button"
                onClick={() => void deleteSale(selectedSale.id)}
              >
                Delete Sale
              </button>
            </div>
          </div>
        ) : (
          <div className="drawer-empty">
            <div className="drawer-empty-orb" />
            <span className="status-badge status-static status-unlisted">No sale selected</span>
            <h5>Open any sale to review it</h5>
            <p>Check buyer details, sold value, and profit against inventory.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function getSaleProfit(sale: Sale, order?: MatchedOrder | null) {
  if (sale.inventory_order_id == null) {
    return 0;
  }

  return (sale.payout_total ?? sale.sale_total ?? 0) - (order?.total_cost ?? 0);
}

function getSaleCost(sale: Sale, order?: MatchedOrder | null) {
  if (!order?.total_cost) {
    return 0;
  }

  if (!order.qty_bought || !sale.qty_sold || order.qty_bought <= 0 || sale.qty_sold <= 0) {
    return order.total_cost;
  }

  return (order.total_cost / order.qty_bought) * sale.qty_sold;
}

function getReferenceOrderForSale(
  sale: Sale,
  matchedOrders: Record<number, MatchedOrder>,
  allOrders: MatchedOrder[],
) {
  if (sale.inventory_order_id != null && matchedOrders[sale.inventory_order_id]) {
    return matchedOrders[sale.inventory_order_id];
  }

  let best: { order: MatchedOrder; score: number } | null = null;

  for (const order of allOrders) {
    let score = 0;

    score += compareText(order.event_name, sale.event_name) * 0.4;
    score += compareText(order.venue, sale.venue) * 0.15;
    score += compareEventDay(order.event_date, sale.event_date) * 0.2;
    score += compareText(order.section, sale.section) * 0.1;
    score += compareExact(order.row, sale.row) * 0.05;
    score += compareSeats(order.seat_from, order.seat_to, sale.seat_from, sale.seat_to) * 0.1;

    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { order, score };
    }
  }

  return best && best.score >= 0.45 ? best.order : null;
}

function compareText(left?: string | null, right?: string | null) {
  if (!left || !right) {
    return 0;
  }

  const a = normalizeCompareValue(left);
  const b = normalizeCompareValue(right);

  if (a === b) {
    return 1;
  }

  return a.includes(b) || b.includes(a) ? 0.7 : 0;
}

function compareExact(left?: string | null, right?: string | null) {
  if (!left || !right) {
    return 0;
  }

  return normalizeCompareValue(left) === normalizeCompareValue(right) ? 1 : 0;
}

function compareEventDay(left?: string | null, right?: string | null) {
  const a = getDateKey(left);
  const b = getDateKey(right);

  if (!a || !b) {
    return 0;
  }

  return a === b ? 1 : 0;
}

function compareSeats(
  orderSeatFrom?: string | null,
  orderSeatTo?: string | null,
  saleSeatFrom?: string | null,
  saleSeatTo?: string | null,
) {
  const orderRange = `${orderSeatFrom || ""}-${orderSeatTo || orderSeatFrom || ""}`;
  const saleRange = `${saleSeatFrom || ""}-${saleSeatTo || saleSeatFrom || ""}`;

  if (!orderRange.trim() || !saleRange.trim()) {
    return 0;
  }

  return normalizeCompareValue(orderRange) === normalizeCompareValue(saleRange) ? 1 : 0;
}

function normalizeCompareValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getDateKey(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const match = value.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) {
    return null;
  }

  const fallback = new Date(`${match[1]} ${match[2]} ${match[3]}`);
  if (Number.isNaN(fallback.getTime())) {
    return null;
  }

  return fallback.toISOString().slice(0, 10);
}

function getDeltaTone(value: number | null) {
  if (value == null || value === 0) {
    return "delta-flat";
  }

  return value > 0 ? "delta-up" : "delta-down";
}

function renderDeltaValue(value: number | null, withArrow = false) {
  if (value == null) {
    return "—";
  }

  if (value === 0) {
    return formatCurrency(0);
  }

  if (!withArrow) {
    return formatCurrency(value);
  }

  return `${value > 0 ? "↑" : "↓"} ${formatCurrency(Math.abs(value))}`;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatEventDate(value: string | null) {
  return value || "Date missing";
}

function formatSoldAt(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatSeatLabel(row: string | null, seatFrom: string | null, seatTo: string | null) {
  const seatLabel = seatFrom
    ? seatTo && seatTo !== seatFrom
      ? `Seats ${seatFrom}–${seatTo}`
      : `Seat ${seatFrom}`
    : "Seat —";

  return row ? `Row ${row} • ${seatLabel}` : seatLabel;
}

function getMonthLabel(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value.replace(/\|/g, " "));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(parsed);
}

