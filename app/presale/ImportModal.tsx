"use client";

import { useRef, useState, useCallback } from "react";
import {
  autoMatchColumns,
  transformRows,
  type ColumnMapping,
  type ImportableField,
  type PreviewRow,
  type ImportResult,
} from "./import-utils";

const CAMPAIGN_LABELS: Record<string, string> = {
  la28_olympics: "LA28 Olympics",
};

const ALL_FIELDS: ImportableField[] = [
  "account_email", "presale_code", "slot_start", "slot_end", "notes", "campaign",
];

const FIELD_LABELS: Record<ImportableField, string> = {
  account_email: "Account Email",
  presale_code:  "Presale Code",
  slot_start:    "Slot Opens",
  slot_end:      "Slot Closes",
  notes:         "Notes",
  campaign:      "Campaign",
};

type Step = "upload" | "mapping" | "preview" | "result";
type Tab  = "file" | "paste" | "history";

type HistoryBatch = {
  id: string;
  created_at: string;
  method: string;
  file_names: string[];
  total_rows: number;
  imported: number;
  skipped: number;
  failed: number;
  status: string;
};

type ParsedData = {
  headers: string[];
  rawRows: Record<string, string>[];
  rows: PreviewRow[];
  mapping: ColumnMapping;
  method: string;
  fileName: string;
  warnings: string[];
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STEP_ORDER: Step[] = ["upload", "mapping", "preview", "result"];
const STEP_LABELS: Record<Step, string> = {
  upload:  "Upload",
  mapping: "Columns",
  preview: "Preview",
  result:  "Done",
};

export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [tab,      setTab]      = useState<Tab>("file");
  const [step,     setStep]     = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [paste,    setPaste]    = useState("");
  const [parsing,  setParsing]  = useState(false);
  const [parseErr, setParseErr] = useState("");
  const [data,     setData]     = useState<ParsedData | null>(null);
  const [mapping,  setMapping]  = useState<ColumnMapping>({});
  const [filter,   setFilter]   = useState<"all" | "ready" | "duplicate" | "issue">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result,   setResult]   = useState<ImportResult | null>(null);
  const [history,  setHistory]  = useState<HistoryBatch[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Computed preview rows (re-computed on mapping change) ─────────────

  const previewRows: PreviewRow[] = data
    ? transformRows(data.rawRows, mapping).map((row, i) => {
        // Preserve duplicate status from initial server parse (fingerprint-based)
        const serverRow = data.rows[i];
        if (serverRow?._status === "duplicate" && row._status === "ready") {
          return { ...row, _status: "duplicate" as const };
        }
        return row;
      })
    : [];

  const counts = {
    ready:     previewRows.filter(r => r._status === "ready").length,
    duplicate: previewRows.filter(r => r._status === "duplicate").length,
    issue:     previewRows.filter(r => r._status === "invalid" || r._status === "warn").length,
  };

  const displayRows =
    filter === "ready"     ? previewRows.filter(r => r._status === "ready") :
    filter === "duplicate" ? previewRows.filter(r => r._status === "duplicate") :
    filter === "issue"     ? previewRows.filter(r => r._status === "invalid" || r._status === "warn") :
    previewRows;

  // ── Drag and drop ─────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setParseErr(""); }
  }, []);

  // ── Parse (server) ────────────────────────────────────────────────────

  async function parse(source: "file" | "paste") {
    setParsing(true);
    setParseErr("");
    try {
      let res: Response;
      if (source === "file" && file) {
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/presale/import", { method: "POST", body: form });
      } else if (source === "paste" && paste.trim()) {
        res = await fetch("/api/presale/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: paste }),
        });
      } else {
        setParsing(false);
        return;
      }

      const json = await res.json() as ParsedData & { error?: string };
      if (!res.ok || json.error) { setParseErr(json.error ?? "Parse failed"); setParsing(false); return; }

      setData(json);
      setMapping(json.mapping);
      setSelected(new Set(json.rows.filter(r => r._status === "ready").map(r => r._index)));
      setStep("mapping");
    } catch {
      setParseErr("Network error — please try again");
    }
    setParsing(false);
  }

  // ── Import (server) ───────────────────────────────────────────────────

  async function confirmImport() {
    if (!data) return;
    setImporting(true);
    setParseErr("");
    const rowsToSend = previewRows.filter(r => selected.has(r._index));
    try {
      const res = await fetch("/api/presale/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToSend, method: data.method, fileName: data.fileName }),
      });
      const json = await res.json() as ImportResult & { error?: string };
      if (!res.ok || json.error) { setParseErr(json.error ?? "Import failed"); setImporting(false); return; }
      setResult(json);
      setStep("result");
      if (json.imported > 0) onImported();
    } catch {
      setParseErr("Network error — please try again");
    }
    setImporting(false);
  }

  // ── History ───────────────────────────────────────────────────────────

  async function loadHistory() {
    if (history !== null) return;
    setHistLoading(true);
    try {
      const res = await fetch("/api/presale/import/history");
      const json = await res.json() as { batches?: HistoryBatch[] };
      setHistory(json.batches ?? []);
    } catch { setHistory([]); }
    setHistLoading(false);
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "history") void loadHistory();
  }

  // ── Selection helpers ─────────────────────────────────────────────────

  function toggleRow(idx: number) {
    setSelected(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }
  function selectReady() { setSelected(new Set(previewRows.filter(r => r._status === "ready").map(r => r._index))); }
  function selectAll()   { setSelected(new Set(previewRows.map(r => r._index))); }
  function clearAll()    { setSelected(new Set()); }

  // ── Proceed from mapping ──────────────────────────────────────────────

  function goToPreview() {
    setFilter("all");
    setSelected(new Set(
      transformRows(data!.rawRows, mapping)
        .filter(r => r._status === "ready")
        .map(r => r._index)
    ));
    setStep("preview");
  }

  // ── Render ────────────────────────────────────────────────────────────

  const stepIdx = STEP_ORDER.indexOf(step);

  return (
    <div
      className="add-sale-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="add-sale-sheet"
        style={{ maxWidth: 780, width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="add-sale-sheet drawer-header">
          <div>
            <h4 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.02em" }}>Import Presales</h4>
            {step !== "upload" && step !== "result" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                {STEP_ORDER.filter(s => s !== "result").map((s, i) => (
                  <span key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {i > 0 && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>›</span>}
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: s === step ? "var(--accent)"
                           : STEP_ORDER.indexOf(step) > i ? "var(--text-secondary)"
                           : "var(--text-muted)",
                    }}>
                      {STEP_LABELS[s]}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="add-sale-body" style={{ overflowY: "auto", maxHeight: "65vh" }}>

          {/* ── UPLOAD ─────────────────────────────────────────────────── */}
          {step === "upload" && (
            <>
              <div className="view-toggle" style={{ marginBottom: 20 }}>
                {(["file", "paste", "history"] as Tab[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`toggle-btn${tab === t ? " toggle-btn-active" : ""}`}
                    onClick={() => changeTab(t)}
                  >
                    {t === "file" ? "Upload File" : t === "paste" ? "Paste Data" : "History"}
                  </button>
                ))}
              </div>

              {tab === "file" && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragging ? "var(--accent)" : "rgba(255,255,255,0.12)"}`,
                      borderRadius: 12,
                      padding: "36px 20px",
                      textAlign: "center",
                      cursor: "pointer",
                      background: dragging ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods,.json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setFile(f); setParseErr(""); }
                        e.target.value = "";
                      }}
                    />
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                      {file ? file.name : "Drop a file or click to browse"}
                    </p>
                    {file ? (
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                        {(file.size / 1024).toFixed(1)} KB — click to change
                      </p>
                    ) : (
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                        CSV, XLSX, XLS, ODS, TSV, JSON — max 10 MB
                      </p>
                    )}
                  </div>

                  <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
                    <strong style={{ color: "var(--text-secondary)" }}>Column names we recognise:</strong>
                    {" "}Account Email, Presale Code, Slot Opens/Start, Slot Closes/End, Notes, Campaign.
                    {" "}Columns not matched are skipped; you can fix them in the next step.
                  </div>
                </>
              )}

              {tab === "paste" && (
                <>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 10px" }}>
                    Paste CSV, TSV, or JSON. Put column headers in the first row.
                  </p>
                  <textarea
                    className="field"
                    value={paste}
                    onChange={(e) => { setPaste(e.target.value); setParseErr(""); }}
                    placeholder={"Account Email,Presale Code,Slot Opens,Slot Closes\nkemptoncameron9x@gmail.com,,2026-07-29 16:00,2026-07-29 20:00"}
                    style={{
                      width: "100%", minHeight: 160, fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12, resize: "vertical", display: "block", boxSizing: "border-box",
                    }}
                  />
                </>
              )}

              {tab === "history" && (
                histLoading ? (
                  <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
                ) : !history || history.length === 0 ? (
                  <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)" }}>
                    No import history yet
                  </div>
                ) : (
                  <div style={{ overflow: "auto" }}>
                    <table className="premium-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Source</th>
                          <th>Total</th>
                          <th>Imported</th>
                          <th>Skipped</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(b => (
                          <tr key={b.id}>
                            <td><span className="timestamp-text">{fmtDate(b.created_at)}</span></td>
                            <td>
                              <span className="mono-text" style={{ fontSize: 11 }}>
                                {b.method.toUpperCase()}
                                {b.file_names[0] ? ` · ${b.file_names[0]}` : ""}
                              </span>
                            </td>
                            <td>{b.total_rows}</td>
                            <td style={{ color: "#4ade80", fontWeight: 600 }}>{b.imported}</td>
                            <td style={{ color: "var(--text-muted)" }}>{b.skipped}</td>
                            <td>
                              <span className={`status-badge status-static ${
                                b.status === "completed" ? "status-sold" :
                                b.status === "partial"   ? "status-listed" :
                                "status-unlisted"
                              }`}>
                                {b.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {parseErr && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(255,79,79,0.1)", border: "1px solid rgba(255,79,79,0.3)", borderRadius: 8, fontSize: 13, color: "#ffb4b4" }}>
                  {parseErr}
                </div>
              )}
            </>
          )}

          {/* ── MAPPING ────────────────────────────────────────────────── */}
          {step === "mapping" && data && (
            <>
              {data.warnings.map((w, i) => (
                <div key={i} style={{ padding: "10px 14px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, fontSize: 13, color: "#fde68a", marginBottom: 12 }}>
                  ⚠ {w}
                </div>
              ))}
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
                We auto-matched {Object.values(mapping).filter(Boolean).length} of {data.headers.length} column{data.headers.length !== 1 ? "s" : ""}. Adjust any that look wrong.
              </p>
              <div style={{ overflow: "auto" }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Source Column</th>
                      <th>Maps to Field</th>
                      <th style={{ color: "var(--text-muted)" }}>Sample Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.headers.map(header => {
                      const samples = data.rawRows
                        .slice(0, 3)
                        .map(r => r[header])
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <tr key={header}>
                          <td><span className="mono-text" style={{ fontSize: 12 }}>{header}</span></td>
                          <td>
                            <select
                              className="field"
                              value={mapping[header] ?? ""}
                              onChange={(e) => {
                                const val = e.target.value ? e.target.value as ImportableField : null;
                                setMapping(prev => {
                                  const next: ColumnMapping = {};
                                  // Un-assign this field from any other column
                                  for (const [k, v] of Object.entries(prev)) {
                                    next[k] = (val && v === val && k !== header) ? null : v;
                                  }
                                  next[header] = val;
                                  return next;
                                });
                              }}
                              style={{ fontSize: 13, padding: "6px 10px" }}
                            >
                              <option value="">— Skip —</option>
                              {ALL_FIELDS.map(f => (
                                <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {samples || "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── PREVIEW ────────────────────────────────────────────────── */}
          {step === "preview" && (
            <>
              {/* Filter bar + selection controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {(["all", "ready", "duplicate", "issue"] as const).map(f => {
                  const n = f === "all" ? previewRows.length : counts[f as keyof typeof counts];
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      style={{
                        background: filter === f ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${filter === f ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 13,
                        color: filter === f ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: filter === f ? 600 : 400,
                      }}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)} {n}
                    </button>
                  );
                })}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" onClick={selectReady} className="ghost-button" style={{ fontSize: 11, padding: "5px 10px" }}>Ready</button>
                  <button type="button" onClick={selectAll}   className="ghost-button" style={{ fontSize: 11, padding: "5px 10px" }}>All</button>
                  <button type="button" onClick={clearAll}    className="ghost-button" style={{ fontSize: 11, padding: "5px 10px" }}>None</button>
                </div>
              </div>

              {parseErr && (
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(255,79,79,0.1)", border: "1px solid rgba(255,79,79,0.3)", borderRadius: 8, fontSize: 13, color: "#ffb4b4" }}>
                  {parseErr}
                </div>
              )}

              <div style={{ overflow: "auto", maxHeight: 360 }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32, paddingRight: 0 }}>
                        <input
                          type="checkbox"
                          checked={selected.size === previewRows.length && previewRows.length > 0}
                          onChange={(e) => e.target.checked ? selectAll() : clearAll()}
                        />
                      </th>
                      <th>Status</th>
                      <th>Account Email</th>
                      <th>Campaign</th>
                      <th>Slot Opens</th>
                      <th>Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map(row => {
                      const checked = selected.has(row._index);
                      const statusClass =
                        row._status === "ready"     ? "status-sold" :
                        row._status === "duplicate" ? "status-listed" :
                        row._status === "warn"      ? "status-listed" :
                        "status-unlisted";
                      const statusLabel =
                        row._status === "ready"     ? "Ready" :
                        row._status === "duplicate" ? "Duplicate" :
                        row._status === "warn"      ? "Warn" :
                        "Invalid";
                      return (
                        <tr
                          key={row._index}
                          style={{ opacity: checked ? 1 : 0.4, cursor: "pointer" }}
                          onClick={() => toggleRow(row._index)}
                          title={row._issues.join("; ") || undefined}
                        >
                          <td onClick={(e) => e.stopPropagation()} style={{ paddingRight: 0 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRow(row._index)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td>
                            <span className={`status-badge status-static ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td>
                            <span className="mono-text" style={{ fontSize: 12 }}>
                              {row.account_email || "—"}
                            </span>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {CAMPAIGN_LABELS[row.campaign] ?? row.campaign}
                          </td>
                          <td>
                            <span className="timestamp-text">{fmtDate(row.slot_start)}</span>
                          </td>
                          <td>
                            <span className="mono-text" style={{ fontSize: 12 }}>
                              {row.presale_code ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {displayRows.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                          No rows match this filter
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── RESULT ─────────────────────────────────────────────────── */}
          {step === "result" && result && (
            <div style={{ padding: "28px 0", textAlign: "center" }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>
                {result.imported > 0 ? "✅" : "⚠️"}
              </div>
              <h3 style={{ margin: "0 0 6px", fontSize: 22, letterSpacing: "-0.02em" }}>
                {result.imported > 0
                  ? `${result.imported} ${result.imported === 1 ? "entry" : "entries"} imported`
                  : "Nothing new imported"}
              </h3>
              <div style={{ display: "flex", gap: 32, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
                {[
                  { label: "Imported", value: result.imported, color: "#4ade80" },
                  { label: "Skipped",  value: result.skipped,  color: "var(--text-secondary)" },
                  { label: "Failed",   value: result.failed,   color: result.failed > 0 ? "#ff6b6b" : "var(--text-secondary)" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{label}</div>
                  </div>
                ))}
              </div>
              {result.errors.length > 0 && (
                <div style={{ marginTop: 20, padding: "12px 16px", background: "rgba(255,79,79,0.1)", border: "1px solid rgba(255,79,79,0.3)", borderRadius: 8, textAlign: "left", fontSize: 12, color: "#ffb4b4" }}>
                  <strong>Errors:</strong>
                  <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    {result.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div style={{
          padding: "18px 24px",
          borderTop: "1px solid rgba(38,38,47,0.7)",
          display: "flex", gap: 12, flexWrap: "wrap",
        }}>
          {step === "upload" && tab !== "history" && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={parsing || (tab === "file" ? !file : !paste.trim())}
                onClick={() => void parse(tab as "file" | "paste")}
              >
                {parsing ? "Parsing…" : "Parse & Continue →"}
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            </>
          )}
          {step === "upload" && tab === "history" && (
            <button type="button" className="ghost-button" onClick={onClose}>Close</button>
          )}
          {step === "mapping" && (
            <>
              <button type="button" className="primary-button" onClick={goToPreview}>
                Preview {data?.rawRows.length ?? 0} rows →
              </button>
              <button type="button" className="ghost-button" onClick={() => { setStep("upload"); setParseErr(""); }}>
                ← Back
              </button>
            </>
          )}
          {step === "preview" && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={importing || selected.size === 0}
                onClick={() => void confirmImport()}
              >
                {importing ? "Importing…" : `Import ${selected.size} selected`}
              </button>
              <button type="button" className="ghost-button" onClick={() => { setStep("mapping"); setParseErr(""); }}>
                ← Back
              </button>
            </>
          )}
          {step === "result" && (
            <button type="button" className="primary-button" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
