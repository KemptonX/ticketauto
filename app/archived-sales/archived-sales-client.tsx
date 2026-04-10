"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";

type Sale = {
  id: number;
  external_sale_id: string | null;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
  sold_at: string | null;
  account_email: string | null;
  qty_sold: number | null;
  sale_total: number | null;
  payout_total: number | null;
  sale_status: string | null;
  inventory_order_id: number | null;
  created_at: string | null;
};

type MatchedOrder = {
  id: number;
  total_cost: number | null;
  qty_bought: number | null;
};

const navItems = [
  { label: "Tickets", href: "/orders", active: false },
  { label: "Archived Tickets", href: "/archived-orders", active: false },
  { label: "Inventory", href: "/inventory", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Archived Sales", href: "/archived-sales", active: true },
  { label: "Analytics", href: "/analytics", active: false },
];

export default function ArchivedSalesClient() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [matchedOrders, setMatchedOrders] = useState<Record<number, MatchedOrder>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

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
      .select("id, external_sale_id, event_name, venue, event_date, sold_at, account_email, qty_sold, sale_total, payout_total, sale_status, inventory_order_id, created_at")
      .eq("sale_status", "Archived")
      .order("sold_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      const nextSales = (data as Sale[]) || [];
      setSales(nextSales);

      const orderIds = nextSales
        .map((sale) => sale.inventory_order_id)
        .filter((value): value is number => value != null);

      if (orderIds.length > 0) {
        const { data: orderData, error: orderError } = await supabase
          .from("orders")
          .select("id, total_cost, qty_bought")
          .in("id", [...new Set(orderIds)]);

        if (orderError) {
          setMessage(orderError.message);
        } else {
          const orderMap = ((orderData as MatchedOrder[]) || []).reduce<Record<number, MatchedOrder>>((acc, order) => {
            acc[order.id] = order;
            return acc;
          }, {});
          setMatchedOrders(orderMap);
        }
      } else {
        setMatchedOrders({});
      }

      if (showRefreshing) {
        setMessage("Archived sales refreshed");
      }
    }

    setLoading(false);
    setRefreshing(false);
  }

  async function restoreSale(id: number) {
    const { error } = await supabase
      .from("sales")
      .update({ sale_status: "Sold" })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSales((current) => current.filter((sale) => sale.id !== id));
    setMessage("Sale restored");
  }

  async function deleteSale(id: number) {
    const confirmed = window.confirm("Delete this archived sale?");
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("sales").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSales((current) => current.filter((sale) => sale.id !== id));
    setMessage("Archived sale deleted");
  }

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      if (!search) {
        return true;
      }

      const needle = search.toLowerCase();
      return [sale.event_name, sale.venue, sale.account_email, sale.external_sale_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [sales, search]);

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
              <Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`}>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-settings-box">
            <p className="sidebar-settings-title">Settings</p>
            <Link href="/connections" className="sidebar-settings-link">
              Connections
            </Link>
            <button className="sidebar-settings-link sidebar-settings-button" type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Sales archive</p>
            <h2>Archived Sales</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => void loadSales(true)} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {message ? (
          <div className="feedback-banner" role="status">
            <span className="feedback-dot" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="command-bar">
          <div className="command-header">
            <div>
              <p className="section-tag">Archive</p>
              <h4>Search archived sales</h4>
            </div>
          </div>
          <div className="filter-grid">
            <label className="field-label">
              <span>Search</span>
              <input
                className="field field-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search event, venue, account, sale ID..."
              />
            </label>
          </div>
        </section>

        <section className="table-card inventory-board">
          <div className="table-card-header inventory-board-header">
            <div>
              <p className="section-tag">Archived</p>
              <h4>Stored sales</h4>
            </div>
            <span className="table-count">{filteredSales.length} archived</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading archived sales</h5>
              <p>Pulling archived rows from your sales table.</p>
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No archived sales</h5>
              <p>Archive a sale from the Sales page to move it here.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Account</th>
                    <th>Qty</th>
                    <th>Bought For</th>
                    <th>Sold For</th>
                    <th>Profit</th>
                    <th>ROI</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.map((sale) => {
                    const matchedOrder =
                      sale.inventory_order_id != null
                        ? matchedOrders[sale.inventory_order_id]
                        : undefined;
                    const boughtFor = getSaleCost(sale, matchedOrder);
                    const soldFor = sale.sale_total ?? sale.payout_total ?? null;
                    const profit =
                      sale.inventory_order_id != null && soldFor != null
                        ? soldFor - boughtFor
                        : null;
                    const roi =
                      profit != null && boughtFor > 0 ? (profit / boughtFor) * 100 : null;

                    return (
                      <tr key={sale.id}>
                        <td>
                          <div className="event-cell">
                            <strong>{sale.event_name || "Untitled sale"}</strong>
                            <span>{sale.venue || "Venue missing"}</span>
                            <small>{sale.event_date || "Date missing"}</small>
                          </div>
                        </td>
                        <td>
                          <span className="truncate-text" title={sale.account_email || ""}>
                            {sale.account_email || "No account"}
                          </span>
                        </td>
                        <td>{sale.qty_sold ?? "—"}</td>
                        <td>{formatCurrency(boughtFor)}</td>
                        <td>{formatCurrency(soldFor)}</td>
                        <td className={profit != null && profit > 0 ? "value-up" : profit != null && profit < 0 ? "value-down" : ""}>
                          {profit == null ? "—" : formatCurrency(profit)}
                        </td>
                        <td className={roi != null && roi > 0 ? "value-up" : roi != null && roi < 0 ? "value-down" : ""}>
                          {roi == null ? "—" : `${roi.toFixed(1)}%`}
                        </td>
                        <td>
                          <div className="drawer-actions">
                            <button className="secondary-button" type="button" onClick={() => void restoreSale(sale.id)}>
                              Restore
                            </button>
                            <button className="danger-button" type="button" onClick={() => void deleteSale(sale.id)}>
                              Delete
                            </button>
                          </div>
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

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
