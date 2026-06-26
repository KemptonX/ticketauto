"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";
import { CURRENCY_OPTIONS, getCurrencyCode, setCurrencyCode, formatCurrency } from "@/src/lib/currency";
import { TEMPLATE_VARS, DEFAULT_SUBJECT, DEFAULT_BODY, EmailTemplate, loadTemplates, saveTemplates, loadActiveTemplateId, saveActiveTemplateId, interpolate } from "@/src/lib/email-template";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";
import AccountsTab from "@/app/components/marketplace/AccountsTab";

// ─── Types ────────────────────────────────────────────────────────────────────

type GmailAccount = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  provider: string;
  status: string;
  sync_mode: string;
  is_primary: boolean;
  is_active: boolean;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  scope: string | null;
  google_subject: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type ImapAccountRow = {
  id: string;
  host: string;
  port: number;
  username: string;
  use_tls: boolean;
  mailbox: string;
  unread_only: boolean;
  mark_read: boolean;
  label: string | null;
  status: string;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
};

type ImportField = {
  key: string;
  label: string;
  aliases: string[];
  dataType: "text" | "date" | "number" | "status" | "sale_status" | "transfer_status" | "payment_status";
  group?: string;
  required?: boolean;
};

type ImportStep = "upload" | "map" | "preview" | "done";

// ─── Nav ──────────────────────────────────────────────────────────────────────

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

// ─── Import field definitions ─────────────────────────────────────────────────

const IMPORT_FIELDS: ImportField[] = [
  // ── Ticket / Inventory ──
  {
    key: "event_name", group: "Ticket / Inventory",
    label: "Event Name",
    aliases: ["event name", "event", "show", "concert", "match", "game", "act", "artist", "title", "name", "fixture", "performance"],
    dataType: "text",
    required: true,
  },
  {
    key: "venue", group: "Ticket / Inventory",
    label: "Venue",
    aliases: ["venue", "stadium", "arena", "location", "ground", "hall", "theatre", "theater", "place", "city"],
    dataType: "text",
  },
  {
    key: "event_date", group: "Ticket / Inventory",
    label: "Event Date",
    aliases: ["date", "event date", "show date", "match date", "game date", "when", "event_date", "event date time", "date time", "datetime"],
    dataType: "date",
  },
  {
    key: "section", group: "Ticket / Inventory",
    label: "Section / Block",
    aliases: ["section", "block", "sec", "stand", "area", "zone", "sector"],
    dataType: "text",
  },
  {
    key: "row", group: "Ticket / Inventory",
    label: "Row",
    aliases: ["row", "row number", "row no"],
    dataType: "text",
  },
  {
    key: "seat_from", group: "Ticket / Inventory",
    label: "Seat From",
    aliases: ["seat from", "seat_from", "from seat", "first seat", "seat start", "seat no from", "seat number from", "seat low", "seat begin"],
    dataType: "text",
  },
  {
    key: "seat_to", group: "Ticket / Inventory",
    label: "Seat To",
    aliases: ["seat to", "seat_to", "to seat", "last seat", "seat end", "seat no to", "seat number to", "seat high"],
    dataType: "text",
  },
  {
    key: "seats", group: "Ticket / Inventory",
    label: "Seats (range e.g. 12-14)",
    aliases: ["seats", "seat", "seat numbers", "seat range", "seat no", "seat number", "seat nos"],
    dataType: "text",
  },
  {
    key: "qty_bought", group: "Ticket / Inventory",
    label: "Qty Bought",
    aliases: ["qty", "quantity", "tickets", "count", "num tickets", "number", "qty bought", "quantity bought", "no of tickets", "num", "ticket count", "no tickets"],
    dataType: "number",
  },
  {
    key: "qty_sold", group: "Ticket / Inventory",
    label: "Qty Sold",
    aliases: ["qty sold", "quantity sold", "sold qty", "sold quantity", "tickets sold", "qty_sold", "sold count", "no sold", "number sold"],
    dataType: "number",
  },
  {
    key: "total_cost", group: "Ticket / Inventory",
    label: "Total Cost",
    aliases: ["cost", "total cost", "price", "amount paid", "paid", "purchase price", "buying price", "face value", "total paid", "cost price", "buy price", "purchase total", "amount", "total amount"],
    dataType: "number",
  },
  {
    key: "sold_total", group: "Ticket / Inventory",
    label: "Sold For (order)",
    aliases: ["sold total", "sold_total"],
    dataType: "number",
  },
  {
    key: "listing_status", group: "Ticket / Inventory",
    label: "Ticket Status",
    aliases: ["status", "ticket status", "listing status", "listing_status", "state", "ticket state"],
    dataType: "status",
  },
  {
    key: "booking_ref", group: "Ticket / Inventory",
    label: "Booking Ref",
    aliases: ["ref", "reference", "booking ref", "booking_ref", "order ref", "order_ref", "booking", "booking reference", "order number", "booking number", "confirmation"],
    dataType: "text",
  },
  {
    key: "account_email", group: "Ticket / Inventory",
    label: "Account Email",
    aliases: ["account", "account email", "account_email", "gmail", "inbox", "bought with", "purchase email"],
    dataType: "text",
  },
  {
    key: "source_type", group: "Ticket / Inventory",
    label: "Source / Platform (ticket)",
    aliases: ["source", "source type", "source_type", "bought from", "purchased from", "supplier", "provider"],
    dataType: "text",
  },

  // ── Sale Details ──
  {
    key: "sale_status", group: "Sale Details",
    label: "Sale Status",
    aliases: ["sale status", "sale state", "order status"],
    dataType: "sale_status",
  },
  {
    key: "sold_at", group: "Sale Details",
    label: "Sale Date",
    aliases: ["sale date", "sold date", "sold at", "date sold", "order date", "sold_at", "sale date time"],
    dataType: "date",
  },
  {
    key: "sale_total", group: "Sale Details",
    label: "Sale Total",
    aliases: ["sale total", "sale price", "sold for", "sold amount", "selling price", "gross", "gross proceeds", "gross sale", "revenue"],
    dataType: "number",
  },
  {
    key: "payout_total", group: "Sale Details",
    label: "Payout Total (net)",
    aliases: ["payout", "payout total", "net proceeds", "net payout", "net amount", "amount received", "proceeds", "net"],
    dataType: "number",
  },
  {
    key: "buyer_name", group: "Sale Details",
    label: "Buyer Name",
    aliases: ["buyer", "buyer name", "customer", "customer name", "purchaser", "client", "recipient"],
    dataType: "text",
  },
  {
    key: "marketplace", group: "Sale Details",
    label: "Platform / Marketplace",
    aliases: ["platform", "marketplace", "channel", "sold via", "sold on", "sold through", "via", "broker", "site", "exchange", "buyer platform", "sale platform"],
    dataType: "text",
  },
  {
    key: "buyer_email", group: "Sale Details",
    label: "Buyer Email",
    aliases: ["buyer email", "customer email", "client email", "purchaser email"],
    dataType: "text",
  },
  {
    key: "external_sale_id", group: "Sale Details",
    label: "Sale Reference / Order ID",
    aliases: ["sale ref", "sale reference", "order id", "transaction id", "ref no", "external ref", "external id", "external sale id", "sale id"],
    dataType: "text",
  },
  {
    key: "notes", group: "Sale Details",
    label: "Notes",
    aliases: ["notes", "note", "comment", "comments", "description", "memo"],
    dataType: "text",
  },

  // ── Transfer ──
  {
    key: "transfer_status", group: "Transfer",
    label: "Transfer Status",
    aliases: ["transfer status", "transfer state", "delivery status", "transfer"],
    dataType: "transfer_status",
  },
  {
    key: "transfer_date", group: "Transfer",
    label: "Transfer Date",
    aliases: ["transfer date", "transferred date", "delivered date", "delivery date", "transferred on", "transfer_date"],
    dataType: "date",
  },
  {
    key: "transfer_deadline", group: "Transfer",
    label: "Transfer Deadline",
    aliases: ["transfer deadline", "deadline", "transfer by", "transfer before", "must transfer by", "deliver by"],
    dataType: "date",
  },

  // ── Payment ──
  {
    key: "payment_status", group: "Payment",
    label: "Payment Status",
    aliases: ["payment status", "payment state", "paid status", "payout status", "pay status"],
    dataType: "payment_status",
  },
  {
    key: "expected_payout_date", group: "Payment",
    label: "Expected Payout Date",
    aliases: ["expected payout", "expected payout date", "payout expected", "estimated payout", "payout estimate", "expected payment date", "anticipated payout"],
    dataType: "date",
  },
  {
    key: "payout_date", group: "Payment",
    label: "Actual Payout Date",
    aliases: ["payout date", "paid date", "payment date", "received date", "paid on", "payment received date", "actual payout", "actual payout date", "paid at"],
    dataType: "date",
  },
];

const FIELD_GROUPS = [
  { group: "Ticket / Inventory", fields: IMPORT_FIELDS.filter((f) => f.group === "Ticket / Inventory") },
  { group: "Sale Details", fields: IMPORT_FIELDS.filter((f) => f.group === "Sale Details") },
  { group: "Transfer", fields: IMPORT_FIELDS.filter((f) => f.group === "Transfer") },
  { group: "Payment", fields: IMPORT_FIELDS.filter((f) => f.group === "Payment") },
];

// ── Column sets ───────────────────────────────────────────────────────────────

const ORDER_COLUMNS = new Set([
  "booking_ref", "event_name", "venue", "event_date", "account_email",
  "section", "row", "seat_from", "seat_to",
  "qty_bought", "total_cost", "sold_total", "listing_status", "source_type",
]);

const SALE_COLUMNS = new Set([
  "sale_status", "sold_at", "sale_total", "payout_total", "buyer_name",
  "marketplace", "buyer_email", "external_sale_id", "notes",
  "transfer_status", "transfer_date", "transfer_deadline",
  "payment_status", "expected_payout_date", "payout_date",
  "qty_sold",
]);

// ─── Auto-mapping ─────────────────────────────────────────────────────────────

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}

function autoMapHeader(header: string): string {
  const norm = normalizeHeader(header);

  for (const field of IMPORT_FIELDS) {
    const keyNorm = field.key.replace(/_/g, " ");
    if (norm === keyNorm) return field.key;
    if (field.aliases.includes(norm)) return field.key;
  }

  // Partial / substring match — prefer longer alias matches
  let bestKey = "skip";
  let bestScore = 0;

  for (const field of IMPORT_FIELDS) {
    for (const alias of field.aliases) {
      if (norm.includes(alias) || alias.includes(norm)) {
        const score = alias.length;
        if (score > bestScore) {
          bestScore = score;
          bestKey = field.key;
        }
      }
    }
  }

  return bestKey;
}

// ─── Value parsers ────────────────────────────────────────────────────────────

function parseImportNumber(raw: string): number | null {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return null;
  const cleaned = raw.replace(/[£$€,\s]/g, "").replace(/[()]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseImportDate(raw: string): string | null {
  if (!raw || raw.trim() === "") return null;
  const s = raw.trim();

  // ISO: 2025-04-14 or 2025-04-14T...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // UK: 14/04/2025 or 14-04-2025
  const ukSlash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ukSlash) {
    const [, d, m, y] = ukSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // US: 04/14/2025
  const usSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usSlash) {
    const [, m, d, y] = usSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "14 Apr 2025" or "April 14, 2025"
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const dayFirst = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (dayFirst) {
    const mo = months[dayFirst[2].toLowerCase().slice(0, 3)];
    if (mo) return `${dayFirst[3]}-${mo}-${dayFirst[1].padStart(2, "0")}`;
  }
  const monthFirst = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})/);
  if (monthFirst) {
    const mo = months[monthFirst[1].toLowerCase().slice(0, 3)];
    if (mo) return `${monthFirst[3]}-${mo}-${monthFirst[2].padStart(2, "0")}`;
  }

  // Native parse fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s; // keep raw if nothing works
}

function parseImportStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (["sold", "sale", "completed", "yes"].includes(s)) return "Sold";
  if (["listed", "live", "active"].includes(s)) return "Listed";
  if (["archived", "archive", "expired", "past"].includes(s)) return "Archived";
  return "Unlisted";
}

function parseSaleStatus(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (["unsold", "listed", "live", "active", "available", "unlisted"].includes(s)) return "_skip";
  if (["paid", "payment received", "settled"].includes(s)) return "Paid";
  if (["transfer completed", "transferred", "transfer complete", "complete"].includes(s)) return "Sold – Transfer Completed";
  if (["awaiting transfer", "pending transfer", "transfer pending", "sold", "sale", "confirmed"].includes(s)) return "Sold – Awaiting Transfer";
  if (["cancelled", "canceled", "cancel", "issue", "refunded", "problem"].includes(s)) return "Cancelled / Issue";
  return null;
}

function parseTransferStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (["completed", "complete", "transferred", "done", "transfer completed", "transfer complete", "yes", "sent"].includes(s)) return "Transfer Completed";
  return "Awaiting Transfer";
}

function parsePaymentStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (["paid", "received", "payment received", "settled", "cleared", "yes", "complete", "completed"].includes(s)) return "Paid";
  return "Awaiting Payment";
}

type RowType = "inventory_only" | "sale_awaiting_transfer" | "sale_transferred" | "sale_paid" | "sale_cancelled" | "skip";

function getRowType(obj: Record<string, unknown>): RowType {
  const hasSaleFields = Boolean(
    obj.sale_total || obj.sale_status || obj.transfer_status || obj.payment_status ||
    obj.marketplace || obj.buyer_name || obj.external_sale_id || obj.sold_at
  );
  if (!hasSaleFields) return "inventory_only";
  if ((obj.sale_status as string) === "_skip") return "skip";
  if ((obj.sale_status as string) === "Cancelled / Issue") return "sale_cancelled";
  if ((obj.payment_status as string) === "Paid" || (obj.sale_status as string) === "Paid") return "sale_paid";
  if ((obj.transfer_status as string) === "Transfer Completed" || (obj.sale_status as string) === "Sold – Transfer Completed") return "sale_transferred";
  return "sale_awaiting_transfer";
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',' || ch === '\t') { row.push(cell); cell = ""; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell);
        cell = "";
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some((c) => c.trim())) rows.push(row); }
  return rows;
}

// ─── Row transformer ──────────────────────────────────────────────────────────

function transformRow(
  rawRow: string[],
  headers: string[],
  colMap: Record<number, string>,
): Record<string, unknown> | null {
  const obj: Record<string, unknown> = {};

  for (let i = 0; i < headers.length; i++) {
    const fieldKey = colMap[i] ?? "skip";
    if (fieldKey === "skip") continue;
    const raw = (rawRow[i] ?? "").trim();
    if (!raw) continue;

    const field = IMPORT_FIELDS.find((f) => f.key === fieldKey);
    if (!field) continue;

    if (field.dataType === "number") {
      const n = parseImportNumber(raw);
      if (n !== null) obj[fieldKey] = n;
    } else if (field.dataType === "date") {
      obj[fieldKey] = parseImportDate(raw);
    } else if (field.dataType === "status") {
      obj[fieldKey] = parseImportStatus(raw);
    } else if (field.dataType === "sale_status") {
      const parsed = parseSaleStatus(raw);
      if (parsed !== null) obj[fieldKey] = parsed;
    } else if (field.dataType === "transfer_status") {
      obj[fieldKey] = parseTransferStatus(raw);
    } else if (field.dataType === "payment_status") {
      obj[fieldKey] = parsePaymentStatus(raw);
    } else {
      // Handle combined seats field "12-14" → seat_from + seat_to
      if (fieldKey === "seats") {
        const range = raw.match(/^(\w+)\s*[-–]\s*(\w+)$/);
        if (range) {
          obj.seat_from = range[1];
          obj.seat_to = range[2];
        } else {
          obj.seat_from = raw;
        }
      } else {
        obj[fieldKey] = raw;
      }
    }
  }

  return Object.keys(obj).length ? obj : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function connectionStatusClass(status: string) {
  switch (status) {
    case "Ready": return "badge-sold";
    case "Paused": return "badge-unlisted";
    case "Needs OAuth": return "badge-listed";
    default: return "badge-problem";
  }
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "Pending";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function formatOAuthError(error: string) {
  switch (error) {
    case "access_denied": return "Google access was denied";
    case "state-mismatch": return "Google sign-in expired. Try Connect Gmail again.";
    case "missing-google-client":
    case "missing-google-config": return "Google OAuth env vars are missing";
    case "not-signed-in": return "Sign in before connecting Gmail";
    case "gmail-profile-failed": return "Google connected, but profile lookup failed";
    case "missing-microsoft-client":
    case "missing-microsoft-config": return "Microsoft OAuth env vars are missing";
    case "outlook-profile-failed": return "Microsoft connected, but profile lookup failed";
    case "outlook-no-email": return "Microsoft connected, but no email address was returned";
    default: return error.replaceAll("-", " ");
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsClient() {
  const searchParams = useSearchParams();

  // Tab
  const [activeTab, setActiveTab] = useState<"connections" | "import" | "currency" | "clients" | "notifications" | "accounts">(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "import") return "import";
      if (t === "currency") return "currency";
      if (t === "clients") return "clients";
      if (t === "notifications") return "notifications";
      if (t === "accounts") return "accounts";
    }
    return "connections";
  });

  // ── Discord account linking state ──
  const [discordLinked, setDiscordLinked] = useState<{ username: string } | null | undefined>(undefined);
  const [exportingData, setExportingData] = useState(false);
  const [exported, setExported] = useState(false);
  const [linkError, setLinkError] = useState("");
  const justLinked = searchParams.get("linked") === "true";

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const identity = user.identities?.find((i) => i.provider === "discord");
      if (identity) {
        const username =
          (identity.identity_data?.full_name as string | undefined) ??
          (identity.identity_data?.name as string | undefined) ??
          (identity.identity_data?.custom_claims?.global_name as string | undefined) ??
          "Discord";
        setDiscordLinked({ username });
      } else {
        setDiscordLinked(null);
      }
    })();
  }, []);

  async function exportAllData() {
    setExportingData(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: orders }, { data: sales }] = await Promise.all([
        supabase.from("orders").select("*").eq("user_id", user.id),
        supabase.from("sales").select("*").eq("user_id", user.id),
      ]);
      function toCSV(rows: Record<string, unknown>[]): string {
        if (!rows?.length) return "";
        const headers = Object.keys(rows[0]);
        return [
          headers.join(","),
          ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
        ].join("\n");
      }
      function download(csv: string, filename: string) {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
      const date = new Date().toISOString().slice(0, 10);
      if (orders?.length) download(toCSV(orders as Record<string, unknown>[]), `tixtracker-orders-${date}.csv`);
      await new Promise((r) => setTimeout(r, 400));
      if (sales?.length) download(toCSV(sales as Record<string, unknown>[]), `tixtracker-sales-${date}.csv`);
      setExported(true);
    } finally {
      setExportingData(false);
    }
  }

  async function linkDiscordAccount() {
    setLinkError("");
    const { error } = await supabase.auth.linkIdentity({
      provider: "discord",
      options: {
        redirectTo: "https://tixtracker.app/auth/callback?mode=link&next=/settings?tab=connections",
        scopes: "identify email",
      },
    });
    if (error) setLinkError(error.message);
  }

  // ── Discord notifications state ──
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordSaved, setDiscordSaved] = useState(false);
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordTesting, setDiscordTesting] = useState(false);
  const [discordMessage, setDiscordMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [alertTime, setAlertTime] = useState("09:00");
  const [alertTimezone, setAlertTimezone] = useState("UTC");
  const [alertScheduleSaved, setAlertScheduleSaved] = useState(false);
  const [alertScheduleSaving, setAlertScheduleSaving] = useState(false);

  // ── Webhook field customisation ──
  type WebhookFieldKey = "order" | "sale" | "transfer" | "payout";
  type WebhookFields = Record<WebhookFieldKey, string[]>;
  const DEFAULT_WEBHOOK_FIELDS: WebhookFields = {
    order:    ["venue", "date", "qty", "cost", "ref", "source", "section", "email"],
    sale:     ["date", "qty", "sale_total", "payout", "marketplace", "section"],
    transfer: ["date", "qty", "section", "venue", "order_id"],
    payout:   ["payment_date", "total", "orders", "ref"],
  };
  const WEBHOOK_FIELD_DEFS: Record<WebhookFieldKey, { id: string; label: string; emoji: string }[]> = {
    order: [
      { id: "venue",   label: "Venue",          emoji: "📍" },
      { id: "date",    label: "Date",            emoji: "📅" },
      { id: "qty",     label: "Quantity",        emoji: "🎫" },
      { id: "cost",    label: "Cost",            emoji: "💰" },
      { id: "ref",     label: "Reference",       emoji: "🏷️" },
      { id: "source",  label: "Source",          emoji: "📦" },
      { id: "section", label: "Section / Row",   emoji: "💺" },
      { id: "email",   label: "Account Email",   emoji: "📧" },
    ],
    sale: [
      { id: "date",        label: "Date",          emoji: "📅" },
      { id: "qty",         label: "Qty Sold",      emoji: "🎫" },
      { id: "sale_total",  label: "Sale Total",    emoji: "💰" },
      { id: "payout",      label: "Payout",        emoji: "💵" },
      { id: "marketplace", label: "Marketplace",   emoji: "🏪" },
      { id: "section",     label: "Section / Row", emoji: "💺" },
    ],
    transfer: [
      { id: "date",     label: "Event Date", emoji: "📅" },
      { id: "qty",      label: "Qty",        emoji: "🎫" },
      { id: "section",  label: "Section",    emoji: "💺" },
      { id: "venue",    label: "Venue",      emoji: "📍" },
      { id: "order_id", label: "Order #",    emoji: "🔢" },
    ],
    payout: [
      { id: "payment_date", label: "Payment Date", emoji: "📅" },
      { id: "total",        label: "Total Payout", emoji: "💵" },
      { id: "orders",       label: "Order Count",  emoji: "📦" },
      { id: "ref",          label: "Payment Ref",  emoji: "🔢" },
    ],
  };
  const [webhookFields, setWebhookFields] = useState<WebhookFields>(DEFAULT_WEBHOOK_FIELDS);
  const [webhookFieldsSaved, setWebhookFieldsSaved] = useState(false);
  const [webhookFieldsSaving, setWebhookFieldsSaving] = useState(false);

  function toggleWebhookField(type: WebhookFieldKey, fieldId: string) {
    setWebhookFields(prev => ({
      ...prev,
      [type]: prev[type].includes(fieldId)
        ? prev[type].filter(f => f !== fieldId)
        : [...prev[type], fieldId],
    }));
  }

  async function saveWebhookFields() {
    setWebhookFieldsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_settings").upsert(
        { user_id: user.id, webhook_fields: webhookFields, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      setWebhookFieldsSaved(true);
      setTimeout(() => setWebhookFieldsSaved(false), 2500);
    } finally {
      setWebhookFieldsSaving(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("discord_webhook_url, webhook_fields, alert_time, alert_timezone")
        .eq("user_id", user.id)
        .maybeSingle();
      const row = data as { discord_webhook_url?: string; webhook_fields?: Partial<WebhookFields>; alert_time?: string; alert_timezone?: string } | null;
      if (row?.discord_webhook_url) setDiscordWebhookUrl(row.discord_webhook_url);
      if (row?.webhook_fields) {
        const wf = row.webhook_fields;
        setWebhookFields({
          order:    wf.order    ?? DEFAULT_WEBHOOK_FIELDS.order,
          sale:     wf.sale     ?? DEFAULT_WEBHOOK_FIELDS.sale,
          transfer: wf.transfer ?? DEFAULT_WEBHOOK_FIELDS.transfer,
          payout:   wf.payout   ?? DEFAULT_WEBHOOK_FIELDS.payout,
        });
      }
      if (row?.alert_time) setAlertTime(row.alert_time);
      if (row?.alert_timezone) setAlertTimezone(row.alert_timezone);
    })();
  }, []);

  async function saveDiscordWebhook() {
    const url = discordWebhookUrl.trim();
    setDiscordSaving(true);
    setDiscordMessage(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setDiscordMessage({ ok: false, text: "Not signed in" }); return; }
      const { error } = await supabase
        .from("user_settings")
        .upsert({ user_id: user.id, discord_webhook_url: url || null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) {
        setDiscordMessage({ ok: false, text: error.message });
      } else {
        setDiscordSaved(true);
        setDiscordMessage({ ok: true, text: url ? "Webhook URL saved." : "Webhook URL cleared." });
        setTimeout(() => setDiscordSaved(false), 2500);
      }
    } finally {
      setDiscordSaving(false);
    }
  }

  async function saveAlertSchedule() {
    setAlertScheduleSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_settings").upsert(
        { user_id: user.id, alert_time: alertTime, alert_timezone: alertTimezone, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      setAlertScheduleSaved(true);
      setTimeout(() => setAlertScheduleSaved(false), 2500);
    } finally {
      setAlertScheduleSaving(false);
    }
  }

  async function testDiscordWebhook() {
    setDiscordTesting(true);
    setDiscordMessage(null);
    try {
      const res = await fetch("/api/test-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: discordWebhookUrl.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setDiscordMessage({ ok: true, text: "Test ping sent! Check your Discord channel." });
      } else {
        setDiscordMessage({ ok: false, text: data.error ?? "Test failed" });
      }
    } catch {
      setDiscordMessage({ ok: false, text: "Network error — check your connection" });
    } finally {
      setDiscordTesting(false);
    }
  }

  // ── Email forwarding state ──
  type ForwardingSettings = {
    id: string;
    forwarding_email: string;
    forwarding_token: string;
    status: string;
    last_received_at: string | null;
    last_successful_import_at: string | null;
    latest_verification_code: string | null;
    latest_verification_link: string | null;
    latest_verification_received_at: string | null;
    created_at: string;
  };
  const [forwardingSettings, setForwardingSettings] = useState<ForwardingSettings | null>(null);
  const [forwardingLoading, setForwardingLoading] = useState(false);
  const [forwardingCopied, setForwardingCopied] = useState(false);
  const [forwardingRegenConfirm, setForwardingRegenConfirm] = useState(false);
  const [forwardingRegenLoading, setForwardingRegenLoading] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (activeTab !== "connections") return;
    void (async () => {
      setForwardingLoading(true);
      try {
        const res = await fetch("/api/forwarding/setup");
        if (res.ok) {
          const data = await res.json() as { setting: ForwardingSettings };
          setForwardingSettings(data.setting);
        }
      } finally {
        setForwardingLoading(false);
      }
    })();
  }, [activeTab]);

  async function copyForwardingEmail() {
    if (!forwardingSettings) return;
    await navigator.clipboard.writeText(forwardingSettings.forwarding_email);
    setForwardingCopied(true);
    setTimeout(() => setForwardingCopied(false), 2000);
  }

  async function regenerateForwardingEmail() {
    if (!forwardingRegenConfirm) {
      setForwardingRegenConfirm(true);
      return;
    }
    setForwardingRegenLoading(true);
    setForwardingMessage(null);
    try {
      const res = await fetch("/api/forwarding/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      if (res.ok) {
        const data = await res.json() as { setting: ForwardingSettings };
        setForwardingSettings(data.setting);
        setForwardingRegenConfirm(false);
        setForwardingMessage({ ok: true, text: "Forwarding address regenerated. Update your email forwarding rules with the new address." });
      } else {
        setForwardingMessage({ ok: false, text: "Failed to regenerate address. Try again." });
      }
    } catch {
      setForwardingMessage({ ok: false, text: "Network error. Try again." });
    } finally {
      setForwardingRegenLoading(false);
    }
  }

  // ── Currency state ──
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() => getCurrencyCode());
  const [currencySaved, setCurrencySaved] = useState(false);

  function saveCurrency(code: string) {
    setSelectedCurrency(code);
    setCurrencyCode(code);
    setCurrencySaved(true);
    setTimeout(() => setCurrencySaved(false), 2000);
  }

  // ── Client email template state ──
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSubject, setTemplateSubject] = useState(DEFAULT_SUBJECT);
  const [templateBody, setTemplateBody] = useState(DEFAULT_BODY);
  const [templateSaved, setTemplateSaved] = useState(false);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ts = loadTemplates();
    const activeId = loadActiveTemplateId();
    const active = ts.find((t) => t.id === activeId) ?? ts[0];
    setTemplates(ts);
    setActiveTemplateId(active?.id ?? "");
    setTemplateName(active?.name ?? "");
    setTemplateSubject(active?.subject ?? DEFAULT_SUBJECT);
    setTemplateBody(active?.body ?? DEFAULT_BODY);
  }, []);

  function switchTemplate(id: string) {
    const t = templates.find((t) => t.id === id);
    if (!t) return;
    setActiveTemplateId(id);
    saveActiveTemplateId(id);
    setTemplateName(t.name);
    setTemplateSubject(t.subject);
    setTemplateBody(t.body);
  }

  function handleSaveTemplate() {
    const updated = templates.map((t) =>
      t.id === activeTemplateId ? { ...t, name: templateName, subject: templateSubject, body: templateBody } : t
    );
    setTemplates(updated);
    saveTemplates(updated);
    saveActiveTemplateId(activeTemplateId);
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 2000);
  }

  function handleNewTemplate() {
    const id = Date.now().toString();
    const newT: EmailTemplate = { id, name: "New template", subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
    const updated = [...templates, newT];
    setTemplates(updated);
    saveTemplates(updated);
    setActiveTemplateId(id);
    saveActiveTemplateId(id);
    setTemplateName(newT.name);
    setTemplateSubject(newT.subject);
    setTemplateBody(newT.body);
  }

  function handleDeleteTemplate() {
    if (templates.length <= 1) return;
    const updated = templates.filter((t) => t.id !== activeTemplateId);
    setTemplates(updated);
    saveTemplates(updated);
    const first = updated[0];
    setActiveTemplateId(first.id);
    saveActiveTemplateId(first.id);
    setTemplateName(first.name);
    setTemplateSubject(first.subject);
    setTemplateBody(first.body);
  }

  function insertVariable(key: string) {
    const ta = bodyTextareaRef.current;
    if (!ta) {
      setTemplateBody((prev) => prev + key);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = templateBody.slice(0, start) + key + templateBody.slice(end);
    setTemplateBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + key.length, start + key.length);
    });
  }

  const templatePreview = interpolate(templateBody, {
    customer_name: "Jane Smith",
    event_name: "Coldplay – Music of the Spheres",
    event_date: "Sat 14 Jun 2025",
    venue: "Wembley Stadium",
    section: "Block 201",
    seats: "Row M, Seats 12–14",
    quantity: "3",
  });

  // ── Connections state ──
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [connLoading, setConnLoading] = useState(true);
  const [connRefreshing, setConnRefreshing] = useState(false);
  const [connSubmitting, setConnSubmitting] = useState(false);
  const [connMessage, setConnMessage] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  // ── IMAP state ──
  const [imapAccounts, setImapAccounts] = useState<ImapAccountRow[]>([]);
  const [imapLoading, setImapLoading] = useState(true);
  const [imapMessage, setImapMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [imapSubmitting, setImapSubmitting] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapUsername, setImapUsername] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [imapUseTls, setImapUseTls] = useState(true);
  const [imapMailbox, setImapMailbox] = useState("INBOX");
  const [imapUnreadOnly, setImapUnreadOnly] = useState(true);
  const [imapMarkRead, setImapMarkRead] = useState(false);
  const [imapLabel, setImapLabel] = useState("");

  // ── Import state ──
  const [importStep, setImportStep] = useState<ImportStep>("upload");
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  type FailedRow = { rowNum: number; reason: string; data: Record<string, unknown> };
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; skipped: number; salesCreated: number; errors: string[]; failedRows: FailedRow[] } | null>(null);
  const [failedEdits, setFailedEdits] = useState<FailedRow[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fixedValues, setFixedValues] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // ── IMAP handlers ──
  async function loadImapAccounts() {
    setImapLoading(true);
    const { data, error } = await supabase
      .from("imap_accounts")
      .select("id, host, port, username, use_tls, mailbox, unread_only, mark_read, label, status, is_active, last_synced_at, created_at")
      .order("created_at", { ascending: false });
    if (!error) setImapAccounts((data as ImapAccountRow[]) || []);
    setImapLoading(false);
  }

  async function connectImap(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const host = imapHost.trim();
    const username = imapUsername.trim();
    if (!host || !username || !imapPassword) {
      setImapMessage({ ok: false, text: "Host, username, and password are required" });
      return;
    }
    setImapSubmitting(true);
    setImapMessage(null);
    try {
      const res = await fetch("/api/imap/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          port: parseInt(imapPort, 10) || 993,
          username,
          password: imapPassword,
          use_tls: imapUseTls,
          mailbox: imapMailbox || "INBOX",
          unread_only: imapUnreadOnly,
          mark_read: imapMarkRead,
          label: imapLabel || null,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setImapMessage({ ok: true, text: "IMAP account connected successfully" });
        setImapPassword("");
        await loadImapAccounts();
      } else {
        setImapMessage({ ok: false, text: data.error ?? "Connection failed" });
      }
    } catch {
      setImapMessage({ ok: false, text: "Network error — check your connection" });
    } finally {
      setImapSubmitting(false);
    }
  }

  async function removeImapAccount(id: string, username: string) {
    if (!window.confirm(`Remove IMAP account ${username}?`)) return;
    const res = await fetch("/api/imap/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      await loadImapAccounts();
      setImapMessage({ ok: true, text: "IMAP account removed" });
    }
  }

  async function toggleImapAccount(account: ImapAccountRow) {
    const nextActive = !account.is_active;
    await supabase
      .from("imap_accounts")
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq("id", account.id);
    await loadImapAccounts();
  }

  // ── Connection effects ──
  useEffect(() => {
    void loadAccounts();
    void loadImapAccounts();
  }, []);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      const provider = searchParams.get("provider");
      const label = provider === "outlook" ? "Outlook" : "Gmail";
      setConnMessage(`${label} connected: ${connected}`);
      void loadAccounts(true);
    } else if (error) {
      setConnMessage(formatOAuthError(error));
    }
  }, [searchParams]);

  // ── Connection handlers ──
  async function loadAccounts(showRefreshing = false) {
    if (showRefreshing) setConnRefreshing(true);
    else setConnLoading(true);
    const { data, error } = await supabase.from("gmail_accounts").select("*").order("created_at", { ascending: false });
    if (error) setConnMessage(error.message);
    else {
      setAccounts((data as GmailAccount[]) || []);
      if (showRefreshing && !searchParams.get("connected")) setConnMessage("Connections refreshed");
    }
    setConnLoading(false);
    setConnRefreshing(false);
  }

  async function addAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimEmail = newEmail.trim().toLowerCase();
    if (!trimEmail) { setConnMessage("Enter a Gmail address"); return; }
    setConnSubmitting(true);
    setConnMessage("");
    const { error } = await supabase.from("gmail_accounts").insert({
      email: trimEmail,
      display_name: newDisplayName.trim() || null,
      provider: "gmail",
      status: "Needs OAuth",
      sync_mode: "manual",
      is_primary: accounts.length === 0,
      is_active: true,
    });
    if (error) { setConnMessage(error.message); setConnSubmitting(false); return; }
    setNewEmail("");
    setNewDisplayName("");
    await loadAccounts(true);
    setConnMessage("Inbox added");
    setConnSubmitting(false);
  }

  async function toggleAccount(account: GmailAccount) {
    const nextActive = !account.is_active;
    const nextStatus = nextActive
      ? account.status === "Paused" ? (account.access_token ? "Ready" : "Needs OAuth") : account.status
      : "Paused";
    const { error } = await supabase.from("gmail_accounts")
      .update({ is_active: nextActive, status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", account.id);
    if (error) { setConnMessage(error.message); return; }
    await loadAccounts(true);
    setConnMessage(nextActive ? "Inbox resumed" : "Inbox paused");
  }

  async function setPrimary(account: GmailAccount) {
    setConnMessage("");
    for (const current of accounts) {
      const shouldBePrimary = current.id === account.id;
      if (current.is_primary === shouldBePrimary) continue;
      const { error } = await supabase.from("gmail_accounts")
        .update({ is_primary: shouldBePrimary, updated_at: new Date().toISOString() })
        .eq("id", current.id);
      if (error) { setConnMessage(error.message); return; }
    }
    await loadAccounts(true);
    setConnMessage("Primary inbox updated");
  }

  async function removeAccount(account: GmailAccount) {
    if (!window.confirm(`Remove ${account.email} from this profile?`)) return;
    const { error } = await supabase.from("gmail_accounts").delete().eq("id", account.id);
    if (error) { setConnMessage(error.message); return; }
    await loadAccounts(true);
    setConnMessage("Inbox removed");
  }

  const connMetrics = useMemo(() => {
    const connected = accounts.length;
    const active = accounts.filter((a) => a.is_active).length;
    const oauthReady = accounts.filter((a) => a.status === "Ready").length;
    const primary = accounts.find((a) => a.is_primary);
    return [
      { label: "Connected inboxes", value: String(connected), detail: `${connected} mailbox${connected !== 1 ? "es" : ""} on this profile` },
      { label: "OAuth ready", value: String(oauthReady), detail: oauthReady === 0 ? "No tokens yet" : `${oauthReady} inboxes authorised` },
      { label: "Active sync", value: String(active), detail: active === 0 ? "No live inboxes" : `${active} inboxes ready` },
      { label: "Primary inbox", value: primary ? primary.email.split("@")[0] : "None", detail: primary ? primary.email : "Pick one inbox to lead sync" },
    ];
  }, [accounts]);

  // ── Import handlers ──
  async function handleFile(file: File) {
    setImportMessage("");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      let rows: string[][];

      if (ext === "xlsx" || ext === "xls" || ext === "ods") {
        const { read, utils } = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csv = utils.sheet_to_csv(ws, { FS: ",", RS: "\n" });
        rows = parseCSV(csv);
      } else {
        const text = await file.text();
        rows = parseCSV(text);
      }

      if (rows.length < 2) {
        setImportMessage("File has no data rows. Make sure row 1 is headers.");
        return;
      }

      const headers = rows[0].map((h) => h.trim());
      const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
      const mapped: Record<number, string> = {};
      headers.forEach((h, i) => { mapped[i] = autoMapHeader(h); });

      setImportHeaders(headers);
      setImportRows(dataRows);
      setColMap(mapped);
      setImportStep("map");
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : "Failed to read file");
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, []);

  function updateColMap(colIndex: number, fieldKey: string) {
    setColMap((prev) => ({ ...prev, [colIndex]: fieldKey }));
  }

  const previewRows = useMemo(() => {
    return importRows.slice(0, 5).map((row) => transformRow(row, importHeaders, colMap));
  }, [importRows, importHeaders, colMap]);

  const mappedFieldLabels = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (let i = 0; i < importHeaders.length; i++) {
      const k = colMap[i];
      if (!k || k === "skip" || seen.has(k)) continue;
      seen.add(k);
      const field = IMPORT_FIELDS.find((f) => f.key === k);
      labels.push(field?.label ?? k);
    }
    return labels;
  }, [importHeaders, colMap]);

  async function runImport() {
    setImporting(true);
    setImportMessage("");

    const toInsert: Array<{ rowNum: number; data: Record<string, unknown> }> = [];
    const errors: string[] = [];
    const failedRows: FailedRow[] = [];

    for (let i = 0; i < importRows.length; i++) {
      const obj = transformRow(importRows[i], importHeaders, colMap);
      if (!obj || Object.keys(obj).length < 2) {
        const reason = "Not enough data (fewer than 2 fields)";
        errors.push(`Row ${i + 2}: ${reason}`);
        failedRows.push({ rowNum: i + 2, reason, data: obj ?? {} });
        continue;
      }
      // Apply fixed values for any field not already mapped from a column
      for (const [key, value] of Object.entries(fixedValues)) {
        if (value && !(key in obj)) obj[key] = value;
      }
      toInsert.push({ rowNum: i + 2, data: obj });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let salesCreated = 0;

    for (const { rowNum, data } of toInsert) {
      // Split into order-level and sale-level fields
      const orderData: Record<string, unknown> = {};
      const saleData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (ORDER_COLUMNS.has(key)) orderData[key] = value;
        else if (SALE_COLUMNS.has(key)) saleData[key] = value;
      }

      if (!orderData.booking_ref) orderData.booking_ref = crypto.randomUUID();
      if (!orderData.listing_status) {
        orderData.listing_status = (Object.keys(saleData).length > 0 || orderData.sold_total) ? "Sold" : "Unlisted";
      }

      const rowType = getRowType({ ...saleData, ...data });
      let orderId: string | null = null;

      // Insert order (or update on duplicate booking_ref)
      const { data: insertedOrder, error: orderError } = await supabase
        .from("orders")
        .insert(orderData)
        .select("id")
        .single();

      if (orderError) {
        if (orderError.message.includes("duplicate") && orderData.booking_ref) {
          const { booking_ref, ...updateData } = orderData as Record<string, unknown>;
          const { data: updatedOrder, error: updateError } = await supabase
            .from("orders")
            .update(updateData)
            .eq("booking_ref", booking_ref as string)
            .select("id")
            .single();
          if (updateError) {
            errors.push(`Row ${rowNum}: ${updateError.message}`);
            skipped++;
          } else {
            orderId = (updatedOrder as { id: string }).id;
            updated++;
          }
        } else {
          errors.push(`Row ${rowNum}: ${orderError.message}`);
          failedRows.push({ rowNum, reason: orderError.message, data });
          skipped++;
        }
      } else {
        orderId = (insertedOrder as { id: string }).id;
        inserted++;
      }

      // Create sale record if we have sale data and an actionable row type
      if (orderId && rowType !== "inventory_only" && rowType !== "skip") {
        let transferStatus = (saleData.transfer_status as string) ??
          (saleData.transfer_date ? "Transfer Completed" : "Awaiting Transfer");
        let paymentStatus = (saleData.payment_status as string) ??
          (saleData.payout_date ? "Paid" : "Awaiting Payment");

        let saleStatus = saleData.sale_status as string;
        if (!saleStatus || saleStatus === "_skip") {
          if (paymentStatus === "Paid") saleStatus = "Paid";
          else if (transferStatus === "Transfer Completed") saleStatus = "Sold – Transfer Completed";
          else saleStatus = "Sold – Awaiting Transfer";
        }

        // Archived tickets or paid/archived sales → treat as fully settled
        const isFullySettled =
          orderData.listing_status === "Archived" ||
          saleStatus === "Paid" ||
          (saleData.sale_status as string) === "Archived";
        if (isFullySettled) {
          saleStatus = "Paid";
          transferStatus = "Transfer Completed";
          paymentStatus = "Paid";
        }

        const saleTotal = (saleData.sale_total as number) ?? (orderData.sold_total as number) ?? null;
        const qtySold = (saleData.qty_sold as number) ?? (orderData.qty_bought as number) ?? 1;
        const payoutTotal = (saleData.payout_total as number) ??
          (paymentStatus === "Paid" ? saleTotal : null);

        const saleInsert: Record<string, unknown> = {
          source: "import",
          source_message_id: `import-${crypto.randomUUID()}`,
          inventory_order_id: orderId,
          event_name: orderData.event_name,
          ...(orderData.event_date ? { event_date: orderData.event_date } : {}),
          ...(orderData.venue ? { venue: orderData.venue } : {}),
          ...(orderData.section ? { section: orderData.section } : {}),
          ...(orderData.row ? { row: orderData.row } : {}),
          ...(orderData.seat_from ? { seat_from: orderData.seat_from } : {}),
          ...(orderData.seat_to ? { seat_to: orderData.seat_to } : {}),
          qty_sold: qtySold,
          sale_status: saleStatus,
          ...(saleData.sold_at ? { sold_at: saleData.sold_at } : {}),
          ...(saleTotal !== null ? { sale_total: saleTotal } : {}),
          ...(payoutTotal !== null ? { payout_total: payoutTotal } : {}),
          ...(saleData.buyer_name ? { buyer_name: saleData.buyer_name } : {}),
          ...(saleData.marketplace ? { marketplace: saleData.marketplace } : {}),
          ...(saleData.buyer_email ? { buyer_email: saleData.buyer_email } : {}),
          ...(saleData.external_sale_id ? { external_sale_id: saleData.external_sale_id } : {}),
          transfer_status: transferStatus,
          ...(saleData.transfer_date ? { transfer_date: saleData.transfer_date } : {}),
          ...(saleData.transfer_deadline ? { transfer_deadline: saleData.transfer_deadline } : {}),
          payment_status: paymentStatus,
          ...(saleData.expected_payout_date ? { expected_payout_date: saleData.expected_payout_date } : {}),
          ...(saleData.payout_date ? { payout_date: saleData.payout_date } : {}),
          ...(saleData.notes ? { notes: saleData.notes } : {}),
        };

        const { error: saleError } = await supabase.from("sales").insert(saleInsert);
        if (saleError) {
          errors.push(`Row ${rowNum} (sale): ${saleError.message}`);
        } else {
          salesCreated++;
          // Keep orders.sold_total in sync so dashboard profit is correct
          if (!orderData.sold_total && saleTotal !== null) {
            await supabase.from("orders").update({ sold_total: saleTotal }).eq("id", orderId);
          }
        }
      }
    }

    const result = { inserted, updated, skipped, salesCreated, errors, failedRows };
    setImportResult(result);
    setFailedEdits(failedRows.map((r) => ({ ...r, data: { ...r.data } })));
    setImporting(false);
    setImportStep("done");
  }

  function resetImport() {
    setImportStep("upload");
    setImportRows([]);
    setImportHeaders([]);
    setColMap({});
    setImportMessage("");
    setImportResult(null);
    setFailedEdits([]);
    setFixedValues({});
  }

  async function retryFailed() {
    if (failedEdits.length === 0) return;
    setRetrying(true);
    let inserted = importResult?.inserted ?? 0;
    let updated = importResult?.updated ?? 0;
    let salesCreated = importResult?.salesCreated ?? 0;
    let skipped = 0;
    const remainingFailed: FailedRow[] = [];

    for (const row of failedEdits) {
      const data = { ...row.data };
      for (const [key, value] of Object.entries(fixedValues)) {
        if (value && !(key in data)) data[key] = value;
      }

      const orderData: Record<string, unknown> = {};
      const saleData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (ORDER_COLUMNS.has(key)) orderData[key] = value;
        else if (SALE_COLUMNS.has(key)) saleData[key] = value;
      }
      if (!orderData.booking_ref) orderData.booking_ref = crypto.randomUUID();
      if (!orderData.listing_status) {
        orderData.listing_status = (Object.keys(saleData).length > 0 || orderData.sold_total) ? "Sold" : "Unlisted";
      }

      const rowType = getRowType({ ...saleData, ...data });
      let orderId: string | null = null;

      const { data: insertedOrder, error } = await supabase.from("orders").insert(orderData).select("id").single();
      if (error) {
        if (error.message.includes("duplicate") && orderData.booking_ref) {
          const { booking_ref, ...updateData } = orderData as Record<string, unknown>;
          const { data: updatedOrder, error: updateError } = await supabase
            .from("orders").update(updateData).eq("booking_ref", booking_ref as string).select("id").single();
          if (updateError) {
            remainingFailed.push({ ...row, reason: updateError.message, data });
            skipped++;
          } else {
            orderId = (updatedOrder as { id: string }).id;
            updated++;
          }
        } else {
          remainingFailed.push({ ...row, reason: error.message, data });
          skipped++;
        }
      } else {
        orderId = (insertedOrder as { id: string }).id;
        inserted++;
      }

      if (orderId && rowType !== "inventory_only" && rowType !== "skip") {
        let transferStatus = (saleData.transfer_status as string) ?? (saleData.transfer_date ? "Transfer Completed" : "Awaiting Transfer");
        let paymentStatus = (saleData.payment_status as string) ?? (saleData.payout_date ? "Paid" : "Awaiting Payment");
        let saleStatus = saleData.sale_status as string;
        if (!saleStatus || saleStatus === "_skip") {
          if (paymentStatus === "Paid") saleStatus = "Paid";
          else if (transferStatus === "Transfer Completed") saleStatus = "Sold – Transfer Completed";
          else saleStatus = "Sold – Awaiting Transfer";
        }
        const isFullySettled =
          orderData.listing_status === "Archived" ||
          saleStatus === "Paid" ||
          (saleData.sale_status as string) === "Archived";
        if (isFullySettled) {
          saleStatus = "Paid";
          transferStatus = "Transfer Completed";
          paymentStatus = "Paid";
        }
        const saleTotal = (saleData.sale_total as number) ?? (orderData.sold_total as number) ?? null;
        const qtySold = (saleData.qty_sold as number) ?? (orderData.qty_bought as number) ?? 1;
        const payoutTotal = (saleData.payout_total as number) ?? (paymentStatus === "Paid" ? saleTotal : null);
        const { error: saleError } = await supabase.from("sales").insert({
          source: "import",
          source_message_id: `import-${crypto.randomUUID()}`,
          inventory_order_id: orderId,
          event_name: orderData.event_name,
          ...(orderData.event_date ? { event_date: orderData.event_date } : {}),
          ...(orderData.venue ? { venue: orderData.venue } : {}),
          ...(orderData.section ? { section: orderData.section } : {}),
          ...(orderData.row ? { row: orderData.row } : {}),
          ...(orderData.seat_from ? { seat_from: orderData.seat_from } : {}),
          ...(orderData.seat_to ? { seat_to: orderData.seat_to } : {}),
          qty_sold: qtySold,
          sale_status: saleStatus,
          ...(saleData.sold_at ? { sold_at: saleData.sold_at } : {}),
          ...(saleTotal !== null ? { sale_total: saleTotal } : {}),
          ...(payoutTotal !== null ? { payout_total: payoutTotal } : {}),
          ...(saleData.buyer_name ? { buyer_name: saleData.buyer_name } : {}),
          ...(saleData.marketplace ? { marketplace: saleData.marketplace } : {}),
          ...(saleData.buyer_email ? { buyer_email: saleData.buyer_email } : {}),
          ...(saleData.external_sale_id ? { external_sale_id: saleData.external_sale_id } : {}),
          transfer_status: transferStatus,
          ...(saleData.transfer_date ? { transfer_date: saleData.transfer_date } : {}),
          ...(saleData.transfer_deadline ? { transfer_deadline: saleData.transfer_deadline } : {}),
          payment_status: paymentStatus,
          ...(saleData.expected_payout_date ? { expected_payout_date: saleData.expected_payout_date } : {}),
          ...(saleData.payout_date ? { payout_date: saleData.payout_date } : {}),
          ...(saleData.notes ? { notes: saleData.notes } : {}),
        });
        if (!saleError) {
          salesCreated++;
          // Keep orders.sold_total in sync so dashboard profit is correct
          if (!orderData.sold_total && saleTotal !== null) {
            await supabase.from("orders").update({ sold_total: saleTotal }).eq("id", orderId);
          }
        }
      }
    }

    setImportResult((prev) => prev ? {
      ...prev,
      inserted,
      updated,
      skipped,
      salesCreated,
      errors: remainingFailed.map((r) => `Row ${r.rowNum}: ${r.reason}`),
      failedRows: remainingFailed,
    } : null);
    setFailedEdits(remainingFailed.map((r) => ({ ...r, data: { ...r.data } })));
    setRetrying(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="orders-shell connections-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`}>
                <NavIcon href={item.href} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main connections-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Account</p>
            <h2>Settings</h2>
          </div>
        </header>

        {/* Tab navigation */}
        <section className="command-card" style={{ marginBottom: 0 }}>
          <div className="view-toggle">
            <button type="button" className={`toggle-btn${activeTab === "connections" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("connections")}>
              Connections
            </button>
            <button type="button" className={`toggle-btn${activeTab === "import" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("import")}>
              Import
            </button>
            <button type="button" className={`toggle-btn${activeTab === "currency" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("currency")}>
              Currency
            </button>
            <button type="button" className={`toggle-btn${activeTab === "clients" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("clients")}>
              Clients
            </button>
            <button type="button" className={`toggle-btn${activeTab === "notifications" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("notifications")}>
              Notifications
            </button>
            <button type="button" className={`toggle-btn${activeTab === "accounts" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("accounts")}>
              Accounts
            </button>
          </div>
        </section>

        {/* ── Connections tab ── */}
        {activeTab === "connections" && (
          <>
            {/* ── Email Forwarding — RECOMMENDED (top of page) ── */}
            <section id="email-forwarding-section" className="hero-card connections-hero" style={{ border: "1px solid rgba(103,240,165,0.35)", background: "linear-gradient(135deg, rgba(103,240,165,0.06) 0%, rgba(0,0,0,0) 60%)" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#67F0A5", textTransform: "uppercase", letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 99, background: "rgba(103,240,165,0.15)", border: "1px solid rgba(103,240,165,0.3)" }}>⭐ Recommended</span>
                </div>
                <p className="section-tag">Email Forwarding</p>
                <h3>Forward emails to TixTracker</h3>
              </div>
              <div className="hero-meta">
                <div>
                  <span className="hero-meta-label">Status</span>
                  <strong style={{ color: forwardingSettings ? "#67F0A5" : "var(--text-2)" }}>
                    {forwardingLoading ? "Loading…" : forwardingSettings ? "Active" : "Not set up"}
                  </strong>
                </div>
                {forwardingSettings?.last_successful_import_at && (
                  <div>
                    <span className="hero-meta-label">Last imported</span>
                    <strong>{new Date(forwardingSettings.last_successful_import_at).toLocaleDateString()}</strong>
                  </div>
                )}
              </div>
            </section>

            <section className="table-card" style={{ borderColor: "rgba(103,240,165,0.15)" }}>
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Your forwarding address</p>
                  <h4>Forward from any email provider</h4>
                </div>
                <Link href="/how-to-forward" target="_blank" rel="noopener noreferrer" className="secondary-button" style={{ flexShrink: 0, fontSize: 13 }}>
                  How to set up forwarding →
                </Link>
              </div>
              <div style={{ padding: "0 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.6 }}>
                  Works with Gmail, Outlook, Apple Mail, Yahoo, ProtonMail, and any other email client. Copy your unique address below, then forward ticket confirmation emails to it — they&apos;re scanned automatically. You can forward emails one at a time, or set up an automatic forwarding rule so new ticket emails arrive without any extra steps.
                </p>

                {forwardingLoading && (
                  <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", fontSize: 13, color: "var(--text-muted)" }}>
                    Loading your forwarding address…
                  </div>
                )}

                {!forwardingLoading && !forwardingSettings && (
                  <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", fontSize: 13, color: "#f87171" }}>
                    Could not load forwarding address. Make sure the database migration has been applied, then refresh the page.
                  </div>
                )}

                {!forwardingLoading && forwardingSettings && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <code style={{
                        flex: "1 1 320px",
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        fontSize: "0.82rem",
                        fontFamily: "var(--font-geist-mono, monospace)",
                        color: "#a5aaff",
                        wordBreak: "break-all",
                        userSelect: "all",
                      }}>
                        {forwardingSettings.forwarding_email}
                      </code>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ flexShrink: 0 }}
                        onClick={() => void copyForwardingEmail()}
                      >
                        {forwardingCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>

                    {forwardingSettings.latest_verification_code && (
                      <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(165,170,255,0.08)", border: "1px solid rgba(165,170,255,0.25)" }}>
                        <p style={{ margin: "0 0 4px", fontSize: "0.78rem", fontWeight: 700, color: "#a5aaff", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                          Gmail Verification Code Received
                        </p>
                        <p style={{ margin: "0 0 6px", fontSize: "0.82rem", color: "rgba(255,255,255,0.6)" }}>
                          TixTracker received a verification email from Gmail. Enter this code in Gmail to complete forwarding setup:
                        </p>
                        <code style={{ fontSize: "1.1rem", fontWeight: 700, color: "#67F0A5", fontFamily: "var(--font-geist-mono, monospace)" }}>
                          {forwardingSettings.latest_verification_code}
                        </code>
                        {forwardingSettings.latest_verification_link && (
                          <p style={{ margin: "8px 0 0", fontSize: "0.78rem" }}>
                            Or{" "}
                            <a href={forwardingSettings.latest_verification_link} target="_blank" rel="noopener noreferrer" style={{ color: "#a5aaff" }}>
                              click here to confirm forwarding
                            </a>
                          </p>
                        )}
                      </div>
                    )}

                    <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                        This address is permanent and unique to your account. Emails forwarded to it are processed using the same engine as the Gmail scanner.
                        Only forward ticket confirmation emails from Ticketmaster, AXS, Viagogo, StubHub or Ticombo.
                      </p>
                    </div>

                    <div style={{ paddingTop: 4 }}>
                      <p style={{ margin: "0 0 8px", fontSize: "0.78rem", fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Danger zone</p>
                      {!forwardingRegenConfirm ? (
                        <button type="button" className="secondary-button" style={{ fontSize: 12, color: "rgba(248,113,113,0.8)", borderColor: "rgba(248,113,113,0.3)" }} onClick={() => setForwardingRegenConfirm(true)}>
                          Regenerate forwarding address
                        </button>
                      ) : (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>This will break any existing forwarding rules. You will need to update your email client to use the new address.</p>
                          <button type="button" className="secondary-button" style={{ fontSize: 12, color: "#f87171", borderColor: "rgba(248,113,113,0.5)" }} disabled={forwardingRegenLoading} onClick={() => void regenerateForwardingEmail()}>
                            {forwardingRegenLoading ? "Regenerating…" : "Yes, regenerate"}
                          </button>
                          <button type="button" className="secondary-button" style={{ fontSize: 12 }} onClick={() => setForwardingRegenConfirm(false)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {forwardingMessage && (
                  <div style={{ padding: "8px 14px", borderRadius: 8, fontSize: "0.82rem", background: forwardingMessage.ok ? "rgba(103,240,165,0.1)" : "rgba(255,80,80,0.1)", border: `1px solid ${forwardingMessage.ok ? "rgba(103,240,165,0.3)" : "rgba(255,80,80,0.3)"}`, color: forwardingMessage.ok ? "#67F0A5" : "#ff8080" }}>
                    {forwardingMessage.ok ? "✓ " : "✗ "}{forwardingMessage.text}
                  </div>
                )}
              </div>
            </section>

            <section className="hero-card connections-hero">
              <div>
                <p className="section-tag">Connections</p>
                <h3>Connect Gmail &amp; Outlook inboxes</h3>
              </div>
              <div className="hero-meta">
                <div>
                  <span className="hero-meta-label">Inboxes</span>
                  <strong>{accounts.length}</strong>
                </div>
                <div>
                  <span className="hero-meta-label">OAuth ready</span>
                  <strong>{accounts.filter((a) => a.status === "Ready").length}</strong>
                </div>
              </div>
            </section>

            <div className="topbar-actions" style={{ padding: "0 0 1rem 0" }}>
              <button type="button" className="secondary-button" onClick={() => void loadAccounts(true)} disabled={connRefreshing}>
                {connRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <Link href="/api/outlook/connect" className="secondary-button">Connect Outlook</Link>
              <span className="primary-button" style={{ opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}>Coming soon</span>
            </div>

            {connMessage ? <div className="feedback-banner" role="status"><span className="feedback-dot" /><span>{connMessage}</span></div> : null}

            <section className="kpi-grid connections-kpi-grid">
              {connMetrics.map((m) => (
                <article key={m.label} className="kpi-card">
                  <p className="kpi-label">{m.label}</p>
                  <strong className="kpi-value">{m.value}</strong>
                  <span className="kpi-trend">{m.detail}</span>
                </article>
              ))}
            </section>

            <section className="command-card connections-command-card">
              <div className="command-header">
                <div><p className="section-tag">Gmail</p><h4>Connect Gmail</h4></div>
              </div>
              <div className="connections-cta-row">
                <div className="connections-cta-copy">
                  <strong>Scan ticket emails automatically</strong>
                  <span>
                    Connect Gmail so TixTracker can scan ticket-related emails and import ticket
                    purchases, sales, transfer confirmations and payout information into your
                    dashboard.
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", marginTop: "6px", display: "block" }}>
                    TixTracker uses read-only Gmail access. We do not send, delete or modify emails,
                    mark emails as read, or sell your Google data.
                  </span>
                </div>
                <span className="primary-button" style={{ opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}>Coming soon</span>
              </div>
            </section>

            <section className="command-card connections-command-card">
              <div className="command-header">
                <div><p className="section-tag">Outlook</p><h4>Connect a Microsoft inbox</h4></div>
              </div>
              <div className="connections-cta-row">
                <div className="connections-cta-copy">
                  <strong>Microsoft OAuth</strong>
                  <span>Authorise an Outlook or Hotmail inbox via Microsoft Graph.</span>
                </div>
                <Link href="/api/outlook/connect" className="primary-button">Connect Outlook</Link>
              </div>
              <form className="connections-form" onSubmit={addAccount}>
                <label className="field-label">
                  <span>Email</span>
                  <input className="command-input" type="email" placeholder="tickets@yourdomain.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </label>
                <label className="field-label">
                  <span>Label</span>
                  <input className="command-input" type="text" placeholder="Main inbox" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} />
                </label>
                <button type="submit" className="secondary-button" disabled={connSubmitting}>{connSubmitting ? "Adding..." : "Add manually"}</button>
              </form>
            </section>

            <section className="command-card connections-command-card">
              <div className="command-header">
                <div><p className="section-tag">IMAP</p><h4>Connect any email inbox via IMAP</h4></div>
              </div>
              <p style={{ margin: "0 0 1rem", color: "var(--text-2)", fontSize: "0.85rem", lineHeight: 1.6 }}>
                Works with any IMAP-enabled inbox — iCloud Mail, Outlook, Gmail, Yahoo, custom domains, and more. Some providers require an app-specific password: iCloud (Apple ID → Sign-In &amp; Security → App-Specific Passwords), Gmail (Google Account → Security → App Passwords), Yahoo (Account Security → Generate app password).
              </p>
              <form className="connections-form" style={{ gap: "0.75rem" }} onSubmit={(e) => void connectImap(e)}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem" }}>
                  <label className="field-label">
                    <span>Host</span>
                    <input className="command-input" type="text" placeholder="imap.mail.me.com" value={imapHost} onChange={(e) => setImapHost(e.target.value)} required />
                  </label>
                  <label className="field-label">
                    <span>Port</span>
                    <input className="command-input" type="number" placeholder="993" value={imapPort} onChange={(e) => setImapPort(e.target.value)} style={{ width: "80px" }} />
                  </label>
                </div>
                <label className="field-label">
                  <span>Username (email address)</span>
                  <input className="command-input" type="email" placeholder="you@icloud.com" value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required />
                </label>
                <label className="field-label">
                  <span>Password</span>
                  <input className="command-input" type="password" placeholder="App-specific password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} autoComplete="new-password" required />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <label className="field-label">
                    <span>Mailbox</span>
                    <input className="command-input" type="text" placeholder="INBOX" value={imapMailbox} onChange={(e) => setImapMailbox(e.target.value)} />
                  </label>
                  <label className="field-label">
                    <span>Label (optional)</span>
                    <input className="command-input" type="text" placeholder="iCloud tickets" value={imapLabel} onChange={(e) => setImapLabel(e.target.value)} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={imapUseTls} onChange={(e) => setImapUseTls(e.target.checked)} />
                    TLS / SSL
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={imapUnreadOnly} onChange={(e) => setImapUnreadOnly(e.target.checked)} />
                    Unread only
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={imapMarkRead} onChange={(e) => setImapMarkRead(e.target.checked)} />
                    Mark as read after scan
                  </label>
                </div>
                {imapMessage && (
                  <div style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    background: imapMessage.ok ? "rgba(103,240,165,0.08)" : "rgba(255,80,80,0.08)",
                    border: `1px solid ${imapMessage.ok ? "rgba(103,240,165,0.25)" : "rgba(255,80,80,0.25)"}`,
                    color: imapMessage.ok ? "#67F0A5" : "#ff8080",
                  }}>
                    {imapMessage.ok ? "✓ " : "✗ "}{imapMessage.text}
                  </div>
                )}
                <button type="submit" className="primary-button" disabled={imapSubmitting} style={{ alignSelf: "flex-start" }}>
                  {imapSubmitting ? "Connecting..." : "Connect &amp; test"}
                </button>
              </form>
            </section>

            {/* IMAP account list */}
            {(imapLoading || imapAccounts.length > 0) && (
              <section className="table-card connections-list-card">
                <div className="table-card-header">
                  <div><p className="section-tag">IMAP</p><h4>IMAP accounts</h4></div>
                  <span className="table-count">{imapAccounts.length} total</span>
                </div>
                {imapLoading ? (
                  <div className="empty-state compact-empty-state"><h5>Loading...</h5></div>
                ) : (
                  <div className="connections-list">
                    {imapAccounts.map((account) => (
                      <article key={account.id} className="connection-card">
                        <div className="connection-card-main">
                          <div className="connection-card-topline">
                            <strong>{account.label || account.username}</strong>
                            <div className="connection-badges">
                              <span className={`status-badge ${connectionStatusClass(account.status)}`}>{account.status}</span>
                              {!account.is_active && <span className="status-badge badge-paused">Paused</span>}
                            </div>
                          </div>
                          <p className="connection-email">{account.username} — {account.host}:{account.port}</p>
                          <div className="connection-meta-grid">
                            <div><span className="connection-meta-label">Mailbox</span><strong>{account.mailbox}</strong></div>
                            <div><span className="connection-meta-label">TLS</span><strong>{account.use_tls ? "Yes" : "No"}</strong></div>
                            <div><span className="connection-meta-label">Last sync</span><strong>{account.last_synced_at ? formatDateTime(account.last_synced_at) : "Pending"}</strong></div>
                          </div>
                        </div>
                        <div className="connection-card-actions">
                          <button type="button" className="secondary-button" onClick={() => void toggleImapAccount(account)}>
                            {account.is_active ? "Pause" : "Resume"}
                          </button>
                          <button type="button" className="ghost-button danger-button" onClick={() => void removeImapAccount(account.id, account.username)}>Remove</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="table-card connections-list-card">
              <div className="table-card-header">
                <div><p className="section-tag">Inboxes</p><h4>Mailbox list</h4></div>
                <span className="table-count">{accounts.length} total</span>
              </div>
              {connLoading ? (
                <div className="empty-state compact-empty-state"><h5>Loading inboxes...</h5></div>
              ) : accounts.length === 0 ? (
                <div className="empty-state connections-empty-state">
                  <div className="empty-orb" />
                  <h5>No inboxes yet</h5>
                  <p>Connect Gmail to start syncing Viagogo sales emails.</p>
                  <span className="primary-button" style={{ opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}>Coming soon</span>
                </div>
              ) : (
                <div className="connections-list">
                  {accounts.map((account) => (
                    <article key={account.id} className="connection-card">
                      <div className="connection-card-main">
                        <div className="connection-card-topline">
                          <strong>{account.display_name || account.email}</strong>
                          <div className="connection-badges">
                            <span className={`status-badge ${connectionStatusClass(account.status)}`}>{account.status}</span>
                            {account.is_primary && <span className="status-badge badge-primary">Primary</span>}
                            {!account.is_active && <span className="status-badge badge-paused">Paused</span>}
                          </div>
                        </div>
                        <p className="connection-email">{account.email}</p>
                        <div className="connection-meta-grid">
                          <div><span className="connection-meta-label">Provider</span><strong>{account.provider}</strong></div>
                          <div><span className="connection-meta-label">Mode</span><strong>{account.sync_mode}</strong></div>
                          <div><span className="connection-meta-label">Last sync</span><strong>{account.last_synced_at ? formatDateTime(account.last_synced_at) : "Pending"}</strong></div>
                        </div>
                      </div>
                      <div className="connection-card-actions">
                        {account.status !== "Ready" && (
                          account.provider === "outlook"
                            ? <Link href="/api/outlook/connect" className="primary-button">Connect</Link>
                            : <span className="primary-button" style={{ opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" }}>Coming soon</span>
                        )}
                        {!account.is_primary && (
                          <button type="button" className="secondary-button" onClick={() => void setPrimary(account)}>Set primary</button>
                        )}
                        <button type="button" className="secondary-button" onClick={() => void toggleAccount(account)}>
                          {account.is_active ? "Pause" : "Resume"}
                        </button>
                        <button type="button" className="ghost-button danger-button" onClick={() => void removeAccount(account)}>
                          {account.provider === "gmail" ? "Disconnect Gmail" : "Remove"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* ── Discord account linking ── */}
            <section className="table-card connections-list-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Account</p>
                  <h4>Link Discord account</h4>
                </div>
                {discordLinked && (
                  <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: "rgba(74,222,128,0.12)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)", fontWeight: 600 }}>
                    Connected
                  </span>
                )}
              </div>
              <div style={{ padding: "1.25rem 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                {discordLinked === undefined ? (
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>Checking account…</p>
                ) : discordLinked !== null ? (
                  /* Already linked */
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {justLinked && (
                      <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", fontSize: 13, color: "#4ade80" }}>
                        Discord linked successfully — you can now sign in with Discord.
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, background: "rgba(88,101,242,0.1)", border: "1px solid rgba(88,101,242,0.25)" }}>
                      <svg width="20" height="15" viewBox="0 0 18 14" fill="none"><path d="M15.245 1.175A14.91 14.91 0 0 0 11.567 0c-.167.302-.362.71-.496 1.033a13.784 13.784 0 0 0-4.143 0A11.124 11.124 0 0 0 6.431 0 14.968 14.968 0 0 0 2.75 1.179C.395 4.753-.242 8.238.076 11.674c1.54 1.148 3.033 1.846 4.502 2.303a10.8 10.8 0 0 0 .95-1.57 9.723 9.723 0 0 1-1.495-.73c.125-.093.248-.19.366-.29 2.884 1.353 6.016 1.353 8.866 0 .12.1.243.197.366.29a9.72 9.72 0 0 1-1.499.731c.28.558.604 1.086.952 1.57 1.47-.457 2.965-1.155 4.505-2.304.37-3.955-.627-7.408-2.644-10.499zM6.013 9.554c-.895 0-1.63-.835-1.63-1.857 0-1.022.717-1.859 1.63-1.859.914 0 1.647.836 1.63 1.859 0 1.022-.715 1.857-1.63 1.857zm6.025 0c-.896 0-1.63-.835-1.63-1.857 0-1.022.716-1.859 1.63-1.859.913 0 1.646.836 1.63 1.859 0 1.022-.716 1.857-1.63 1.857z" fill="#a5aaff"/></svg>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#a5aaff", margin: 0 }}>@{discordLinked.username}</p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: 0 }}>You can sign in with Discord or email</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Not linked — show steps */
                  <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                      Link your Discord account so you can sign in with Discord going forward. Your existing data, orders, and sales are preserved.
                    </p>

                    {/* Step 1 — Export */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>Step 1 — Back up your data first</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 12px" }}>
                        Export your orders and sales as a safety net before linking. This takes 2 seconds and means nothing can be lost.
                      </p>
                      <button
                        type="button"
                        className={exported ? "secondary-button" : "primary-button"}
                        disabled={exportingData}
                        onClick={() => void exportAllData()}
                        style={{ fontSize: 13 }}
                      >
                        {exportingData ? "Exporting…" : exported ? "✓ Exported — download again?" : "Export all data (CSV)"}
                      </button>
                    </div>

                    {/* Step 2 — Link */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(88,101,242,0.07)", border: "1px solid rgba(88,101,242,0.2)" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#a5aaff", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>Step 2 — Link Discord</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 12px" }}>
                        You&apos;ll be sent to Discord to authorise. When you return, your accounts are merged and you can log in with either method.
                      </p>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ background: "rgba(88,101,242,0.25)", border: "1px solid rgba(88,101,242,0.5)", color: "#a5aaff", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                        onClick={() => void linkDiscordAccount()}
                      >
                        <svg width="16" height="12" viewBox="0 0 18 14" fill="none"><path d="M15.245 1.175A14.91 14.91 0 0 0 11.567 0c-.167.302-.362.71-.496 1.033a13.784 13.784 0 0 0-4.143 0A11.124 11.124 0 0 0 6.431 0 14.968 14.968 0 0 0 2.75 1.179C.395 4.753-.242 8.238.076 11.674c1.54 1.148 3.033 1.846 4.502 2.303a10.8 10.8 0 0 0 .95-1.57 9.723 9.723 0 0 1-1.495-.73c.125-.093.248-.19.366-.29 2.884 1.353 6.016 1.353 8.866 0 .12.1.243.197.366.29a9.72 9.72 0 0 1-1.499.731c.28.558.604 1.086.952 1.57 1.47-.457 2.965-1.155 4.505-2.304.37-3.955-.627-7.408-2.644-10.499zM6.013 9.554c-.895 0-1.63-.835-1.63-1.857 0-1.022.717-1.859 1.63-1.859.914 0 1.647.836 1.63 1.859 0 1.022-.715 1.857-1.63 1.857zm6.025 0c-.896 0-1.63-.835-1.63-1.857 0-1.022.716-1.859 1.63-1.859.913 0 1.646.836 1.63 1.859 0 1.022-.716 1.857-1.63 1.857z" fill="currentColor"/></svg>
                        Link Discord account
                      </button>
                      {linkError && (
                        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", fontSize: 12, color: "#f87171" }}>
                          {linkError.includes("already") || linkError.includes("in use")
                            ? "This Discord account is already linked to a different TixTracker login. If you previously signed in with Discord to test, you'll need to delete that test account first — contact support."
                            : linkError}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

          </>
        )}

        {/* ── Import tab ── */}
        {activeTab === "import" && (
          <>
            <section className="hero-card connections-hero">
              <div>
                <p className="section-tag">Import</p>
                <h3>Bring in your existing tickets from any spreadsheet</h3>
              </div>
              <div className="hero-meta">
                <div><span className="hero-meta-label">Formats</span><strong>CSV · XLSX · TSV</strong></div>
                <div><span className="hero-meta-label">Step</span><strong>{importStep === "upload" ? "1 / 4" : importStep === "map" ? "2 / 4" : importStep === "preview" ? "3 / 4" : "Done"}</strong></div>
              </div>
            </section>

            {importMessage && (
              <div className="feedback-banner feedback-banner-error" role="status">
                <span className="feedback-dot" /><span>{importMessage}</span>
              </div>
            )}

            {/* Step 1: Upload */}
            {importStep === "upload" && (
              <section className="table-card">
                <div className="table-card-header">
                  <div><p className="section-tag">Step 1</p><h4>Upload your file</h4></div>
                </div>
                <div style={{ padding: "1.5rem" }}>
                  <p style={{ marginBottom: "1rem", color: "var(--muted)", fontSize: "0.875rem" }}>
                    Export your spreadsheet or Google Sheet as CSV, XLSX, or TSV. TixTracker will read your column headers and auto-map them — even if they don't match exactly.
                  </p>
                  <div
                    className={`import-dropzone${dragOver ? " import-dropzone-active" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                  >
                    <div className="import-dropzone-icon">↑</div>
                    <strong>Drop file here or click to browse</strong>
                    <span>Supports .csv, .xlsx, .xls, .tsv — max 5 MB</span>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.ods" style={{ display: "none" }} onChange={handleFileInput} />
                  <div style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: "12px", padding: "6px 14px" }}
                      onClick={() => {
                        const headers = [
                          "Event Name", "Venue", "Event Date", "Section", "Row",
                          "Seat From", "Seat To", "Qty Bought", "Total Cost",
                          "Booking Ref", "Account Email",
                          "Platform", "Viagogo Order ID", "Qty Sold", "Sold For", "Payout Total",
                          "Buyer Name", "Buyer Email", "Sale Date",
                          "Sale Status", "Transfer Status", "Transfer Date", "Transfer Deadline",
                          "Payment Status", "Expected Payout Date", "Payout Date",
                          "Notes",
                        ];
                        const example = [
                          "Coldplay World Tour", "Wembley Stadium", "15/06/2025", "Block 123", "A",
                          "1", "2", "2", "350.00",
                          "TM-123456", "myaccount@gmail.com",
                          "Viagogo", "VG-987654321", "2", "480.00", "420.00",
                          "John Smith", "buyer@email.com", "01/05/2025",
                          "Sold – Transfer Completed", "Transfer Completed", "01/06/2025", "03/06/2025",
                          "Paid", "10/06/2025", "05/06/2025",
                          "",
                        ];
                        const csv = [headers.join(","), example.join(",")].join("\n");
                        const blob = new Blob([csv], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "tixtracker-import-template.csv";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Download Template CSV
                    </button>
                  </div>
                  <div style={{ marginTop: "1.5rem" }}>
                    <p className="section-tag" style={{ marginBottom: "0.5rem" }}>Tips for best results</p>
                    <ul style={{ fontSize: "0.8125rem", color: "var(--muted)", lineHeight: 1.6, paddingLeft: "1.25rem" }}>
                      <li>Row 1 should be column headers (Event, Date, Cost, etc.)</li>
                      <li>Headers don't need to match exactly — "Purchase Price", "Cost", "Amount Paid" all work</li>
                      <li>Dates can be any common format: DD/MM/YYYY, MM/DD/YYYY, or "14 Apr 2025"</li>
                      <li>Costs can include £ or $ symbols and commas — they'll be stripped automatically</li>
                      <li>A "Seats" column with ranges like "12-14" will auto-split into Seat From and Seat To</li>
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* Step 2: Map columns */}
            {importStep === "map" && (
              <section className="table-card">
                <div className="table-card-header">
                  <div>
                    <p className="section-tag">Step 2 of 4</p>
                    <h4>Review column mapping</h4>
                  </div>
                  <span className="table-count">{importRows.length} data rows · {importHeaders.length} columns</span>
                </div>
                <div style={{ padding: "0 1.5rem 0.5rem" }}>
                  <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
                    TixTracker has auto-matched your columns. Check each one is mapped correctly — set to "Skip" for columns you don't need.
                  </p>
                </div>
                <div className="import-map-grid">
                  {importHeaders.map((header, i) => {
                    const sampleVal = importRows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" / ");
                    const mapped = colMap[i] ?? "skip";
                    const isSkipped = mapped === "skip";
                    return (
                      <div key={i} className={`import-map-row${isSkipped ? " import-map-row-skipped" : ""}`}>
                        <div className="import-map-header">
                          <strong>{header || `Column ${i + 1}`}</strong>
                          {sampleVal && <span className="import-map-sample">{sampleVal.slice(0, 60)}</span>}
                        </div>
                        <div className="import-map-arrow">→</div>
                        <select
                          className="field import-map-select"
                          value={mapped}
                          onChange={(e) => updateColMap(i, e.target.value)}
                        >
                          <option value="skip">— Skip column —</option>
                          {FIELD_GROUPS.map(({ group, fields }) => (
                            <optgroup key={group} label={group}>
                              {fields.map((f) => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {/* Fixed values panel */}
                <div style={{ padding: "0 1.5rem 1rem", borderTop: "1px solid var(--border)" }}>
                  <p className="section-tag" style={{ margin: "1rem 0 0.25rem" }}>Optional fallback values</p>
                  <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "1rem" }}>
                    Only used when a row has no value from the column mapping above. Each row's own data always takes priority.
                    Useful when your entire file shares one value — e.g. every sale is via Viagogo, or every row is Awaiting Transfer.
                    If your file has mixed statuses per row, map those columns above and leave these blank.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
                    <label className="field-label">
                      <span>Platform / Marketplace</span>
                      <select
                        className="field"
                        value={fixedValues.marketplace ?? ""}
                        onChange={(e) => setFixedValues((p) => ({ ...p, marketplace: e.target.value }))}
                      >
                        <option value="">— not set —</option>
                        <option>Viagogo</option>
                        <option>StubHub</option>
                        <option>Lysted</option>
                        <option>Private Broker</option>
                        <option>Ticketmaster</option>
                        <option>AXS</option>
                        <option>SEE Tickets</option>
                        <option>Skiddle</option>
                        <option>Twickets</option>
                        <option>FIXR</option>
                        <option>Dice</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>Sale Status</span>
                      <select
                        className="field"
                        value={fixedValues.sale_status ?? ""}
                        onChange={(e) => setFixedValues((p) => ({ ...p, sale_status: e.target.value }))}
                      >
                        <option value="">— not set —</option>
                        <option value="Sold – Awaiting Transfer">Sold – Awaiting Transfer</option>
                        <option value="Sold – Transfer Completed">Sold – Transfer Completed</option>
                        <option value="Paid">Paid</option>
                        <option value="Cancelled / Issue">Cancelled / Issue</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>Transfer Status</span>
                      <select
                        className="field"
                        value={fixedValues.transfer_status ?? ""}
                        onChange={(e) => setFixedValues((p) => ({ ...p, transfer_status: e.target.value }))}
                      >
                        <option value="">— not set —</option>
                        <option value="Awaiting Transfer">Awaiting Transfer</option>
                        <option value="Transfer Completed">Transfer Completed</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>Payment Status</span>
                      <select
                        className="field"
                        value={fixedValues.payment_status ?? ""}
                        onChange={(e) => setFixedValues((p) => ({ ...p, payment_status: e.target.value }))}
                      >
                        <option value="">— not set —</option>
                        <option value="Awaiting Payment">Awaiting Payment</option>
                        <option value="Paid">Paid</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="import-footer">
                  <button type="button" className="ghost-button" onClick={resetImport}>Back</button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setImportStep("preview")}
                    disabled={!Object.values(colMap).some((v) => v !== "skip")}
                  >
                    Preview import →
                  </button>
                </div>
              </section>
            )}

            {/* Step 3: Preview */}
            {importStep === "preview" && (
              <section className="table-card">
                <div className="table-card-header">
                  <div>
                    <p className="section-tag">Step 3 of 4</p>
                    <h4>Preview (first 5 rows)</h4>
                  </div>
                  <span className="table-count">{importRows.length} rows ready to import</span>
                </div>
                <div style={{ padding: "0 1.5rem 1rem" }}>
                  <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
                    Check the data looks right before importing. Only completely empty rows will be skipped.
                  </p>
                </div>
                <div className="table-scroll">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        {mappedFieldLabels.map((label) => <th key={label}>{label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) =>
                        row ? (
                          <tr key={i}>
                            {mappedFieldLabels.map((label) => {
                              const fieldKey = IMPORT_FIELDS.find((f) => f.label === label)?.key ?? label;
                              return <td key={label}>{String(row[fieldKey] ?? "—")}</td>;
                            })}
                          </tr>
                        ) : (
                          <tr key={i} style={{ opacity: 0.4 }}>
                            <td colSpan={mappedFieldLabels.length}>Empty row — will be skipped</td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="import-footer">
                  <button type="button" className="ghost-button" onClick={() => setImportStep("map")}>Back</button>
                  <button type="button" className="primary-button" onClick={() => void runImport()} disabled={importing}>
                    {importing ? "Importing..." : `Import ${importRows.length} rows →`}
                  </button>
                </div>
              </section>
            )}

            {/* Step 4: Done */}
            {importStep === "done" && importResult && (
              <section className="table-card">
                <div className="table-card-header">
                  <div><p className="section-tag">Complete</p><h4>Import finished</h4></div>
                </div>
                <div style={{ padding: "2rem 1.5rem" }}>
                  <div className="drawer-summary" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "0.75rem" }}>
                    <div>
                      <span>Tickets imported</span>
                      <strong className="value-up">{importResult.inserted}</strong>
                    </div>
                    <div>
                      <span>Tickets updated</span>
                      <strong className="value-up">{importResult.updated}</strong>
                    </div>
                    <div>
                      <span>Skipped</span>
                      <strong>{importResult.skipped}</strong>
                    </div>
                  </div>
                  <div className="drawer-summary" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1.5rem" }}>
                    <div>
                      <span>Sales created</span>
                      <strong style={{ color: importResult.salesCreated > 0 ? "#4ade80" : undefined }}>{importResult.salesCreated}</strong>
                    </div>
                    <div>
                      <span>Total rows</span>
                      <strong>{importRows.length}</strong>
                    </div>
                    <div>
                      <span>Errors</span>
                      <strong style={{ color: importResult.errors.length > 0 ? "#f87171" : undefined }}>{importResult.errors.length}</strong>
                    </div>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div style={{ marginTop: "1rem", maxHeight: 200, overflowY: "auto", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                      <p style={{ fontSize: "0.75rem", color: "#f87171", fontWeight: 600, marginBottom: "0.5rem" }}>Error details:</p>
                      {importResult.errors.map((e, i) => (
                        <p key={i} style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)", marginBottom: "0.25rem" }}>{e}</p>
                      ))}
                    </div>
                  )}
                  {failedEdits.length > 0 && (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <p className="section-tag" style={{ marginBottom: "0.25rem" }}>Failed rows — edit and retry ({failedEdits.length})</p>
                      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "1rem" }}>Fix the data below then click Retry to import these rows.</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "400px", overflowY: "auto" }}>
                        {failedEdits.map((row, ri) => (
                          <div key={ri} style={{ background: "var(--surface-2)", borderRadius: "8px", padding: "0.875rem 1rem" }}>
                            <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>Row {row.rowNum} — {row.reason}</p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem" }}>
                              {(["event_name","venue","event_date","booking_ref","account_email","qty_bought","total_cost","listing_status"] as const).map((field) => (
                                <label key={field} className="field-label" style={{ fontSize: "0.75rem" }}>
                                  <span>{field.replace(/_/g, " ")}</span>
                                  <input
                                    className="field"
                                    value={String(row.data[field] ?? "")}
                                    onChange={(e) => setFailedEdits((prev) => prev.map((r, i) => i === ri ? { ...r, data: { ...r.data, [field]: e.target.value } } : r))}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: "1rem" }}>
                        <button type="button" className="primary-button" onClick={() => void retryFailed()} disabled={retrying}>
                          {retrying ? "Retrying..." : `Retry ${failedEdits.length} failed row${failedEdits.length !== 1 ? "s" : ""} →`}
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button type="button" className="secondary-button" onClick={resetImport}>Import another file</button>
                    <Link href="/orders" className="ghost-button">View tickets →</Link>
                    {importResult.salesCreated > 0 && (
                      <Link href="/sales" className="primary-button">View sales →</Link>
                    )}
                    {importResult.salesCreated === 0 && (
                      <Link href="/orders" className="primary-button">View tickets →</Link>
                    )}
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* ── Clients tab ── */}
        {activeTab === "clients" && (
          <>
            <section className="hero-card connections-hero">
              <div>
                <p className="section-tag">Clients</p>
                <h3>Email templates for buyers</h3>
              </div>
              <div className="hero-meta">
                <div><span className="hero-meta-label">Templates</span><strong>{templates.length}</strong></div>
                <div><span className="hero-meta-label">Variables</span><strong>{TEMPLATE_VARS.length}</strong></div>
              </div>
            </section>

            {/* Template picker */}
            <section className="command-card">
              <div className="clients-filter-row">
                <label className="filter-field" style={{ flex: "1 1 180px" }}>
                  <span className="filter-label">Active template</span>
                  <select className="field" value={activeTemplateId} onChange={(e) => switchTemplate(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-field" style={{ flex: "1 1 160px" }}>
                  <span className="filter-label">Template name</span>
                  <input
                    className="field"
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g. Thank-you, VIP, Resale"
                  />
                </label>
                <div className="filter-field" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
                  <span className="filter-label" style={{ visibility: "hidden" }}>_</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button type="button" className="secondary-button" onClick={handleNewTemplate}>+ New</button>
                    <button
                      type="button"
                      className="ghost-button"
                      style={{ color: templates.length <= 1 ? "var(--muted)" : "#ef4444" }}
                      disabled={templates.length <= 1}
                      onClick={handleDeleteTemplate}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Editor */}
            <section className="table-card">
              <div className="table-card-header" style={{ padding: "20px 24px 16px" }}>
                <div>
                  <p className="section-tag">Editor</p>
                  <h4>Subject &amp; body</h4>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {templateSaved && <span className="status-badge badge-sold">Saved</span>}
                </div>
              </div>

              <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* Subject */}
                <label className="filter-field">
                  <span className="filter-label">Subject line</span>
                  <input
                    className="field"
                    type="text"
                    value={templateSubject}
                    onChange={(e) => setTemplateSubject(e.target.value)}
                    placeholder="Your tickets – {{event_name}}"
                  />
                </label>

                {/* Variable chips */}
                <div>
                  <p className="filter-label" style={{ marginBottom: "10px" }}>Insert variable at cursor</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {TEMPLATE_VARS.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "12px", padding: "4px 10px", fontFamily: "monospace" }}
                        title={v.description}
                        onClick={() => insertVariable(v.key)}
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Body */}
                <label className="filter-field">
                  <span className="filter-label">Email body</span>
                  <textarea
                    ref={bodyTextareaRef}
                    className="field"
                    value={templateBody}
                    onChange={(e) => setTemplateBody(e.target.value)}
                    rows={14}
                    style={{ resize: "vertical", fontFamily: "monospace", fontSize: "13px", lineHeight: 1.6 }}
                  />
                </label>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button type="button" className="primary-button" onClick={handleSaveTemplate}>
                    Save template
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => { setTemplateSubject(DEFAULT_SUBJECT); setTemplateBody(DEFAULT_BODY); }}
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            </section>

            {/* Preview */}
            <section className="table-card">
              <div className="table-card-header" style={{ padding: "20px 24px 16px" }}>
                <div>
                  <p className="section-tag">Preview</p>
                  <h4>How it looks for a real buyer</h4>
                </div>
              </div>
              <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <label className="filter-field">
                  <span className="filter-label">Subject</span>
                  <div className="field" style={{ color: "var(--text-primary)", fontSize: "13px" }}>
                    {interpolate(templateSubject, {
                      customer_name: "Jane Smith",
                      event_name: "Coldplay – Music of the Spheres",
                      event_date: "Sat 14 Jun 2025",
                      venue: "Wembley Stadium",
                      section: "Block 201",
                      seats: "Row M, Seats 12–14",
                      quantity: "3",
                    })}
                  </div>
                </label>
                <label className="filter-field">
                  <span className="filter-label">Body</span>
                  <pre className="field" style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: "13px",
                    lineHeight: 1.7,
                    color: "var(--text-primary)",
                    margin: 0,
                    fontFamily: "inherit",
                    minHeight: "200px",
                  }}>
                    {templatePreview}
                  </pre>
                </label>
                <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Sample data only — real emails use the buyer&apos;s actual ticket details.
                </p>
              </div>
            </section>
          </>
        )}

        {/* ── Notifications tab ── */}
        {activeTab === "notifications" && (
          <>
            <section className="hero-card connections-hero">
              <div>
                <p className="section-tag">Notifications</p>
                <h3>Discord unsold ticket alerts</h3>
              </div>
              <div className="hero-meta">
                <div>
                  <span className="hero-meta-label">Alerts</span>
                  <strong>7 · 3 · 2 · 1 day</strong>
                </div>
                <div>
                  <span className="hero-meta-label">Daily at</span>
                  <strong>{alertTime} &nbsp;{alertTimezone.replace("_", " ")}</strong>
                </div>
              </div>
            </section>

            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">How it works</p>
                  <h4>Unsold ticket pings</h4>
                </div>
              </div>
              <div style={{ padding: "0 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ color: "var(--text-2)", fontSize: "0.875rem", lineHeight: 1.6, margin: 0 }}>
                  Once a day at your chosen time, TixTracker checks for unsold tickets and pings your Discord
                  channel at four urgency levels. Only tickets still unsold (not Sold or Archived) trigger a notification.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {([
                    { emoji: "⚠️", days: "7 days", color: "#FFB84F" },
                    { emoji: "🔶", days: "3 days", color: "#FF7D2C" },
                    { emoji: "🚨", days: "2 days", color: "#FF4500" },
                    { emoji: "🔴", days: "1 day",  color: "#FF2244" },
                  ] as const).map(({ emoji, days, color }) => (
                    <div key={days} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${color}40`, textAlign: "center" }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{emoji}</div>
                      <strong style={{ fontSize: "0.8rem", color }}>{days}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Alert schedule</p>
                  <h4>When to send daily alerts</h4>
                </div>
                {alertScheduleSaved && (
                  <span className="status-badge status-static status-sold">Saved ✓</span>
                )}
              </div>
              <div style={{ padding: "0 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <p style={{ color: "var(--text-2)", fontSize: "0.875rem", lineHeight: 1.6, margin: 0 }}>
                  Choose the time and timezone for your daily unsold alert. TixTracker checks every hour and fires your notification when the clock matches your setting.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>Send time</label>
                    <select
                      className="field"
                      value={alertTime}
                      onChange={(e) => setAlertTime(e.target.value)}
                      style={{ width: 130 }}
                    >
                      {Array.from({ length: 24 }, (_, h) => {
                        const val = `${String(h).padStart(2, "0")}:00`;
                        const label = `${String(h).padStart(2, "0")}:00${h < 12 ? " AM" : h === 12 ? " PM" : " PM"}`;
                        return <option key={val} value={val}>{label}</option>;
                      })}
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>Timezone</label>
                    <select
                      className="field"
                      value={alertTimezone}
                      onChange={(e) => setAlertTimezone(e.target.value)}
                      style={{ width: 260 }}
                    >
                      <optgroup label="UTC">
                        <option value="UTC">UTC</option>
                      </optgroup>
                      <optgroup label="Europe">
                        <option value="Europe/London">London (GMT / BST)</option>
                        <option value="Europe/Dublin">Dublin (GMT / IST)</option>
                        <option value="Europe/Lisbon">Lisbon (WET / WEST)</option>
                        <option value="Europe/Paris">Paris (CET / CEST)</option>
                        <option value="Europe/Berlin">Berlin (CET / CEST)</option>
                        <option value="Europe/Amsterdam">Amsterdam (CET / CEST)</option>
                        <option value="Europe/Madrid">Madrid (CET / CEST)</option>
                        <option value="Europe/Rome">Rome (CET / CEST)</option>
                        <option value="Europe/Warsaw">Warsaw (CET / CEST)</option>
                        <option value="Europe/Athens">Athens (EET / EEST)</option>
                        <option value="Europe/Bucharest">Bucharest (EET / EEST)</option>
                        <option value="Europe/Helsinki">Helsinki (EET / EEST)</option>
                        <option value="Europe/Moscow">Moscow (MSK)</option>
                      </optgroup>
                      <optgroup label="North America">
                        <option value="America/New_York">New York (ET)</option>
                        <option value="America/Toronto">Toronto (ET)</option>
                        <option value="America/Chicago">Chicago (CT)</option>
                        <option value="America/Denver">Denver (MT)</option>
                        <option value="America/Phoenix">Phoenix (MST, no DST)</option>
                        <option value="America/Los_Angeles">Los Angeles (PT)</option>
                        <option value="America/Vancouver">Vancouver (PT)</option>
                        <option value="America/Anchorage">Anchorage (AKT)</option>
                        <option value="Pacific/Honolulu">Honolulu (HST)</option>
                      </optgroup>
                      <optgroup label="South America">
                        <option value="America/Sao_Paulo">São Paulo (BRT)</option>
                        <option value="America/Argentina/Buenos_Aires">Buenos Aires (ART)</option>
                        <option value="America/Bogota">Bogotá (COT)</option>
                        <option value="America/Mexico_City">Mexico City (CT)</option>
                      </optgroup>
                      <optgroup label="Middle East &amp; Africa">
                        <option value="Africa/Johannesburg">Johannesburg (SAST)</option>
                        <option value="Africa/Cairo">Cairo (EET)</option>
                        <option value="Africa/Lagos">Lagos (WAT)</option>
                        <option value="Asia/Dubai">Dubai (GST)</option>
                        <option value="Asia/Riyadh">Riyadh (AST)</option>
                      </optgroup>
                      <optgroup label="Asia">
                        <option value="Asia/Kolkata">Mumbai / New Delhi (IST)</option>
                        <option value="Asia/Colombo">Colombo (IST)</option>
                        <option value="Asia/Dhaka">Dhaka (BST)</option>
                        <option value="Asia/Bangkok">Bangkok (ICT)</option>
                        <option value="Asia/Singapore">Singapore (SGT)</option>
                        <option value="Asia/Kuala_Lumpur">Kuala Lumpur (MYT)</option>
                        <option value="Asia/Hong_Kong">Hong Kong (HKT)</option>
                        <option value="Asia/Shanghai">Shanghai (CST)</option>
                        <option value="Asia/Tokyo">Tokyo (JST)</option>
                        <option value="Asia/Seoul">Seoul (KST)</option>
                      </optgroup>
                      <optgroup label="Oceania">
                        <option value="Australia/Perth">Perth (AWST)</option>
                        <option value="Australia/Darwin">Darwin (ACST)</option>
                        <option value="Australia/Brisbane">Brisbane (AEST)</option>
                        <option value="Australia/Sydney">Sydney (AEST / AEDT)</option>
                        <option value="Australia/Melbourne">Melbourne (AEST / AEDT)</option>
                        <option value="Pacific/Auckland">Auckland (NZST / NZDT)</option>
                        <option value="Pacific/Fiji">Fiji (FJT)</option>
                      </optgroup>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={alertScheduleSaving}
                    onClick={() => void saveAlertSchedule()}
                  >
                    {alertScheduleSaving ? "Saving…" : "Save schedule"}
                  </button>
                </div>
              </div>
            </section>

            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Discord webhook</p>
                  <h4>Connect your channel</h4>
                </div>
                {discordSaved && (
                  <span className="status-badge status-static status-sold">Saved ✓</span>
                )}
              </div>
              <div style={{ padding: "0 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <ol style={{ color: "var(--text-2)", fontSize: "0.875rem", lineHeight: 1.7, margin: 0, paddingLeft: "1.2rem" }}>
                  <li>In Discord, open your server → <strong>Server Settings → Integrations → Webhooks</strong></li>
                  <li>Click <strong>New Webhook</strong>, choose a channel, then click <strong>Copy Webhook URL</strong></li>
                  <li>Paste the URL below and click <strong>Save</strong></li>
                </ol>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="field"
                    type="url"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={discordWebhookUrl}
                    onChange={(e) => { setDiscordWebhookUrl(e.target.value); setDiscordMessage(null); }}
                    style={{ flex: "1 1 320px", fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.8rem" }}
                  />
                  <button
                    type="button"
                    className="primary-button"
                    disabled={discordSaving}
                    onClick={() => void saveDiscordWebhook()}
                  >
                    {discordSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={discordTesting || !discordWebhookUrl.trim().startsWith("https://discord.com/api/webhooks/")}
                    onClick={() => void testDiscordWebhook()}
                  >
                    {discordTesting ? "Sending…" : "Send test ping"}
                  </button>
                </div>

                {discordMessage && (
                  <div style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                    background: discordMessage.ok ? "rgba(103,240,165,0.1)" : "rgba(255,80,80,0.1)",
                    border: `1px solid ${discordMessage.ok ? "rgba(103,240,165,0.3)" : "rgba(255,80,80,0.3)"}`,
                    color: discordMessage.ok ? "#67F0A5" : "#ff8080",
                  }}>
                    {discordMessage.ok ? "✓ " : "✗ "}{discordMessage.text}
                  </div>
                )}

                <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    Your webhook URL is stored securely per account. Each TixTracker user can configure their own Discord channel independently.
                    To disable alerts, clear the field and save.
                  </p>
                </div>
              </div>
            </section>

            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Notification format</p>
                  <h4>Customise embed fields</h4>
                </div>
                {webhookFieldsSaved && (
                  <span className="status-badge status-static status-sold">Saved ✓</span>
                )}
              </div>
              <div style={{ padding: "0 1.5rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
                <p style={{ color: "var(--text-2)", fontSize: "0.875rem", lineHeight: 1.6, margin: 0 }}>
                  Choose which fields appear in each Discord notification. Untick any you don&apos;t need.
                </p>

                {(
                  [
                    { key: "order"    as WebhookFieldKey, label: "🎟️ Ticket Order",       desc: "Sent when a new ticket purchase is imported" },
                    { key: "sale"     as WebhookFieldKey, label: "💸 Sale",                desc: "Sent when a new Viagogo / StubHub / Ticombo sale is scanned" },
                    { key: "transfer" as WebhookFieldKey, label: "🚚 Tickets Delivered",   desc: "Sent when a Viagogo delivery confirmation is processed" },
                    { key: "payout"   as WebhookFieldKey, label: "💰 Payout",              desc: "Sent when a Viagogo payout email is processed" },
                  ] as const
                ).map(({ key, label, desc }) => (
                  <div key={key}>
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: "0.9rem" }}>{label}</strong>
                      <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>{desc}</p>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {WEBHOOK_FIELD_DEFS[key].map(({ id, label: fieldLabel, emoji }) => (
                        <label
                          key={id}
                          className="filter-field-checkbox"
                          style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${webhookFields[key].includes(id) ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.1)"}`, background: webhookFields[key].includes(id) ? "rgba(96,165,250,0.08)" : "rgba(255,255,255,0.03)", fontSize: "0.82rem", transition: "all 0.15s" }}
                        >
                          <input
                            type="checkbox"
                            checked={webhookFields[key].includes(id)}
                            onChange={() => toggleWebhookField(key, id)}
                            style={{ accentColor: "#60a5fa" }}
                          />
                          <span>{emoji} {fieldLabel}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="primary-button"
                  disabled={webhookFieldsSaving}
                  onClick={() => void saveWebhookFields()}
                  style={{ alignSelf: "flex-start" }}
                >
                  {webhookFieldsSaving ? "Saving…" : "Save format"}
                </button>
              </div>
            </section>

          </>
        )}

        {/* ── Currency tab ── */}
        {activeTab === "currency" && (
          <>
            <section className="hero-card connections-hero">
              <div>
                <p className="section-tag">Currency</p>
                <h3>Set your display currency</h3>
              </div>
              <div className="hero-meta">
                <div>
                  <span className="hero-meta-label">Current</span>
                  <strong>{selectedCurrency}</strong>
                </div>
                <div>
                  <span className="hero-meta-label">Preview</span>
                  <strong>{formatCurrency(1234.56, selectedCurrency)}</strong>
                </div>
              </div>
            </section>

            <section className="table-card">
              <div className="table-card-header">
                <div>
                  <p className="section-tag">Display currency</p>
                  <h4>Choose your currency symbol</h4>
                </div>
                {currencySaved && (
                  <span className="status-badge badge-sold" style={{ alignSelf: "center" }}>Saved</span>
                )}
              </div>
              <div style={{ padding: "1.5rem" }}>
                <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
                  All prices across the app will display in the currency you choose. This is saved in your browser.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem" }}>
                  {CURRENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => saveCurrency(opt.code)}
                      className={selectedCurrency === opt.code ? "primary-button" : "secondary-button"}
                      style={{ justifyContent: "flex-start", textAlign: "left", fontVariantNumeric: "tabular-nums" }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                  <p className="section-tag" style={{ marginBottom: "0.5rem" }}>Live preview</p>
                  <div className="drawer-summary" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                    <div><span>Small</span><strong>{formatCurrency(9.99, selectedCurrency)}</strong></div>
                    <div><span>Medium</span><strong>{formatCurrency(149.50, selectedCurrency)}</strong></div>
                    <div><span>Large</span><strong>{formatCurrency(1234.56, selectedCurrency)}</strong></div>
                    <div><span>Profit</span><strong className="value-up">{formatCurrency(432.10, selectedCurrency)}</strong></div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ── Accounts tab ── */}
        {activeTab === "accounts" && (
          <AccountsTab />
        )}
      </main>
    </div>
  );
}
