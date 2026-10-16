// Shared spreadsheet-import parsing helpers.
//
// Previously, app/settings/settings-client.tsx and app/sales/SalesImportModal.tsx
// each carried their own near-identical copies of CSV parsing, date/number
// parsing, and header auto-mapping. Keeping one tested copy means a parsing
// fix (e.g. the unparseable-date fallback below) only needs to happen once
// and applies to every import flow, present and future, instead of silently
// diverging between two copies over time.

export type FieldAlias = { key: string; aliases: string[] };

export function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

// Generic column auto-mapper: exact key/alias match first, then a
// longest-alias substring match as a fallback. `fields` only needs `key`
// and `aliases` — callers with richer field objects can pass them directly
// since structural typing covers it.
export function autoMapHeader<T extends FieldAlias>(header: string, fields: T[]): string {
  const norm = normalizeHeader(header);

  for (const field of fields) {
    const keyNorm = field.key.replace(/_/g, " ");
    if (norm === keyNorm) return field.key;
    if (field.aliases.includes(norm)) return field.key;
  }

  let bestKey = "skip";
  let bestScore = 0;
  for (const field of fields) {
    for (const alias of field.aliases) {
      if (norm.includes(alias) || alias.includes(norm)) {
        if (alias.length > bestScore) {
          bestScore = alias.length;
          bestKey = field.key;
        }
      }
    }
  }
  return bestKey;
}

// Strips currency symbols/commas/parens before parsing. Returns null for
// blank/placeholder cells ("", "-", "n/a") rather than 0 — callers must
// never treat "couldn't parse" the same as "the value is zero".
export function parseImportNumber(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed.toLowerCase() === "n/a") return null;
  const cleaned = trimmed.replace(/[£$€,\s]/g, "").replace(/[()]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Detects which currency symbol (if any) appears in a raw numeric cell —
// used to warn when a cell looks like it's in a different currency than
// the one the customer selected for the whole file.
export function detectCurrencySymbol(raw: string): "GBP" | "USD" | "EUR" | null {
  if (raw.includes("£")) return "GBP";
  if (raw.includes("$")) return "USD";
  if (raw.includes("€")) return "EUR";
  return null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Parses a wide range of common date formats to ISO (YYYY-MM-DD).
//
// Returns null — not the raw string — when nothing matches. An earlier
// version of this logic (duplicated in two import flows) fell back to
// `return s` (the raw, unparsed text) when every pattern failed, which
// meant an unparseable date silently reached the database as literal text
// instead of being flagged. Callers use `null` to raise a "missing or
// ambiguous date" warning instead.
export function parseImportDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const ukSlash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (ukSlash) {
    const [, d, m, y] = ukSlash;
    const day = Number(d), month = Number(m);
    if (month <= 12 && day <= 31) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const dayFirst = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (dayFirst) {
    const mo = MONTHS[dayFirst[2].toLowerCase().slice(0, 3)];
    if (mo) return `${dayFirst[3]}-${mo}-${dayFirst[1].padStart(2, "0")}`;
  }
  const monthFirst = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})/);
  if (monthFirst) {
    const mo = MONTHS[monthFirst[1].toLowerCase().slice(0, 3)];
    if (mo) return `${monthFirst[3]}-${mo}-${monthFirst[2].padStart(2, "0")}`;
  }

  // Native parse fallback for anything not covered above (e.g. "14.04.2025",
  // RFC-style strings). Deliberately last, since Date.parse's leniency with
  // ambiguous short numeric forms is exactly what the explicit patterns
  // above exist to pre-empt.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  // Nothing matched — return null, not the raw string. A date column that
  // genuinely fails to parse must surface as a "missing or ambiguous date"
  // warning, not silently store unparsed text in a date field.
  return null;
}

export function parseCSV(text: string): string[][] {
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
      else if (ch === "," || ch === "\t") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && next === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push(row);
  }
  return rows;
}
