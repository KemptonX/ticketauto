// Shared, injection-safe CSV building (SEC-005 remediation) — previously
// duplicated independently across orders-client.tsx, analytics-client.tsx,
// desk-client.tsx, costs-client.tsx, sales-client.tsx and settings-client.tsx
// (exportAllData), each correctly escaping commas/quotes/newlines but none
// guarding against CSV formula injection: a cell value that happens to
// start with =, +, - or @ is executed as a formula by Excel/Sheets/Numbers
// when the file is opened, if the recipient has formulas enabled. Quoting
// alone (wrapping the value in "...") does NOT prevent this — spreadsheet
// apps still interpret a leading = inside a quoted CSV field as a formula
// trigger.
//
// Every value here ultimately originates from scanned emails, imports, or
// manual entry — none of it should be trusted to be formula-safe by
// default, especially for data headed to an accountant's spreadsheet via
// the Tax & Accounts export.

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

function sanitizeCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  // A genuine negative number (e.g. "-42.50") must still display as a
  // negative number, not get prefixed and shown as text — only guard
  // against a LEADING formula-trigger character on a value that isn't
  // simply a negative number.
  const isPlainNegativeNumber = /^-\d/.test(raw) && !isNaN(Number(raw));
  const needsFormulaGuard = raw.length > 0 && FORMULA_TRIGGER_CHARS.has(raw[0]) && !isPlainNegativeNumber;
  const guarded = needsFormulaGuard ? `'${raw}` : raw;

  return guarded.includes(",") || guarded.includes('"') || guarded.includes("\n")
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(sanitizeCsvCell).join(",")).join("\n");
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
