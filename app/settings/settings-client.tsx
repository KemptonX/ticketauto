"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";
import { CURRENCY_OPTIONS, getCurrencyCode, setCurrencyCode, formatCurrency } from "@/src/lib/currency";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

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

type ImportField = {
  key: string;
  label: string;
  aliases: string[];
  dataType: "text" | "date" | "number" | "status";
  required?: boolean;
};

type ImportStep = "upload" | "map" | "preview" | "done";

// ─── Nav ──────────────────────────────────────────────────────────────────────

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
];

// ─── Import field definitions ─────────────────────────────────────────────────

const IMPORT_FIELDS: ImportField[] = [
  {
    key: "event_name",
    label: "Event Name",
    aliases: ["event name", "event", "show", "concert", "match", "game", "act", "artist", "title", "name", "fixture", "performance"],
    dataType: "text",
    required: true,
  },
  {
    key: "venue",
    label: "Venue",
    aliases: ["venue", "stadium", "arena", "location", "ground", "hall", "theatre", "theater", "place", "city"],
    dataType: "text",
  },
  {
    key: "event_date",
    label: "Event Date",
    aliases: ["date", "event date", "show date", "match date", "game date", "when", "event_date", "event date", "event date time", "date time", "datetime"],
    dataType: "date",
  },
  {
    key: "section",
    label: "Section / Block",
    aliases: ["section", "block", "sec", "stand", "area", "zone", "sector"],
    dataType: "text",
  },
  {
    key: "row",
    label: "Row",
    aliases: ["row", "row number", "row no"],
    dataType: "text",
  },
  {
    key: "seat_from",
    label: "Seat From",
    aliases: ["seat from", "seat_from", "from seat", "first seat", "seat start", "seat no from", "seat number from", "seat low", "seat begin"],
    dataType: "text",
  },
  {
    key: "seat_to",
    label: "Seat To",
    aliases: ["seat to", "seat_to", "to seat", "last seat", "seat end", "seat no to", "seat number to", "seat high"],
    dataType: "text",
  },
  {
    key: "seats",
    label: "Seats (range e.g. 12-14)",
    aliases: ["seats", "seat", "seat numbers", "seat range", "seat no", "seat number", "seat nos"],
    dataType: "text",
  },
  {
    key: "qty_bought",
    label: "Qty Bought",
    aliases: ["qty", "quantity", "tickets", "count", "num tickets", "number", "qty bought", "quantity bought", "no of tickets", "num", "ticket count", "no tickets"],
    dataType: "number",
  },
  {
    key: "qty_sold",
    label: "Qty Sold",
    aliases: ["qty sold", "quantity sold", "sold qty", "sold quantity", "tickets sold", "qty_sold", "sold count", "no sold", "number sold"],
    dataType: "number",
  },
  {
    key: "total_cost",
    label: "Total Cost",
    aliases: ["cost", "total cost", "price", "amount paid", "paid", "purchase price", "buying price", "face value", "total paid", "cost price", "buy price", "purchase total", "amount", "total amount"],
    dataType: "number",
  },
  {
    key: "sold_total",
    label: "Sold For",
    aliases: ["sold", "sold for", "sale price", "revenue", "sold total", "sold_total", "payout", "sale total", "selling price", "sold amount"],
    dataType: "number",
  },
  {
    key: "listing_status",
    label: "Status",
    aliases: ["status", "listing status", "listing_status", "ticket status", "state"],
    dataType: "status",
  },
  {
    key: "booking_ref",
    label: "Booking Ref",
    aliases: ["ref", "reference", "booking ref", "booking_ref", "order ref", "order_ref", "booking", "booking reference", "order number", "booking number", "confirmation"],
    dataType: "text",
  },
  {
    key: "account_email",
    label: "Account Email",
    aliases: ["account", "email", "account email", "account_email", "gmail", "inbox", "email address", "bought with", "purchase email"],
    dataType: "text",
  },
  {
    key: "source_type",
    label: "Source / Platform",
    aliases: ["source", "source type", "platform", "ticket type", "source_type", "bought from", "purchased from", "supplier", "provider", "marketplace"],
    dataType: "text",
  },
];

const FIELD_OPTIONS = [
  { value: "skip", label: "— Skip column —" },
  ...IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label })),
];

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
  const [activeTab, setActiveTab] = useState<"connections" | "import" | "currency">(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "import") return "import";
      if (t === "currency") return "currency";
    }
    return "connections";
  });

  // ── Currency state ──
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() => getCurrencyCode());
  const [currencySaved, setCurrencySaved] = useState(false);

  function saveCurrency(code: string) {
    setSelectedCurrency(code);
    setCurrencyCode(code);
    setCurrencySaved(true);
    setTimeout(() => setCurrencySaved(false), 2000);
  }

  // ── Connections state ──
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [connLoading, setConnLoading] = useState(true);
  const [connRefreshing, setConnRefreshing] = useState(false);
  const [connSubmitting, setConnSubmitting] = useState(false);
  const [connMessage, setConnMessage] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  // ── Import state ──
  const [importStep, setImportStep] = useState<ImportStep>("upload");
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  type FailedRow = { rowNum: number; reason: string; data: Record<string, unknown> };
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; skipped: number; errors: string[]; failedRows: FailedRow[] } | null>(null);
  const [failedEdits, setFailedEdits] = useState<FailedRow[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // ── Connection effects ──
  useEffect(() => {
    void loadAccounts();
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

    // Only these columns exist on the orders table
    const ORDER_COLUMNS = new Set([
      "booking_ref", "event_name", "venue", "event_date", "purchased_at",
      "account_email", "section", "row", "seat_from", "seat_to",
      "qty_bought", "total_cost", "sold_total", "listing_status", "source_type",
    ]);

    for (let i = 0; i < importRows.length; i++) {
      const obj = transformRow(importRows[i], importHeaders, colMap);
      if (!obj || Object.keys(obj).length < 3) {
        const reason = "Not enough data (fewer than 3 fields)";
        errors.push(`Row ${i + 2}: ${reason}`);
        failedRows.push({ rowNum: i + 2, reason, data: obj ?? {} });
        continue;
      }

      // Strip fields that don't exist on the orders table
      for (const key of Object.keys(obj)) {
        if (!ORDER_COLUMNS.has(key)) delete obj[key];
      }

      // If booking_ref is blank, generate a random UUID — blank rows are always new, never duplicates
      if (!obj.booking_ref) {
        obj.booking_ref = crypto.randomUUID();
      }

      // Default status
      if (!obj.listing_status) {
        obj.listing_status = obj.sold_total ? "Sold" : "Unlisted";
      }

      toInsert.push({ rowNum: i + 2, data: obj });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    // Insert one row at a time; on duplicate booking ref, update the existing record instead
    for (const { rowNum, data } of toInsert) {
      const { error } = await supabase.from("orders").insert(data);
      if (error) {
        if (error.message.includes("duplicate") && data.booking_ref) {
          // Update the existing record with the new data from the spreadsheet
          const { booking_ref, ...updateData } = data as Record<string, unknown>;
          const { error: updateError } = await supabase
            .from("orders")
            .update(updateData)
            .eq("booking_ref", booking_ref as string);
          if (updateError) {
            errors.push(`Row ${rowNum}: ${updateError.message}`);
            skipped++;
          } else {
            updated++;
          }
        } else {
          errors.push(`Row ${rowNum}: ${error.message}`);
          failedRows.push({ rowNum, reason: error.message, data });
          skipped++;
        }
      } else {
        inserted++;
      }
    }

    const result = { inserted, updated, skipped, errors, failedRows };
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
  }

  async function retryFailed() {
    if (failedEdits.length === 0) return;
    setRetrying(true);
    let inserted = importResult?.inserted ?? 0;
    let updated = importResult?.updated ?? 0;
    let skipped = 0;
    const remainingFailed: FailedRow[] = [];

    for (const row of failedEdits) {
      const data = { ...row.data };
      if (!data.booking_ref) data.booking_ref = crypto.randomUUID();
      if (!data.listing_status) data.listing_status = data.sold_total ? "Sold" : "Unlisted";

      const { error } = await supabase.from("orders").insert(data);
      if (error) {
        if (error.message.includes("duplicate") && data.booking_ref) {
          const { booking_ref, ...updateData } = data as Record<string, unknown>;
          const { error: updateError } = await supabase.from("orders").update(updateData).eq("booking_ref", booking_ref as string);
          if (updateError) {
            remainingFailed.push({ ...row, reason: updateError.message, data });
            skipped++;
          } else {
            updated++;
          }
        } else {
          remainingFailed.push({ ...row, reason: error.message, data });
          skipped++;
        }
      } else {
        inserted++;
      }
    }

    setImportResult((prev) => prev ? {
      ...prev,
      inserted,
      updated,
      skipped,
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
          </div>
        </section>

        {/* ── Connections tab ── */}
        {activeTab === "connections" && (
          <>
            <section className="hero-card connections-hero">
              <div>
                <p className="section-tag">Connections</p>
                <h3>Connect Gmail &amp; Outlook per member</h3>
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
              <Link href="/api/gmail/connect" className="primary-button">Connect Gmail</Link>
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
                <div><p className="section-tag">Gmail</p><h4>Connect or stage an inbox</h4></div>
              </div>
              <div className="connections-cta-row">
                <div className="connections-cta-copy">
                  <strong>Fastest setup</strong>
                  <span>Use Google OAuth to authorise Gmail directly.</span>
                </div>
                <Link href="/api/gmail/connect" className="primary-button">Connect Gmail</Link>
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
                  <Link href="/api/gmail/connect" className="primary-button">Connect first inbox</Link>
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
                          <Link href={account.provider === "outlook" ? "/api/outlook/connect" : "/api/gmail/connect"} className="primary-button">Connect</Link>
                        )}
                        {!account.is_primary && (
                          <button type="button" className="secondary-button" onClick={() => void setPrimary(account)}>Set primary</button>
                        )}
                        <button type="button" className="secondary-button" onClick={() => void toggleAccount(account)}>
                          {account.is_active ? "Pause" : "Resume"}
                        </button>
                        <button type="button" className="ghost-button danger-button" onClick={() => void removeAccount(account)}>Remove</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
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
                    Export your spreadsheet or Google Sheet as CSV, XLSX, or TSV. TicketX will read your column headers and auto-map them — even if they don't match exactly.
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
                    TicketX has auto-matched your columns. Check each one is mapped correctly — set to "Skip" for columns you don't need.
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
                          {FIELD_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
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
                  <div className="drawer-summary" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "1.5rem" }}>
                    <div>
                      <span>Imported</span>
                      <strong className="value-up">{importResult.inserted}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong className="value-up">{importResult.updated}</strong>
                    </div>
                    <div>
                      <span>Skipped</span>
                      <strong>{importResult.skipped}</strong>
                    </div>
                    <div>
                      <span>Total rows</span>
                      <strong>{importRows.length}</strong>
                    </div>
                  </div>
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
                    <Link href="/orders" className="primary-button">View tickets →</Link>
                  </div>
                </div>
              </section>
            )}
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
      </main>
    </div>
  );
}
