// Server-only: spreadsheet/text file parsing + CSV/XLSX export generation.
// Client-side column matching + row transformation lives in app/presale/import-utils.ts.

import * as XLSX from "xlsx";

export type ParsedFileResult = {
  headers: string[];
  rawRows: Record<string, string>[];
  method: "csv" | "xlsx" | "json" | "paste" | "tsv";
  sheetName?: string;
  totalCount: number;
};

const MAX_ROWS = 5_000;

// ── Date-split repair ────────────────────────────────────────────────────
// CSV commas inside "July 29, 2026 10:00" cause the value to be split across
// two cells. Merge them back BEFORE assigning to headers, so the overflow
// cell isn't discarded.

function mergeAdjacentDateCells(cells: string[]): string[] {
  const result: string[] = [];
  for (let k = 0; k < cells.length; k++) {
    const val  = cells[k].trim();
    const next = (cells[k + 1] ?? "").trim();
    // "July 29" followed by "2026 10:00" → "July 29, 2026 10:00"
    if (/^[A-Za-z]+\s+\d{1,2}$/.test(val) && /^\d{4}/.test(next)) {
      result.push(`${val}, ${next}`);
      k++; // consume the next cell too
    } else {
      result.push(val);
    }
  }
  return result;
}

// ── Spreadsheet parsing ───────────────────────────────────────────────────

export function parseSpreadsheetBuffer(buffer: Buffer, filename: string): ParsedFileResult {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const method: ParsedFileResult["method"] =
    ["csv", "tsv", "txt"].includes(ext) ? "csv" :
    ["xlsx", "xls", "xlsm", "xlsb", "ods"].includes(ext) ? "xlsx" :
    "csv";

  const wb = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: false, raw: false });
  const sheetName = wb.SheetNames[0] ?? "Sheet1";
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rawRows: [], method, sheetName, totalCount: 0 };

  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  if (data.length === 0) return { headers: [], rawRows: [], method, sheetName, totalCount: 0 };

  // Find the first non-empty row to use as header
  let hdrIdx = 0;
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    if ((data[i] as unknown[]).some(c => String(c ?? "").trim())) { hdrIdx = i; break; }
  }

  const headers = (data[hdrIdx] as unknown[])
    .map(h => String(h ?? "").trim())
    .filter(Boolean);

  const rawRows: Record<string, string>[] = [];
  const dataRows = data.slice(hdrIdx + 1) as unknown[][];

  for (const rowArr of dataRows) {
    const rawCells = (rowArr as unknown[]).map(c => String(c ?? "").trim());
    if (!rawCells.some(c => c)) continue;
    const cells = mergeAdjacentDateCells(rawCells);
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = cells[j] ?? ""; });
    rawRows.push(obj);
  }

  const totalCount = rawRows.length;
  return { headers, rawRows: rawRows.slice(0, MAX_ROWS), method, sheetName, totalCount };
}

// ── Paste / text parsing ──────────────────────────────────────────────────

export function parsePastedText(text: string): ParsedFileResult {
  const trimmed = text.trim();
  if (!trimmed) return { headers: [], rawRows: [], method: "paste", totalCount: 0 };

  // JSON array
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as Record<string, unknown>[];
      if (Array.isArray(arr) && arr.length > 0) {
        const headers = Object.keys(arr[0]);
        const rawRows = arr.slice(0, MAX_ROWS).map(item => {
          const obj: Record<string, string> = {};
          for (const k of headers) obj[k] = String(item[k] ?? "").trim();
          return obj;
        });
        return { headers, rawRows, method: "json", totalCount: arr.length };
      }
    } catch {}
  }

  // JSON object (single entry)
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const headers = Object.keys(obj);
      const row: Record<string, string> = {};
      for (const k of headers) row[k] = String(obj[k] ?? "").trim();
      return { headers, rawRows: [row], method: "json", totalCount: 1 };
    } catch {}
  }

  // Detect delimiter
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim());
  const firstLine = lines[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = tabCount >= commaCount ? "\t" : ",";
  const method: ParsedFileResult["method"] = delimiter === "\t" ? "tsv" : "csv";

  if (Math.max(tabCount, commaCount) === 0) {
    return { headers: ["notes"], rawRows: [{ notes: trimmed }], method: "paste", totalCount: 1 };
  }

  function splitLine(line: string): string[] {
    if (delimiter === ",") {
      const cells: string[] = [];
      let current = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === "," && !inQuote) {
          cells.push(current.trim()); current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    }
    return line.split("\t").map(c => c.trim());
  }

  const headers = mergeAdjacentDateCells(splitLine(firstLine));
  const rawRows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length && rawRows.length < MAX_ROWS; i++) {
    const cells = mergeAdjacentDateCells(splitLine(lines[i]));
    if (!cells.some(c => c)) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = cells[j] ?? ""; });
    rawRows.push(obj);
  }

  return { headers, rawRows, method, totalCount: rawRows.length };
}

// ── Export ────────────────────────────────────────────────────────────────

type ExportEntry = {
  campaign: string;
  account_email: string;
  presale_code: string | null;
  slot_start: string | null;
  slot_end: string | null;
  notes: string | null;
  created_at: string;
};

function safeForFormula(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@|]/.test(s) ? `'${s}` : s;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

export function buildCSV(entries: ExportEntry[]): string {
  const headers = ["Campaign", "Account Email", "Presale Code", "Slot Opens", "Slot Closes", "Notes", "Created At"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  for (const e of entries) {
    lines.push([
      safeForFormula(e.campaign),
      safeForFormula(e.account_email),
      safeForFormula(e.presale_code ?? ""),
      fmtDate(e.slot_start),
      fmtDate(e.slot_end),
      safeForFormula(e.notes ?? ""),
      fmtDate(e.created_at),
    ].map(esc).join(","));
  }
  return lines.join("\r\n");
}

export function buildXLSX(entries: ExportEntry[]): Buffer {
  const data = entries.map(e => ({
    "Campaign":      e.campaign,
    "Account Email": e.account_email,
    "Presale Code":  e.presale_code ?? "",
    "Slot Opens":    fmtDate(e.slot_start),
    "Slot Closes":   fmtDate(e.slot_end),
    "Notes":         e.notes ?? "",
    "Created At":    fmtDate(e.created_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 18 }, { wch: 30 }, { wch: 20 },
    { wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Presale Entries");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
