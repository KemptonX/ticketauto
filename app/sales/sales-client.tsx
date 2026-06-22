"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/src/lib/supabase";
import { formatCurrency } from "@/src/lib/currency";
import { loadTemplate, interpolate } from "@/src/lib/email-template";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";
import ShareBannerModal, { ShareMultiBannerModal, type MultiSaleStats } from "./ShareBannerModal";
import SalesImportModal from "./SalesImportModal";

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
  payout_total?: number | null;
  currency: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  sale_status: string | null;
  inventory_order_id: number | null;
  match_confidence: number | null;
  split_of_sale_id: number | null;
  created_at: string | null;
  transfer_date: string | null;
  payout_date: string | null;
  expected_payout_date: string | null;
  marketplace: string | null;
  buyer_name: string | null;
  transfer_status: string | null;
  payment_status: string | null;
  notes: string | null;
};

type MatchedOrder = {
  id: number;
  booking_ref: string | null;
  total_cost: number | null;
  sold_total: number | null;
  qty_bought: number | null;
  account_email: string | null;
  listing_status: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  event_name: string | null;
  venue: string | null;
  event_date: string | null;
};

type AddSaleForm = {
  qty_sold: string;
  sale_price: string;
  buyer_email: string;
  sold_at: string;
  event_name: string;
  venue: string;
  event_date: string;
  section: string;
  row: string;
  seat_from: string;
  seat_to: string;
  marketplace: string;
};

type SaleGroup = {
  key: string;
  eventName: string;
  venue: string;
  eventDate: string;
  dateValue: Date | null;
  latestSoldAt: Date | null;
  sales: Sale[];
  salesCount: number;
  ticketsSold: number;
  soldFor: number;
  profit: number;
  cost: number;
  matchedCount: number;
  unmatchedCount: number;
  hasNew: boolean;
  awaitingTransferQty: number;
  transferCompletedQty: number;
  awaitingPaymentAmount: number;
  paidAmount: number;
  buyerDisplay: string;
  inventoryLinked: boolean;
};

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: true },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

const matchFilterOptions = ["All", "Matched", "Unmatched"];


function computeGroupId(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h = h >>> 0;
  }
  return String(h % 100000).padStart(5, "0");
}

export default function SalesClient() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [metricSales, setMetricSales] = useState<Pick<Sale, "qty_sold" | "sale_total" | "payout_total" | "payment_status" | "sale_status" | "transfer_status">[]>([]);
  const [matchedOrders, setMatchedOrders] = useState<Record<number, MatchedOrder>>({});
  const [allOrders, setAllOrders] = useState<MatchedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState("All");
  const [accountFilter, setAccountFilter] = useState("All");
  const [sortBy, setSortBy] = useState("event-soonest");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [matchingOrderId, setMatchingOrderId] = useState<number | null>(null);
  const [unmatching, setUnmatching] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [saleEdits, setSaleEdits] = useState<{ qty_sold: string; price_per_ticket: string; sale_total: string; sale_status: string; transfer_status: string; payment_status: string; transfer_date: string; payout_date: string; expected_payout_date: string; marketplace: string; buyer_name: string; notes: string } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [showAddSale, setShowAddSale] = useState(false);
  const [addSaleOrderId, setAddSaleOrderId] = useState<number | null>(null);
  const [addSaleSearch, setAddSaleSearch] = useState("");
  const [addSaleForm, setAddSaleForm] = useState<AddSaleForm>({ qty_sold: "1", sale_price: "", buyer_email: "", sold_at: "", event_name: "", venue: "", event_date: "", section: "", row: "", seat_from: "", seat_to: "", marketplace: "" });
  const [savingNewSale, setSavingNewSale] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [connectedAccounts, setConnectedAccounts] = useState<{ id: string; email: string; provider: string }[]>([]);
  const [emailFromAccountId, setEmailFromAccountId] = useState<string>("");
  const [thankYouSentIds, setThankYouSentIds] = useState<Record<number, true>>({});
  const [shareSaleId, setShareSaleId] = useState<number | null>(null);
  const [selectedSaleIds, setSelectedSaleIds] = useState<Set<number>>(new Set());
  const [massUpdating, setMassUpdating] = useState(false);
  const [shareMultiOpen, setShareMultiOpen] = useState(false);
  const [massMatchGroupKey, setMassMatchGroupKey] = useState<string | null>(null);
  const [massMatchInput, setMassMatchInput] = useState("");
  const [massMatchLoading, setMassMatchLoading] = useState(false);
  const [copiedSaleGroupId, setCopiedSaleGroupId] = useState<string | null>(null);
  const [groupIdInput, setGroupIdInput] = useState("");
  const [groupIdSuggestions, setGroupIdSuggestions] = useState<MatchedOrder[] | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("sent_thankyou_sale_ids") || "[]") as number[];
      const rec: Record<number, true> = {};
      for (const id of stored) rec[id] = true;
      setThankYouSentIds(rec);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadSales(false, showArchived, showDeleted);
  }, [showArchived, showDeleted]);

  const selectedSaleRaw = sales.find((s) => s.id === selectedSaleId) || null;

  useEffect(() => {
    if (selectedSaleRaw) {
      setSaleEdits({
        qty_sold: selectedSaleRaw.qty_sold != null ? String(selectedSaleRaw.qty_sold) : "",
        price_per_ticket: selectedSaleRaw.price_per_ticket != null ? String(selectedSaleRaw.price_per_ticket) : "",
        sale_total: selectedSaleRaw.sale_total != null ? String(selectedSaleRaw.sale_total) : "",
        sale_status: selectedSaleRaw.sale_status || "Sold – Awaiting Transfer",
        transfer_status: selectedSaleRaw.transfer_status || "Awaiting Transfer",
        payment_status: selectedSaleRaw.payment_status || "Awaiting Payment",
        transfer_date: selectedSaleRaw.transfer_date ? selectedSaleRaw.transfer_date.slice(0, 16) : "",
        payout_date: selectedSaleRaw.payout_date ? selectedSaleRaw.payout_date.slice(0, 16) : "",
        expected_payout_date: selectedSaleRaw.expected_payout_date ? selectedSaleRaw.expected_payout_date.slice(0, 16) : "",
        marketplace: selectedSaleRaw.marketplace || "",
        buyer_name: selectedSaleRaw.buyer_name || "",
        notes: selectedSaleRaw.notes || "",
      });
    } else {
      setSaleEdits(null);
    }
    setManualSearch("");
    setGroupIdInput("");
    setGroupIdSuggestions(null);
  }, [selectedSaleId]);

  async function saveSaleEdits() {
    if (!selectedSaleRaw || !saleEdits) return;
    setSavingSale(true);
    setMessage("");

    const qty_sold = saleEdits.qty_sold !== "" ? Number(saleEdits.qty_sold) : null;
    const price_per_ticket = saleEdits.price_per_ticket !== "" ? Number(saleEdits.price_per_ticket) : null;
    const sale_total = saleEdits.sale_total !== "" ? Number(saleEdits.sale_total) : null;
    const sale_status = saleEdits.sale_status || selectedSaleRaw.sale_status || "Sold – Awaiting Transfer";
    const transfer_status = saleEdits.transfer_status || "Awaiting Transfer";
    const payment_status = saleEdits.payment_status || "Awaiting Payment";
    const transfer_date = saleEdits.transfer_date ? new Date(saleEdits.transfer_date).toISOString() : null;
    const payout_date = saleEdits.payout_date ? new Date(saleEdits.payout_date).toISOString() : null;
    const expected_payout_date = saleEdits.expected_payout_date ? new Date(saleEdits.expected_payout_date).toISOString() : null;
    const marketplace = saleEdits.marketplace || null;
    const buyer_name = saleEdits.buyer_name || null;
    const notes = saleEdits.notes || null;

    const { error } = await supabase
      .from("sales")
      .update({ qty_sold, price_per_ticket, sale_total, sale_status, transfer_status, payment_status, transfer_date, payout_date, expected_payout_date, marketplace, buyer_name, notes })
      .eq("id", selectedSaleRaw.id);

    if (error) {
      setMessage(error.message);
      setSavingSale(false);
      return;
    }

    if (sale_status === "Paid" && !showArchived && !showDeleted) {
      setSales((current) => current.filter((s) => s.id !== selectedSaleRaw.id));
      setSelectedSaleId(null);
    } else {
      setSales((current) =>
        current.map((s) =>
          s.id === selectedSaleRaw.id ? { ...s, qty_sold, price_per_ticket, sale_total, sale_status, transfer_status, payment_status, transfer_date, payout_date, expected_payout_date, marketplace, buyer_name, notes } : s,
        ),
      );
    }

    if (selectedSaleRaw.inventory_order_id != null) {
      await syncOrderFromSales(selectedSaleRaw.inventory_order_id);
    }

    setSavingSale(false);
    setMessage(sale_status === "Paid" && !showArchived && !showDeleted ? "Sale marked as Paid — moved to Archived" : "Sale updated");
  }


  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadSales(showRefreshing = false, archived = showArchived, deleted = showDeleted) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const query = supabase.from("sales").select("*").order("sold_at", { ascending: false }).order("created_at", { ascending: false });
    const [{ data, error }, { data: metricsData }] = await Promise.all([
      deleted ? query.eq("sale_status", "Deleted")
      : archived ? query.in("sale_status", ["Archived", "Paid"])
      : query.not("sale_status", "in", '("Archived","Deleted","Paid")'),
      supabase
        .from("sales")
        .select("qty_sold, sale_total, payout_total, payment_status, sale_status, transfer_status")
        .not("sale_status", "in", '("Deleted")'),
    ]);

    if (error) {
      setMessage(error.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const nextSales = (data as Sale[]) || [];
    setSales(nextSales);
    setMetricSales((metricsData ?? []) as typeof metricSales);

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("id, booking_ref, total_cost, sold_total, qty_bought, account_email, listing_status, section, row, seat_from, seat_to, event_name, venue, event_date");

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

    // Silently auto-archive qualifying past-event sales
    if (!archived && !deleted) {
      const archivedIds = await autoArchivePastSales(nextSales);
      if (archivedIds.length > 0) {
        setSales(prev => prev.filter(s => !archivedIds.includes(s.id)));
        if (selectedSaleId != null && archivedIds.includes(selectedSaleId)) {
          setSelectedSaleId(null);
        }
      }
    }

    setLoading(false);
    setRefreshing(false);
  }

  function exportSalesCSV() {
    const headers = [
      "Sale Reference",
      "Event Name",
      "Venue",
      "Event Date",
      "Section",
      "Row",
      "Seat From",
      "Seat To",
      "Qty Sold",
      "Sale Date",
      "Sale Total",
      "Platform",
      "Buyer Name",
      "Buyer Email",
      "Sale Status",
      "Transfer Status",
      "Transfer Date",
      "Payment Status",
      "Expected Payout Date",
      "Payout Date",
      "Notes",
      "Account",
      "Matched Order ID",
    ];
    const rows = sales.map((s) => [
      s.external_sale_id ?? "",
      s.event_name ?? "",
      s.venue ?? "",
      s.event_date ?? "",
      s.section ?? "",
      s.row ?? "",
      s.seat_from ?? "",
      s.seat_to ?? "",
      s.qty_sold ?? "",
      s.sold_at ?? "",
      s.sale_total ?? s.payout_total ?? "",
      s.marketplace ?? "",
      s.buyer_name ?? "",
      s.buyer_email ?? "",
      s.sale_status ?? "",
      s.transfer_status ?? "",
      s.transfer_date ?? "",
      s.payment_status ?? "",
      s.expected_payout_date ?? "",
      s.payout_date ?? "",
      s.notes ?? "",
      s.account_email ?? "",
      s.inventory_order_id ?? "",
    ]);
    downloadCSV(`sales-${dateStamp()}.csv`, headers, rows);
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

      const lcResponse = await fetch("/api/scan-sales-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const lcResult = await lcResponse.json() as { updated?: number; error?: string };

      await loadSales(true);

      let msg = `Sales scan complete: ${result.inserted} new, ${result.matched} matched`;
      if (lcResponse.ok && (lcResult.updated ?? 0) > 0) {
        msg += `, ${lcResult.updated} lifecycle updated`;
      }
      setMessage(msg);
    } catch {
      setMessage("Sales scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function deleteSale(id: number) {
    const confirmed = window.confirm("Move this sale to Deleted? You can restore it later.");
    if (!confirmed) return;
    setMessage("");
    const saleToDelete = sales.find(s => s.id === id);
    const { error } = await supabase.from("sales").update({ sale_status: "Deleted" }).eq("id", id);
    if (error) { setMessage(error.message); return; }
    setSales((current) => current.filter((sale) => sale.id !== id));
    if (selectedSaleId === id) setSelectedSaleId(null);
    if (saleToDelete?.inventory_order_id != null) {
      await syncOrderFromSales(saleToDelete.inventory_order_id);
    }
    setMessage("Sale moved to Deleted — switch to Deleted tab to restore.");
  }

  async function deleteSelectedSales() {
    if (selectedSaleIds.size === 0 || massUpdating) return;
    const confirmed = window.confirm(`Move ${selectedSaleIds.size} sale${selectedSaleIds.size > 1 ? "s" : ""} to Deleted? You can restore them later.`);
    if (!confirmed) return;
    setMassUpdating(true);
    const ids = [...selectedSaleIds];
    const { error } = await supabase.from("sales").update({ sale_status: "Deleted" }).in("id", ids);
    if (error) { setMessage(error.message); setMassUpdating(false); return; }
    setSales((current) => current.filter((s) => !selectedSaleIds.has(s.id)));
    if (selectedSaleId != null && selectedSaleIds.has(selectedSaleId)) setSelectedSaleId(null);
    setSelectedSaleIds(new Set());
    setMassUpdating(false);
    setMessage(`${ids.length} sale${ids.length > 1 ? "s" : ""} moved to Deleted.`);
  }

  async function restoreSale(sale: Sale) {
    setMessage("");
    const { error } = await supabase.from("sales").update({ sale_status: "Sold" }).eq("id", sale.id);
    if (error) { setMessage(error.message); return; }
    setSales((current) => current.filter((s) => s.id !== sale.id));
    if (selectedSaleId === sale.id) setSelectedSaleId(null);
    if (sale.inventory_order_id != null) {
      await syncOrderFromSales(sale.inventory_order_id);
    }
    setMessage("Sale restored to Active.");
  }

  async function archiveSale(sale: Sale) {
    const confirmed = window.confirm("Move this sale to Archived Sales?");
    if (!confirmed) {
      return;
    }

    setMessage("");

    const { error } = await supabase
      .from("sales")
      .update({ sale_status: "Archived" })
      .eq("id", sale.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSales((current) => current.filter((row) => row.id !== sale.id));
    if (selectedSaleId === sale.id) {
      setSelectedSaleId(null);
    }
    setMessage("Sale archived");
  }

  async function autoArchivePastSales(loadedSales: Sale[]): Promise<number[]> {
    const toArchive: number[] = [];
    for (const s of loadedSales) {
      const status = s.sale_status ?? "";
      if (status === "Archived" || status === "Deleted" || status === "Cancelled / Issue") continue;
      if (s.payment_status === "Paid") {
        toArchive.push(s.id);
      }
    }

    if (toArchive.length === 0) return [];
    await supabase.from("sales").update({ sale_status: "Archived" }).in("id", toArchive);
    return toArchive;
  }

  async function syncOrderFromSales(orderId: number) {
    const [{ data, error }, { data: orderData }] = await Promise.all([
      supabase
        .from("sales")
        .select("sale_total, payout_total, qty_sold")
        .eq("inventory_order_id", orderId)
        .neq("sale_status", "Deleted"),
      supabase
        .from("orders")
        .select("qty_bought")
        .eq("id", orderId)
        .single(),
    ]);

    if (error) {
      throw new Error(error.message);
    }

    const linkedSales = (data || []) as { sale_total?: number | null; payout_total?: number | null; qty_sold?: number | null }[];
    const soldTotal = linkedSales.reduce((sum, sale) => sum + (sale.sale_total ?? sale.payout_total ?? 0), 0);
    const qtySold = linkedSales.reduce((sum, sale) => sum + (sale.qty_sold ?? 0), 0);
    const qtyBought = (orderData as { qty_bought?: number | null } | null)?.qty_bought ?? 0;

    let newStatus: string;
    if (linkedSales.length === 0) {
      newStatus = "Unlisted";
    } else if (qtyBought > 0 && qtySold < qtyBought) {
      newStatus = "Partially Sold";
    } else {
      newStatus = "Sold";
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        sold_total: linkedSales.length > 0 ? soldTotal : null,
        listing_status: newStatus,
      })
      .eq("id", orderId);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  async function handleMassMatch(saleGroupKey: string) {
    const targetId = massMatchInput.trim().padStart(5, "0");
    const targetOrders = allOrders.filter((o) => {
      const key = `${o.event_name || "Untitled ticket"}__${o.venue || "Venue missing"}__${o.event_date || "Date missing"}`;
      return computeGroupId(key) === targetId;
    });

    if (targetOrders.length === 0) {
      setMessage(`No order group found with ID ${targetId}`);
      return;
    }

    setMassMatchLoading(true);
    const group = groupedSales.find((g) => g.key === saleGroupKey);
    const targetOrderIds = new Set(targetOrders.map((o) => o.id));

    // ── Reset phase ──────────────────────────────────────────────────────────
    // Delete any overflow records previously created by mass match for these orders
    await supabase
      .from("sales")
      .delete()
      .in("inventory_order_id", [...targetOrderIds])
      .not("split_of_sale_id", "is", null);

    // Also delete orphaned overflow records (inventory_order_id null) whose
    // parent sale is in this sale group
    const groupSaleIds = (group?.sales ?? []).filter((s) => s.split_of_sale_id == null).map((s) => s.id);
    if (groupSaleIds.length > 0) {
      await supabase
        .from("sales")
        .delete()
        .in("split_of_sale_id", groupSaleIds);
    }

    // Unlink any sales in this group already matched to the target orders
    const alreadyLinked = (group?.sales ?? []).filter(
      (s) => s.inventory_order_id != null && targetOrderIds.has(s.inventory_order_id) && s.split_of_sale_id == null,
    );
    if (alreadyLinked.length > 0) {
      await supabase
        .from("sales")
        .update({ inventory_order_id: null, match_confidence: null })
        .in("id", alreadyLinked.map((s) => s.id));
    }

    // All non-overflow sales in this group are now candidates
    const unmatchedSales = (group?.sales ?? []).filter((s) => s.split_of_sale_id == null);

    // Fresh capacity — every order starts at full qty_bought
    const orderCapacity = new Map<number, number>(
      targetOrders.map((o) => [o.id, o.qty_bought ?? 1])
    );
    const matchedOrderIds = new Set<number>();
    let matched = 0;

    type Pending = { saleId: number; qty: number; payout: number | null; ref: Sale; overflowOf: number | null };
    const queue: Pending[] = unmatchedSales.map((s) => ({
      saleId: s.id, qty: s.qty_sold ?? 1, payout: s.sale_total ?? s.payout_total, ref: s, overflowOf: null,
    }));

    for (const pending of queue) {
      let bestOrder: MatchedOrder | null = null;
      let bestScore = -1;

      for (const order of targetOrders) {
        if ((orderCapacity.get(order.id) ?? 0) <= 0) continue;
        const score = getManualMatchScore(pending.ref, order);
        if (score > bestScore) { bestScore = score; bestOrder = order; }
      }

      if (!bestOrder) {
        bestOrder = targetOrders.find((o) => (orderCapacity.get(o.id) ?? 0) > 0) ?? null;
      }

      if (!bestOrder) continue;

      const available = orderCapacity.get(bestOrder.id) ?? 0;
      const toAssign = Math.min(pending.qty, available);
      const fraction = toAssign / pending.qty;
      const assignedPayout = pending.payout != null ? Math.round(pending.payout * fraction * 100) / 100 : null;
      const remainder = pending.qty - toAssign;

      if (remainder > 0) {
        // Split: update this sale record with the capped qty, create overflow for the rest
        const overflowPayout = pending.payout != null ? Math.round(pending.payout * (1 - fraction) * 100) / 100 : null;

        const { error: updateErr } = await supabase
          .from("sales")
          .update({
            inventory_order_id: bestOrder.id,
            qty_sold: toAssign,
            sale_total: assignedPayout,
            price_per_ticket: toAssign > 0 && assignedPayout != null ? Math.round(assignedPayout / toAssign * 100) / 100 : null,
            match_confidence: bestScore > 0 ? bestScore / 100 : null,
          })
          .eq("id", pending.saleId);

        if (!updateErr) {
          matched++;
          orderCapacity.set(bestOrder.id, available - toAssign);
          matchedOrderIds.add(bestOrder.id);

          // Insert overflow record, then queue it for matching
          const { data: ovRow } = await supabase
            .from("sales")
            .insert({
              source: pending.ref.source,
              source_message_id: `${pending.ref.source_message_id}-overflow-${bestOrder.id}`,
              event_name: pending.ref.event_name,
              venue: pending.ref.venue,
              event_date: pending.ref.event_date,
              section: pending.ref.section,
              row: pending.ref.row,
              seat_from: pending.ref.seat_from,
              seat_to: pending.ref.seat_to,
              account_email: pending.ref.account_email,
              buyer_email: pending.ref.buyer_email,
              currency: pending.ref.currency,
              sale_status: pending.ref.sale_status,
              price_per_ticket: pending.ref.price_per_ticket,
              qty_sold: remainder,
              sale_total: overflowPayout,
              split_of_sale_id: pending.overflowOf ?? pending.saleId,
              inventory_order_id: null,
              match_confidence: null,
            })
            .select("id")
            .single();

          if (ovRow) {
            queue.push({ saleId: ovRow.id, qty: remainder, payout: overflowPayout, ref: pending.ref, overflowOf: pending.overflowOf ?? pending.saleId });
          }
        }
      } else {
        // Sale fits entirely within order capacity
        const { error } = await supabase
          .from("sales")
          .update({ inventory_order_id: bestOrder.id, match_confidence: bestScore > 0 ? bestScore / 100 : null })
          .eq("id", pending.saleId);

        if (!error) {
          matched++;
          orderCapacity.set(bestOrder.id, available - toAssign);
          matchedOrderIds.add(bestOrder.id);
        }
      }
    }

    for (const orderId of matchedOrderIds) {
      await syncOrderFromSales(orderId);
    }

    await loadSales(true);
    setMassMatchGroupKey(null);
    setMassMatchInput("");
    setMassMatchLoading(false);
    setMessage(`Mass matched ${matched} of ${unmatchedSales.length} sale${unmatchedSales.length !== 1 ? "s" : ""} to order group #${targetId} — synced ${matchedOrderIds.size} order${matchedOrderIds.size !== 1 ? "s" : ""}`);
  }

  function findOrdersByGroupId(id: string): MatchedOrder[] {
    const targetId = id.trim().padStart(5, "0");
    return allOrders.filter((o) => {
      const key = `${o.event_name || "Untitled ticket"}__${o.venue || "Venue missing"}__${o.event_date || "Date missing"}`;
      return computeGroupId(key) === targetId;
    });
  }

  async function matchSaleToOrder(sale: Sale, order: MatchedOrder, score: number) {
    setMatchingOrderId(order.id);
    setMessage("");

    try {
      const previousOrderId = sale.inventory_order_id;
      const { error } = await supabase
        .from("sales")
        .update({
          inventory_order_id: order.id,
          match_confidence: Number((score / 100).toFixed(2)),
        })
        .eq("id", sale.id);

      if (error) {
        setMessage(error.message);
        return;
      }

      await syncOrderFromSales(order.id);
      if (previousOrderId != null && previousOrderId !== order.id) {
        await syncOrderFromSales(previousOrderId);
      }

      await loadSales(true);
      setMessage(`Matched ${sale.external_sale_id || "sale"} to ${order.booking_ref || "ticket"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to match sale");
    } finally {
      setMatchingOrderId(null);
    }
  }

  async function unmatchSale(sale: Sale) {
    if (sale.inventory_order_id == null) {
      return;
    }

    const confirmed = window.confirm("Remove the current matched ticket from this sale?");
    if (!confirmed) {
      return;
    }

    setUnmatching(true);
    setMessage("");

    try {
      const previousOrderId = sale.inventory_order_id;
      const { error } = await supabase
        .from("sales")
        .update({
          inventory_order_id: null,
          match_confidence: null,
        })
        .eq("id", sale.id);

      if (error) {
        setMessage(error.message);
        return;
      }

      await syncOrderFromSales(previousOrderId);
      await loadSales(true);
      setMessage("Sale unmatched");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to unmatch sale");
    } finally {
      setUnmatching(false);
    }
  }

  function openAddSale() {
    setAddSaleOrderId(null);
    setAddSaleSearch("");
    setAddSaleForm({ qty_sold: "1", sale_price: "", buyer_email: "", sold_at: new Date().toISOString().slice(0, 10), event_name: "", venue: "", event_date: "", section: "", row: "", seat_from: "", seat_to: "", marketplace: "" });
    setShowAddSale(true);
  }

  function closeAddSale() {
    setShowAddSale(false);
    setAddSaleOrderId(null);
    setAddSaleSearch("");
  }

  async function addSaleManually() {
    const order = addSaleOrderId != null ? allOrders.find((o) => o.id === addSaleOrderId) : null;
    const payout = addSaleForm.sale_price !== "" ? Number(addSaleForm.sale_price) : null;
    const qty = addSaleForm.qty_sold !== "" ? Number(addSaleForm.qty_sold) : null;

    const newSale = {
      source: "manual" as const,
      source_message_id: `manual-${Date.now()}`,
      event_name: addSaleForm.event_name || order?.event_name || null,
      venue: addSaleForm.venue || order?.venue || null,
      event_date: addSaleForm.event_date || order?.event_date || null,
      sold_at: addSaleForm.sold_at ? new Date(addSaleForm.sold_at).toISOString() : new Date().toISOString(),
      account_email: order?.account_email ?? null,
      buyer_email: addSaleForm.buyer_email || null,
      qty_sold: qty,
      sale_total: payout,
      price_per_ticket: qty && payout ? payout / qty : payout,
      currency: "GBP",
      section: addSaleForm.section || order?.section || null,
      row: addSaleForm.row || order?.row || null,
      seat_from: addSaleForm.seat_from || order?.seat_from || null,
      seat_to: addSaleForm.seat_to || order?.seat_to || null,
      marketplace: addSaleForm.marketplace || null,
      sale_status: "Sold – Awaiting Transfer",
      inventory_order_id: order?.id ?? null,
      match_confidence: order ? 1 : null,
    };

    setSavingNewSale(true);
    setMessage("");

    const { error } = await supabase.from("sales").insert(newSale);
    if (error) {
      setMessage(error.message);
      setSavingNewSale(false);
      return;
    }

    if (order) {
      await syncOrderFromSales(order.id);
    }

    setSavingNewSale(false);
    closeAddSale();
    await loadSales(true);
    setMessage("Sale added");
  }

  async function openEmailModal() {
    if (!selectedSale) return;
    const seatLabel = formatSeatLabel(selectedSale.row, selectedSale.seat_from, selectedSale.seat_to);
    const customerName = selectedSale.buyer_email?.split("@")[0] ?? "";
    const tmpl = loadTemplate();
    const vars = {
      customer_name: customerName,
      event_name: selectedSale.event_name ?? "",
      event_date: formatEventDate(selectedSale.event_date),
      venue: selectedSale.venue ?? "",
      section: selectedSale.section ?? "",
      seats: seatLabel,
      quantity: selectedSale.qty_sold ?? "",
    };
    setEmailSubject(interpolate(tmpl.subject, vars));
    setEmailBody(interpolate(tmpl.body, vars));
    setEmailError("");

    const { data } = await supabase
      .from("gmail_accounts")
      .select("id, email, provider")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    const accounts = (data as { id: string; email: string; provider: string }[]) || [];
    setConnectedAccounts(accounts);
    setEmailFromAccountId(accounts[0]?.id ?? "");
    setShowEmailModal(true);
  }

  function closeEmailModal() {
    setShowEmailModal(false);
    setEmailSubject("");
    setEmailBody("");
    setEmailError("");
    setEmailFromAccountId("");
  }

  function markThankYouSent(saleId: number) {
    setThankYouSentIds((prev) => {
      const next = { ...prev, [saleId]: true as const };
      try {
        localStorage.setItem("sent_thankyou_sale_ids", JSON.stringify(Object.keys(next).map(Number)));
      } catch { /* ignore */ }
      return next;
    });
  }

  async function sendBuyerEmail() {
    if (!selectedSale) return;
    const saleId = selectedSale.id;
    const buyerEmail = selectedSale.buyer_email;
    setSendingEmail(true);
    setEmailError("");
    try {
      const response = await fetch("/api/send-buyer-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId, accountId: emailFromAccountId, subject: emailSubject, body: emailBody }),
      });
      const result = await response.json();
      if (!response.ok) {
        setEmailError(result.error || "Failed to send email");
        return;
      }
      markThankYouSent(saleId);
      closeEmailModal();
      setMessage(`Email sent to ${buyerEmail}`);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  }

  function toggleGroup(key: string) {
    setExpandedGroups((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  }

  function resetFilters() {
    setSearch("");
    setMatchFilter("All");
    setAccountFilter("All");
    setSortBy("event-soonest");
    setStatusFilter("All");
  }

  const accountOptions = useMemo(() => {
    const values = sales
      .map((sale) => sale.account_email)
      .filter((value): value is string => Boolean(value));

    return ["All", ...new Set(values)];
  }, [sales]);

  const platformOptions = useMemo(() => {
    const presets = ["Viagogo", "StubHub", "TiCombo", "Lysted", "Private Broker", "Ticketmaster", "AXS"];
    const fromSales = sales
      .map((s) => s.marketplace)
      .filter((v): v is string => Boolean(v));
    const merged = [...new Set([...presets, ...fromSales])].sort();
    return merged;
  }, [sales]);

  const lifecycleMetrics = useMemo(() => {
    let ticketsSold = 0, revenueReceived = 0, awaitingPayment = 0, awaitingTransferCount = 0;
    for (const s of metricSales) {
      const payout = s.sale_total ?? s.payout_total ?? 0;
      const payStatus = s.payment_status || "Awaiting Payment";
      const saleStatus = s.sale_status || "Sold – Awaiting Transfer";
      const isActive = saleStatus !== "Archived" && saleStatus !== "Paid" && saleStatus !== "Deleted";

      if (isActive) ticketsSold += s.qty_sold ?? 0;

      if (payStatus === "Paid" || saleStatus === "Paid") {
        revenueReceived += payout;
      } else if (saleStatus !== "Cancelled / Issue") {
        awaitingPayment += payout;
      }
      const transStatus = s.transfer_status || "Awaiting Transfer";
      if (isActive && transStatus === "Awaiting Transfer" && saleStatus !== "Cancelled / Issue") {
        awaitingTransferCount += s.qty_sold ?? 1;
      }
    }
    return { ticketsSold, revenueReceived, awaitingPayment, awaitingTransferCount };
  }, [metricSales]);

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

      const matchesAccount = accountFilter === "All" || sale.account_email === accountFilter;

      const effectiveStatus = sale.sale_status || "Sold – Awaiting Transfer";
      const matchesStatus =
        statusFilter === "All" ||
        effectiveStatus === statusFilter ||
        (statusFilter === "Paid" && effectiveStatus === "Sold");

      return matchesSearch && matchesMatch && matchesAccount && matchesStatus;
    });
  }, [sales, search, matchFilter, accountFilter, statusFilter]);

  const groupedSales = useMemo(() => {
    const map = new Map<string, SaleGroup>();
    const buyersByKey = new Map<string, Set<string>>();

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
          dateValue: parseEventDateValue(eventDate),
          latestSoldAt: null,
          sales: [],
          salesCount: 0,
          ticketsSold: 0,
          soldFor: 0,
          profit: 0,
          cost: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          hasNew: false,
          awaitingTransferQty: 0,
          transferCompletedQty: 0,
          awaitingPaymentAmount: 0,
          paidAmount: 0,
          buyerDisplay: "",
          inventoryLinked: false,
        });
      }

      const group = map.get(key)!;
      group.sales.push(sale);
      if (sale.sold_at) {
        const soldDate = new Date(sale.sold_at);
        if (!group.latestSoldAt || soldDate > group.latestSoldAt) group.latestSoldAt = soldDate;
      }
      // Don't count split/overflow records as separate sale entries in header counts
      if (sale.split_of_sale_id == null) {
        group.salesCount += 1;
        if (sale.created_at && new Date(sale.created_at).getTime() > Date.now() - 86400000) group.hasNew = true;
        if (sale.inventory_order_id != null) { group.matchedCount += 1; group.inventoryLinked = true; }
        else group.unmatchedCount += 1;

        const platform = sale.marketplace;
        if (platform) {
          if (!buyersByKey.has(key)) buyersByKey.set(key, new Set());
          buyersByKey.get(key)!.add(platform);
        }
      }

      // Always count transfer/payment status for ALL sales including splits —
      // splits represent real tickets that still need to be transferred and paid
      {
        const transferStatus = sale.transfer_status || "Awaiting Transfer";
        const paymentStatus = sale.payment_status || "Awaiting Payment";
        const saleStatus = sale.sale_status || "Sold – Awaiting Transfer";
        if (transferStatus === "Awaiting Transfer") group.awaitingTransferQty += ticketsSold;
        else if (transferStatus === "Transfer Completed") group.transferCompletedQty += ticketsSold;
        if (paymentStatus === "Paid" || saleStatus === "Paid") group.paidAmount += soldFor;
        else if (saleStatus !== "Cancelled / Issue") group.awaitingPaymentAmount += soldFor;
      }
      // But always count tickets, revenue, and cost (overflows contribute real qty and revenue)
      group.ticketsSold += ticketsSold;
      group.soldFor += soldFor;
      group.cost += cost ?? 0;
      if (sale.inventory_order_id != null) {
        group.profit += profit ?? 0;
      }
    }

    // Resolve buyer display for each group
    for (const [key, group] of map) {
      const buyers = Array.from(buyersByKey.get(key) ?? new Set<string>()).filter(Boolean);
      group.buyerDisplay = buyers.length === 0 ? "" : buyers.length === 1 ? buyers[0] : "Multiple";
    }

    // Sort sales within each group by section → row → seat_from (numeric)
    for (const group of map.values()) {
      group.sales.sort((a, b) => {
        const secCmp = (a.section || "").localeCompare(b.section || "");
        if (secCmp !== 0) return secCmp;
        const rowA = parseInt(a.row || "0") || a.row?.charCodeAt(0) || 0;
        const rowB = parseInt(b.row || "0") || b.row?.charCodeAt(0) || 0;
        if (rowA !== rowB) return rowA - rowB;
        return (parseInt(a.seat_from || "0") || 0) - (parseInt(b.seat_from || "0") || 0);
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      switch (sortBy) {
        case "recently-sold":
          if (a.latestSoldAt && b.latestSoldAt) return b.latestSoldAt.getTime() - a.latestSoldAt.getTime();
          return a.latestSoldAt ? -1 : b.latestSoldAt ? 1 : 0;
        case "oldest-sold":
          if (a.latestSoldAt && b.latestSoldAt) return a.latestSoldAt.getTime() - b.latestSoldAt.getTime();
          return a.latestSoldAt ? -1 : b.latestSoldAt ? 1 : 0;
        case "event-soonest":
          if (a.dateValue && b.dateValue) return a.dateValue.getTime() - b.dateValue.getTime();
          return a.dateValue ? -1 : b.dateValue ? 1 : 0;
        case "event-latest":
          if (a.dateValue && b.dateValue) return b.dateValue.getTime() - a.dateValue.getTime();
          return a.dateValue ? -1 : b.dateValue ? 1 : 0;
        case "highest-profit":
          return b.profit - a.profit;
        case "highest-revenue":
          return b.soldFor - a.soldFor;
        default:
          return 0;
      }
    });
  }, [filteredSales, matchedOrders, allOrders, sortBy]);


  const selectedSale = selectedSaleRaw;
  const selectedOrder = selectedSale ? getReferenceOrderForSale(selectedSale, matchedOrders, allOrders) : null;
  const selectedProfit = selectedSale ? getSaleProfit(selectedSale, selectedOrder) : null;
  const matchSuggestions = useMemo(
    () => (selectedSale ? getMatchSuggestions(selectedSale, allOrders) : []),
    [selectedSale, allOrders],
  );

  const filteredOrdersForAdd = useMemo(() => {
    const q = addSaleSearch.trim().toLowerCase();
    const base = allOrders.filter((o) => o.listing_status !== "Archived");
    if (!q) return base;
    return base.filter((o) =>
      [o.booking_ref, o.event_name, o.venue, o.section, o.row, o.account_email]
        .some((f) => f?.toLowerCase().includes(q)),
    );
  }, [allOrders, addSaleSearch]);

  const selectedOrderForAdd = useMemo(
    () => (addSaleOrderId != null ? allOrders.find((o) => o.id === addSaleOrderId) ?? null : null),
    [addSaleOrderId, allOrders],
  );

  const selectedStats = useMemo((): MultiSaleStats | null => {
    if (selectedSaleIds.size === 0) return null;
    const arr = sales.filter(s => selectedSaleIds.has(s.id));
    let totalTickets = 0, totalRevenue = 0, totalCost = 0;
    const seenEvents = new Set<string>();
    for (const s of arr) {
      totalTickets += s.qty_sold ?? 0;
      totalRevenue += s.sale_total ?? s.payout_total ?? 0;
      totalCost += getSaleCost(s, getReferenceOrderForSale(s, matchedOrders, allOrders));
      if (s.event_name) seenEvents.add(s.event_name);
    }
    const totalProfit = totalRevenue - totalCost;
    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : null;
    return { salesCount: arr.length, totalTickets, totalRevenue, totalCost, totalProfit, roi, eventNames: Array.from(seenEvents) };
  }, [selectedSaleIds, sales, matchedOrders, allOrders]);

  function toggleSaleSelection(id: number) {
    setSelectedSaleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroupSelection(groupSales: Sale[], allSelected: boolean) {
    const ids = groupSales.map(s => s.id);
    setSelectedSaleIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  async function applyMassUpdate(updates: {
    transfer_status?: string;
    payment_status?: string;
    sale_status?: string;
    payout_date?: string | null;
  }) {
    if (selectedSaleIds.size === 0 || massUpdating) return;
    setMassUpdating(true);
    const ids = [...selectedSaleIds];
    const { error } = await supabase.from("sales").update(updates).in("id", ids);
    if (error) {
      setMessage("Bulk update failed: " + error.message);
    } else {
      setSales(prev => prev.map(s => ids.includes(s.id) ? { ...s, ...updates } : s));
      setSelectedSaleIds(new Set());
      setMessage(`${ids.length} sale${ids.length === 1 ? "" : "s"} updated`);
    }
    setMassUpdating(false);
  }

  const manualResults = useMemo(() => {
    const q = manualSearch.trim().toLowerCase();
    if (!q || !selectedSale) return [];
    return allOrders
      .filter((o) =>
        [o.booking_ref, o.event_name, o.venue, o.section, o.row]
          .some((f) => f?.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [manualSearch, allOrders, selectedSale]);

  return (
    <div className={`orders-shell${selectedSale ? " orders-shell-drawer-open" : ""}`}>
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
            <p className="eyebrow">Sales desk</p>
            <h2>Sales</h2>
          </div>

          <div className="topbar-actions">
            <button className="secondary-button" onClick={() => void loadSales(true)} disabled={refreshing} type="button">
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button className="secondary-button" onClick={exportSalesCSV} type="button">
              Export CSV
            </button>
            {!showArchived && !showDeleted && (
              <>
                <button className="secondary-button" onClick={() => void scanSalesNow()} disabled={scanning} type="button">
                  {scanning ? "Scanning..." : "Scan Sales"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    const allIds = new Set(filteredSales.map(s => s.id));
                    const allSelected = filteredSales.length > 0 && filteredSales.every(s => selectedSaleIds.has(s.id));
                    setSelectedSaleIds(allSelected ? new Set() : allIds);
                  }}
                >
                  {filteredSales.length > 0 && filteredSales.every(s => selectedSaleIds.has(s.id))
                    ? "Deselect All"
                    : `Select All (${filteredSales.length})`}
                </button>
                <button className="secondary-button" onClick={() => setShowImportModal(true)} type="button">
                  Import CSV
                </button>
                <button className="primary-button" onClick={openAddSale} type="button">
                  + Add Sale
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

        <div style={{ display: "flex", gap: 10, paddingBottom: 16, flexWrap: "wrap" }}>
          {([
            { label: "Active Tickets Sold", value: String(lifecycleMetrics.ticketsSold),             color: "rgba(255,255,255,0.9)", filterStatus: null },
            { label: "Revenue Received",  value: formatCurrency(lifecycleMetrics.revenueReceived), color: "#4ade80",              filterStatus: "Paid" },
            { label: "Awaiting Payment",  value: formatCurrency(lifecycleMetrics.awaitingPayment), color: "#fbbf24",              filterStatus: null },
            { label: "Awaiting Transfer", value: String(lifecycleMetrics.awaitingTransferCount),   color: "#f97316",              filterStatus: "Sold – Awaiting Transfer" },
          ] as const).map((m) => (
            <div
              key={m.label}
              onClick={m.filterStatus ? () => setStatusFilter(statusFilter === m.filterStatus ? "All" : m.filterStatus!) : undefined}
              style={{
                flex: "1 1 130px",
                background: statusFilter === m.filterStatus ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${statusFilter === m.filterStatus ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 10,
                padding: "12px 16px",
                cursor: m.filterStatus ? "pointer" : "default",
                transition: "all 150ms ease",
              }}
            >
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>

        <section className="command-card">
          <div className="command-header">
            <div className="view-toggle">
              <button
                type="button"
                className={!showArchived && !showDeleted ? "toggle-btn toggle-btn-active" : "toggle-btn"}
                onClick={() => { setShowArchived(false); setShowDeleted(false); setSelectedSaleId(null); }}
              >
                Active
              </button>
              <button
                type="button"
                className={showArchived ? "toggle-btn toggle-btn-active" : "toggle-btn"}
                onClick={() => { setShowArchived(true); setShowDeleted(false); setSelectedSaleId(null); }}
              >
                Archived
              </button>
              <button
                type="button"
                className={showDeleted ? "toggle-btn toggle-btn-active" : "toggle-btn"}
                onClick={() => { setShowDeleted(true); setShowArchived(false); setSelectedSaleId(null); }}
              >
                Deleted
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ghost-button" type="button" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </div>

          <div className="sales-filter-grid">
            <label className="filter-field">
              <span className="filter-label">Search</span>
              <input
                className="field field-search"
                placeholder="Search event, venue, account, section..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">Match</span>
              <select className="field" value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)}>
                {matchFilterOptions.map((option) => (
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
              <span className="filter-label">Status</span>
              <select className="field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="All">All statuses</option>
                <option value="Sold – Awaiting Transfer">Awaiting Transfer</option>
                <option value="Sold – Transfer Completed">Transfer Completed</option>
                <option value="Paid">Paid</option>
                <option value="Cancelled / Issue">Cancelled / Issue</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">Sort by</span>
              <select className="field" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="recently-sold">Recently sold</option>
                <option value="oldest-sold">Oldest sold</option>
                <option value="event-soonest">Event date (soonest)</option>
                <option value="event-latest">Event date (latest)</option>
                <option value="highest-profit">Highest profit</option>
                <option value="highest-revenue">Highest revenue</option>
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

                const groupId = computeGroupId(group.key);
                const isMassMatchActive = massMatchGroupKey === group.key;

                return (
                  <article
                    key={group.key}
                    className={`inventory-group-card${group.unmatchedCount > 0 ? " inventory-group-risk" : ""}${expanded ? " inventory-group-open" : ""}`}
                  >
                    <div className="inventory-group-header-row">
                    <button className="inventory-group-toggle" type="button" onClick={() => toggleGroup(group.key)}>
                      <div className="inventory-group-main">
                        <div className="inventory-group-title">
                          <strong>{group.eventName}</strong>
                          <span>{group.venue}</span>
                          <small>{formatEventDate(group.eventDate)}</small>
                          {group.hasNew && <span className="new-badge">New</span>}
                        </div>

                        <div className="inventory-group-metrics">
                          <div className="inventory-metric-chip">
                            <span>Tickets</span>
                            <strong>{group.ticketsSold}</strong>
                          </div>
                          <div className="inventory-metric-chip">
                            <span>Sold for</span>
                            <strong>{formatCurrency(group.soldFor)}</strong>
                          </div>
                          {group.awaitingPaymentAmount > 0 && (
                            <div className="inventory-metric-chip">
                              <span>Awaiting</span>
                              <strong style={{ color: "#fbbf24" }}>{formatCurrency(group.awaitingPaymentAmount)}</strong>
                            </div>
                          )}
                          <div className="inventory-status-row">
                            {group.awaitingTransferQty > 0 && (
                              <span className="status-badge status-static" style={{ background: "rgba(249,115,22,0.15)", color: "#f97316", border: "1px solid rgba(249,115,22,0.3)" }}>
                                {group.awaitingTransferQty} to transfer
                              </span>
                            )}
                            {group.transferCompletedQty > 0 && (
                              <span className="status-badge status-static" style={{ background: "rgba(79,195,255,0.12)", color: "#4fc3ff", border: "1px solid rgba(79,195,255,0.25)" }}>
                                {group.transferCompletedQty} transferred
                              </span>
                            )}
                            {group.paidAmount > 0 && (
                              <span className="status-badge status-static" style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.25)" }}>
                                Paid {formatCurrency(group.paidAmount)}
                              </span>
                            )}
                            {group.inventoryLinked && (
                              <span className="status-badge status-static" style={{ background: "rgba(155,92,255,0.12)", color: "#9b5cff", border: "1px solid rgba(155,92,255,0.25)" }}>
                                Inventory linked
                              </span>
                            )}
                            {group.unmatchedCount > 0 && (
                              <span className="status-badge status-static status-problem">Review {group.unmatchedCount}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="inventory-group-side">
                        <div className="inventory-progress-block">
                          <span>{group.matchedCount}/{group.salesCount} matched</span>
                          <div className="inventory-progress-track">
                            <div className="inventory-progress-fill" style={{ width: `${Math.max(matchedRatio, 6)}%` }} />
                          </div>
                        </div>
                        <span className="inventory-chevron">{expanded ? "−" : "+"}</span>
                      </div>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", flexShrink: 0 }}>
                      <span
                        className="group-id-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigator.clipboard.writeText(groupId);
                          setCopiedSaleGroupId(group.key);
                          setTimeout(() => setCopiedSaleGroupId(null), 1500);
                        }}
                        title="Click to copy group ID"
                      >
                        {copiedSaleGroupId === group.key ? "Copied!" : `#${groupId}`}
                      </span>
                      {group.unmatchedCount > 0 && (
                        <button
                          className={`merge-btn${isMassMatchActive ? " merge-btn-active" : ""}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMassMatchActive) { setMassMatchGroupKey(null); setMassMatchInput(""); }
                            else { setMassMatchGroupKey(group.key); setMassMatchInput(""); }
                          }}
                        >
                          {isMassMatchActive ? "Cancel" : "Mass match"}
                        </button>
                      )}
                    </div>
                    </div>

                    {isMassMatchActive && (
                      <div style={{ padding: "10px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "var(--text-2)", flexShrink: 0 }}>Order group ID:</span>
                        <input
                          className="field field-compact"
                          placeholder="e.g. 24157"
                          value={massMatchInput}
                          onChange={(e) => setMassMatchInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && massMatchInput.trim()) void handleMassMatch(group.key); }}
                          style={{ width: 110 }}
                          autoFocus
                        />
                        <button
                          className="primary-button"
                          type="button"
                          disabled={massMatchLoading || !massMatchInput.trim()}
                          onClick={() => void handleMassMatch(group.key)}
                        >
                          {massMatchLoading ? "Matching…" : `Match ${group.unmatchedCount} sale${group.unmatchedCount !== 1 ? "s" : ""}`}
                        </button>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Copy the group ID from the Tickets page and paste it here</span>
                      </div>
                    )}

                    {expanded ? (
                      <div className="inventory-ticket-stack sales-ticket-grid">
                        <div className="inventory-ticket-header">
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={group.sales.length > 0 && group.sales.every(s => selectedSaleIds.has(s.id))}
                              onChange={() => toggleGroupSelection(group.sales, group.sales.every(s => selectedSaleIds.has(s.id)))}
                              onClick={e => e.stopPropagation()}
                              style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#9b5cff", flexShrink: 0 }}
                            />
                            Seat
                          </span>
                          <span>Platform</span>
                          <span>Buyer</span>
                          <span>Value</span>
                          <span>Status</span>
                          <span></span>
                        </div>
                        {group.sales.map((sale) => {
                          const matchedOrder = getReferenceOrderForSale(sale, matchedOrders, allOrders);
                          const isUnmatched = sale.inventory_order_id == null;
                          const topSuggestion = isUnmatched ? getMatchSuggestions(sale, allOrders)[0] ?? null : null;
                          const isNew = sale.created_at ? new Date(sale.created_at).getTime() > Date.now() - 86400000 : false;
                          const isChecked = selectedSaleIds.has(sale.id);
                          return (
                            <div key={sale.id}>
                              <div
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
                                style={{ cursor: "pointer", background: isChecked ? "rgba(155,92,255,0.07)" : undefined }}
                              >
                                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleSaleSelection(sale.id)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#9b5cff", flexShrink: 0 }}
                                  />
                                  <div className="inventory-ticket-seat">
                                    <strong>{formatFullSeatLabel(sale.section, sale.row, sale.seat_from, sale.seat_to)}</strong>
                                    <span className="sale-qty-badge">{sale.qty_sold ?? 1} ticket{(sale.qty_sold ?? 1) !== 1 ? "s" : ""}</span>
                                    {(sale.buyer_name || sale.marketplace) && (
                                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>
                                        {[sale.buyer_name, sale.marketplace].filter(Boolean).join(" · ")}
                                      </span>
                                    )}
                                    {sale.external_sale_id && <span className="sale-id-chip">{sale.external_sale_id}</span>}
                                    {isNew && <span className="new-badge new-badge-inline">New</span>}
                                    {sale.split_of_sale_id != null && <span className="new-badge new-badge-inline" style={{ background: "rgba(255,180,0,0.15)", color: "#f5c842", borderColor: "rgba(255,180,0,0.3)" }}>↳ Split</span>}
                                  </div>
                                </div>
                                <span className="truncate-text" title={sale.marketplace || ""}>
                                  {sale.marketplace || "—"}
                                </span>
                                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                                  <span className="truncate-text" title={sale.buyer_email || ""}>{sale.buyer_email || "—"}</span>
                                  {sale.buyer_email && thankYouSentIds[sale.id] && (
                                    <span style={{ fontSize: "10px", color: "#22c55e", fontWeight: 600, letterSpacing: "0.02em" }}>✓ Email sent</span>
                                  )}
                                </div>
                                <strong className="inventory-cost-value">
                                  {formatCurrency(sale.sale_total ?? sale.payout_total)}
                                </strong>
                                <span
                                  className="status-badge status-static"
                                  style={getLifecycleBadgeStyle(sale.sale_status)}
                                >
                                  {getLifecycleLabel(sale.sale_status)}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setShareSaleId(sale.id); }}
                                  title="Share this sale"
                                  style={{
                                    background: "rgba(155,92,255,0.12)",
                                    border: "1px solid rgba(155,92,255,0.25)",
                                    borderRadius: 8,
                                    width: 32, height: 32,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    cursor: "pointer",
                                    transition: "all 150ms ease",
                                    flexShrink: 0,
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(155,92,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="18" cy="5" r="3" />
                                    <circle cx="6" cy="12" r="3" />
                                    <circle cx="18" cy="19" r="3" />
                                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                  </svg>
                                </button>
                              </div>
                              {isUnmatched && topSuggestion && (
                                <div className="inline-match-row">
                                  <div className="inline-match-info">
                                    <span className="inline-match-label">Best match</span>
                                    <strong>{topSuggestion.order.booking_ref || topSuggestion.order.event_name || "Ticket"}</strong>
                                    {topSuggestion.order.event_date && (
                                      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "1px 7px", display: "inline-block" }}>{formatEventDate(topSuggestion.order.event_date)}</span>
                                    )}
                                    <span>{topSuggestion.order.section || "—"} · {formatSeatLabel(topSuggestion.order.row, topSuggestion.order.seat_from, topSuggestion.order.seat_to)} · {topSuggestion.score}%</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="primary-button"
                                    onClick={(e) => { e.stopPropagation(); void matchSaleToOrder(sale, topSuggestion.order, topSuggestion.score); }}
                                    disabled={matchingOrderId === topSuggestion.order.id}
                                  >
                                    {matchingOrderId === topSuggestion.order.id ? "Matching..." : "Quick match"}
                                  </button>
                                </div>
                              )}
                              {isUnmatched && !topSuggestion && (
                                <div className="inline-match-row inline-match-none">
                                  <span>No candidate found — open detail to search manually</span>
                                </div>
                              )}
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

        {/* ── Selection toolbar ───────────────────────────────────────────── */}
        {selectedSaleIds.size > 0 && selectedStats && (
          <div style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "rgba(14,14,22,0.92)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(155,92,255,0.35)",
            borderRadius: 999,
            padding: "10px 16px 10px 20px",
            boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(155,92,255,0.15), 0 0 30px rgba(155,92,255,0.12)",
            whiteSpace: "nowrap",
            maxWidth: "calc(100vw - 32px)",
            overflowX: "auto",
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginRight: 4 }}>
              {selectedStats.salesCount} selected
            </span>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)" }} />

            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Tickets</span>
              <strong style={{ fontSize: 14, color: "rgba(255,255,255,0.85)" }}>{selectedStats.totalTickets}</strong>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Revenue</span>
              <strong style={{ fontSize: 14, color: "#4fc3ff" }}>{formatCurrency(selectedStats.totalRevenue)}</strong>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Profit</span>
              <strong style={{ fontSize: 14, color: selectedStats.totalProfit >= 0 ? "#4ade80" : "#f87171" }}>
                {selectedStats.totalProfit >= 0 ? "+" : ""}{formatCurrency(selectedStats.totalProfit)}
              </strong>
            </div>

            {selectedStats.roi !== null && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>ROI</span>
                <strong style={{ fontSize: 14, color: selectedStats.totalProfit >= 0 ? "#4ade80" : "#f87171" }}>
                  {selectedStats.roi >= 0 ? "+" : ""}{selectedStats.roi.toFixed(1)}%
                </strong>
              </div>
            )}

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)" }} />

            <button
              type="button"
              onClick={() => setShareMultiOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "linear-gradient(135deg, rgba(155,92,255,0.3), rgba(255,79,163,0.3))",
                border: "1px solid rgba(155,92,255,0.4)",
                borderRadius: 999,
                padding: "6px 14px",
                cursor: "pointer",
                color: "rgba(255,255,255,0.9)",
                fontSize: 13, fontWeight: 600,
                transition: "all 150ms ease",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share Success
            </button>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)" }} />

            <button
              type="button"
              disabled={massUpdating}
              onClick={() => void applyMassUpdate({ transfer_status: "Transfer Completed" })}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "rgba(74,222,128,0.12)",
                border: "1px solid rgba(74,222,128,0.3)",
                borderRadius: 999,
                padding: "6px 12px",
                cursor: massUpdating ? "not-allowed" : "pointer",
                color: "#4ade80",
                fontSize: 12, fontWeight: 600,
                opacity: massUpdating ? 0.5 : 1,
              }}
            >
              ✓ Transferred
            </button>

            <button
              type="button"
              disabled={massUpdating}
              onClick={() => void applyMassUpdate({
                payment_status: "Paid",
                transfer_status: "Transfer Completed",
                sale_status: "Paid",
                payout_date: new Date().toISOString().slice(0, 10),
              })}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "rgba(74,222,128,0.2)",
                border: "1px solid rgba(74,222,128,0.45)",
                borderRadius: 999,
                padding: "6px 12px",
                cursor: massUpdating ? "not-allowed" : "pointer",
                color: "#4ade80",
                fontSize: 12, fontWeight: 600,
                opacity: massUpdating ? 0.5 : 1,
              }}
            >
              £ Paid Out
            </button>

            <button
              type="button"
              disabled={massUpdating}
              onClick={() => void applyMassUpdate({ sale_status: "Archived" })}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 999,
                padding: "6px 12px",
                cursor: massUpdating ? "not-allowed" : "pointer",
                color: "rgba(255,255,255,0.5)",
                fontSize: 12, fontWeight: 600,
                opacity: massUpdating ? 0.5 : 1,
              }}
            >
              Archive
            </button>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)" }} />

            <button
              type="button"
              onClick={() => setSelectedSaleIds(new Set())}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 999,
                padding: "6px 12px",
                cursor: "pointer",
                color: "rgba(255,255,255,0.4)",
                fontSize: 13, fontWeight: 600,
              }}
            >
              Clear
            </button>
          </div>
        )}
      </main>

      {selectedSale ? (
      <aside className="details-drawer details-drawer-open">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Sale detail</p>
            <h4>{selectedSale.event_name || "Untitled sale"}</h4>
          </div>
          <button className="drawer-close" type="button" onClick={() => setSelectedSaleId(null)}>
            ×
          </button>
        </div>

        <div className="drawer-content">
            <section className="drawer-hero">
              <div className="drawer-hero-copy">
                <strong>{selectedSale.event_name || "Untitled sale"}</strong>
                <span>{selectedSale.venue || "Venue missing"}</span>
                <small>{formatEventDate(selectedSale.event_date)}</small>
              </div>
              <div className="drawer-hero-meta">
                <span className="status-badge status-static" style={getLifecycleBadgeStyle(selectedSale.sale_status)}>
                  {getLifecycleLabel(selectedSale.sale_status)}
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
                <input
                  className="field"
                  type="number"
                  min="1"
                  value={saleEdits?.qty_sold ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, qty_sold: e.target.value } : prev)}
                />
              </label>
              <label>
                <span>Price per ticket</span>
                <input
                  className="field"
                  type="number"
                  step="0.01"
                  min="0"
                  value={saleEdits?.price_per_ticket ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, price_per_ticket: e.target.value } : prev)}
                />
              </label>
              <label>
                <span>Total sold for</span>
                <input
                  className="field"
                  type="number"
                  step="0.01"
                  min="0"
                  value={saleEdits?.sale_total ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, sale_total: e.target.value } : prev)}
                />
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
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Lifecycle status</span>
                <select
                  className="field"
                  value={saleEdits?.sale_status ?? selectedSale.sale_status ?? "Sold – Awaiting Transfer"}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSaleEdits((prev) => {
                      if (!prev) return prev;
                      const today = new Date().toISOString().slice(0, 16);
                      const needsTransfer = ["Sold – Transfer Completed", "Paid"].includes(next);
                      return {
                        ...prev,
                        sale_status: next,
                        transfer_status: needsTransfer ? "Transfer Completed" : prev.transfer_status,
                        payment_status: next === "Paid" ? "Paid" : prev.payment_status,
                        transfer_date: needsTransfer && !prev.transfer_date ? today : prev.transfer_date,
                        payout_date: next === "Paid" && !prev.payout_date ? today : prev.payout_date,
                      };
                    });
                  }}
                >
                  <option value="Sold – Awaiting Transfer">Sold – Awaiting Transfer</option>
                  <option value="Sold – Transfer Completed">Sold – Transfer Completed</option>
                  <option value="Paid">Paid</option>
                  <option value="Cancelled / Issue">Cancelled / Issue</option>
                </select>
              </label>
              <label>
                <span>Transfer date</span>
                <input
                  className="field"
                  type="datetime-local"
                  value={saleEdits?.transfer_date ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, transfer_date: e.target.value } : prev)}
                />
              </label>
              <label>
                <span>Expected payout date</span>
                <input
                  className="field"
                  type="datetime-local"
                  value={saleEdits?.expected_payout_date ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, expected_payout_date: e.target.value } : prev)}
                />
              </label>
              <label>
                <span>Payment received date</span>
                <input
                  className="field"
                  type="datetime-local"
                  value={saleEdits?.payout_date ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, payout_date: e.target.value } : prev)}
                />
              </label>
              <label>
                <span>Buyer / Broker name</span>
                <input
                  className="field"
                  placeholder="e.g. John Smith, Private"
                  value={saleEdits?.buyer_name ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, buyer_name: e.target.value } : prev)}
                />
              </label>
              <label>
                <span>Platform</span>
                <select
                  className="field"
                  value={saleEdits?.marketplace ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, marketplace: e.target.value } : prev)}
                >
                  <option value="">— Select platform —</option>
                  {platformOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Transfer status</span>
                <select
                  className="field"
                  value={saleEdits?.transfer_status ?? "Awaiting Transfer"}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, transfer_status: e.target.value } : prev)}
                >
                  <option value="Awaiting Transfer">Awaiting Transfer</option>
                  <option value="Transfer Completed">Transfer Completed</option>
                </select>
              </label>
              <label>
                <span>Payment status</span>
                <select
                  className="field"
                  value={saleEdits?.payment_status ?? "Awaiting Payment"}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, payment_status: e.target.value } : prev)}
                >
                  <option value="Awaiting Payment">Awaiting Payment</option>
                  <option value="Paid">Paid</option>
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Notes</span>
                <textarea
                  className="field"
                  rows={2}
                  placeholder="Any notes about this sale..."
                  value={saleEdits?.notes ?? ""}
                  onChange={(e) => setSaleEdits((prev) => prev ? { ...prev, notes: e.target.value } : prev)}
                  style={{ resize: "vertical", fontFamily: "inherit" }}
                />
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
                <span>Match status</span>
                <strong>{selectedSale.inventory_order_id != null ? "Matched" : "Unmatched"}</strong>
              </div>
            </div>

            <div className="drawer-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {selectedSale.buyer_email ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void openEmailModal()}
                  >
                    {thankYouSentIds[selectedSale.id] ? "✓ Email Sent" : "Send Email"}
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void archiveSale(selectedSale)}
                >
                  Archive Sale
                </button>
                {selectedSale.inventory_order_id != null ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void unmatchSale(selectedSale)}
                    disabled={unmatching}
                  >
                    {unmatching ? "Unmatching..." : "Unmatch Sale"}
                  </button>
                ) : null}
                {showDeleted ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void restoreSale(selectedSale)}
                  >
                    Restore Sale
                  </button>
                ) : (
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void deleteSale(selectedSale.id)}
                  >
                    Delete Sale
                  </button>
                )}
              </div>
              <button
                className="primary-button"
                type="button"
                style={{ width: "100%" }}
                onClick={() => void saveSaleEdits()}
                disabled={savingSale}
              >
                {savingSale ? "Saving..." : "Save"}
              </button>
            </div>

            <section className="drawer-summary">
              <div>
                <span>Match suggestions</span>
                <strong>{matchSuggestions.length > 0 ? `${matchSuggestions.length} options` : "No candidates"}</strong>
              </div>
              <div>
                <span>Scored by</span>
                <strong>Artist + date first</strong>
              </div>
            </section>

            {matchSuggestions.length > 0 && (
              <div className="inventory-ticket-stack">
                <div className="inventory-ticket-header">
                  <span>Ticket</span>
                  <span>Account</span>
                  <span>Match %</span>
                  <span>Action</span>
                </div>
                {matchSuggestions.map(({ order, score }) => (
                  <div key={order.id} className="inventory-ticket-row">
                    <div className="inventory-ticket-seat">
                      <strong>{order.booking_ref || order.event_name || "Ticket"}</strong>
                      {order.event_date && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "1px 7px", display: "inline-block" }}>{formatEventDate(order.event_date)}</span>
                      )}
                      <span>
                        {order.section || "Section —"} • {formatSeatLabel(order.row, order.seat_from, order.seat_to)}
                      </span>
                    </div>
                    <span className="truncate-text" title={order.account_email || ""}>
                      {order.account_email || "No account"}
                    </span>
                    <strong className="inventory-cost-value">{score}%</strong>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void matchSaleToOrder(selectedSale, order, score)}
                      disabled={matchingOrderId === order.id}
                    >
                      {matchingOrderId === order.id ? "Matching..." : "Match"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <section className="drawer-summary" style={{ marginTop: "1rem" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <span>{matchSuggestions.length === 0 && !groupIdSuggestions ? "No scored candidates — search by group ID or name below" : "Can't find it? Search below"}</span>
              </div>
            </section>

            <div style={{ padding: "0 0 0.5rem", display: "flex", gap: 8 }}>
              <input
                className="field"
                placeholder="Group ID (e.g. 24157)"
                value={groupIdInput}
                onChange={(e) => { setGroupIdInput(e.target.value); if (!e.target.value.trim()) setGroupIdSuggestions(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupIdInput.trim()) {
                    const found = findOrdersByGroupId(groupIdInput);
                    setGroupIdSuggestions(found.length > 0 ? found : []);
                  }
                }}
                style={{ flex: "0 0 140px" }}
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  const found = findOrdersByGroupId(groupIdInput);
                  setGroupIdSuggestions(found.length > 0 ? found : []);
                }}
              >
                Find
              </button>
            </div>

            {groupIdSuggestions !== null && selectedSale && (
              <div className="inventory-ticket-stack" style={{ marginBottom: "0.75rem" }}>
                <div className="inventory-ticket-header">
                  <span>Order</span>
                  <span>Account</span>
                  <span>Match %</span>
                  <span>Action</span>
                </div>
                {groupIdSuggestions.length === 0 ? (
                  <div className="inventory-ticket-row">
                    <div className="inventory-ticket-seat"><strong>No orders found</strong><span>Check the ID and try again.</span></div>
                    <span>—</span><span>—</span><span>—</span>
                  </div>
                ) : (
                  groupIdSuggestions
                    .map((order) => ({ order, score: getManualMatchScore(selectedSale, order) }))
                    .sort((a, b) => b.score - a.score)
                    .map(({ order, score }) => (
                      <div key={order.id} className="inventory-ticket-row">
                        <div className="inventory-ticket-seat">
                          <strong>{order.booking_ref || order.event_name || "Ticket"}</strong>
                          {order.event_date && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "1px 7px", display: "inline-block" }}>{formatEventDate(order.event_date)}</span>
                          )}
                          <span>{order.section || "—"} · {formatSeatLabel(order.row, order.seat_from, order.seat_to)}</span>
                        </div>
                        <span className="truncate-text" title={order.account_email || ""}>{order.account_email || "—"}</span>
                        <strong className="inventory-cost-value">{score > 0 ? `${score}%` : "—"}</strong>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void matchSaleToOrder(selectedSale, order, score)}
                          disabled={matchingOrderId === order.id}
                        >
                          {matchingOrderId === order.id ? "Matching..." : "Match"}
                        </button>
                      </div>
                    ))
                )}
              </div>
            )}

            <div style={{ padding: "0 0 0.5rem" }}>
              <input
                className="field field-search"
                placeholder="Booking ref, event name, venue, section..."
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
              />
            </div>

            {manualSearch.trim() && (
              <div className="inventory-ticket-stack">
                <div className="inventory-ticket-header">
                  <span>Ticket</span>
                  <span>Account</span>
                  <span>Seats</span>
                  <span>Action</span>
                </div>
                {manualResults.length === 0 ? (
                  <div className="inventory-ticket-row">
                    <div className="inventory-ticket-seat">
                      <strong>No orders found</strong>
                      <span>Try a different booking ref or event name.</span>
                    </div>
                    <span>—</span>
                    <span>—</span>
                    <span className="status-badge status-static status-unlisted">None</span>
                  </div>
                ) : (
                  manualResults.map((order) => (
                    <div key={order.id} className="inventory-ticket-row">
                      <div className="inventory-ticket-seat">
                        <strong>{order.booking_ref || order.event_name || "Ticket"}</strong>
                        {order.event_date && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "1px 7px", display: "inline-block" }}>{formatEventDate(order.event_date)}</span>
                        )}
                        <span>{order.event_name || "—"}</span>
                      </div>
                      <span className="truncate-text" title={order.account_email || ""}>
                        {order.account_email || "—"}
                      </span>
                      <span>{formatSeatLabel(order.row, order.seat_from, order.seat_to)}</span>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void matchSaleToOrder(selectedSale, order, 100)}
                        disabled={matchingOrderId === order.id}
                      >
                        {matchingOrderId === order.id ? "Matching..." : "Force match"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
      </aside>
      ) : null}

      {showImportModal && (
        <SalesImportModal
          allOrders={allOrders}
          onClose={() => setShowImportModal(false)}
          onImported={() => { void loadSales(true); }}
        />
      )}

      {shareMultiOpen && selectedStats && (
        <ShareMultiBannerModal stats={selectedStats} onClose={() => setShareMultiOpen(false)} />
      )}

      {shareSaleId != null && (() => {
        const shareSale = sales.find(s => s.id === shareSaleId);
        const shareOrder = shareSale ? getReferenceOrderForSale(shareSale, matchedOrders, allOrders) : null;
        return shareSale ? (
          <ShareBannerModal
            sale={shareSale}
            order={shareOrder}
            onClose={() => setShareSaleId(null)}
          />
        ) : null;
      })()}

      {showEmailModal && selectedSale?.buyer_email && createPortal(
        <div className="add-sale-overlay" onClick={closeEmailModal}>
          <div className="add-sale-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Buyer email</p>
                <h4>Send Email</h4>
              </div>
              <button className="drawer-close" type="button" onClick={closeEmailModal}>✕</button>
            </div>

            <div className="add-sale-body">
              <div className="add-sale-section">
                <div className="drawer-grid">
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>From</span>
                    <select
                      className="field"
                      value={emailFromAccountId}
                      onChange={(e) => setEmailFromAccountId(e.target.value)}
                    >
                      {connectedAccounts.length === 0 && (
                        <option value="">No connected inboxes</option>
                      )}
                      {connectedAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.email} ({a.provider === "outlook" ? "Outlook" : "Gmail"})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>To</span>
                    <div className="field" style={{ color: "var(--text-muted, #888)" }}>
                      {selectedSale.buyer_email}
                    </div>
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>Subject</span>
                    <input
                      className="field"
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Email subject..."
                    />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>Message</span>
                    <textarea
                      className="field"
                      rows={10}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder="Email body..."
                      style={{ resize: "vertical", fontFamily: "inherit" }}
                    />
                  </label>
                </div>
              </div>
            </div>

            {emailError && (
              <div style={{ padding: "0 1.5rem 1rem", color: "var(--color-danger, #e53e3e)", fontSize: "0.85rem" }}>
                {emailError}
              </div>
            )}

            <div className="drawer-actions">
              <button className="secondary-button" type="button" onClick={closeEmailModal}>Cancel</button>
              <button
                className="primary-button"
                type="button"
                disabled={sendingEmail || !emailFromAccountId || !emailSubject.trim() || !emailBody.trim()}
                onClick={() => void sendBuyerEmail()}
              >
                {sendingEmail ? "Sending..." : "Send Email"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showAddSale && createPortal(
        <div className="add-sale-overlay" onClick={closeAddSale}>
          <div className="add-sale-sheet" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Manual entry</p>
                <h4>Add Sale</h4>
              </div>
              <button className="drawer-close" type="button" onClick={closeAddSale}>✕</button>
            </div>

            <div className="add-sale-body">
              {/* Ticket picker */}
              <div className="add-sale-section">
                <p className="add-sale-section-title">Match to a ticket <span className="add-sale-optional">(optional)</span></p>
                <input
                  className="field field-search"
                  placeholder="Search event, booking ref, section, account..."
                  value={addSaleSearch}
                  onChange={(e) => setAddSaleSearch(e.target.value)}
                />
                <div className="add-sale-order-list">
                  {filteredOrdersForAdd.length === 0 ? (
                    <p className="add-sale-empty">No unsold tickets found</p>
                  ) : (
                    filteredOrdersForAdd.slice(0, 15).map((order) => {
                      const selected = addSaleOrderId === order.id;
                      return (
                        <button
                          key={order.id}
                          type="button"
                          className={`add-sale-order-row${selected ? " add-sale-order-selected" : ""}`}
                          onClick={() => {
                            if (selected) {
                              setAddSaleOrderId(null);
                              setAddSaleForm((f) => ({ ...f, event_name: "", venue: "", event_date: "", section: "", row: "", seat_from: "", seat_to: "" }));
                            } else {
                              setAddSaleOrderId(order.id);
                              setAddSaleForm((f) => ({
                                ...f,
                                event_name: order.event_name || "",
                                venue: order.venue || "",
                                event_date: order.event_date || "",
                                section: order.section || "",
                                row: order.row || "",
                                seat_from: order.seat_from || "",
                                seat_to: order.seat_to || "",
                              }));
                            }
                          }}
                        >
                          <div className="add-sale-order-info">
                            <strong>{order.event_name || "Untitled"}</strong>
                            <span>{order.venue || "—"}{order.section ? ` · ${order.section}` : ""}{order.row ? ` Row ${order.row}` : ""}</span>
                            <span className="add-sale-order-meta">{order.booking_ref || "No ref"} · {order.account_email || "No account"}</span>
                          </div>
                          <div className="add-sale-order-right">
                            <span className={`status-badge status-static ${order.listing_status === "Listed" ? "status-listed" : order.listing_status === "Problem / Missing" ? "status-problem" : "status-unlisted"}`}>
                              {order.listing_status || "Unlisted"}
                            </span>
                            {selected && <span className="add-sale-check">✓</span>}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                {selectedOrderForAdd && (
                  <div className="add-sale-matched-chip">
                    <span className="add-sale-matched-dot" />
                    Linked to <strong>{selectedOrderForAdd.event_name || selectedOrderForAdd.booking_ref || "Ticket"}</strong>
                    {selectedOrderForAdd.section ? ` · ${selectedOrderForAdd.section}` : ""}
                    {selectedOrderForAdd.row ? ` Row ${selectedOrderForAdd.row}` : ""}
                  </div>
                )}
              </div>

              {/* Event details */}
              <div className="add-sale-section">
                <p className="add-sale-section-title">Event details <span className="add-sale-optional">(auto-filled when ticket selected)</span></p>
                <div className="drawer-grid">
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span>Event name</span>
                    <input className="field" placeholder="e.g. BBC Radio 1's Big Weekend" value={addSaleForm.event_name} onChange={(e) => setAddSaleForm((f) => ({ ...f, event_name: e.target.value }))} />
                  </label>
                  <label>
                    <span>Venue</span>
                    <input className="field" placeholder="e.g. Herrington Country Park" value={addSaleForm.venue} onChange={(e) => setAddSaleForm((f) => ({ ...f, venue: e.target.value }))} />
                  </label>
                  <label>
                    <span>Event date</span>
                    <input className="field" type="date" value={addSaleForm.event_date} onChange={(e) => setAddSaleForm((f) => ({ ...f, event_date: e.target.value }))} />
                  </label>
                  <label>
                    <span>Section <span className="add-sale-optional">(optional)</span></span>
                    <input className="field" placeholder="e.g. General Admission" value={addSaleForm.section} onChange={(e) => setAddSaleForm((f) => ({ ...f, section: e.target.value }))} />
                  </label>
                  <label>
                    <span>Row <span className="add-sale-optional">(optional)</span></span>
                    <input className="field" placeholder="e.g. A" value={addSaleForm.row} onChange={(e) => setAddSaleForm((f) => ({ ...f, row: e.target.value }))} />
                  </label>
                  <label>
                    <span>Seat from <span className="add-sale-optional">(optional)</span></span>
                    <input className="field" placeholder="e.g. 1" value={addSaleForm.seat_from} onChange={(e) => setAddSaleForm((f) => ({ ...f, seat_from: e.target.value }))} />
                  </label>
                  <label>
                    <span>Seat to <span className="add-sale-optional">(optional)</span></span>
                    <input className="field" placeholder="e.g. 2" value={addSaleForm.seat_to} onChange={(e) => setAddSaleForm((f) => ({ ...f, seat_to: e.target.value }))} />
                  </label>
                </div>
              </div>

              {/* Sale details */}
              <div className="add-sale-section">
                <p className="add-sale-section-title">Sale details</p>
                <div className="drawer-grid">
                  <label>
                    <span>Platform sold on</span>
                    <select
                      className="field"
                      value={addSaleForm.marketplace}
                      onChange={(e) => setAddSaleForm((f) => ({ ...f, marketplace: e.target.value }))}
                    >
                      <option value="">Select platform…</option>
                      {["Viagogo", "StubHub", "Ticombo", "Lysted", "Private Broker", "Ticketmaster", "AXS"].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Qty sold</span>
                    <input
                      className="field"
                      type="number"
                      min="1"
                      value={addSaleForm.qty_sold}
                      onChange={(e) => setAddSaleForm((f) => ({ ...f, qty_sold: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Sale price (£)</span>
                    <input
                      className="field"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={addSaleForm.sale_price}
                      onChange={(e) => setAddSaleForm((f) => ({ ...f, sale_price: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Buyer email <span className="add-sale-optional">(optional)</span></span>
                    <input
                      className="field"
                      type="email"
                      placeholder="buyer@example.com"
                      value={addSaleForm.buyer_email}
                      onChange={(e) => setAddSaleForm((f) => ({ ...f, buyer_email: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Date sold</span>
                    <input
                      className="field"
                      type="date"
                      value={addSaleForm.sold_at}
                      onChange={(e) => setAddSaleForm((f) => ({ ...f, sold_at: e.target.value }))}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="drawer-actions">
              <button className="secondary-button" type="button" onClick={closeAddSale}>Cancel</button>
              <button
                className="primary-button"
                type="button"
                disabled={savingNewSale || !addSaleForm.sale_price}
                onClick={() => void addSaleManually()}
              >
                {savingNewSale ? "Saving..." : "Add Sale"}
              </button>
            </div>

          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function getLifecycleLabel(status: string | null): string {
  switch (status) {
    case "Sold – Awaiting Transfer":
    case "Sold":
      return "Awaiting Transfer";
    case "Sold – Transfer Completed": return "Transfer Completed";
    case "Paid": return "Paid";
    case "Cancelled / Issue": return "Cancelled";
    default: return "Awaiting Transfer";
  }
}

function getLifecycleBadgeStyle(status: string | null): React.CSSProperties {
  switch (status) {
    case "Sold – Awaiting Transfer":
    case "Sold":
      return { background: "rgba(249,115,22,0.15)", color: "#f97316", borderColor: "rgba(249,115,22,0.3)" };
    case "Sold – Transfer Completed":
      return { background: "rgba(79,195,255,0.15)", color: "#4fc3ff", borderColor: "rgba(79,195,255,0.3)" };
    case "Paid":
      return { background: "rgba(74,222,128,0.15)", color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" };
    case "Cancelled / Issue":
      return { background: "rgba(248,113,113,0.15)", color: "#f87171", borderColor: "rgba(248,113,113,0.3)" };
    default:
      return { background: "rgba(249,115,22,0.15)", color: "#f97316", borderColor: "rgba(249,115,22,0.3)" };
  }
}

function getSaleProfit(sale: Sale, order?: MatchedOrder | null) {
  if (sale.inventory_order_id == null) {
    return 0;
  }

  return (sale.sale_total ?? sale.payout_total ?? 0) - getSaleCost(sale, order);
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
    score += (compareEventDay(order.event_date, sale.event_date) ?? 0) * 0.2;
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

function getMatchSuggestions(sale: Sale, orders: MatchedOrder[]) {
  return orders
    .filter((order) => order.listing_status !== "Sold" || order.id === sale.inventory_order_id)
    .map((order) => ({
      order,
      score: getManualMatchScore(sale, order),
    }))
    .filter((item) => item.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function getEventWords(value?: string | null): string[] {
  if (!value) return [];
  const stop = new Set(["the", "and", "for", "at"]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

function compareEventNameSuggestion(left?: string | null, right?: string | null): number {
  if (!left || !right) return 0;
  const a = normalizeCompareValue(left);
  const b = normalizeCompareValue(right);
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  // Word-level overlap as fallback (catches "Taylor Swift World Tour" vs "Taylor Swift")
  const aWords = getEventWords(left);
  const bSet = new Set(getEventWords(right));
  let overlap = 0;
  for (const w of aWords) { if (bSet.has(w)) overlap++; }
  if (overlap >= 2) return 0.65;
  if (overlap >= 1) return 0.40;
  return 0;
}

function getManualMatchScore(sale: Sale, order: MatchedOrder) {
  const dateScore = compareEventDay(order.event_date, sale.event_date);
  // Hard gate: both dates present but different → definitely wrong event
  if (dateScore === 0) return 0;

  const eventScore = compareEventNameSuggestion(order.event_name, sale.event_name);
  if (eventScore === 0) return 0;

  const venueScore = compareText(order.venue, sale.venue);
  const sectionScore = compareSectionForUi(order.section, sale.section);
  const rowScore = compareExact(order.row, sale.row);
  const seatScore = compareSeats(order.seat_from, order.seat_to, sale.seat_from, sale.seat_to);

  // Date is the primary anchor — weight it heavily alongside event name
  const total =
    eventScore * 0.45 +
    (dateScore ?? 0) * 0.40 +
    venueScore * 0.08 +
    sectionScore * 0.04 +
    rowScore * 0.02 +
    seatScore * 0.01;

  return Math.round(total * 100);
}

function compareSectionForUi(left?: string | null, right?: string | null) {
  const leftSectionNumber = extractSectionNumber(left);
  const rightSectionNumber = extractSectionNumber(right);

  if (leftSectionNumber && rightSectionNumber && leftSectionNumber === rightSectionNumber) {
    return 0.95;
  }

  return compareText(left, right);
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

function compareEventDay(left?: string | null, right?: string | null): number | null {
  const a = getDateKey(left);
  const b = getDateKey(right);

  if (!a || !b) {
    return null; // missing date — can't compare, don't disqualify
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

function extractSectionNumber(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d{1,4})/);
  return match?.[1] || null;
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

function parseEventDateValue(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s*\|\s*/g, " ").replace(/,\s*/g, ", ").trim();

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const monthFirstMatch = normalized.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (monthFirstMatch) {
    const [, month, day, year, hour = "00", minute = "00"] = monthFirstMatch;
    const fallback = new Date(`${month} ${day} ${year} ${hour}:${minute}`);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
  }

  const match = normalized.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) {
    return null;
  }

  const [, day, month, year, hour = "00", minute = "00"] = match;
  const fallback = new Date(`${day} ${month} ${year} ${hour}:${minute}`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
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


function formatEventDate(value: string | null): string {
  if (!value) return "Date missing";
  if (/^[A-Za-z]{2,3}\s+\d{1,2}\s+[A-Za-z]{3}/i.test(value)) return value;
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
  }
  return value;
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

function formatSeatLabel(row: string | null, seatFrom: string | null, seatTo: string | null) {
  const seatLabel = seatFrom
    ? seatTo && seatTo !== seatFrom
      ? `Seats ${seatFrom}–${seatTo}`
      : `Seat ${seatFrom}`
    : "Seat —";

  return row ? `Row ${row} • ${seatLabel}` : seatLabel;
}

function formatFullSeatLabel(section: string | null, row: string | null, seatFrom: string | null, seatTo: string | null) {
  const parts: string[] = [];
  if (section) parts.push(section);
  if (row) parts.push(`Row ${row}`);
  if (seatFrom) {
    parts.push(seatTo && seatTo !== seatFrom ? `Seats ${seatFrom}–${seatTo}` : `Seat ${seatFrom}`);
  }
  return parts.length ? parts.join(" / ") : "—";
}


