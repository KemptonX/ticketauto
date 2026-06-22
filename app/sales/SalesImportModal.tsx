"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/src/lib/supabase";

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
  { key: "payout_total",     label: "Payout Received",  group: "Sales Details",      aliases: ["payout","payout total","net payout","proceeds","net","net amount","amount received","amount paid out","amount paid","received","net received","take home","payout after fees","total payout","your payment"], dataType: "number" },
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
  "qty_sold","sale_total","payout_total","buyer_name","marketplace","buyer_email",
  "external_sale_id","sale_status","transfer_status","payment_status",
  "sold_at","transfer_date","payout_date","expected_payout_date","notes",
]);

// ─── Parsers ──────────────────────────────────────────────────────────────────

function normalizeHeader(h: string) {
  return h.toLowerCase().trim().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}

function autoMap(header: string): string {
  const norm = normalizeHeader(header);
  for (const f of FIELDS) {
    if (norm === f.key.replace(/_/g, " ") || f.aliases.includes(norm)) return f.key;
  }
  let best = "skip", bestScore = 0;
  for (const f of FIELDS) {
    for (const a of f.aliases) {
      if (norm.includes(a) || a.includes(norm)) {
        if (a.length > bestScore) { bestScore = a.length; best = f.key; }
      }
    }
  }
  return best;
}

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const uk = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  const MONTHS: Record<string, string> = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
  const df = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (df) { const mo = MONTHS[df[2].toLowerCase().slice(0, 3)]; if (mo) return `${df[3]}-${mo}-${df[1].padStart(2, "0")}`; }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNum(raw: string): number | null {
  if (!raw?.trim() || raw.trim() === "-" || raw.trim() === "n/a") return null;
  const n = parseFloat(raw.replace(/[£$€,\s]/g, "").replace(/[()]/g, ""));
  return isNaN(n) ? null : n;
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

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',' || ch === '\t') { row.push(cell); cell = ""; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell); cell = "";
        if (row.some(c => c.trim())) rows.push(row);
        row = [];
      } else cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row); }
  return rows;
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

  // If paid but payout_total missing, default to sale_total
  if (payStatus === "Paid" && !obj.payout_total && obj.sale_total) {
    obj.payout_total = obj.sale_total;
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
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, []);

  async function handleFile(file: File) {
    setMessage("");
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

  const previewSummary = useMemo(() => {
    let ticketsSold = 0, awaitingTransfer = 0, transferredPending = 0, paidArchived = 0, cancelled = 0;
    let awaitingPaymentAmount = 0, paidAmount = 0;
    for (const row of allTransformed) {
      if (row._skip) continue;
      ticketsSold += (row.qty_sold as number) ?? 0;
      const t = getRowType(row);
      if (t === "awaiting-transfer") awaitingTransfer++;
      else if (t === "transferred-pending-payment") { transferredPending++; awaitingPaymentAmount += (row.payout_total as number) ?? (row.sale_total as number) ?? 0; }
      else if (t === "paid-archived") { paidArchived++; paidAmount += (row.payout_total as number) ?? (row.sale_total as number) ?? 0; }
      else if (t === "cancelled") cancelled++;
    }
    const skipped = allTransformed.filter(r => r._skip).length;
    return { total: importRows.length, skipped, ticketsSold, awaitingTransfer, transferredPending, paidArchived, cancelled, awaitingPaymentAmount, paidAmount };
  }, [allTransformed, importRows.length]);

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
      const obj = transformRow(importRows[i], headers, colMap);

      if (obj._skip) { skipped++; continue; }
      delete obj._skip;

      for (const k of Object.keys(obj)) { if (!SALE_COLS.has(k)) delete obj[k]; }

      if (!obj.event_name) {
        errors.push({ rowNum: i + 2, reason: "Missing event name" });
        continue;
      }

      // Skip rows that have no sale data — these are order-only rows from a TixTracker export
      // (e.g. personal/unsold tickets that have event info but no qty_sold / sale_total)
      const hasSaleData = obj.qty_sold != null || obj.sale_total != null || obj.payout_total != null || obj.external_sale_id;
      if (!hasSaleData) {
        skipped++;
        continue;
      }

      if ((obj.payment_status as string) === "Paid" && !obj.payout_total && obj.sale_total) {
        obj.payout_total = obj.sale_total;
      }

      const bestMatch = findBestOrder(obj, allOrders);
      if (bestMatch) {
        obj.inventory_order_id = bestMatch.order.id;
        obj.match_confidence = Math.round(bestMatch.score) / 100;
        matched++;
        syncIds.add(bestMatch.order.id);
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
                duplicates++;
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
                  { title: "Sales Details",   items: ["Sold date & sale price", "Payout received (after fees)", "Platform & sale reference"] },
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
                ].map(m => (
                  <div key={m.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

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
              <button className="secondary-button" type="button" onClick={() => setStep("preview")}>Preview</button>
              <button className="primary-button" type="button" disabled={importing} onClick={() => void runImport()}>
                {importing ? "Importing…" : `Import ${importRows.length} rows`}
              </button>
            </>
          )}
          {step === "preview" && (
            <>
              <button className="secondary-button" type="button" onClick={() => setStep("map")}>Back</button>
              <button className="primary-button" type="button" disabled={importing} onClick={() => void runImport()}>
                {importing ? "Importing…" : `Import ${importRows.length} rows`}
              </button>
            </>
          )}
          {step === "done" && (
            <>
              <button className="secondary-button" type="button" onClick={() => {
                setStep("upload"); setImportRows([]); setHeaders([]); setColMap({}); setResult(null); setMessage("");
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
