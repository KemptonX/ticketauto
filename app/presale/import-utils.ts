// Client-safe: column matching, row transformation, validation.
// No server-only deps — importable from both server routes and client components.

export type ImportableField =
  | "campaign"
  | "account_email"
  | "presale_code"
  | "slot_start"
  | "slot_end"
  | "notes";

export type ColumnMapping = Record<string, ImportableField | null>;

export type PreviewRow = {
  _index: number;
  _status: "ready" | "duplicate" | "invalid" | "warn";
  _issues: string[];
  campaign: string;
  account_email: string;
  presale_code: string | null;
  slot_start: string | null;
  slot_end: string | null;
  notes: string | null;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  batchId: string;
  errors: string[];
};

// ── Column matching ───────────────────────────────────────────────────────

const FIELD_ALIASES: Record<ImportableField, string[]> = {
  campaign: [
    "campaign", "presale type", "event campaign", "sale type",
    "type", "presale name", "presale", "category",
  ],
  account_email: [
    "email", "account email", "account", "registered email",
    "gmail", "account address", "email address", "login",
    "username", "registered account", "buyer email",
  ],
  presale_code: [
    "code", "presale code", "password", "access code",
    "sale code", "promo code", "coupon", "voucher", "key",
    "presale password",
  ],
  slot_start: [
    "slot start", "slot opens", "presale start", "start",
    "start time", "sale start", "onsale", "on-sale", "on sale",
    "open", "opens", "presale open", "window start", "access start",
  ],
  slot_end: [
    "slot end", "slot closes", "presale end", "end", "end time",
    "sale end", "close", "closes", "presale close", "window end",
    "access end",
  ],
  notes: [
    "notes", "note", "comments", "comment", "description",
    "info", "details", "remarks", "extra",
  ],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function matchColumn(header: string): ImportableField | null {
  const n = normalise(header);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [ImportableField, string[]][]) {
    if (aliases.some(a => normalise(a) === n)) return field;
  }
  return null;
}

export function autoMatchColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ImportableField>();
  for (const h of headers) {
    const field = matchColumn(h);
    if (field && !used.has(field)) {
      mapping[h] = field;
      used.add(field);
    } else {
      mapping[h] = null;
    }
  }
  return mapping;
}

// ── Date parsing ──────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function parseDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  // ISO or any format Date() can handle natively
  const d1 = new Date(v);
  if (!isNaN(d1.getTime())) return d1.toISOString();

  // Excel serial (5-digit number)
  if (/^\d{5}$/.test(v)) {
    const d = new Date((parseInt(v, 10) - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "29 Jul 2026" or "29 Jul 2026, 13:00" or "29 Jul 2026 13:00:00"
  const textMatch = v.match(
    /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i,
  );
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const month = MONTH_MAP[textMatch[2].toLowerCase()];
    const year = parseInt(textMatch[3], 10);
    if (month) {
      const d = new Date(year, month - 1, day,
        textMatch[4] ? parseInt(textMatch[4], 10) : 0,
        textMatch[5] ? parseInt(textMatch[5], 10) : 0);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY HH:MM
  const dmyMatch = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day,
        dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0,
        dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  return null;
}

// ── Row transformation ────────────────────────────────────────────────────

const DEFAULT_CAMPAIGN = "la28_olympics";

function extractField(raw: Record<string, string>, mapping: ColumnMapping, field: ImportableField): string {
  for (const [col, f] of Object.entries(mapping)) {
    if (f === field) return (raw[col] ?? "").trim();
  }
  return "";
}

function inferCampaign(raw: Record<string, string>, mapping: ColumnMapping): string {
  const val = extractField(raw, mapping, "campaign");
  if (!val) return DEFAULT_CAMPAIGN;
  const lower = val.toLowerCase();
  if (lower.includes("la28") || lower.includes("olympic")) return "la28_olympics";
  return lower.replace(/\s+/g, "_");
}

export function transformRow(raw: Record<string, string>, mapping: ColumnMapping, index: number): PreviewRow {
  const issues: string[] = [];
  const campaign     = inferCampaign(raw, mapping);
  const account_email = extractField(raw, mapping, "account_email");
  const presale_code  = extractField(raw, mapping, "presale_code") || null;
  const slotStartRaw  = extractField(raw, mapping, "slot_start");
  const slotEndRaw    = extractField(raw, mapping, "slot_end");
  const notes         = extractField(raw, mapping, "notes") || null;

  if (account_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account_email)) {
    issues.push(`Invalid email: "${account_email}"`);
  }

  const slot_start = slotStartRaw ? parseDate(slotStartRaw) : null;
  const slot_end   = slotEndRaw   ? parseDate(slotEndRaw)   : null;
  if (slotStartRaw && !slot_start) issues.push(`Cannot parse date: "${slotStartRaw}"`);
  if (slotEndRaw   && !slot_end)   issues.push(`Cannot parse date: "${slotEndRaw}"`);
  if (slot_start && slot_end && new Date(slot_start) > new Date(slot_end)) {
    issues.push("Slot start is after slot end");
  }

  const _status: PreviewRow["_status"] =
    issues.length > 0 ? "invalid" :
    !account_email    ? "warn"    :
    "ready";

  return { _index: index, _status, _issues: issues, campaign, account_email, presale_code, slot_start, slot_end, notes };
}

export function transformRows(rawRows: Record<string, string>[], mapping: ColumnMapping): PreviewRow[] {
  return rawRows.map((r, i) => transformRow(r, mapping, i));
}
