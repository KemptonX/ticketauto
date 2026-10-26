"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/src/lib/supabase";
import { parseCSV, parseImportNumber, parseImportDate, autoMapHeader as sharedAutoMapHeader } from "@/src/lib/spreadsheet-parsing";
import { CURRENCY_OPTIONS, getCurrencyCode, convertToGbpClient } from "@/src/lib/currency";
import {
  checkRequiredText,
  checkQuantity,
  checkFinancialValue,
  checkCurrencyMismatch,
  wouldOversell,
  describeOversell,
  classifyIssues,
  type ImportIssue,
  type RowClassification,
} from "@/src/lib/import-validation";

type MatchedOrder = {
  id: number;
  booking_ref: string | null;
  total_cost: number | null;
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

export type SalesImportModalProps = {
  allOrders: MatchedOrder[];
  onClose: () => void;
  onImported: () => void;
};

type ImportStep = "upload" | "map" | "preview" | "done";
type FailedRow = { rowNum: number; reason: string };
type RowType = "inventory-only" | "awaiting-transfer" | "transferred-pending-payment" | "paid-archived" | "cancelled";

type ImportField = {
  key: string;
  label: string;
  group: string;
  aliases: string[];
  dataType: "text" | "date" | "number" | "sale_status" | "transfer_status" | "payment_status";
};

const FIELDS: ImportField[] = [
  // ── Ticket Details ────────────────────────────────────────────────────────
  { key: "event_name",       label: "Event Name",       group: "Ticket Details",     aliases: ["event","event name","show","concert","artist","title","name","fixture","event title"], dataType: "text" },
  { key: "event_date",       label: "Event Date",       group: "Ticket Details",     aliases: ["event date","date","show date","match date","game date","event day"], dataType: "date" },
  { key: "venue",            label: "Venue",            group: "Ticket Details",     aliases: ["venue","stadium","arena","location","ground","hall","venue name"], dataType: "text" },
  { key: "section",          label: "Section / Block",  group: "Ticket Details",     aliases: ["section","block","sec","stand","area","zone","sector","block section"], dataType: "text" },
  { key: "row",              label: "Row",              group: "Ticket Details",     aliases: ["row","row number","row no","row num","row letter"], dataType: "text" },
  { key: "seats",            label: "Seats (e.g. 1–4)", group: "Ticket Details",     aliases: ["seat","seats","seat range","seat no","seat nos","seat numbers","seat number","first seat","last seat"], dataType: "text" },
  { key: "seat_from",       label: "Seat From",        group: "Ticket Details",     aliases: ["seat from","from seat","seat start","seat begin","first seat no"], dataType: "text" },
  { key: "seat_to",         label: "Seat To",          group: "Ticket Details",     aliases: ["seat to","to seat","seat end","seat finish","last seat no"], dataType: "text" },
  { key: "qty_sold",         label: "Tickets Sold",     group: "Ticket Details",     aliases: ["qty sold","tickets sold","qty","quantity","count","sold qty","no of tickets","number of tickets","tickets","number sold","sold"], dataType: "number" },
  // ── Sales Details ─────────────────────────────────────────────────────────
  { key: "sold_at",          label: "Sold Date",        group: "Sales Details",      aliases: ["sale date","sold at","sold date","date sold","transaction date","sale time","sold on"], dataType: "date" },
  { key: "sale_total",       label: "Sale Price",       group: "Sales Details",      aliases: ["sale price","price","sale total","sold for","revenue","total","amount","gross","face value sold","gross revenue","sold amount","total price"], dataType: "number" },
  { key: "marketplace",      label: "Platform",         group: "Sales Details",      aliases: ["platform","marketplace","via","through","sold via","channel","buyer platform","market","source platform","sold on","listing platform"], dataType: "text" },
  { key: "external_sale_id", label: "Sale Reference",   group: "Sales Details",      aliases: ["sale ref","sale reference","sale id","sale number","order ref","reference","ref","ticket ref","sale order id","marketplace order id","order id","order number"], dataType: "text" },
  { key: "sale_status",     label: "Sale Status",      group: "Sales Details",      aliases: ["sale status","status","order status","ticket status","sale state"], dataType: "sale_status" },
  // ── Transfer & Payment ────────────────────────────────────────────────────
  { key: "transfer_status",  label: "Transfer Status",  group: "Transfer & Payment", aliases: ["transfer status","transfer","transferred","transfer state","handover status","transfer complete","transfer done"], dataType: "transfer_status" },
  { key: "payment_status",   label: "Payment Status",   group: "Transfer & Payment", aliases: ["payment status","paid","payment","payment state","pay status","payment received","payout status","payment received status"], dataType: "payment_status" },
  { key: "payout_date",      label: "Date Paid",        group: "Transfer & Payment", aliases: ["payment date","paid date","date paid","payout date","received date","actual payout date","actual payment date","payout received","payment received date"], dataType: "date" },
  // ── Notes ─────────────────────────────────────────────────────────────────
  { key: "notes",            label: "Notes",            group: "Notes",              aliases: ["notes","note","comments","comment","remarks","memo","description","general notes","sale notes","transfer notes","payment notes","additional info"], dataType: "text" },
];

const FIELD_GROUPS = ["Ticket Details", "Sales Details", "Transfer & Payment", "Notes"] as const;

// Columns that actually exist in the sales table and can be inserted
const SALE_COLS = new Set([
  "event_name","event_date","venue","section","row","seat_from","seat_to",
  "qty_sold","sale_total","buyer_name","marketplace","buyer_email",
  "external_sale_id","sale_status","transfer_status","payment_status",
  "sold_at","transfer_date","payout_date","expected_payout_date","notes",
]);

// ─── Parsers ──────────────────────────────────────────────────────────────────
// parseCSV / parseImportNumber / parseImportDate / header auto-mapping now
// live in src/lib/spreadsheet-parsing.ts, shared with settings-client.tsx's
// ticket importer — see that module for why.

function autoMap(header: string): string {
  return sharedAutoMapHeader(header, FIELDS);
}

function parseDate(raw: string): string | null {
  return parseImportDate(raw);
}

function parseNum(raw: string): number | null {
  return parseImportNumber(raw);
}

function parseSaleStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s || s === "unsold" || s === "listed" || s === "available" || s === "unlisted" || s === "unsold / listed") return "_skip";
  if (s === "paid" || s.includes("payment received") || s.includes("settled") || s.includes("complete") || s.includes("archived")) return "Paid";
  if (s.includes("transfer") && (s.includes("complete") || s.includes("done") || s.includes("transferred"))) return "Sold – Transfer Completed";
  if (s.includes("cancel") || s.includes("issue") || s.includes("problem") || s.includes("refund") || s.includes("void") || s.includes("dispute")) return "Cancelled / Issue";
  if (s === "sold" || s.includes("awaiting") || s.includes("pending") || s === "sale" || s.includes("partially sold")) return "Sold – Awaiting Transfer";
  return "Sold – Awaiting Transfer";
}

function parseTransferStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s || s === "not required" || s === "n/a" || s === "na" || s === "not applicable") return "Awaiting Transfer";
  if (s.includes("complete") || s.includes("done") || s.includes("transferred") || s === "yes" || s === "true" || s === "1" || s === "transfer completed") return "Transfer Completed";
  return "Awaiting Transfer";
}

function parsePaymentStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s || s === "not due" || s === "n/a" || s === "na" || s === "not applicable" || s === "awaiting") return "Awaiting Payment";
  if (s === "paid" || s.includes("received") || s.includes("settled") || s.includes("complete") || s === "yes" || s === "true" || s === "1" || s === "payment received") return "Paid";
  return "Awaiting Payment";
}

function transformRow(rawRow: string[], headers: string[], colMap: Record<number, string>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = colMap[i] ?? "skip";
    if (key === "skip") continue;
    const raw = (rawRow[i] ?? "").trim();
    if (!raw) continue;
    const field = FIELDS.find(f => f.key === key);
    if (!field) continue;
    if (field.dataType === "number") {
      const n = parseNum(raw);
      if (n != null) obj[key] = n;
    } else if (field.dataType === "date") {
      const d = parseDate(raw);
      if (d) obj[key] = d;
    } else if (field.dataType === "sale_status") {
      const status = parseSaleStatus(raw);
      if (status === "_skip") obj._skip = true;
      else obj[key] = status;
    } else if (field.dataType === "transfer_status") {
      obj[key] = parseTransferStatus(raw);
    } else if (field.dataType === "payment_status") {
      obj[key] = parsePaymentStatus(raw);
    } else if (key === "seats") {
      const range = raw.match(/^(\w+)\s*[-–]\s*(\w+)$/);
      if (range) { obj.seat_from = range[1]; obj.seat_to = range[2]; }
      else if (!obj.seat_from) obj.seat_from = raw;
    } else if (key === "seat_from") {
      obj.seat_from = raw;
    } else if (key === "seat_to") {
      obj.seat_to = raw;
    } else {
      obj[key] = raw;
    }
  }

  // ── Auto-derive statuses from each other ──────────────────────────────────
  const payStatus  = (obj.payment_status  as string) || "Awaiting Payment";
  const transStatus = (obj.transfer_status as string) || "Awaiting Transfer";

  if (!obj.transfer_status) obj.transfer_status = "Awaiting Transfer";
  if (!obj.payment_status)  obj.payment_status  = "Awaiting Payment";

  // Derive sale_status if not explicitly set
  if (!obj.sale_status) {
    if (payStatus === "Paid") {
      obj.sale_status = "Paid";
    } else if (transStatus === "Transfer Completed") {
      obj.sale_status = "Sold – Transfer Completed";
    } else {
      obj.sale_status = "Sold – Awaiting Transfer";
    }
  } else if (payStatus === "Paid") {
    // Payment confirmed overrides sale_status to Paid
    obj.sale_status = "Paid";
  }

  return obj;
}

// ─── Row type ─────────────────────────────────────────────────────────────────

function getRowType(row: Record<string, unknown>): RowType {
  const ss = (row.sale_status  as string) || "";
  const ts = (row.transfer_status as string) || "Awaiting Transfer";
  const ps = (row.payment_status  as string) || "Awaiting Payment";
  if (ss === "Cancelled / Issue") return "cancelled";
  if (ss === "Paid" || ps === "Paid") return "paid-archived";
  if (ts === "Transfer Completed") return "transferred-pending-payment";
  return "awaiting-transfer";
}

const ROW_TYPE_LABEL: Record<RowType, string> = {
  "inventory-only":             "Inventory only",
  "awaiting-transfer":          "Sale — awaiting transfer",
  "transferred-pending-payment":"Transferred — awaiting payment",
  "paid-archived":              "Paid — archived",
  "cancelled":                  "Cancelled / Issue",
};

const ROW_TYPE_STYLE: Record<RowType, React.CSSProperties> = {
  "inventory-only":             { background: "rgba(79,195,255,0.12)",  color: "#4fc3ff", border: "1px solid rgba(79,195,255,0.25)" },
  "awaiting-transfer":          { background: "rgba(249,115,22,0.15)",  color: "#f97316", border: "1px solid rgba(249,115,22,0.3)" },
  "transferred-pending-payment":{ background: "rgba(251,191,36,0.12)",  color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" },
  "paid-archived":              { background: "rgba(74,222,128,0.12)",  color: "#4ade80", border: "1px solid rgba(74,222,128,0.25)" },
  "cancelled":                  { background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" },
};

// ─── Order matching ───────────────────────────────────────────────────────────

function norm(v: unknown) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreMatch(row: Record<string, unknown>, order: MatchedOrder): number {
  let score = 0;
  const enA = norm(row.event_name), enB = norm(order.event_name);
  if (enA && enB) {
    if (enA === enB) score += 40;
    else if (enA.includes(enB) || enB.includes(enA)) score += 28;
    else {
      const wordsA = enA.split(/\s+/).filter(w => w.length > 2);
      const setB = new Set(enB.split(/\s+/).filter(w => w.length > 2));
      const overlap = wordsA.filter(w => setB.has(w)).length;
      if (overlap >= 2) score += 20;
      else if (overlap >= 1) score += 10;
    }
  }
  const dateA = parseDate(String(row.event_date ?? ""));
  const dateB = parseDate(order.event_date ?? "");
  if (dateA && dateB) score += dateA === dateB ? 30 : 0;
  if (norm(row.section) && norm(order.section) && norm(row.section) === norm(order.section)) score += 15;
  if (norm(row.row) && norm(order.row) && norm(row.row) === norm(order.row)) score += 10;
  if (norm(row.seat_from) && norm(order.seat_from) && norm(row.seat_from) === norm(order.seat_from)) score += 5;
  return score;
}

function findBestOrder(row: Record<string, unknown>, orders: MatchedOrder[]): { order: MatchedOrder; score: number } | null {
  let best: { order: MatchedOrder; score: number } | null = null;
  for (const o of orders) {
    const s = scoreMatch(row, o);
    if (s >= 55 && (!best || s > best.score)) best = { order: o, score: s };
  }
  return best;
}

// Top-N candidate orders regardless of the 55% auto-accept threshold —
// used to let the customer pick manually when confidence is too low to
// auto-match, instead of the row silently staying "Unmatched".
function findCandidates(row: Record<string, unknown>, orders: MatchedOrder[], limit = 3): { order: MatchedOrder; score: number }[] {
  return orders
    .map((o) => ({ order: o, score: scoreMatch(row, o) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function syncOrder(orderId: number) {
  const { data } = await supabase
    .from("sales")
    .select("payout_total, sale_total, qty_sold")
    .eq("inventory_order_id", orderId)
    .not("sale_status", "in", '("Deleted","Cancelled / Issue")');
  if (!data) return;
  const soldTotal = (data as { payout_total?: number | null; sale_total?: number | null }[])
    .reduce((s, r) => s + (r.payout_total ?? r.sale_total ?? 0), 0);
  const qtySold = (data as { qty_sold?: number | null }[]).reduce((s, r) => s + (r.qty_sold ?? 0), 0);
  const { data: ord } = await supabase.from("orders").select("qty_bought").eq("id", orderId).single();
  const qtyBought = (ord as { qty_bought?: number | null } | null)?.qty_bought ?? 0;
  const newStatus = data.length === 0 ? "Unlisted" : qtyBought > 0 && qtySold < qtyBought ? "Partially Sold" : "Sold";
  await supabase.from("orders").update({ sold_total: soldTotal, listing_status: newStatus }).eq("id", orderId);
}

// ─── Component ────────────────────────────────────────────────────────────────

type ImportResult = {
  inserted: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  skipped: number;
  errors: FailedRow[];
  awaitingTransfer: number;
  transferredPending: number;
  paidArchived: number;
  awaitingPaymentAmount: number;
  paidAmount: number;
};

export default function SalesImportModal({ allOrders, onClose, onImported }: SalesImportModalProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importCurrency, setImportCurrency] = useState(() => getCurrencyCode());
  const [alreadySoldByOrder, setAlreadySoldByOrder] = useState<Map<number, number>>(new Map());
  const [includeWarningRows, setIncludeWarningRows] = useState(false);
  // Per preview-row override for low-confidence/no matches — "skip" means
  // "don't try to match this row at all" (it imports unmatched), a number
  // is an explicit order id the customer picked themselves.
  const [matchOverride, setMatchOverride] = useState<Record<number, number | "skip">>({});
  const [importFileName, setImportFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Best-effort import-history record (see supabase/migrations/0009_import_batches.sql)
  // — never blocks or fails the import itself if the table doesn't exist yet.
  async function recordImportBatch(counts: Record<string, number>) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return;
    // Table is ticket_import_batches, not import_batches — see migration
    // 0009's comment: a differently-shaped table already exists under
    // the name import_batches for the unrelated presale importer.
    await supabase.from("ticket_import_batches").insert({ user_id: userId, source: "sales_import", source_filename: importFileName || null, counts });
  }

  // Loads how much of each order is already sold (excluding "Deleted"
  // sales) so oversell can be checked against the real current total, not
  // just the quantity bought. Paginated — this user's sales could exceed
  // Supabase's default 1000-row page size.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const orderIds = allOrders.map((o) => o.id);
      if (orderIds.length === 0) return;
      const totals = new Map<number, number>();
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("sales")
          .select("inventory_order_id, qty_sold")
          .in("inventory_order_id", orderIds)
          .neq("sale_status", "Deleted")
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        for (const row of data as { inventory_order_id: number | null; qty_sold: number | null }[]) {
          if (row.inventory_order_id == null) continue;
          totals.set(row.inventory_order_id, (totals.get(row.inventory_order_id) ?? 0) + (row.qty_sold ?? 0));
        }
        if (data.length < pageSize) break;
      }
      if (!cancelled) setAlreadySoldByOrder(totals);
    }
    void load();
    return () => { cancelled = true; };
  }, [allOrders]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, []);

  async function handleFile(file: File) {
    setMessage("");
    setImportFileName(file.name);
    try {
      let rows: string[][];
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "xlsx" || ext === "xls" || ext === "ods") {
        const { read, utils } = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = parseCSV(utils.sheet_to_csv(ws, { FS: ",", RS: "\n" }));
      } else {
        rows = parseCSV(await file.text());
      }
      if (rows.length < 2) { setMessage("File has no data rows — check row 1 is headers."); return; }
      const hdrs = rows[0].map(h => h.trim());
      const data = rows.slice(1).filter(r => r.some(c => c.trim()));
      const mapped: Record<number, string> = {};
      hdrs.forEach((h, i) => { mapped[i] = autoMap(h); });
      setHeaders(hdrs);
      setImportRows(data);
      setColMap(mapped);
      setStep("map");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to read file");
    }
  }

  const allTransformed = useMemo(
    () => importRows.map(r => transformRow(r, headers, colMap)),
    [importRows, headers, colMap],
  );

  const previewRows = useMemo(() => allTransformed.slice(0, 5), [allTransformed]);

  const previewMatches = useMemo(
    () => previewRows.map(row => findBestOrder(row, allOrders)),
    [previewRows, allOrders],
  );

  type ValidatedSaleRow = {
    rowNum: number;
    row: Record<string, unknown>;
    match: { order: MatchedOrder; score: number } | null;
    candidates: { order: MatchedOrder; score: number }[];
    issues: ImportIssue[];
    classification: RowClassification;
  };

  // Classifies every sale row before anything is written — required
  // fields, valid quantities, and (critically) an oversell check that
  // accumulates across the whole batch: several rows in this file can
  // legitimately point at the same order (multiple partial sales), so the
  // running total — not any single row in isolation — is what must stay
  // within that order's qty_bought.
  const validatedRows: ValidatedSaleRow[] = useMemo(() => {
    const runningSold = new Map(alreadySoldByOrder);
    return allTransformed.map((row, i) => {
      const rowNum = i + 2;
      if (row._skip) {
        return { rowNum, row, match: null, candidates: [], issues: [], classification: "valid" as RowClassification };
      }

      const override = matchOverride[i];
      const auto = findBestOrder(row, allOrders);
      const candidates = findCandidates(row, allOrders);
      const match = override === "skip" ? null : override != null ? { order: allOrders.find((o) => o.id === override)!, score: 100 } : auto;

      const issues: ImportIssue[] = [];
      issues.push(...checkRequiredText("event_name", "Event Name", row.event_name as string | undefined));
      issues.push(...checkQuantity("qty_sold", "Quantity Sold", (row.qty_sold as number) ?? null, { required: true }));

      const saleTotalGbp = row.sale_total != null ? convertToGbpClient(row.sale_total as number, importCurrency) : null;
      issues.push(...checkFinancialValue("sale_total", "Sale Price", saleTotalGbp, { required: true }));

      const rawMoneyCells: string[] = [];
      for (let c = 0; c < headers.length; c++) {
        if (colMap[c] === "sale_total") rawMoneyCells.push(importRows[i]?.[c] ?? "");
      }
      const mismatch = checkCurrencyMismatch(rawMoneyCells, importCurrency);
      if (mismatch) issues.push(mismatch);

      const qtySold = (row.qty_sold as number) ?? 0;
      if (match && qtySold > 0) {
        const already = runningSold.get(match.order.id) ?? 0;
        if (wouldOversell(match.order.qty_bought, already, qtySold)) {
          issues.push({ severity: "error", code: "oversell", message: describeOversell(match.order.qty_bought ?? 0, already, qtySold) });
        }
        runningSold.set(match.order.id, already + qtySold);
      }

      return { rowNum, row, match, candidates, issues, classification: classifyIssues(issues) };
    });
  }, [allTransformed, allOrders, alreadySoldByOrder, matchOverride, importCurrency, headers, colMap, importRows]);

  const previewSummary = useMemo(() => {
    let ticketsSold = 0, awaitingTransfer = 0, transferredPending = 0, paidArchived = 0, cancelled = 0;
    let awaitingPaymentAmount = 0, paidAmount = 0, errorCount = 0, warningCount = 0;
    for (const row of allTransformed) {
      if (row._skip) continue;
      ticketsSold += (row.qty_sold as number) ?? 0;
      const t = getRowType(row);
      if (t === "awaiting-transfer") awaitingTransfer++;
      else if (t === "transferred-pending-payment") { transferredPending++; awaitingPaymentAmount += (row.payout_total as number) ?? (row.sale_total as number) ?? 0; }
      else if (t === "paid-archived") { paidArchived++; paidAmount += (row.payout_total as number) ?? (row.sale_total as number) ?? 0; }
      else if (t === "cancelled") cancelled++;
    }
    for (const r of validatedRows) {
      if (r.classification === "error") errorCount++;
      else if (r.classification === "warning") warningCount++;
    }
    const skipped = allTransformed.filter(r => r._skip).length;
    return { total: importRows.length, skipped, ticketsSold, awaitingTransfer, transferredPending, paidArchived, cancelled, awaitingPaymentAmount, paidAmount, errorCount, warningCount };
  }, [allTransformed, importRows.length, validatedRows]);

  async function runImport() {
    setImporting(true);
    setMessage("");

    let inserted = 0, duplicates = 0, matched = 0, unmatched = 0, skipped = 0;
    let awaitingTransfer = 0, transferredPending = 0, paidArchived = 0;
    let awaitingPaymentAmount = 0, paidAmount = 0;
    const errors: FailedRow[] = [];
    const syncIds = new Set<number>();

    // Build batch — validate client-side, collect errors without hitting the DB yet
    const batch: Record<string, unknown>[] = [];
    const batchMeta: { rowNum: number; rowType: ReturnType<typeof getRowType>; payout: number }[] = [];

    for (let i = 0; i < importRows.length; i++) {
      const validated = validatedRows[i];
      const obj = { ...validated.row };

      if (obj._skip) { skipped++; continue; }
      delete obj._skip;

      for (const k of Object.keys(obj)) { if (!SALE_COLS.has(k)) delete obj[k]; }

      // Skip rows that have no sale data — these are order-only rows from a TixTracker export
      // (e.g. personal/unsold tickets that have event info but no qty_sold / sale_total)
      const hasSaleData = obj.qty_sold != null || obj.sale_total != null || obj.payout_total != null || obj.external_sale_id;
      if (!hasSaleData) {
        skipped++;
        continue;
      }

      if (validated.classification === "error") {
        errors.push({ rowNum: validated.rowNum, reason: validated.issues.find((iss) => iss.severity === "error")?.message ?? "This row has a problem and was not imported." });
        continue;
      }
      if (validated.classification === "warning" && !includeWarningRows) {
        errors.push({ rowNum: validated.rowNum, reason: validated.issues.find((iss) => iss.severity === "warning")?.message ?? "This row needs attention and was skipped." });
        continue;
      }

      // Convert sale/payout amounts from the selected import currency to
      // GBP (TixTracker's canonical storage currency) — reuses the same
      // convertToGbpClient() used for manual sale entry and the ticket importer.
      if (obj.sale_total != null) obj.sale_total = convertToGbpClient(obj.sale_total as number, importCurrency);
      if (obj.payout_total != null) obj.payout_total = convertToGbpClient(obj.payout_total as number, importCurrency);

      if (validated.match) {
        obj.inventory_order_id = validated.match.order.id;
        obj.match_confidence = Math.round(validated.match.score) / 100;
        matched++;
        syncIds.add(validated.match.order.id);
      } else {
        unmatched++;
      }

      obj.source = "import";
      obj.source_message_id = `import-${Date.now()}-${i}`;

      batch.push(obj);
      batchMeta.push({ rowNum: i + 2, rowType: getRowType(obj), payout: (obj.payout_total as number) ?? 0 });
    }

    // Batch insert in chunks — falls back to row-by-row on chunk failure
    // so one bad row can't silently drop 200 good rows
    if (batch.length > 0) {
      const CHUNK = 200;
      for (let c = 0; c < batch.length; c += CHUNK) {
        const chunk = batch.slice(c, c + CHUNK);
        const chunkMeta = batchMeta.slice(c, c + CHUNK);
        const { error } = await supabase.from("sales").insert(chunk);
        if (error) {
          // Chunk failed — retry each row individually to rescue the good ones
          for (let j = 0; j < chunk.length; j++) {
            const { error: rowErr } = await supabase.from("sales").insert(chunk[j]);
            if (rowErr) {
              if (rowErr.message.includes("duplicate key") || rowErr.message.includes("unique constraint")) {
                // Record already exists — find it and update with the latest CSV data (upsert behaviour)
                const extId = chunk[j].external_sale_id as string | null;
                const src = chunk[j].source as string;
                const { data: existing } = extId
                  ? await supabase
                      .from("sales")
                      .select("id")
                      .eq("source", src)
                      .eq("external_sale_id", extId)
                      .maybeSingle()
                  : { data: null };

                if (existing) {
                  const { error: updateErr } = await supabase
                    .from("sales")
                    .update(chunk[j])
                    .eq("id", (existing as { id: number }).id);
                  if (updateErr) {
                    errors.push({ rowNum: chunkMeta[j].rowNum, reason: updateErr.message });
                  } else {
                    const m = chunkMeta[j];
                    inserted++;
                    if (m.rowType === "awaiting-transfer") awaitingTransfer++;
                    else if (m.rowType === "transferred-pending-payment") { transferredPending++; awaitingPaymentAmount += m.payout; }
                    else if (m.rowType === "paid-archived") { paidArchived++; paidAmount += m.payout; }
                  }
                } else {
                  duplicates++;
                }
              } else {
                errors.push({ rowNum: chunkMeta[j].rowNum, reason: rowErr.message });
              }
            } else {
              const m = chunkMeta[j];
              inserted++;
              if (m.rowType === "awaiting-transfer") awaitingTransfer++;
              else if (m.rowType === "transferred-pending-payment") { transferredPending++; awaitingPaymentAmount += m.payout; }
              else if (m.rowType === "paid-archived") { paidArchived++; paidAmount += m.payout; }
            }
          }
        } else {
          for (const m of chunkMeta) {
            inserted++;
            if (m.rowType === "awaiting-transfer") awaitingTransfer++;
            else if (m.rowType === "transferred-pending-payment") { transferredPending++; awaitingPaymentAmount += m.payout; }
            else if (m.rowType === "paid-archived") { paidArchived++; paidAmount += m.payout; }
          }
        }
      }
    }

    // Sync matched orders in parallel
    await Promise.all([...syncIds].map((id) => syncOrder(id)));

    setResult({ inserted, duplicates, matched, unmatched, skipped, errors, awaitingTransfer, transferredPending, paidArchived, awaitingPaymentAmount, paidAmount });
    setStep("done");
    setImporting(false);
    void recordImportBatch({ inserted, matched, unmatched, duplicates, skipped, errors: errors.length });
  }

  const content = (
    <div className="add-sale-overlay" onClick={onClose}>
      <div className="add-sale-sheet" style={{ maxWidth: 820 }} onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Sales import</p>
            <h4>Import Broker Spreadsheet</h4>
          </div>
          <button className="drawer-close" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="add-sale-body">

          {/* ── Upload ── */}
          {step === "upload" && (
            <div className="add-sale-section">
              <p className="add-sale-section-title">
                Upload a CSV or Excel file. Columns are auto-matched — just export your broker spreadsheet as-is.
              </p>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "rgba(155,92,255,0.7)" : "rgba(155,92,255,0.35)"}`,
                  borderRadius: 12, padding: "40px 24px", textAlign: "center", cursor: "pointer",
                  background: dragOver ? "rgba(155,92,255,0.06)" : "rgba(255,255,255,0.02)",
                  transition: "all 150ms ease",
                }}
              >
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Drop file here or click to browse</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>CSV, XLSX, XLS supported</div>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.ods" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
              </div>

              {message && <p style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>{message}</p>}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
                {([
                  { title: "Ticket Details",  items: ["Event name, date & venue", "Section, row & seats", "Quantity sold"] },
                  { title: "Sales Details",   items: ["Sold date & sale price", "Platform & sale reference"] },
                  { title: "Transfer & Payment", items: ["Transfer & payment status", "Date paid"] },
                  { title: "Notes",           items: ["Free-text notes"] },
                ] as const).map(g => (
                  <div key={g.title} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{g.title}</p>
                    {g.items.map(item => (
                      <p key={item} style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>{item}</p>
                    ))}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "rgba(155,92,255,0.7)", marginTop: 12 }}>
                Column headers are auto-matched. Sales link to existing inventory automatically. Paid sales move to Archived.
              </p>
            </div>
          )}

          {/* ── Map ── */}
          {step === "map" && (
            <div className="add-sale-section">
              <p className="add-sale-section-title">
                Map your columns — {importRows.length} rows detected. Auto-matched where possible.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {headers.map((h, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", minWidth: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={h}
                    >{h}</span>
                    <select
                      className="field"
                      style={{ fontSize: 12, padding: "4px 8px", flex: 1 }}
                      value={colMap[i] ?? "skip"}
                      onChange={e => setColMap(prev => ({ ...prev, [i]: e.target.value }))}
                    >
                      <option value="skip">— Skip column —</option>
                      {FIELD_GROUPS.map(group => {
                        const gf = FIELDS.filter(f => f.group === group);
                        if (!gf.length) return null;
                        return (
                          <optgroup key={group} label={group}>
                            {gf.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                ))}
              </div>
              {message && <p style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>{message}</p>}

              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>What currency is this file&apos;s money in?</p>
                <select
                  className="field"
                  style={{ fontSize: 12, padding: "4px 8px", maxWidth: 260 }}
                  value={importCurrency}
                  onChange={(e) => setImportCurrency(e.target.value)}
                >
                  {CURRENCY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── Preview ── */}
          {step === "preview" && (
            <div className="add-sale-section">
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
                {[
                  { label: "Total rows",             value: previewSummary.total,                                           color: "rgba(255,255,255,0.8)" },
                  { label: "Tickets sold",            value: previewSummary.ticketsSold,                                    color: "#4fc3ff" },
                  { label: "Awaiting transfer",       value: previewSummary.awaitingTransfer,                               color: "#f97316" },
                  { label: "Transferred",             value: previewSummary.transferredPending,                             color: "#4fc3ff" },
                  { label: "Paid / Archived",         value: previewSummary.paidArchived,                                   color: "#4ade80" },
                  { label: "Awaiting payment",        value: previewSummary.awaitingPaymentAmount > 0 ? `£${previewSummary.awaitingPaymentAmount.toFixed(2)}` : "—", color: "#fbbf24" },
                  { label: "Paid out",                value: previewSummary.paidAmount > 0 ? `£${previewSummary.paidAmount.toFixed(2)}` : "—",           color: "#4ade80" },
                  { label: "Skipped (unsold)",        value: previewSummary.skipped,                                        color: "rgba(255,255,255,0.35)" },
                  { label: "Need attention",          value: previewSummary.warningCount,                                   color: "#fbbf24" },
                  { label: "Can't import yet",        value: previewSummary.errorCount,                                     color: "#f87171" },
                ].map(m => (
                  <div key={m.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {(previewSummary.errorCount > 0 || previewSummary.warningCount > 0) && (
                <div style={{ marginBottom: 16, maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {validatedRows
                    .filter((r) => r.classification !== "valid")
                    .slice(0, 50)
                    .map((r) => (
                      <div
                        key={r.rowNum}
                        style={{
                          padding: "8px 10px", borderRadius: 8,
                          border: `1px solid ${r.classification === "error" ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.3)"}`,
                          background: r.classification === "error" ? "rgba(248,113,113,0.06)" : "rgba(251,191,36,0.06)",
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>Row {r.rowNum}{r.row.event_name ? ` — ${String(r.row.event_name)}` : ""}</strong>
                        {r.issues.map((issue, j) => (
                          <p key={j} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "3px 0 0" }}>{issue.message}</p>
                        ))}
                      </div>
                    ))}
                </div>
              )}

              {previewSummary.warningCount > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 16, cursor: "pointer" }}>
                  <input type="checkbox" checked={includeWarningRows} onChange={(e) => setIncludeWarningRows(e.target.checked)} />
                  Also import the {previewSummary.warningCount} row{previewSummary.warningCount !== 1 ? "s" : ""} that need attention, as-is
                </label>
              )}

              {(() => {
                const needsMatch = validatedRows
                  .map((r, i) => ({ r, i }))
                  .filter(({ r, i }) => !r.row._skip && !r.match && (r.row.qty_sold != null || r.row.sale_total != null) && matchOverride[i] !== "skip");
                return needsMatch.length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 8, fontWeight: 600 }}>
                      {needsMatch.length} row{needsMatch.length !== 1 ? "s" : ""} couldn&apos;t be auto-matched to a ticket — pick the right one, or leave as unmatched
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                      {needsMatch.slice(0, 30).map(({ r, i }) => (
                        <div key={r.rowNum} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.6)" }}>
                            Row {r.rowNum}: {String(r.row.event_name ?? "—")}
                          </span>
                          <select
                            className="field"
                            style={{ fontSize: 12, padding: "3px 6px", flex: 1 }}
                            value={matchOverride[i] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMatchOverride((prev) => {
                                const next = { ...prev };
                                if (v === "") delete next[i];
                                else next[i] = v === "skip" ? "skip" : Number(v);
                                return next;
                              });
                            }}
                          >
                            <option value="">— Use best automatic match (none found) —</option>
                            {r.candidates.map((c) => (
                              <option key={c.order.id} value={c.order.id}>
                                {c.order.event_name ?? "Untitled"} · {c.order.event_date ?? "no date"} ({c.score}% match)
                              </option>
                            ))}
                            <option value="skip">Leave unmatched (import without linking to a ticket)</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 10, fontWeight: 600 }}>
                Preview — first {Math.min(5, importRows.length)} of {importRows.length} rows
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      {["Event","Date","Sec / Row","Qty","Sold For","Platform","Transfer","Payment","Row type","Match"].map(h => (
                        <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: "rgba(255,255,255,0.4)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => {
                      const match = previewMatches[i];
                      const rt = getRowType(row);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.8)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(row.event_name ?? "—")}</td>
                          <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{String(row.event_date ?? "—")}</td>
                          <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{String(row.section ?? "—")} / {String(row.row ?? "—")}</td>
                          <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.7)" }}>{String(row.qty_sold ?? "—")}</td>
                          <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.7)" }}>{row.sale_total != null ? `£${row.sale_total}` : "—"}</td>
                          <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.55)" }}>{String(row.marketplace ?? "—")}</td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4,
                              ...(row.transfer_status === "Transfer Completed"
                                ? { background: "rgba(79,195,255,0.12)", color: "#4fc3ff", border: "1px solid rgba(79,195,255,0.25)" }
                                : { background: "rgba(249,115,22,0.12)", color: "#f97316", border: "1px solid rgba(249,115,22,0.25)" })
                            }}>
                              {row.transfer_status === "Transfer Completed" ? "Transferred" : "Awaiting"}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4,
                              ...(row.payment_status === "Paid"
                                ? { background: "rgba(74,222,128,0.12)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.25)" }
                                : { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" })
                            }}>
                              {row.payment_status === "Paid" ? "Paid" : "Awaiting"}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, ...ROW_TYPE_STYLE[rt] }}>
                              {ROW_TYPE_LABEL[rt]}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {match ? (
                              <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}>
                                {match.score}%
                              </span>
                            ) : (
                              <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.1)" }}>
                                No match
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 10 }}>
                Rows matching ≥ 55% to inventory are auto-linked. Unsold rows are skipped. Paid sales are archived automatically.
              </p>
            </div>
          )}

          {/* ── Done ── */}
          {step === "done" && result && (
            <div className="add-sale-section">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                {[
                  { label: "Imported",             value: result.inserted,              color: "#4ade80" },
                  { label: "Matched to inventory", value: result.matched,               color: "#4fc3ff" },
                  { label: "Unmatched",             value: result.unmatched,             color: "#fbbf24" },
                  { label: "Already imported",      value: result.duplicates,            color: "rgba(255,255,255,0.4)" },
                  { label: "Skipped",               value: result.skipped,               color: "rgba(255,255,255,0.4)" },
                  { label: "Awaiting transfer",     value: result.awaitingTransfer,      color: "#f97316" },
                  { label: "Transferred — unpaid",  value: result.transferredPending,    color: "#fbbf24" },
                  { label: "Paid / Archived",       value: result.paidArchived,          color: "#4ade80" },
                  { label: "Revenue imported",      value: (result.awaitingPaymentAmount + result.paidAmount) > 0 ? `£${(result.awaitingPaymentAmount + result.paidAmount).toFixed(2)}` : "—", color: "#4ade80" },
                  { label: "Errors",                value: result.errors.length,         color: result.errors.length > 0 ? "#f87171" : "rgba(255,255,255,0.4)" },
                ].map(m => (
                  <div key={m.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              {result.duplicates > 0 && (
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    {result.duplicates} row{result.duplicates !== 1 ? "s were" : " was"} already in your sales and skipped — re-importing existing records is safe, nothing was overwritten.
                  </p>
                </div>
              )}
              {result.errors.length > 0 && (
                <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "12px 14px" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#f87171", marginBottom: 8 }}>
                    {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} failed:
                  </p>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <p key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Row {e.rowNum}: {e.reason}</p>
                  ))}
                  {result.errors.length > 5 && (
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>…and {result.errors.length - 5} more</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="drawer-actions">
          {step === "upload" && (
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          )}
          {step === "map" && (
            <>
              <button className="secondary-button" type="button" onClick={() => setStep("upload")}>Back</button>
              <button className="primary-button" type="button" onClick={() => setStep("preview")}>
                Preview import →
              </button>
            </>
          )}
          {step === "preview" && (
            <>
              <button className="secondary-button" type="button" onClick={() => setStep("map")}>Back</button>
              <button
                type="button"
                className="primary-button"
                disabled={importing || (previewSummary.total - previewSummary.skipped - previewSummary.errorCount - (includeWarningRows ? 0 : previewSummary.warningCount) <= 0)}
                onClick={() => void runImport()}
              >
                {importing ? "Importing…" : `Import ${previewSummary.total - previewSummary.skipped - previewSummary.errorCount - (includeWarningRows ? 0 : previewSummary.warningCount)} rows`}
              </button>
            </>
          )}
          {step === "done" && (
            <>
              <button className="secondary-button" type="button" onClick={() => {
                setStep("upload"); setImportRows([]); setHeaders([]); setColMap({}); setResult(null); setMessage("");
                setIncludeWarningRows(false); setMatchOverride({});
              }}>
                Import more
              </button>
              <button className="primary-button" type="button" onClick={() => { onImported(); onClose(); }}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
