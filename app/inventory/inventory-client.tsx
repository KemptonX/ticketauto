"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { autoArchiveExpiredOrders } from "@/src/lib/archive-rules";
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

type ArchivedSaleSummary = {
  inventory_order_id: number | null;
  qty_sold: number | null;
};

type InventoryGroup = {
  key: string;
  eventName: string;
  venue: string;
  eventDate: string;
  dateValue: Date | null;
  orders: Order[];
  totalTickets: number;
  unsoldTickets: number;
  totalValue: number;
  soldCount: number;
  listedCount: number;
  unlistedCount: number;
  problemCount: number;
  accounts: string[];
  isRisk: boolean;
};

const navItems = [
  { label: "Dashboard", href: "/orders", active: false },
  { label: "Inventory", href: "/inventory", active: true },
  { label: "Sales", href: "/sales", active: false },
  { label: "Archived Sales", href: "/archived-sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
];

const statusFilterOptions = ["All", "Unlisted", "Listed", "Sold", "Problem / Missing"];
const dateFilterOptions = ["All", "This week", "This month"];

export default function InventoryClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [archivedSalesByOrder, setArchivedSalesByOrder] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [artistFilter, setArtistFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [accountFilter, setAccountFilter] = useState("All");
  const [sortByDate, setSortByDate] = useState<"closest" | "latest">("closest");
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await autoArchiveExpiredOrders({
        supabase,
        userId: user.id,
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .neq("listing_status", "Archived")
      .order("event_date", { ascending: true });

    if (error) {
      setMessage(error.message);
    } else {
      setOrders((data as Order[]) || []);

      const { data: archivedSales, error: archivedSalesError } = await supabase
        .from("sales")
        .select("inventory_order_id, qty_sold")
        .eq("sale_status", "Archived");

      if (archivedSalesError) {
        setMessage(archivedSalesError.message);
      } else {
        const archivedMap = ((archivedSales as ArchivedSaleSummary[]) || []).reduce<Record<number, number>>(
          (acc, sale) => {
            if (sale.inventory_order_id == null) {
              return acc;
            }

            acc[sale.inventory_order_id] =
              (acc[sale.inventory_order_id] ?? 0) + (sale.qty_sold ?? 1);
            return acc;
          },
          {},
        );

        setArchivedSalesByOrder(archivedMap);
      }

      if (showRefreshing) {
        setMessage("Inventory refreshed");
      }
    }

    setLoading(false);
    setRefreshing(false);
  }

  function toggleGroup(key: string) {
    setExpandedGroups((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
  }

  function resetFilters() {
    setSearch("");
    setStatusFilter("All");
    setDateFilter("All");
    setMonthFilter("All");
    setAccountFilter("All");
    setSortByDate("closest");
  }

  const artistOptions = useMemo(() => {
    const values = orders
      .map((order) => order.event_name)
      .filter((value): value is string => Boolean(value));
    return ["All", ...new Set(values)];
  }, [orders]);

  const monthOptions = useMemo(() => {
    const values = orders
      .map((order) => getMonthLabel(parseEventDate(order.event_date)))
      .filter((value): value is string => Boolean(value));
    return ["All", ...new Set(values)];
  }, [orders]);

  const accountOptions = useMemo(() => {
    const values = orders
      .map((order) => order.account_email)
      .filter((value): value is string => Boolean(value));
    return ["All", ...new Set(values)];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const remainingQty = getRemainingInventoryQuantity(
        order,
        archivedSalesByOrder[order.id] ?? 0,
      );

      if (remainingQty <= 0) {
        return false;
      }

      const status = normalizeStatus(order.listing_status);
      const eventDate = parseEventDate(order.event_date);
      const daysAway = getDaysAway(eventDate);
      const matchesSearch =
        search === "" ||
        [order.event_name, order.venue, order.account_email, order.booking_ref]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search.toLowerCase()));

      const monthLabel = getMonthLabel(eventDate);
      const matchesArtist = artistFilter === "All" || order.event_name === artistFilter;
      const matchesStatus = statusFilter === "All" || status === statusFilter;

      const matchesDate =
        dateFilter === "All" ||
        (dateFilter === "This week" && daysAway != null && daysAway >= 0 && daysAway <= 7) ||
        (dateFilter === "Upcoming" && daysAway != null && daysAway > 7);

      const matchesAccount =
        accountFilter === "All" || order.account_email === accountFilter;

      return matchesSearch && matchesStatus && matchesDate && matchesAccount;
    });
  }, [orders, archivedSalesByOrder, search, artistFilter, statusFilter, dateFilter, monthFilter, accountFilter]);

  const groupedInventory = useMemo(() => {
    const map = new Map<string, InventoryGroup>();

    for (const order of filteredOrders) {
      const eventName = order.event_name || "Untitled event";
      const venue = order.venue || "Venue missing";
      const eventDate = order.event_date || "Date missing";
      const dateValue = parseEventDate(order.event_date);
      const key = `${eventName}__${venue}__${eventDate}`;
      const quantity = getRemainingInventoryQuantity(
        order,
        archivedSalesByOrder[order.id] ?? 0,
      );
      const status = normalizeStatus(order.listing_status);
      const isSold = status === "Sold";
      const unsoldTickets = isSold ? 0 : quantity;
      const value = isSold ? 0 : order.total_cost ?? 0;

      if (!map.has(key)) {
        map.set(key, {
          key,
          eventName,
          venue,
          eventDate,
          dateValue,
          orders: [],
          totalTickets: 0,
          unsoldTickets: 0,
          totalValue: 0,
          soldCount: 0,
          listedCount: 0,
          unlistedCount: 0,
          problemCount: 0,
          accounts: [],
          isRisk: false,
        });
      }

      const group = map.get(key)!;
      group.orders.push(order);
      group.totalTickets += quantity;
      group.unsoldTickets += unsoldTickets;
      group.totalValue += value;
      if (!group.accounts.includes(order.account_email || "No account")) {
        group.accounts.push(order.account_email || "No account");
      }

      if (status === "Sold") {
        group.soldCount += quantity;
      } else if (status === "Listed") {
        group.listedCount += quantity;
      } else if (status === "Problem / Missing") {
        group.problemCount += quantity;
      } else {
        group.unlistedCount += quantity;
      }

      const daysAway = getDaysAway(dateValue);
      if (group.unsoldTickets > 0 && daysAway != null && daysAway >= 0 && daysAway <= 7) {
        group.isRisk = true;
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.dateValue && b.dateValue) {
        return sortByDate === "closest"
          ? a.dateValue.getTime() - b.dateValue.getTime()
          : b.dateValue.getTime() - a.dateValue.getTime();
      }
      if (a.dateValue) {
        return sortByDate === "closest" ? -1 : 1;
      }
      if (b.dateValue) {
        return sortByDate === "closest" ? 1 : -1;
      }
      if (a.isRisk !== b.isRisk) {
        return a.isRisk ? -1 : 1;
      }
      return a.eventName.localeCompare(b.eventName);
    });
  }, [filteredOrders, archivedSalesByOrder, sortByDate]);

  const metrics = useMemo(() => {
    const ticketsRemaining = groupedInventory.reduce((sum, group) => sum + group.unsoldTickets, 0);
    const inventoryValue = groupedInventory.reduce((sum, group) => sum + group.totalValue, 0);
    const activeEvents = groupedInventory.length;
    const upcomingRisk = groupedInventory.reduce((sum, group) => sum + (group.isRisk ? group.unsoldTickets : 0), 0);

    return [
      {
        label: "Stock Left",
        value: String(ticketsRemaining),
        detail: ticketsRemaining > 0 ? "Unsold across inventory" : "No open stock",
      },
      {
        label: "Stock Value",
        value: formatCurrency(inventoryValue),
        detail: inventoryValue > 0 ? "Cost tied up in stock" : "No capital tied up",
      },
      {
        label: "Active Events",
        value: String(activeEvents),
        detail: activeEvents > 0 ? "Grouped event lines" : "No active events",
      },
      {
        label: "Upcoming Risk",
        value: String(upcomingRisk),
        detail: upcomingRisk > 0 ? "Unsold tickets inside 7 days" : "No near-term risk",
      },
    ];
  }, [groupedInventory]);

  return (
    <div className="orders-shell inventory-shell">
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
          <p className="sidebar-panel-label">Inventory</p>
          <strong>Stock visibility</strong>
          <span>Group live tickets by event, risk, and value.</span>
          <Link href="/connections" className="sidebar-panel-link">
            Open connections
          </Link>
        </div>
      </aside>

      <main className="orders-main inventory-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Stock desk</p>
            <h2>Inventory</h2>
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

        <section className="hero-card inventory-hero-card">
          <div>
            <p className="section-tag">Inventory</p>
            <h3>See open stock by event, value, and risk.</h3>
          </div>
          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Events</span>
              <strong>{groupedInventory.length}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Stock Left</span>
              <strong>{metrics[0].value}</strong>
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
            <article key={metric.label} className={`kpi-card${metric.label === "Upcoming Risk" && metric.value !== "0" ? " inventory-risk-kpi" : ""}`}>
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
              <h4>Scan stock in seconds</h4>
            </div>
            <button className="ghost-button" onClick={resetFilters} type="button">
              Reset Filters
            </button>
          </div>

          <div className="inventory-filter-grid">
            <label className="filter-field inventory-filter-wide">
              <span className="filter-label">Search</span>
              <input
                className="field field-search"
                placeholder="Search event, venue, account, ref..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <label className="filter-field">
              <span className="filter-label">Artist</span>
              <select className="field" value={artistFilter} onChange={(event) => setArtistFilter(event.target.value)}>
                {artistOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Status</span>
              <select className="field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statusFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Event Date</span>
              <select className="field" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                {dateFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Month</span>
              <select className="field" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
                {monthOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Account</span>
              <select className="field" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
                {accountOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Sort By</span>
              <select className="field" value={sortByDate} onChange={(event) => setSortByDate(event.target.value as "closest" | "latest")}>
                <option value="closest">Event Date: Closest to Latest</option>
                <option value="latest">Event Date: Latest to Closest</option>
              </select>
            </label>
          </div>
        </section>

        <section className="table-card inventory-board">
          <div className="table-card-header inventory-board-header">
            <div>
              <p className="section-tag">Tickets</p>
              <h4>Holdings by event</h4>
            </div>
            <span className="table-count">{groupedInventory.length} event groups</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading inventory</h5>
              <p>Grouping ticket stock by event and value.</p>
            </div>
          ) : groupedInventory.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No stock in this view</h5>
              <p>Reset filters or add ticket rows to build inventory.</p>
            </div>
          ) : (
            <div className="inventory-group-list">
              {groupedInventory.map((group) => {
                const expanded = expandedGroups.includes(group.key);
                const soldRatio = group.totalTickets > 0 ? (group.soldCount / group.totalTickets) * 100 : 0;

                return (
                  <article
                    key={group.key}
                    className={`inventory-group-card${group.isRisk ? " inventory-group-risk" : ""}${expanded ? " inventory-group-open" : ""}`}
                  >
                    <button
                      className="inventory-group-toggle"
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                    >
                      <div className="inventory-group-main">
                        <div className="inventory-group-title">
                          <strong>{group.eventName}</strong>
                          <span>{group.venue}</span>
                          <small>{formatEventDate(group.eventDate)}</small>
                        </div>

                        <div className="inventory-group-metrics">
                          <div className="inventory-metric-chip">
                            <span>Held</span>
                            <strong>{group.unsoldTickets}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Stock Value</span>
                            <strong>{formatCurrency(group.totalValue)}</strong>
                          </div>
                          <div className="inventory-status-row">
                            <span className="status-badge status-static status-unlisted">Unlisted {group.unlistedCount}</span>
                            <span className="status-badge status-static status-listed">Listed {group.listedCount}</span>
                            <span className="status-badge status-static status-sold">Sold {group.soldCount}</span>
                          </div>
                        </div>
                      </div>

                      <div className="inventory-group-side">
                        {group.isRisk ? <span className="inventory-risk-badge">Risk in 7 days</span> : null}
                        <div className="inventory-progress-block">
                          <span>{group.soldCount}/{group.totalTickets} sold</span>
                          <div className="inventory-progress-track">
                            <div
                              className="inventory-progress-fill"
                              style={{ width: `${Math.max(soldRatio, 6)}%` }}
                            />
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
                          <span>Cost</span>
                          <span>Status</span>
                        </div>
                        {group.orders.map((order) => (
                          <div key={order.id} className="inventory-ticket-row">
                            <div className="inventory-ticket-seat">
                              <strong>{order.section || "Section —"}</strong>
                              <span>{formatSeatLabel(order.row, order.seat_from, order.seat_to)}</span>
                            </div>
                            <span className="truncate-text" title={order.account_email || ""}>
                              {order.account_email || "No account"}
                            </span>
                            <strong className="inventory-cost-value">{formatCurrency(order.total_cost)}</strong>
                            <span className={`status-badge status-static ${getStatusTone(order.listing_status)}`}>
                              {normalizeStatus(order.listing_status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
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

function getStatusTone(status: string | null) {
  switch (normalizeStatus(status)) {
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

function getTicketQuantity(order: Order) {
  if (order.qty_bought && order.qty_bought > 0) {
    return order.qty_bought;
  }
  return 1;
}

function getRemainingInventoryQuantity(order: Order, archivedQty: number) {
  return Math.max(0, getTicketQuantity(order) - archivedQty);
}

function parseEventDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!match) {
    return null;
  }

  const [, day, monthName, year] = match;
  const monthIndex = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(monthName.slice(0, 3).toLowerCase());
  if (monthIndex === -1) {
    return null;
  }

  return new Date(Number(year), monthIndex, Number(day));
}

function isThisMonth(date: Date) {
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function getMonthLabel(date: Date | null) {
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function getDaysAway(date: Date | null) {
  if (!date) {
    return null;
  }
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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

function formatEventDate(value: string) {
  const date = parseEventDate(value);
  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}












