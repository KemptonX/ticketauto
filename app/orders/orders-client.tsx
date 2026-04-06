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

const statusOptions = ["All", "Unlisted", "Listed", "Sold", "Problem / Missing"];
const quickStatusOptions = ["Unlisted", "Listed", "Sold", "Problem / Missing"];
const sourceOptions = [
  "All",
  "ticketmaster_direct",
  "ticketmaster_resale",
  "manual",
];

const navItems = [
  { label: "Dashboard", href: "/orders", active: true },
  { label: "Sales", href: "/sales", active: false },
  { label: "Inventory", href: "/inventory", active: false },
  { label: "Analytics", href: "/analytics", active: false },
];

export default function OrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("All");
  const [venueFilter, setVenueFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [soldFilter, setSoldFilter] = useState("All");

  function resetFilters() {
    setSearch("");
    setEventFilter("All");
    setVenueFilter("All");
    setStatusFilter("All");
    setSourceFilter("All");
    setSoldFilter("All");
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
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      const nextOrders = (data as Order[]) || [];
      setOrders(nextOrders);
      if (selectedOrderId != null) {
        const stillExists = nextOrders.some((order) => order.id === selectedOrderId);
        if (!stillExists) {
          setSelectedOrderId(null);
        }
      }
      if (showRefreshing) {
        setMessage("Inventory refreshed");
      }
    }

    setLoading(false);
    setRefreshing(false);
  }

  async function scanGmailNow() {
    setScanning(true);
    setMessage("");

    try {
      const response = await fetch("/api/scan-gmail", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Scan failed");
        setScanning(false);
        return;
      }

      await loadOrders(true);
      setMessage("Inbox scan complete");
    } catch {
      setMessage("Inbox scan failed");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  function updateOrder(id: number, field: keyof Order, value: string) {
    setOrders((current) =>
      current.map((order) =>
        order.id === id
          ? {
              ...order,
              [field]:
                field === "qty_bought" ||
                field === "total_cost" ||
                field === "sold_total"
                  ? value === ""
                    ? null
                    : Number(value)
                  : value,
            }
          : order,
      ),
    );
  }

  async function saveOrder(order: Order) {
    setMessage("");

    const { error } = await supabase
      .from("orders")
      .update({
        booking_ref: order.booking_ref,
        event_name: order.event_name,
        venue: order.venue,
        event_date: order.event_date,
        account_email: order.account_email,
        section: order.section,
        row: order.row,
        seat_from: order.seat_from,
        seat_to: order.seat_to,
        qty_bought: order.qty_bought,
        total_cost: order.total_cost,
        sold_total: order.sold_total,
        listing_status: order.listing_status,
        source_type: order.source_type,
      })
      .eq("id", order.id);

    setMessage(error ? error.message : `Saved ${order.booking_ref || "ticket"}`);
  }

  async function saveQuickField(
    order: Order,
    field: "listing_status" | "sold_total",
    value: string,
  ) {
    updateOrder(order.id, field, value);

    const payload =
      field === "sold_total"
        ? { sold_total: value === "" ? null : Number(value) }
        : { listing_status: value };

    const { error } = await supabase
      .from("orders")
      .update(payload)
      .eq("id", order.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(
      field === "listing_status" ? "Status saved" : "Sales total saved",
    );
  }

  async function deleteOrder(id: number) {
    const confirmed = window.confirm("Delete this ticket row?");
    if (!confirmed) {
      return;
    }

    setMessage("");

    const { error } = await supabase.from("orders").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setOrders((current) => current.filter((order) => order.id !== id));
    if (selectedOrderId === id) {
      setSelectedOrderId(null);
    }
    setMessage("Ticket row deleted");
  }

  async function addRow() {
    setMessage("");

    const { data, error } = await supabase
      .from("orders")
      .insert({
        booking_ref: "",
        event_name: "",
        venue: "",
        event_date: "",
        account_email: "",
        section: "",
        row: "",
        seat_from: "",
        seat_to: "",
        qty_bought: null,
        total_cost: null,
        sold_total: null,
        listing_status: "Unlisted",
        source_type: "manual",
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    const newOrder = data as Order;
    setOrders((current) => [newOrder, ...current]);
    setSelectedOrderId(newOrder.id);
    setMessage("New ticket row added");
  }

  const eventOptions = useMemo(() => {
    const values = orders
      .map((order) => order.event_name)
      .filter((value): value is string => Boolean(value));
    return ["All", ...new Set(values)];
  }, [orders]);

  const venueOptions = useMemo(() => {
    const values = orders
      .map((order) => order.venue)
      .filter((value): value is string => Boolean(value));
    return ["All", ...new Set(values)];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        search === "" ||
        [
          order.booking_ref,
          order.event_name,
          order.venue,
          order.account_email,
          order.section,
          order.row,
          order.source_type,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(search.toLowerCase()),
          );

      const matchesEvent =
        eventFilter === "All" || order.event_name === eventFilter;

      const matchesVenue =
        venueFilter === "All" || order.venue === venueFilter;

      const matchesStatus =
        statusFilter === "All" || order.listing_status === statusFilter;

      const matchesSource =
        sourceFilter === "All" || order.source_type === sourceFilter;

      const matchesSold =
        soldFilter === "All" ||
        (soldFilter === "Sold" && (order.sold_total ?? 0) > 0) ||
        (soldFilter === "Unsold" && !(order.sold_total ?? 0));

      return (
        matchesSearch &&
        matchesEvent &&
        matchesVenue &&
        matchesStatus &&
        matchesSource &&
        matchesSold
      );
    });
  }, [
    orders,
    search,
    eventFilter,
    venueFilter,
    statusFilter,
    sourceFilter,
    soldFilter,
  ]);

  const selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ?? null;

  const metrics = useMemo(() => {
    const totalOrders = filteredOrders.length;
    const totalCost = filteredOrders.reduce(
      (sum, order) => sum + (order.total_cost ?? 0),
      0,
    );
    const totalSold = filteredOrders.reduce(
      (sum, order) => sum + (order.sold_total ?? 0),
      0,
    );
    const totalProfit = filteredOrders.reduce((sum, order) => {
      if (order.sold_total == null || order.total_cost == null) {
        return sum;
      }
      return sum + (order.sold_total - order.total_cost);
    }, 0);

    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    return [
      {
        label: "Tickets",
        value: String(totalOrders),
        detail: totalOrders > 0 ? `${totalOrders} live rows` : "No rows yet",
        trend: "+2 this week",
      },
      {
        label: "Spent",
        value: formatCurrency(totalCost),
        detail:
          totalOrders > 0
            ? formatCurrency(totalCost / totalOrders)
            : "No buys yet",
      },
      {
        label: "Sales",
        value: formatCurrency(totalSold),
        detail: totalSold > 0 ? "Sales logged" : "No sales yet",
      },
      {
        label: "ROI",
        value: `${roi.toFixed(1)}%`,
        detail:
          totalProfit !== 0 ? `${formatCurrency(totalProfit)} net` : "Flat book",
      },
    ];
  }, [filteredOrders]);

  return (
    <div className="orders-shell">
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

        <div className="sidebar-footer">
          <div className="sidebar-panel">
            <p className="sidebar-panel-label">Desk status</p>
            <strong>Inbox sync live</strong>
            <span>
              Refresh data, scan Gmail, and manage inventory from one premium
              workspace.
            </span>
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
            <p className="eyebrow">Ticket desk</p>
            <h2>Dashboard</h2>
          </div>

          <div className="topbar-actions">
            <button
              className="secondary-button"
              onClick={() => loadOrders(true)}
              disabled={refreshing}
              type="button"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="secondary-button"
              onClick={scanGmailNow}
              disabled={scanning}
              type="button"
            >
              {scanning ? "Scanning..." : "Scan Gmail"}
            </button>
            <button className="primary-button" onClick={addRow} type="button">
              Add Order
            </button>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="section-tag">Overview</p>
            <h3>Track stock, sales, and profit.</h3>
          </div>

          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Sync</span>
              <strong>{loading ? "Pulling" : "Ready"}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Rows</span>
              <strong>{filteredOrders.length}</strong>
            </div>
            <Link href="/" className="text-link">
              Home
            </Link>
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
              <h4>Filter your inventory instantly</h4>
            </div>
            <button className="ghost-button" onClick={resetFilters} type="button">
              Reset Filters
            </button>
          </div>

          <div className="command-grid">
            <label className="filter-field">
              <span className="filter-label">Search</span>
              <input
                className="field field-search"
                placeholder="Search ref, event, venue, account..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>

            <label className="filter-field">
              <span className="filter-label">Event</span>
              <select
                className="field"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
              >
                {eventOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Venue</span>
              <select
                className="field"
                value={venueFilter}
                onChange={(e) => setVenueFilter(e.target.value)}
              >
                {venueOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Status</span>
              <select
                className="field"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Source</span>
              <select
                className="field"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                {sourceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Sold</span>
              <select
                className="field"
                value={soldFilter}
                onChange={(e) => setSoldFilter(e.target.value)}
              >
                <option value="All">All sold states</option>
                <option value="Sold">Sold</option>
                <option value="Unsold">Unsold</option>
              </select>
            </label>
          </div>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Tickets</p>
              <h4>Tickets</h4>
            </div>
            <span className="table-count">{filteredOrders.length} rows</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading tickets</h5>
              <p>Pulling your latest rows, seats, and sales numbers.</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No tickets match these filters</h5>
              <p>
                Reset the command bar or add a new order to start building your
                inventory.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Booking Ref</th>
                    <th>Seats</th>
                    <th>Account</th>
                    <th>Bought</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th>Sold Total</th>
                    <th>Profit</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const totalCost = order.total_cost ?? 0;
                    const soldTotal = order.sold_total ?? 0;
                    const profit =
                      order.sold_total != null ? soldTotal - totalCost : null;
                    const roi =
                      profit != null && totalCost > 0
                        ? (profit / totalCost) * 100
                        : null;
                    const active = selectedOrderId === order.id;
                    const statusTone = getStatusTone(order.listing_status);

                    return (
                      <tr
                        key={order.id}
                        className={active ? "row-active" : ""}
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        <td>
                          <div className="event-cell">
                            <strong>{order.event_name || "Untitled ticket"}</strong>
                            <span>{order.venue || "Venue missing"}</span>
                            <small>{order.event_date || "Date missing"}</small>
                          </div>
                        </td>
                        <td>
                          <span className="mono-text">
                            {order.booking_ref || "No ref"}
                          </span>
                        </td>
                        <td>
                          <div className="seat-stack">
                            <strong>{order.section || "Section -"}</strong>
                            <span>
                              {formatSeatLabel(
                                order.row,
                                order.seat_from,
                                order.seat_to,
                              )}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className="truncate-text"
                            title={order.account_email || ""}
                          >
                            {order.account_email || "No account"}
                          </span>
                        </td>
                        <td>{formatBoughtAt(order.purchased_at)}</td>
                        <td>{formatCurrency(order.total_cost)}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <select
                            className="field field-compact"
                            value={order.listing_status ?? "Unlisted"}
                            onChange={(e) =>
                              void saveQuickField(
                                order,
                                "listing_status",
                                e.target.value,
                              )
                            }
                          >
                            {quickStatusOptions.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            className="field field-compact"
                            type="number"
                            step="0.01"
                            value={order.sold_total ?? ""}
                            onChange={(e) =>
                              updateOrder(order.id, "sold_total", e.target.value)
                            }
                            onBlur={(e) =>
                              void saveQuickField(
                                order,
                                "sold_total",
                                e.target.value,
                              )
                            }
                          />
                        </td>
                        <td className={profit != null && profit > 0 ? "value-up" : ""}>
                          {profit == null ? "—" : formatCurrency(profit)}
                        </td>
                        <td className={roi != null && roi > 0 ? "value-up" : ""}>
                          {roi == null ? "—" : `${roi.toFixed(1)}%`}
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

      <aside className={`details-drawer${selectedOrder ? " details-drawer-open" : ""}`}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Ticket detail</p>
            <h4>{selectedOrder?.event_name || "Select a ticket"}</h4>
          </div>
          <button
            className="drawer-close"
            type="button"
            onClick={() => setSelectedOrderId(null)}
          >
            ×
          </button>
        </div>

        {selectedOrder ? (
          <div className="drawer-content">
            <section className="drawer-hero">
              <div className="drawer-hero-copy">
                <strong>{selectedOrder.event_name || "Untitled ticket"}</strong>
                <span>{selectedOrder.venue || "Venue missing"}</span>
                <small>{selectedOrder.event_date || "Date missing"}</small>
              </div>
              <div className="drawer-hero-meta">
                <span className={`status-badge status-static ${getStatusTone(selectedOrder.listing_status)}`}>
                  {selectedOrder.listing_status || "Unlisted"}
                </span>
                <strong className={`drawer-profit ${getDeltaTone((selectedOrder.sold_total ?? 0) - (selectedOrder.total_cost ?? 0))}`}>
                  {renderDeltaValue((selectedOrder.sold_total ?? 0) - (selectedOrder.total_cost ?? 0), true)}
                </strong>
              </div>
            </section>
            <div className="drawer-grid">
              <label>
                <span>Booking ref</span>
                <input
                  className="field"
                  value={selectedOrder.booking_ref ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "booking_ref", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Event</span>
                <input
                  className="field"
                  value={selectedOrder.event_name ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "event_name", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Venue</span>
                <input
                  className="field"
                  value={selectedOrder.venue ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "venue", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Event date</span>
                <input
                  className="field"
                  value={selectedOrder.event_date ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "event_date", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Account</span>
                <input
                  className="field"
                  value={selectedOrder.account_email ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "account_email", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Source</span>
                <input
                  className="field"
                  value={selectedOrder.source_type ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "source_type", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Section</span>
                <input
                  className="field"
                  value={selectedOrder.section ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "section", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Row</span>
                <input
                  className="field"
                  value={selectedOrder.row ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "row", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Seat from</span>
                <input
                  className="field"
                  value={selectedOrder.seat_from ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "seat_from", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Seat to</span>
                <input
                  className="field"
                  value={selectedOrder.seat_to ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "seat_to", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Quantity</span>
                <input
                  className="field"
                  type="number"
                  value={selectedOrder.qty_bought ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "qty_bought", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Buy cost</span>
                <input
                  className="field"
                  type="number"
                  step="0.01"
                  value={selectedOrder.total_cost ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "total_cost", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Total sales</span>
                <input
                  className="field"
                  type="number"
                  step="0.01"
                  value={selectedOrder.sold_total ?? ""}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "sold_total", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Status</span>
                <select
                  className="field"
                  value={selectedOrder.listing_status ?? "Unlisted"}
                  onChange={(e) =>
                    updateOrder(
                      selectedOrder.id,
                      "listing_status",
                      e.target.value,
                    )
                  }
                >
                  {quickStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="drawer-summary">
              <div>
                <span>Purchased</span>
                <strong>{formatBoughtAt(selectedOrder.purchased_at) || "—"}</strong>
              </div>
              <div>
                <span>Profit</span>
                <strong>
                  {formatCurrency(
                    (selectedOrder.sold_total ?? 0) - (selectedOrder.total_cost ?? 0),
                  )}
                </strong>
              </div>
            </div>

            <div className="drawer-actions">
              <button
                className="danger-button"
                type="button"
                onClick={() => void deleteOrder(selectedOrder.id)}
              >
                Delete
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void saveOrder(selectedOrder)}
              >
                Save Row
              </button>
            </div>
          </div>
        ) : (
          <div className="drawer-empty">
            <div className="state-orb state-orb-muted" />
            <span className="drawer-empty-label">No order selected</span>
            <h5>Open any row to edit it</h5>
            <p>
              Review editable fields, seat data, cost structure, and status from
              a focused side panel.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function formatCurrency(value: number | null) {
  if (value == null) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSeatLabel(
  row: string | null,
  seatFrom: string | null,
  seatTo: string | null,
) {
  const rowLabel = row ? `Row ${row}` : "Row —";

  if (seatFrom && seatTo) {
    return `${rowLabel} • Seats ${seatFrom}–${seatTo}`;
  }

  if (seatFrom) {
    return `${rowLabel} • Seat ${seatFrom}`;
  }

  return rowLabel;
}

function formatBoughtAt(value: string | null) {
  if (!value) {
    return "—";
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (isoMatch) {
    const [, year, month, day, hours, minutes] = isoMatch;
    return `${Number(day)}/${Number(month)}/${year} ${hours}:${minutes}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const day = parsed.getUTCDate();
  const month = parsed.getUTCMonth() + 1;
  const year = parsed.getUTCFullYear();
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}





function getStatusTone(status: string | null) {
  switch (status) {
    case "Listed":
      return "status-listed";
    case "Sold":
      return "status-sold";
    case "Problem / Missing":
      return "status-problem";
    default:
      return "status-unlisted";
  }
}

function getDeltaTone(value: number | null) {
  if (value == null) {
    return "delta-flat";
  }
  if (value > 0) {
    return "delta-up";
  }
  if (value < 0) {
    return "delta-down";
  }
  return "delta-flat";
}

function renderDeltaValue(value: number | null, currency: boolean) {
  if (value == null) {
    return "—";
  }

  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "•";
  const formatted = currency ? formatCurrency(Math.abs(value)) : `${Math.abs(value).toFixed(1)}%`;

  return `${arrow} ${formatted}`;
}


















