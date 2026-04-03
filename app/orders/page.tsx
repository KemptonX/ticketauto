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

const statusOptions = ["All", "Unlisted", "Listed", "Listed/Sold", "Sold"];
const sourceOptions = [
  "All",
  "ticketmaster_direct",
  "ticketmaster_resale",
  "manual",
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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

  useEffect(() => {
    async function loadOrders() {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setMessage(error.message);
      } else {
        setOrders((data as Order[]) || []);
      }

      setLoading(false);
    }

    loadOrders();
  }, []);

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
          : order
      )
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

    setMessage(error ? error.message : `Saved ${order.booking_ref}`);
  }

  async function deleteOrder(id: number) {
    const confirmed = window.confirm("Delete this row?");
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
    setMessage("Row deleted");
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

    setOrders((current) => [data as Order, ...current]);
    setMessage("New row added");
  }

  const eventOptions = useMemo(() => {
    return ["All", ...new Set(orders.map((o) => o.event_name).filter(Boolean))];
  }, [orders]);

  const venueOptions = useMemo(() => {
    return ["All", ...new Set(orders.map((o) => o.venue).filter(Boolean))];
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
            String(value).toLowerCase().includes(search.toLowerCase())
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

  return (
    <main
      style={{
        padding: "40px",
        fontFamily: "Arial, sans-serif",
        background: "#f7f7f7",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "32px" }}>Orders</h1>
            <p style={{ marginTop: "8px", color: "#555" }}>
              Filter, edit and track ticket performance
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <button onClick={addRow} style={addButtonStyle}>
              Add Row
            </button>

            <Link
              href="/"
              style={{
                textDecoration: "none",
                color: "#111",
                fontWeight: 600,
              }}
            >
              Back Home
            </Link>
          </div>
        </div>

        {message ? (
          <div
            style={{
              marginBottom: "16px",
              background: "#fff",
              borderRadius: "10px",
              padding: "12px 16px",
            }}
          >
            {message}
          </div>
        ) : null}

        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            padding: "20px",
            marginBottom: "20px",
            boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              gap: "12px",
            }}
          >
            <h2 style={{ margin: 0 }}>Filters</h2>

            <button
              onClick={resetFilters}
              style={resetButtonStyle}
            >
              Reset Filters
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, minmax(220px, 1fr))",
              gap: "16px",
            }}
          >
            <input
              placeholder="Search anything..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />

            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              style={inputStyle}
            >
              {eventOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <select
              value={venueFilter}
              onChange={(e) => setVenueFilter(e.target.value)}
              style={inputStyle}
            >
              {venueOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={inputStyle}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              style={inputStyle}
            >
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>

            <select
              value={soldFilter}
              onChange={(e) => setSoldFilter(e.target.value)}
              style={inputStyle}
            >
              <option value="All">All</option>
              <option value="Sold">Sold</option>
              <option value="Unsold">Unsold</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p>Loading orders...</p>
        ) : (
          <div
            style={{
              background: "#fff",
              borderRadius: "16px",
              padding: "20px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
              overflowX: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "1800px",
              }}
            >
              <thead>
                <tr>
                  <th style={cellStyle}>Booking Ref</th>
                  <th style={cellStyle}>Event</th>
                  <th style={cellStyle}>Venue</th>
                  <th style={cellStyle}>Date</th>
                  <th style={cellStyle}>Bought At</th>
                  <th style={cellStyle}>Account</th>
                  <th style={cellStyle}>Section</th>
                  <th style={cellStyle}>Row</th>
                  <th style={cellStyle}>Seat From</th>
                  <th style={cellStyle}>Seat To</th>
                  <th style={cellStyle}>Qty</th>
                  <th style={cellStyle}>Cost</th>
                  <th style={cellStyle}>Status</th>
                  <th style={cellStyle}>Sold Total</th>
                  <th style={cellStyle}>Profit</th>
                  <th style={cellStyle}>ROI %</th>
                  <th style={cellStyle}>Source</th>
                  <th style={cellStyle}>Save</th>
                  <th style={cellStyle}>Delete</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const totalCost = order.total_cost ?? 0;
                  const soldTotal = order.sold_total ?? 0;
                  const profit =
                    order.sold_total != null ? soldTotal - totalCost : null;
                  const roi =
                    order.sold_total != null && totalCost > 0
                      ? (profit! / totalCost) * 100
                      : null;

                  return (
                    <tr key={order.id}>
                      <td style={cellStyle}>
                        <input
                          value={order.booking_ref ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "booking_ref", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.event_name ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "event_name", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.venue ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "venue", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.event_date ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "event_date", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        {formatBoughtAt(order.purchased_at)}
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.account_email ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "account_email", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.section ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "section", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.row ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "row", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.seat_from ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "seat_from", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.seat_to ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "seat_to", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="number"
                          value={order.qty_bought ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "qty_bought", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="number"
                          step="0.01"
                          value={order.total_cost ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "total_cost", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <select
                          value={order.listing_status ?? "Unlisted"}
                          onChange={(e) =>
                            updateOrder(order.id, "listing_status", e.target.value)
                          }
                          style={inputStyle}
                        >
                          {statusOptions
                            .filter((s) => s !== "All")
                            .map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="number"
                          step="0.01"
                          value={order.sold_total ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "sold_total", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        {profit == null ? "" : `£${profit.toFixed(2)}`}
                      </td>
                      <td style={cellStyle}>
                        {roi == null ? "" : `${roi.toFixed(1)}%`}
                      </td>
                      <td style={cellStyle}>
                        <input
                          value={order.source_type ?? ""}
                          onChange={(e) =>
                            updateOrder(order.id, "source_type", e.target.value)
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={cellStyle}>
                        <button
                          onClick={() => saveOrder(order)}
                          style={buttonStyle}
                        >
                          Save
                        </button>
                      </td>
                      <td style={cellStyle}>
                        <button
                          onClick={() => deleteOrder(order.id)}
                          style={deleteButtonStyle}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

const cellStyle = {
  borderBottom: "1px solid #eee",
  padding: "12px",
  textAlign: "left" as const,
  verticalAlign: "top" as const,
};

const inputStyle = {
  width: "100%",
  minWidth: "180px",
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "15px",
  boxSizing: "border-box" as const,
};

const buttonStyle = {
  border: "none",
  borderRadius: "8px",
  background: "#111827",
  color: "#fff",
  padding: "10px 14px",
  cursor: "pointer",
};

const deleteButtonStyle = {
  border: "none",
  borderRadius: "8px",
  background: "#dc2626",
  color: "#fff",
  padding: "10px 14px",
  cursor: "pointer",
};

const addButtonStyle = {
  border: "none",
  borderRadius: "8px",
  background: "#2563eb",
  color: "#fff",
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 600,
};

const resetButtonStyle = {
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  background: "#fff",
  color: "#111827",
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 600,
};

function formatBoughtAt(value: string | null) {
  if (!value) {
    return "";
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (isoMatch) {
    const [, year, month, day, hours, minutes] = isoMatch;
    return `${Number(month)}/${Number(day)}/${year} ${hours}:${minutes}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const year = parsed.getUTCFullYear();
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");

  return `${month}/${day}/${year} ${hours}:${minutes}`;
}
