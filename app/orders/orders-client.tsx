"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { formatCurrency } from "@/src/lib/currency";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

type SyncLogEntry = {
  id: number;
  scan_type: string;
  scanned: number;
  inserted: number;
  updated: number | null;
  error: string | null;
  created_at: string;
};

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
  email_html: string | null;
};


const statusOptions = ["All", "Unlisted", "Listed", "Partially Sold", "Sold", "Problem / Missing"];
const quickStatusOptions = ["Unlisted", "Listed", "Partially Sold", "Sold", "Problem / Missing"];
const sourceOptions = [
  "All",
  "ticketmaster_direct",
  "ticketmaster_resale",
  "ticketmaster_us",
  "ticketmaster_de",
  "ticketmaster_es",
  "ticketmaster_it",
  "axs",
  "manual",
];

type OrderGroup = {
  key: string;
  eventName: string;
  venue: string;
  eventDate: string;
  dateValue: Date | null;
  orders: Order[];
  totalQty: number;
  totalCost: number;
  totalEffectiveCost: number;
  totalSold: number;
  soldCount: number;
  partiallySoldCount: number;
  listedCount: number;
  unlistedCount: number;
  problemCount: number;
  hasNew: boolean;
};

const sourceLabels: Record<string, string> = {
  All: "All",
  ticketmaster_direct: "TM Direct",
  ticketmaster_resale: "TM Resale",
  ticketmaster_us: "TM US",
  ticketmaster_de: "TM DE",
  ticketmaster_es: "TM ES",
  ticketmaster_it: "TM IT",
  ticketmaster_fr: "TM FR",
  ticketmaster_nl: "TM NL",
  ticketmaster_au: "TM AU",
  ticketmaster_ca: "TM CA",
  axs: "AXS",
  manual: "Manual",
};

const sourceTypeOptions = [
  { value: "manual", label: "Manual" },
  { value: "ticketmaster_direct", label: "TM Direct" },
  { value: "ticketmaster_resale", label: "TM Resale" },
  { value: "ticketmaster_us", label: "TM US" },
  { value: "ticketmaster_de", label: "TM DE" },
  { value: "ticketmaster_es", label: "TM ES" },
  { value: "ticketmaster_it", label: "TM IT" },
  { value: "ticketmaster_fr", label: "TM FR" },
  { value: "ticketmaster_nl", label: "TM NL" },
  { value: "ticketmaster_au", label: "TM AU" },
  { value: "ticketmaster_ca", label: "TM CA" },
  { value: "axs", label: "AXS" },
];

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

type NewTicketForm = {
  event_name: string;
  venue: string;
  event_date: string;
  booking_ref: string;
  account_email: string;
  section: string;
  row: string;
  seat_from: string;
  seat_to: string;
  qty_bought: number;
  total_cost: string;
  listing_status: string;
  source_type: string;
};

const defaultNewTicket: NewTicketForm = {
  event_name: "",
  venue: "",
  event_date: "",
  booking_ref: "",
  account_email: "",
  section: "",
  row: "",
  seat_from: "",
  seat_to: "",
  qty_bought: 2,
  total_cost: "",
  listing_status: "Unlisted",
  source_type: "manual",
};

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: true },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

function computeGroupId(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h = h >>> 0;
  }
  return String(h % 100000).padStart(5, "0");
}

export default function OrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [soldQtyByOrderId, setSoldQtyByOrderId] = useState<Map<number, number>>(new Map());
  const [accounts, setAccounts] = useState<string[]>([]);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submittingNew, setSubmittingNew] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountInput, setNewAccountInput] = useState("");
  const [newTicket, setNewTicket] = useState<NewTicketForm>(defaultNewTicket);

  const [viewMode, setViewMode] = useState<"active" | "archived" | "ignored" | "personal">("active");
  const [sortBy, setSortBy] = useState<"event-date" | "added-newest" | "added-oldest">("event-date");
  const [privacyMode, setPrivacyMode] = useState(false);

  const [search, setSearch] = useState("");
  const [eventFilters, setEventFilters] = useState<string[]>([]);
  const [venueFilters, setVenueFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [sourceFilters, setSourceFilters] = useState<string[]>([]);
  const [soldFilters, setSoldFilters] = useState<string[]>([]);
  const [emailFilters, setEmailFilters] = useState<string[]>([]);

  function resetFilters() {
    setSearch("");
    setEventFilters([]);
    setVenueFilters([]);
    setStatusFilters([]);
    setSourceFilters([]);
    setSoldFilters([]);
    setEmailFilters([]);
  }

  async function loadOrders(showRefreshing = false, mode = viewMode) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const query = supabase.from("orders").select("*").order("created_at", { ascending: false });
    const { data, error } = await (
      mode === "archived"
        ? query.eq("listing_status", "Archived")
        : mode === "ignored"
          ? query.eq("listing_status", "Ignored")
          : mode === "personal"
            ? query.eq("listing_status", "Personal")
            : query.or("listing_status.is.null,listing_status.not.in.(Archived,Ignored,Personal)")
    );

    // Fetch matched sales to get actual qty_sold per order
    const { data: salesData } = await supabase
      .from("sales")
      .select("inventory_order_id, qty_sold")
      .not("inventory_order_id", "is", null);
    const qtyMap = new Map<number, number>();
    for (const s of (salesData ?? []) as { inventory_order_id: number; qty_sold: number | null }[]) {
      qtyMap.set(s.inventory_order_id, (qtyMap.get(s.inventory_order_id) ?? 0) + (s.qty_sold ?? 0));
    }
    setSoldQtyByOrderId(qtyMap);

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

  async function exportOrdersCSV() {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .not("listing_status", "in", '("Ignored","Personal")')
      .order("created_at", { ascending: false });
    if (error || !data) { setMessage("Export failed"); return; }
    const headers = ["Booking Ref", "Event", "Venue", "Event Date", "Purchased At", "Account", "Section", "Row", "Seat From", "Seat To", "Qty", "Cost", "Sold Total", "Status", "Source"];
    const rows = (data as typeof orders).map((o) => [
      o.booking_ref ?? "",
      o.event_name ?? "",
      o.venue ?? "",
      o.event_date ?? "",
      o.purchased_at ?? "",
      o.account_email ?? "",
      o.section ?? "",
      o.row ?? "",
      o.seat_from ?? "",
      o.seat_to ?? "",
      o.qty_bought ?? "",
      o.total_cost ?? "",
      o.sold_total ?? "",
      o.listing_status ?? "",
      o.source_type ?? "",
    ]);
    downloadCSV(`tickets-${dateStamp()}.csv`, headers, rows);
  }

  async function scanMailNow() {
    setScanning(true);
    setMessage("");

    try {
      const response = await fetch("/api/scan-mail", { method: "POST" });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Scan failed");
        return;
      }

      await loadOrders(true);
      const inserted = Number(result.inserted ?? 0);
      const updated = Number(result.updated ?? 0);
      const insertedRefs = Array.isArray(result.insertedRefs) ? result.insertedRefs : [];
      const updatedRefs = Array.isArray(result.updatedRefs) ? result.updatedRefs : [];

      resetFilters();

      const accountResults = Array.isArray(result.accountResults) ? result.accountResults : [];
      const errors: string[] = Array.isArray(result.errors) ? result.errors : [];

      const accountLines = accountResults.length > 0
        ? accountResults
            .map((a: { email: string; inserted: number; updated: number }) =>
              `${a.email}: +${a.inserted} new, ${a.updated} updated`)
            .join(" · ")
        : `${inserted} new, ${updated} updated`;
      const errorNote = errors.length > 0 ? ` — ${errors.join("; ")}` : "";
      setMessage(`Scan complete: ${accountLines}${errorNote}`);
      void loadSyncLog();
    } catch {
      setMessage("Scan failed");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    async function init() {
      if (viewMode === "active") {
        await autoArchivePastEvents();
      }
      loadOrders(false, viewMode);
      void loadAccounts();
      void loadSyncLog();
    }
    void init();
  }, [viewMode]);

  async function autoArchivePastEvents() {
    const { data } = await supabase
      .from("orders")
      .select("id, event_date, listing_status")
      .neq("listing_status", "Archived")
      .neq("listing_status", "Ignored")
      .neq("listing_status", "Personal");

    if (!data) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const toArchive = (data as { id: number; event_date: string | null; listing_status: string | null }[])
      .filter((o) => {
        if (!o.event_date) return false;
        const d = parseAnyDate(o.event_date);
        return d !== null && d < today;
      })
      .map((o) => o.id);

    if (toArchive.length === 0) return;

    await supabase
      .from("orders")
      .update({ listing_status: "Archived" })
      .in("id", toArchive);
  }

  function parseAnyDate(value: string): Date | null {
    const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

    // ISO: 2025-04-14
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, m, d] = value.slice(0, 10).split("-").map(Number);
      return new Date(y, m - 1, d);
    }

    // Day-first: "14 April 2025" / "14 Apr 2025" (UK Ticketmaster)
    const dayFirst = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
    if (dayFirst) {
      const mi = MONTHS.indexOf(dayFirst[2].slice(0, 3).toLowerCase());
      if (mi !== -1) return new Date(Number(dayFirst[3]), mi, Number(dayFirst[1]));
    }

    // Month-first: "April 14, 2025" / "April 14 2025" (US Ticketmaster)
    const monthFirst = value.match(/([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})/);
    if (monthFirst) {
      const mi = MONTHS.indexOf(monthFirst[1].slice(0, 3).toLowerCase());
      if (mi !== -1) return new Date(Number(monthFirst[3]), mi, Number(monthFirst[2]));
    }

    // Fallback: native Date (handles many other formats)
    const native = new Date(value);
    return Number.isNaN(native.getTime()) ? null : native;
  }

  async function loadAccounts() {
    const [{ data: inboxData }, { data: orderData }] = await Promise.all([
      supabase.from("gmail_accounts").select("email").eq("is_active", true).order("is_primary", { ascending: false }),
      supabase.from("orders").select("account_email").not("account_email", "is", null),
    ]);
    const fromInboxes = (inboxData ?? []).map((a: { email: string }) => a.email);
    const fromOrders = (orderData ?? []).map((o: { account_email: string }) => o.account_email).filter(Boolean);
    const merged = Array.from(new Set([...fromInboxes, ...fromOrders])).filter(Boolean).sort();
    setAccounts(merged);
  }

  async function loadSyncLog() {
    const { data } = await supabase
      .from("sync_log")
      .select("id, scan_type, scanned, inserted, updated, error, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) {
      setSyncLog(data as SyncLogEntry[]);
    }
  }


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

    const derivedStatus =
      (order.sold_total ?? 0) > 0 && order.listing_status !== "Sold"
        ? "Sold"
        : order.listing_status;

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
        listing_status: derivedStatus,
        source_type: order.source_type,
      })
      .eq("id", order.id);

    if (!error && derivedStatus !== order.listing_status) {
      updateOrder(order.id, "listing_status", derivedStatus ?? "Unlisted");
    }

    setMessage(error ? error.message : `Saved ${order.booking_ref || "ticket"}`);
  }

  async function saveQuickField(
    order: Order,
    field: "listing_status" | "sold_total",
    value: string,
  ) {
    updateOrder(order.id, field, value);

    let payload: Record<string, string | number | null>;

    if (field === "sold_total") {
      const numeric = value === "" ? null : Number(value);
      payload = { sold_total: numeric };
      if (numeric != null && numeric > 0 && order.listing_status !== "Sold") {
        payload.listing_status = "Sold";
        updateOrder(order.id, "listing_status", "Sold");
      }
    } else {
      payload = { listing_status: value };
    }

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

  async function archiveOrder(id: number) {
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Archived" })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setOrders((current) => current.filter((o) => o.id !== id));
    setSelectedOrderId(null);
    setMessage("Ticket archived");
  }

  async function ignoreOrder(id: number) {
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Ignored" })
      .eq("id", id);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => o.id !== id));
    setSelectedOrderId(null);
    setMessage("Ticket ignored — scanner will skip this booking ref");
  }

  async function restoreOrder(id: number) {
    const order = orders.find((o) => o.id === id);
    const nextStatus = (order?.sold_total ?? 0) > 0 ? "Sold" : "Unlisted";
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: nextStatus })
      .eq("id", id);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => o.id !== id));
    setMessage("Ticket restored");
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

  function openAddForm() {
    setNewTicket(defaultNewTicket);
    setShowAddForm(true);
    setSelectedOrderId(null);
  }

  async function submitNewTicket() {
    if (!newTicket.event_name.trim()) {
      setMessage("Event name is required");
      return;
    }

    setSubmittingNew(true);
    setMessage("");

    const { data, error } = await supabase
      .from("orders")
      .insert({
        booking_ref: newTicket.booking_ref.trim() || null,
        event_name: newTicket.event_name.trim() || null,
        venue: newTicket.venue.trim() || null,
        event_date: newTicket.event_date || null,
        account_email: newTicket.account_email || null,
        section: newTicket.section.trim() || null,
        row: newTicket.row.trim() || null,
        seat_from: newTicket.seat_from.trim() || null,
        seat_to: newTicket.seat_to.trim() || null,
        qty_bought: newTicket.qty_bought > 0 ? newTicket.qty_bought : null,
        total_cost: newTicket.total_cost !== "" ? Number(newTicket.total_cost) : null,
        sold_total: null,
        listing_status: newTicket.listing_status,
        source_type: newTicket.source_type,
      })
      .select()
      .single();

    setSubmittingNew(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    const created = data as Order;
    setOrders((current) => [created, ...current]);
    setShowAddForm(false);
    setSelectedOrderId(created.id);
    setMessage("Ticket added");
  }

  const eventOptions = useMemo(() => {
    const values = orders
      .map((order) => order.event_name)
      .filter((value): value is string => Boolean(value));
    return [...new Set(values)];
  }, [orders]);

  const venueOptions = useMemo(() => {
    const values = orders
      .map((order) => order.venue)
      .filter((value): value is string => Boolean(value));
    return [...new Set(values)];
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
        eventFilters.length === 0 || eventFilters.includes(order.event_name ?? "");

      const matchesVenue =
        venueFilters.length === 0 || venueFilters.includes(order.venue ?? "");

      const matchesStatus =
        statusFilters.length === 0 || statusFilters.includes(order.listing_status ?? "");

      const matchesSource =
        sourceFilters.length === 0 || sourceFilters.includes(order.source_type ?? "");

      const matchesSold =
        soldFilters.length === 0 ||
        (soldFilters.includes("Sold") && order.listing_status === "Sold") ||
        (soldFilters.includes("Unsold") && order.listing_status !== "Sold");

      const matchesEmail =
        emailFilters.length === 0 || emailFilters.includes(order.account_email ?? "");

      return (
        matchesSearch &&
        matchesEvent &&
        matchesVenue &&
        matchesStatus &&
        matchesSource &&
        matchesSold &&
        matchesEmail
      );
    });
  }, [
    orders,
    search,
    eventFilters,
    venueFilters,
    statusFilters,
    sourceFilters,
    soldFilters,
    emailFilters,
  ]);

  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("Listed");
  const [merging, setMerging] = useState(false);
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectGroup(ids: number[]) {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectAll() {
    setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const confirmed = window.confirm(`Delete ${ids.length} ticket${ids.length !== 1 ? "s" : ""}? This cannot be undone.`);
    if (!confirmed) return;
    const { error } = await supabase.from("orders").delete().in("id", ids);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => !selectedIds.has(o.id)));
    clearSelection();
    setMessage(`${ids.length} ticket${ids.length !== 1 ? "s" : ""} deleted`);
  }

  async function bulkArchive() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Archived" })
      .in("id", ids);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => !selectedIds.has(o.id)));
    clearSelection();
    setMessage(`${ids.length} ticket${ids.length !== 1 ? "s" : ""} archived`);
  }

  async function markPersonal(id: number) {
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Personal" })
      .eq("id", id);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => o.id !== id));
    setSelectedOrderId(null);
    setMessage("Ticket marked personal — excluded from all business stats");
  }

  async function bulkMarkPersonal() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Personal" })
      .in("id", ids);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => !selectedIds.has(o.id)));
    clearSelection();
    setMessage(`${ids.length} ticket${ids.length !== 1 ? "s" : ""} marked personal`);
  }

  async function bulkIgnore() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Ignored" })
      .in("id", ids);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => !selectedIds.has(o.id)));
    clearSelection();
    setMessage(`${ids.length} ticket${ids.length !== 1 ? "s" : ""} ignored`);
  }

  async function bulkRestore() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: "Unlisted" })
      .in("id", ids);
    if (error) { setMessage(error.message); return; }
    setOrders((current) => current.filter((o) => !selectedIds.has(o.id)));
    clearSelection();
    setMessage(`${ids.length} ticket${ids.length !== 1 ? "s" : ""} restored`);
  }

  async function bulkSetStatus(status: string) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ listing_status: status })
      .in("id", ids);
    if (error) { setMessage(error.message); return; }
    setOrders((current) =>
      current.map((o) => selectedIds.has(o.id) ? { ...o, listing_status: status } : o),
    );
    clearSelection();
    setMessage(`${ids.length} ticket${ids.length !== 1 ? "s" : ""} set to ${status}`);
  }

  async function bulkMerge() {
    const groupsWithSelection = groupedOrders.filter((g) =>
      g.orders.some((o) => selectedIds.has(o.id)),
    );
    if (groupsWithSelection.length < 2) return;

    const primary = groupsWithSelection[0];
    const secondaries = groupsWithSelection.slice(1);
    const idsToUpdate = secondaries.flatMap((g) => g.orders.map((o) => o.id));

    setMerging(true);
    const { error } = await supabase
      .from("orders")
      .update({
        event_name: primary.eventName,
        venue: primary.venue,
        event_date: primary.eventDate,
      })
      .in("id", idsToUpdate);

    if (error) {
      setMessage(error.message);
      setMerging(false);
      return;
    }

    setOrders((current) =>
      current.map((o) =>
        idsToUpdate.includes(o.id)
          ? { ...o, event_name: primary.eventName, venue: primary.venue, event_date: primary.eventDate }
          : o,
      ),
    );
    clearSelection();
    setMerging(false);
    setMessage(`Merged ${secondaries.length} group${secondaries.length !== 1 ? "s" : ""} into "${primary.eventName}"`);
  }

  function toggleGroup(key: string) {
    setExpandedGroups((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  const groupedOrders = useMemo(() => {
    const map = new Map<string, OrderGroup & { latestAddedAt: number }>();

    for (const order of filteredOrders) {
      const eventName = order.event_name || "Untitled ticket";
      const venue = order.venue || "Venue missing";
      const eventDate = order.event_date || "Date missing";
      const key = `${eventName}__${venue}__${eventDate}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          eventName,
          venue,
          eventDate,
          dateValue: parseOrderDate(order.event_date),
          orders: [],
          totalQty: 0,
          totalCost: 0,
          totalEffectiveCost: 0,
          totalSold: 0,
          soldCount: 0,
          partiallySoldCount: 0,
          listedCount: 0,
          unlistedCount: 0,
          problemCount: 0,
          hasNew: false,
          latestAddedAt: 0,
        });
      }

      const group = map.get(key)!;
      group.orders.push(order);
      group.totalQty += order.qty_bought ?? 0;
      group.totalCost += order.total_cost ?? 0;
      group.totalSold += order.sold_total ?? 0;
      if (order.sold_total != null) {
        const qtySold = soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0);
        group.totalEffectiveCost += getProportionalCost(order.total_cost, order.qty_bought, qtySold, order.listing_status);
      }

      const addedAt = order.created_at ? new Date(order.created_at).getTime() : 0;
      if (addedAt > group.latestAddedAt) group.latestAddedAt = addedAt;
      if (addedAt > Date.now() - 86400000) group.hasNew = true;

      const status = order.listing_status;
      const qty = order.qty_bought ?? 0;
      const actualSold = soldQtyByOrderId.get(order.id) ?? qty;
      if (status === "Sold") group.soldCount += actualSold;
      else if (status === "Partially Sold") {
        group.soldCount += actualSold;
        group.partiallySoldCount += 1;
        const remaining = qty - actualSold;
        if (remaining > 0) group.listedCount += remaining;
      }
      else if (status === "Archived") {
        const archivedSold = soldQtyByOrderId.get(order.id) ?? ((order.sold_total ?? 0) > 0 ? qty : 0);
        if (archivedSold > 0) group.soldCount += archivedSold;
        const remaining = qty - archivedSold;
        if (remaining > 0) group.unlistedCount += remaining;
      }
      else if (status === "Listed") group.listedCount += qty;
      else if (status === "Problem / Missing") group.problemCount += qty;
      else group.unlistedCount += qty;
    }

    return Array.from(map.values()).sort((a, b) => {
      if (sortBy === "added-newest") return b.latestAddedAt - a.latestAddedAt;
      if (sortBy === "added-oldest") return a.latestAddedAt - b.latestAddedAt;
      if (a.dateValue && b.dateValue) return a.dateValue.getTime() - b.dateValue.getTime();
      if (a.dateValue) return -1;
      if (b.dateValue) return 1;
      return a.eventName.localeCompare(b.eventName);
    });
  }, [filteredOrders, sortBy, soldQtyByOrderId]);

  const selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ?? null;

  const metrics = useMemo(() => {
    const availableCount = filteredOrders.filter(
      (o) => o.listing_status !== "Sold",
    ).length;
    const soldCount = filteredOrders.filter(
      (o) => o.listing_status === "Sold",
    ).length;
    const totalCost = filteredOrders.reduce(
      (sum, order) => sum + (order.total_cost ?? 0),
      0,
    );
    const totalProfit = filteredOrders.reduce((sum, order) => {
      if (order.sold_total == null) return sum;
      const qtySold = soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0);
      const effCost = getProportionalCost(order.total_cost, order.qty_bought, qtySold, order.listing_status);
      return sum + (order.sold_total - effCost);
    }, 0);

    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    return [
      {
        label: "Tickets Available",
        value: String(availableCount),
        detail: availableCount > 0 ? "not yet sold" : "All tickets sold",
      },
      {
        label: "Tickets Sold",
        value: String(soldCount),
        detail: soldCount > 0 ? `of ${filteredOrders.length} total` : "No tickets sold yet",
      },
      {
        label: "Capital In",
        value: formatCurrency(totalCost),
        detail:
          filteredOrders.length > 0
            ? `${formatCurrency(totalCost / filteredOrders.length)} avg per ticket`
            : "No spend yet",
      },
      {
        label: "ROI",
        value: `${roi.toFixed(1)}%`,
        detail:
          totalProfit !== 0 ? `${formatCurrency(totalProfit)} net profit` : "No profit yet",
      },
    ];
  }, [filteredOrders, soldQtyByOrderId]);

  return (
    <div className={`orders-shell${(selectedOrder || showAddForm) ? " orders-shell-drawer-open" : ""}`}>
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

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Ticket desk</p>
            <h2>Tickets</h2>
          </div>
          <div className="topbar-actions">
            <button
              className={`secondary-button${privacyMode ? " toggle-btn-active" : ""}`}
              onClick={() => { setPrivacyMode(v => !v); setSearch(""); }}
              type="button"
              title={privacyMode ? "Show event details" : "Hide event details"}
            >
              {privacyMode ? "Show Details" : "Hide Details"}
            </button>
            <button className="secondary-button" onClick={() => loadOrders(true)} disabled={refreshing} type="button">
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button className="secondary-button" onClick={() => void exportOrdersCSV()} type="button">
              Export CSV
            </button>
            {(viewMode === "active" || viewMode === "personal") && (
              <>
                <button className="secondary-button" onClick={scanMailNow} disabled={scanning} type="button">
                  {scanning ? "Scanning..." : "Scan Mail"}
                </button>
                <button className="primary-button" onClick={openAddForm} type="button">
                  Add Ticket
                </button>
              </>
            )}
          </div>
        </header>

        {message ? (
          <div className="feedback-banner" role="status">
            <span className="feedback-dot" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="command-card">
          <div className="command-header">
            <div className="view-toggle">
              <button
                type="button"
                className={`toggle-btn${viewMode === "active" ? " toggle-btn-active" : ""}`}
                onClick={() => { setViewMode("active"); clearSelection(); }}
              >
                Active
              </button>
              <button
                type="button"
                className={`toggle-btn${viewMode === "archived" ? " toggle-btn-active" : ""}`}
                onClick={() => { setViewMode("archived"); clearSelection(); setSelectedOrderId(null); setShowAddForm(false); }}
              >
                Archived
              </button>
              <button
                type="button"
                className={`toggle-btn${viewMode === "ignored" ? " toggle-btn-active" : ""}`}
                onClick={() => { setViewMode("ignored"); clearSelection(); setSelectedOrderId(null); setShowAddForm(false); }}
              >
                Ignored
              </button>
              <button
                type="button"
                className={`toggle-btn${viewMode === "personal" ? " toggle-btn-active" : ""}`}
                onClick={() => { setViewMode("personal"); clearSelection(); setSelectedOrderId(null); setShowAddForm(false); }}
              >
                Personal
              </button>
            </div>
            <div className="view-toggle">
              <button type="button" className={`toggle-btn${sortBy === "event-date" ? " toggle-btn-active" : ""}`} onClick={() => setSortBy("event-date")}>Event date</button>
              <button type="button" className={`toggle-btn${sortBy === "added-newest" ? " toggle-btn-active" : ""}`} onClick={() => setSortBy("added-newest")}>Newest</button>
              <button type="button" className={`toggle-btn${sortBy === "added-oldest" ? " toggle-btn-active" : ""}`} onClick={() => setSortBy("added-oldest")}>Oldest</button>
            </div>
            <button className="ghost-button" onClick={resetFilters} type="button">
              Reset
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

            <div className="filter-field">
              <span className="filter-label">Event</span>
              <MultiSelectField
                options={eventOptions}
                selected={eventFilters}
                onChange={setEventFilters}
                placeholder="All events"
              />
            </div>

            <div className="filter-field">
              <span className="filter-label">Venue</span>
              <MultiSelectField
                options={venueOptions}
                selected={venueFilters}
                onChange={setVenueFilters}
                placeholder="All venues"
              />
            </div>

            <div className="filter-field">
              <span className="filter-label">Status</span>
              <MultiSelectField
                options={statusOptions.filter(o => o !== "All")}
                selected={statusFilters}
                onChange={setStatusFilters}
                placeholder="All statuses"
              />
            </div>

            <div className="filter-field">
              <span className="filter-label">Source</span>
              <MultiSelectField
                options={sourceOptions.filter(o => o !== "All")}
                selected={sourceFilters}
                onChange={setSourceFilters}
                placeholder="All sources"
                labelFn={(v) => sourceLabels[v] ?? v}
              />
            </div>

            <div className="filter-field">
              <span className="filter-label">Sold</span>
              <MultiSelectField
                options={["Sold", "Unsold"]}
                selected={soldFilters}
                onChange={setSoldFilters}
                placeholder="All"
              />
            </div>

            <div className="filter-field">
              <span className="filter-label">Inbox</span>
              <MultiSelectField
                options={accounts}
                selected={emailFilters}
                onChange={setEmailFilters}
                placeholder="All inboxes"
              />
            </div>
          </div>
        </section>

        <section className="table-card inventory-board">
          <div className="table-card-header inventory-board-header">
            <div>
              <p className="section-tag">{viewMode === "archived" ? "Archive" : viewMode === "ignored" ? "Ignored" : viewMode === "personal" ? "Personal" : "Tickets"}</p>
              <h4>{viewMode === "archived" ? "Archived tickets" : viewMode === "ignored" ? "Ignored tickets" : viewMode === "personal" ? "Personal tickets" : "Tickets by event"}</h4>
            </div>
            <span className="table-count">{groupedOrders.length} events · {filteredOrders.reduce((s, o) => s + (o.qty_bought ?? 0), 0)} tickets</span>
          </div>

          {viewMode !== "ignored" && selectedIds.size > 0 ? (
            <div className="bulk-action-bar">
              <span className="bulk-count">{selectedIds.size} selected</span>
              <div className="bulk-actions">
                {viewMode === "active" && (
                  <div className="bulk-status-group">
                    <select
                      className="field field-compact"
                      value={bulkStatus}
                      onChange={(e) => setBulkStatus(e.target.value)}
                    >
                      {quickStatusOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button className="secondary-button" type="button" onClick={() => void bulkSetStatus(bulkStatus)}>
                      Set status
                    </button>
                  </div>
                )}
                <button className="secondary-button" type="button" onClick={selectAll}>
                  Select all ({filteredOrders.length})
                </button>
                {(viewMode === "archived" || viewMode === "personal") && (
                  <button className="secondary-button" type="button" onClick={() => void bulkRestore()}>
                    Restore selected
                  </button>
                )}
                {viewMode === "active" && (
                  <button className="secondary-button" type="button" onClick={() => void bulkArchive()}>
                    Archive selected
                  </button>
                )}
                {viewMode === "active" && groupedOrders.filter((g) => g.orders.some((o) => selectedIds.has(o.id))).length >= 2 && (
                  <button className="secondary-button" type="button" onClick={() => void bulkMerge()} disabled={merging}>
                    {merging ? "Merging..." : "Merge"}
                  </button>
                )}
                {viewMode === "active" && (
                  <button className="secondary-button" type="button" onClick={() => void bulkMarkPersonal()}>
                    Mark personal
                  </button>
                )}
                {viewMode !== "personal" && (
                  <button className="secondary-button" type="button" onClick={() => void bulkIgnore()}>
                    Ignore selected
                  </button>
                )}
                <button className="danger-button" type="button" onClick={() => void bulkDelete()}>
                  Delete selected
                </button>
                <button className="ghost-button" type="button" onClick={clearSelection}>
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading tickets</h5>
            </div>
          ) : groupedOrders.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>{viewMode === "archived" ? "No archived tickets" : viewMode === "ignored" ? "No ignored tickets" : viewMode === "personal" ? "No personal tickets" : "No tickets match these filters"}</h5>
              <p>{viewMode === "archived" ? "Archive a ticket to store it here." : viewMode === "ignored" ? "Ignored tickets will appear here." : viewMode === "personal" ? "Mark a ticket as personal to store it here." : "Reset the filters or add a new ticket."}</p>
            </div>
          ) : (
            <div className="inventory-group-list">
              {groupedOrders.map((group) => {
                const expanded = expandedGroups.includes(group.key);
                const groupProfit = group.orders.some((o) => o.sold_total != null)
                  ? group.totalSold - group.totalEffectiveCost
                  : null;
                const groupRoi = groupProfit != null && group.totalEffectiveCost > 0
                  ? (groupProfit / group.totalEffectiveCost) * 100
                  : null;
                const soldRatio = group.totalQty > 0 ? (group.soldCount / group.totalQty) * 100 : 0;

                const groupIds = group.orders.map((o) => o.id);
                const allGroupSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id));
                const someGroupSelected = groupIds.some((id) => selectedIds.has(id));

                return (
                  <article
                    key={group.key}
                    className={`inventory-group-card${expanded ? " inventory-group-open" : ""}`}
                  >
                    <div className="inventory-group-header-row">
                    <label
                      className="group-checkbox-label"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={allGroupSelected}
                        ref={(el) => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                        onChange={() => toggleSelectGroup(groupIds)}
                      />
                    </label>
                    <button
                      className="inventory-group-toggle"
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                    >
                      <div className="inventory-group-main">
                        <div className="inventory-group-title">
                          <strong>{privacyMode ? "••••••••••••" : group.eventName}</strong>
                          <span>{privacyMode ? "••••••••" : group.venue}</span>
                          <small>{privacyMode ? "•• ••• ••••" : formatEventDate(group.eventDate)}</small>
                          <div className="title-chips">
                            {group.hasNew && <span className="new-badge">New</span>}
                            {(() => { const d = formatDaysAway(group.dateValue); return d ? <span className={`days-chip ${d.tone}`}>{d.label}</span> : null; })()}
                            <span
                              className="group-id-chip"
                              onClick={(e) => {
                                e.stopPropagation();
                                void navigator.clipboard.writeText(computeGroupId(group.key));
                                setCopiedGroupId(group.key);
                                setTimeout(() => setCopiedGroupId(null), 1500);
                              }}
                              title="Click to copy group ID for mass matching"
                            >
                              {copiedGroupId === group.key ? "Copied!" : `#${computeGroupId(group.key)}`}
                            </span>
                          </div>
                        </div>
                        <div className="inventory-group-metrics">
                          <div className="inventory-metric-chip">
                            <span>Tickets</span>
                            <strong>{group.totalQty}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Cost</span>
                            <strong>{formatCurrency(group.totalCost)}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>CPT</span>
                            <strong>{group.totalQty > 0 ? formatCurrency(group.totalCost / group.totalQty) : "—"}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Revenue</span>
                            <strong>{group.totalSold > 0 ? formatCurrency(group.totalSold) : "—"}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Profit</span>
                            <strong className={groupProfit != null && groupProfit > 0 ? "delta-up" : groupProfit != null && groupProfit < 0 ? "delta-down" : ""}>
                              {groupProfit != null ? formatCurrency(groupProfit) : "—"}
                            </strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>ROI</span>
                            <strong className={groupRoi != null && groupRoi > 0 ? "delta-up" : groupRoi != null && groupRoi < 0 ? "delta-down" : ""}>
                              {groupRoi != null ? `${groupRoi.toFixed(1)}%` : "—"}
                            </strong>
                          </div>
                          <div className="inventory-status-row">
                            <a
                              href={getViagogoUrl(group.eventName, group.venue)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="status-badge status-static viagogo-badge"
                              onClick={(e) => e.stopPropagation()}
                              title={`Search "${group.eventName}" on Viagogo`}
                            >
                              Viagogo ↗
                            </a>
                            <span className="status-badge status-static status-unlisted">Unlisted {group.unlistedCount}</span>
                            <span className="status-badge status-static status-listed">Listed {group.listedCount}</span>
                            <span className="status-badge status-static status-sold">Sold {group.soldCount}</span>
                          </div>
                        </div>
                      </div>
                      <div className="inventory-group-side">
                        <div className="inventory-progress-block">
                          <span>{group.soldCount}/{group.totalQty} sold</span>
                          <div className="inventory-progress-track">
                            <div className="inventory-progress-fill" style={{ width: `${Math.max(soldRatio, 6)}%` }} />
                          </div>
                        </div>
                        <span className="inventory-chevron">{expanded ? "−" : "+"}</span>
                      </div>
                    </button>
                    </div>

                    {expanded ? (
                      <div className="table-scroll">
                        <table className="premium-table">
                          <thead>
                            <tr>
                              {viewMode !== "ignored" && <th className="col-check" />}
                              <th>Ref</th>
                              <th>Seats</th>
                              <th>Account</th>
                              <th>Qty</th>
                              <th>Cost</th>
                              <th>Sold For</th>
                              <th>Profit</th>
                              <th>ROI</th>
                              <th>{viewMode === "active" ? "Status" : "Actions"}</th>
                              <th>Added</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.orders.map((order) => {
                              const sold = order.sold_total ?? 0;
                              const qtySoldRow = soldQtyByOrderId.get(order.id) ?? (order.qty_bought ?? 0);
                              const effCost = getProportionalCost(order.total_cost, order.qty_bought, qtySoldRow, order.listing_status);
                              const profit = order.sold_total != null ? sold - effCost : null;
                              const roi = profit != null && effCost > 0 ? (profit / effCost) * 100 : null;
                              const active = selectedOrderId === order.id;
                              const isNew = order.created_at ? new Date(order.created_at).getTime() > Date.now() - 86400000 : false;

                              return (
                                <tr
                                  key={order.id}
                                  className={`${active ? "row-active" : ""}${selectedIds.has(order.id) ? " row-selected" : ""}`}
                                  onClick={() => setSelectedOrderId(order.id)}
                                >
                                  {viewMode !== "ignored" && (
                                    <td className="col-check" onClick={(e) => { e.stopPropagation(); toggleSelect(order.id); }}>
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(order.id)}
                                        onChange={() => toggleSelect(order.id)}
                                      />
                                    </td>
                                  )}
                                  <td>
                                    <span className="mono-text">{order.booking_ref || "No ref"}</span>
                                    {isNew && <span className="new-badge new-badge-inline">New</span>}
                                  </td>
                                  <td>
                                    <div className="seat-stack">
                                      <strong>{order.section || "—"}</strong>
                                      <span>{formatSeatLabel(order.row, order.seat_from, order.seat_to)}</span>
                                    </div>
                                  </td>
                                  <td>
                                    <span className="truncate-text" title={order.account_email || ""}>
                                      {order.account_email || "—"}
                                    </span>
                                  </td>
                                  <td>{order.qty_bought ?? "—"}</td>
                                  <td>{formatCurrency(order.total_cost)}</td>
                                  <td onClick={(e) => e.stopPropagation()}>
                                    <input
                                      className="field field-compact"
                                      type="number"
                                      step="0.01"
                                      value={order.sold_total ?? ""}
                                      onChange={(e) => updateOrder(order.id, "sold_total", e.target.value)}
                                      onBlur={(e) => void saveQuickField(order, "sold_total", e.target.value)}
                                    />
                                  </td>
                                  <td className={profit != null && profit > 0 ? "value-up" : profit != null && profit < 0 ? "value-down" : ""}>
                                    {profit == null ? "—" : formatCurrency(profit)}
                                  </td>
                                  <td className={roi != null && roi > 0 ? "value-up" : ""}>
                                    {roi == null ? "—" : `${roi.toFixed(1)}%`}
                                  </td>
                                  <td onClick={(e) => e.stopPropagation()}>
                                    {viewMode === "archived" ? (
                                      <div style={{ display: "flex", gap: "4px" }}>
                                        <button className="secondary-button" type="button" onClick={() => void restoreOrder(order.id)}>
                                          Restore
                                        </button>
                                        <button className="secondary-button" type="button" onClick={() => void ignoreOrder(order.id)}>
                                          Ignore
                                        </button>
                                      </div>
                                    ) : viewMode === "ignored" || viewMode === "personal" ? (
                                      <button className="secondary-button" type="button" onClick={() => void restoreOrder(order.id)}>
                                        Restore
                                      </button>
                                    ) : (
                                      <select
                                        className="field field-compact"
                                        value={order.listing_status ?? "Unlisted"}
                                        onChange={(e) => void saveQuickField(order, "listing_status", e.target.value)}
                                      >
                                        {quickStatusOptions.map((status) => (
                                          <option key={status} value={status}>{status}</option>
                                        ))}
                                      </select>
                                    )}
                                  </td>
                                  <td>
                                    <span className="timestamp-text">{formatAddedAt(order.created_at)}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Activity</p>
              <h4>Recent Scans</h4>
            </div>
            <span className="table-count">{syncLog.length} entries</span>
          </div>

          {syncLog.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <h5>No scans yet</h5>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Scanned</th>
                    <th>New</th>
                    <th>Updated</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLog.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatSyncDate(entry.created_at)}</td>
                      <td>{entry.scan_type}</td>
                      <td>{entry.scanned}</td>
                      <td>{entry.inserted}</td>
                      <td>{entry.updated ?? 0}</td>
                      <td>
                        {entry.error ? (
                          <span className="status-badge badge-problem" title={entry.error}>Error</span>
                        ) : (
                          <span className="status-badge badge-sold">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </main>

      {showAddForm ? (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">New ticket</p>
              <h4>Add ticket</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setShowAddForm(false)}>×</button>
          </div>
          <div className="drawer-content">
            <div className="drawer-grid">
              <label>
                <span>Event name *</span>
                <input className="field" placeholder="Artist / event name" value={newTicket.event_name} onChange={(e) => setNewTicket((t) => ({ ...t, event_name: e.target.value }))} />
              </label>
              <label>
                <span>Venue</span>
                <input className="field" placeholder="Venue name" value={newTicket.venue} onChange={(e) => setNewTicket((t) => ({ ...t, venue: e.target.value }))} />
              </label>
              <label>
                <span>Event date</span>
                <input className="field" type="date" value={newTicket.event_date} onChange={(e) => setNewTicket((t) => ({ ...t, event_date: e.target.value }))} />
              </label>
              <label>
                <span>Booking ref</span>
                <input className="field" placeholder="Order / booking reference" value={newTicket.booking_ref} onChange={(e) => setNewTicket((t) => ({ ...t, booking_ref: e.target.value }))} />
              </label>
              <label>
                <span>Account</span>
                <select
                  className="field"
                  value={newTicket.account_email}
                  onChange={(e) => setNewTicket((t) => ({ ...t, account_email: e.target.value }))}
                >
                  <option value="">— Select account —</option>
                  {accounts.map((email) => (
                    <option key={email} value={email}>{email}</option>
                  ))}
                </select>
                {addingAccount ? (
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                    <input
                      className="field"
                      placeholder="buyer@email.com"
                      value={newAccountInput}
                      onChange={(e) => setNewAccountInput(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        const email = newAccountInput.trim().toLowerCase();
                        if (email && !accounts.includes(email)) setAccounts((a) => [...a, email].sort());
                        if (email) setNewTicket((t) => ({ ...t, account_email: email }));
                        setNewAccountInput("");
                        setAddingAccount(false);
                      }}
                    >Add</button>
                    <button type="button" className="ghost-button" onClick={() => { setAddingAccount(false); setNewAccountInput(""); }}>✕</button>
                  </div>
                ) : (
                  <button type="button" className="ghost-button" style={{ marginTop: "6px", fontSize: "12px" }} onClick={() => setAddingAccount(true)}>
                    + Add account
                  </button>
                )}
              </label>
              <label>
                <span>Source</span>
                <select className="field" value={newTicket.source_type} onChange={(e) => setNewTicket((t) => ({ ...t, source_type: e.target.value }))}>
                  {sourceTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Section</span>
                <input className="field" placeholder="e.g. Floor A" value={newTicket.section} onChange={(e) => setNewTicket((t) => ({ ...t, section: e.target.value }))} />
              </label>
              <label>
                <span>Row</span>
                <input className="field" placeholder="e.g. D" value={newTicket.row} onChange={(e) => setNewTicket((t) => ({ ...t, row: e.target.value }))} />
              </label>
              <label>
                <span>Seat from</span>
                <input className="field" placeholder="e.g. 14" value={newTicket.seat_from} onChange={(e) => setNewTicket((t) => ({ ...t, seat_from: e.target.value }))} />
              </label>
              <label>
                <span>Seat to</span>
                <input className="field" placeholder="e.g. 15" value={newTicket.seat_to} onChange={(e) => setNewTicket((t) => ({ ...t, seat_to: e.target.value }))} />
              </label>
              <label>
                <span>Quantity</span>
                <input className="field" type="number" min="1" value={newTicket.qty_bought} onChange={(e) => setNewTicket((t) => ({ ...t, qty_bought: Number(e.target.value) }))} />
              </label>
              <label>
                <span>Buy cost (£)</span>
                <input className="field" type="number" step="0.01" min="0" placeholder="0.00" value={newTicket.total_cost} onChange={(e) => setNewTicket((t) => ({ ...t, total_cost: e.target.value }))} />
              </label>
              <label>
                <span>Status</span>
                <select className="field" value={newTicket.listing_status} onChange={(e) => setNewTicket((t) => ({ ...t, listing_status: e.target.value }))}>
                  {quickStatusOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="drawer-actions">
              <button className="ghost-button" type="button" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="primary-button" type="button" onClick={() => void submitNewTicket()} disabled={submittingNew}>
                {submittingNew ? "Adding..." : "Add Ticket"}
              </button>
            </div>
          </div>
        </aside>
      ) : selectedOrder ? (
      <aside className="details-drawer details-drawer-open">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Ticket detail</p>
            <h4>{selectedOrder.event_name || "Untitled ticket"}</h4>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {selectedOrder.email_html && (
              <button
                type="button"
                onClick={() => window.open(`/api/email-pdf/${selectedOrder.id}`, "_blank")}
                title="Download confirmation email as PDF"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: "#026cdf",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Confirmation
              </button>
            )}
            <button
              className="drawer-close"
              type="button"
              onClick={() => setSelectedOrderId(null)}
            >
              ×
            </button>
          </div>
        </div>

        <div className="drawer-content">
            <section className="drawer-hero">
              <div className="drawer-hero-copy">
                <strong>{selectedOrder.event_name || "Untitled ticket"}</strong>
                <span>{selectedOrder.venue || "Venue missing"}</span>
                <small>{formatEventDate(selectedOrder.event_date)}</small>
              </div>
              <div className="drawer-hero-meta">
                <span className={`status-badge status-static ${getStatusTone(selectedOrder.listing_status)}`}>
                  {selectedOrder.listing_status || "Unlisted"}
                </span>
                <strong className={`drawer-profit ${getDeltaTone((selectedOrder.sold_total ?? 0) - getProportionalCost(selectedOrder.total_cost, selectedOrder.qty_bought, soldQtyByOrderId.get(selectedOrder.id) ?? (selectedOrder.qty_bought ?? 0), selectedOrder.listing_status))}`}>
                  {renderDeltaValue((selectedOrder.sold_total ?? 0) - getProportionalCost(selectedOrder.total_cost, selectedOrder.qty_bought, soldQtyByOrderId.get(selectedOrder.id) ?? (selectedOrder.qty_bought ?? 0), selectedOrder.listing_status), true)}
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
                  type="date"
                  value={toDateInputValue(selectedOrder.event_date)}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "event_date", e.target.value)
                  }
                />
              </label>
              <label>
                <span>Account</span>
                <select
                  className="field"
                  value={selectedOrder.account_email ?? ""}
                  onChange={(e) => updateOrder(selectedOrder.id, "account_email", e.target.value)}
                >
                  <option value="">— Select account —</option>
                  {accounts.map((email) => (
                    <option key={email} value={email}>{email}</option>
                  ))}
                </select>
                {addingAccount ? (
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                    <input
                      className="field"
                      placeholder="buyer@email.com"
                      value={newAccountInput}
                      onChange={(e) => setNewAccountInput(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        const email = newAccountInput.trim().toLowerCase();
                        if (email && !accounts.includes(email)) setAccounts((a) => [...a, email].sort());
                        if (email) updateOrder(selectedOrder.id, "account_email", email);
                        setNewAccountInput("");
                        setAddingAccount(false);
                      }}
                    >Add</button>
                    <button type="button" className="ghost-button" onClick={() => { setAddingAccount(false); setNewAccountInput(""); }}>✕</button>
                  </div>
                ) : (
                  <button type="button" className="ghost-button" style={{ marginTop: "6px", fontSize: "12px" }} onClick={() => setAddingAccount(true)}>
                    + Add account
                  </button>
                )}
              </label>
              <label>
                <span>Source</span>
                <select
                  className="field"
                  value={selectedOrder.source_type ?? "manual"}
                  onChange={(e) =>
                    updateOrder(selectedOrder.id, "source_type", e.target.value)
                  }
                >
                  {sourceTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
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
                    (selectedOrder.sold_total ?? 0) - getProportionalCost(selectedOrder.total_cost, selectedOrder.qty_bought, soldQtyByOrderId.get(selectedOrder.id) ?? (selectedOrder.qty_bought ?? 0), selectedOrder.listing_status),
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
              {viewMode === "ignored" || viewMode === "personal" ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void restoreOrder(selectedOrder.id)}
                >
                  Restore
                </button>
              ) : viewMode === "archived" ? (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void restoreOrder(selectedOrder.id)}
                  >
                    Restore
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void ignoreOrder(selectedOrder.id)}
                  >
                    Ignore
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void markPersonal(selectedOrder.id)}
                  >
                    Personal
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void ignoreOrder(selectedOrder.id)}
                  >
                    Ignore
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void archiveOrder(selectedOrder.id)}
                  >
                    Archive
                  </button>
                </>
              )}
              <button
                className="primary-button"
                type="button"
                onClick={() => void saveOrder(selectedOrder)}
              >
                Save Row
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function getDaysAway(date: Date | null): number | null {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDaysAway(date: Date | null): { label: string; tone: string } | null {
  const days = getDaysAway(date);
  if (days == null) return null;
  if (days < 0) return { label: "Past", tone: "days-past" };
  if (days === 0) return { label: "Today", tone: "days-urgent" };
  if (days === 1) return { label: "Tomorrow", tone: "days-urgent" };
  if (days <= 7) return { label: `${days}d`, tone: "days-soon" };
  return { label: `${days}d`, tone: "days-ok" };
}

function parseOrderDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const monthIndex = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(monthName.slice(0,3).toLowerCase());
  if (monthIndex === -1) return null;
  return new Date(Number(year), monthIndex, Number(day));
}

const UK_CITIES = ["london","manchester","birmingham","glasgow","edinburgh","liverpool","leeds","sheffield","bristol","cardiff","newcastle","nottingham","brighton","leicester","wolverhampton","coventry","reading","belfast","southampton","exeter","york","bath","oxford","cambridge","hull","stoke","sunderland","middlesbrough"];

function getViagogoUrl(eventName: string, venue: string): string {
  const isUK = UK_CITIES.some((c) => venue.toLowerCase().includes(c));
  const domain = isUK ? "www.viagogo.co.uk" : "www.viagogo.com";
  const q = encodeURIComponent(eventName);
  return `https://${domain}/secure/Search?q=${q}`;
}

function formatEventDate(value: string | null): string {
  if (!value) return "Date missing";
  // Already in a human-readable format (e.g. "Sat 25 Apr 2026 - 6:30 pm") — return as-is
  if (/^[A-Za-z]{2,3}\s+\d{1,2}\s+[A-Za-z]{3}/i.test(value)) return value;
  // ISO date: 2026-04-22 or 2026-04-22T...
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
  }
  return value;
}

function formatAddedAt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).format(date);
}

function formatSyncDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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





// Converts any stored date string (ISO "2025-06-14", "14 Jun 2025", etc.) to
// the YYYY-MM-DD format required by <input type="date">. Falls back to "" so
// the field shows empty rather than a broken value.
function toDateInputValue(value: string | null): string {
  if (!value) return "";
  // Already ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  // Try parsing natural-language dates like "14 Jun 2025"
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return "";
}

function MultiSelectField({
  options,
  selected,
  onChange,
  placeholder,
  labelFn,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  labelFn?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);
  }

  const displayLabel = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (labelFn ? labelFn(selected[0]) : selected[0])
      : `${selected.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="field"
        style={{
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          borderColor: selected.length > 0 ? "rgba(255,79,163,0.4)" : undefined,
        }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: selected.length > 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
          fontSize: 14,
        }}>
          {displayLabel}
        </span>
        <span style={{ fontSize: 9, opacity: 0.4, flexShrink: 0 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 200,
          background: "#16161e",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: "6px 0",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          maxHeight: 240,
          overflowY: "auto",
          minWidth: "max-content",
        }}>
          {options.map(option => {
            const isChecked = selected.includes(option);
            return (
              <label
                key={option}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: isChecked ? "rgba(255,79,163,0.07)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(option)}
                  style={{ accentColor: "rgb(255,79,163)", width: 14, height: 14, flexShrink: 0, cursor: "pointer" }}
                />
                <span style={{
                  fontSize: 13,
                  color: isChecked ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)",
                  whiteSpace: "nowrap",
                }}>
                  {labelFn ? labelFn(option) : option}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}


function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function getStatusTone(status: string | null) {
  switch (status) {
    case "Listed":
      return "status-listed";
    case "Sold":
      return "status-sold";
    case "Problem / Missing":
      return "status-problem";
    case "Personal":
      return "status-personal";
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


















