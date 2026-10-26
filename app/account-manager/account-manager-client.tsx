"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";
import { formatCurrency } from "@/src/lib/currency";
import { parseCSV, autoMapHeader } from "@/src/lib/spreadsheet-parsing";
import { downloadCsv } from "@/src/lib/csv-export";
import { PLATFORM_LABELS, ACCOUNT_STATUSES, STATUS_LABELS, type Platform, type AccountStatus, type TicketAccount } from "@/src/lib/account-manager";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Tax & Accounts", href: "/tax-accounts", active: false },
  { label: "Accounts", href: "/account-manager", active: true },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Presale & Codes", href: "/presale", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

type EnrichedAccount = TicketAccount & {
  purchase_count: number;
  total_spent: number;
  total_sold: number;
  last_purchase_at: string | null;
};

type Candidate = { platform: Platform; email: string; orderCount: number; lastSeenAt: string };

type Stats = {
  totalAccounts: number;
  ticketmasterAccounts: number;
  axsAccounts: number;
  accountsWithTickets: number;
  unlinkedPurchases: number;
};

type FormState = {
  id: string | null;
  platform: Platform;
  account_name: string;
  email: string;
  phone: string;
  browser_profile_number: string;
  browser_profile_tool: string;
  proxy_reference: string;
  country: string;
  status: AccountStatus;
  notes: string;
  tags: string;
  account_created_at: string;
  last_checked_at: string;
};

const EMPTY_FORM: FormState = {
  id: null, platform: "ticketmaster", account_name: "", email: "", phone: "",
  browser_profile_number: "", browser_profile_tool: "", proxy_reference: "", country: "",
  status: "active", notes: "", tags: "", account_created_at: "", last_checked_at: "",
};

const IMPORT_FIELD_ALIASES = [
  { key: "account_name", aliases: ["name", "account name", "account"] },
  { key: "email", aliases: ["email", "email address", "account email"] },
  { key: "phone", aliases: ["phone", "phone number", "mobile"] },
  { key: "platform", aliases: ["platform", "site"] },
  { key: "status", aliases: ["status", "account status"] },
  { key: "browser_profile_number", aliases: ["browser profile", "browser profile number", "profile number", "profile"] },
  { key: "browser_profile_tool", aliases: ["browser profile tool", "profile tool", "browser tool"] },
  { key: "proxy_reference", aliases: ["proxy", "proxy reference", "proxy ref"] },
  { key: "country", aliases: ["country", "region", "country/region"] },
  { key: "notes", aliases: ["notes", "note", "comment", "comments"] },
  { key: "tags", aliases: ["tags", "tag"] },
];

export default function AccountManagerClient() {
  const [accounts, setAccounts] = useState<EnrichedAccount[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tableReady, setTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [duplicateAccountId, setDuplicateAccountId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [ticketsFilter, setTicketsFilter] = useState<"all" | "has" | "none">("all");
  const [proxyFilter, setProxyFilter] = useState<"all" | "has" | "none">("all");
  const [phoneFilter, setPhoneFilter] = useState<"all" | "has" | "none">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "purchases" | "spent" | "recent" | "profile">("recent");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [historyAccount, setHistoryAccount] = useState<EnrichedAccount | null>(null);
  const [historyRows, setHistoryRows] = useState<Record<string, unknown>[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [importStep, setImportStep] = useState<"idle" | "map" | "preview">("idle");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [importColMap, setImportColMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/account-manager");
      const data = await res.json();
      if (!res.ok) { setMessage(data.error ?? "Failed to load accounts"); return; }
      setAccounts(data.accounts ?? []);
      setCandidates(data.candidates ?? []);
      setStats(data.stats ?? null);
      setTableReady(data.tableReady !== false);
    } catch {
      setMessage("Network error loading accounts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => a.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    let rows = accounts;
    if (platformFilter !== "all") rows = rows.filter((a) => a.platform === platformFilter);
    if (statusFilter !== "all") rows = rows.filter((a) => a.status === statusFilter);
    if (ticketsFilter !== "all") rows = rows.filter((a) => (ticketsFilter === "has" ? a.purchase_count > 0 : a.purchase_count === 0));
    if (proxyFilter !== "all") rows = rows.filter((a) => (proxyFilter === "has" ? !!a.proxy_reference : !a.proxy_reference));
    if (phoneFilter !== "all") rows = rows.filter((a) => (phoneFilter === "has" ? !!a.phone : !a.phone));
    if (tagFilter !== "all") rows = rows.filter((a) => a.tags.includes(tagFilter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) =>
        (a.account_name ?? "").toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q) ||
        (a.phone ?? "").toLowerCase().includes(q) ||
        (a.browser_profile_number ?? "").toLowerCase().includes(q) ||
        (a.proxy_reference ?? "").toLowerCase().includes(q) ||
        (a.notes ?? "").toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    const sorted = [...rows];
    if (sortBy === "name") sorted.sort((a, b) => (a.account_name ?? a.email ?? "").localeCompare(b.account_name ?? b.email ?? ""));
    else if (sortBy === "purchases") sorted.sort((a, b) => b.purchase_count - a.purchase_count);
    else if (sortBy === "spent") sorted.sort((a, b) => b.total_spent - a.total_spent);
    else if (sortBy === "profile") sorted.sort((a, b) => (a.browser_profile_number ?? "").localeCompare(b.browser_profile_number ?? ""));
    else sorted.sort((a, b) => (b.last_purchase_at ?? "").localeCompare(a.last_purchase_at ?? ""));
    return sorted;
  }, [accounts, platformFilter, statusFilter, ticketsFilter, proxyFilter, phoneFilter, tagFilter, search, sortBy]);

  function openCreate(prefill?: Partial<FormState>) {
    setForm({ ...EMPTY_FORM, ...prefill });
    setShowForm(true);
  }

  function openEdit(a: EnrichedAccount) {
    setForm({
      id: a.id,
      platform: a.platform,
      account_name: a.account_name ?? "",
      email: a.email ?? "",
      phone: a.phone ?? "",
      browser_profile_number: a.browser_profile_number ?? "",
      browser_profile_tool: a.browser_profile_tool ?? "",
      proxy_reference: a.proxy_reference ?? "",
      country: a.country ?? "",
      status: a.status,
      notes: a.notes ?? "",
      tags: a.tags.join(", "),
      account_created_at: a.account_created_at ? a.account_created_at.slice(0, 10) : "",
      last_checked_at: a.last_checked_at ? a.last_checked_at.slice(0, 10) : "",
    });
    setDuplicateAccountId(null);
    setShowForm(true);
  }

  async function saveForm() {
    if (!form.email.trim()) {
      setMessage("An email address is required");
      return;
    }
    setSaving(true);
    setMessage("");
    setDuplicateAccountId(null);
    const payload = {
      platform: form.platform,
      account_name: form.account_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      browser_profile_number: form.browser_profile_number.trim() || null,
      browser_profile_tool: form.browser_profile_tool.trim() || null,
      proxy_reference: form.proxy_reference.trim() || null,
      country: form.country.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      account_created_at: form.account_created_at || null,
      last_checked_at: form.last_checked_at ? new Date(form.last_checked_at).toISOString() : null,
    };
    try {
      const res = await fetch("/api/account-manager", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id ? { id: form.id, ...payload } : { ...payload, source: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Save failed");
        if (data.existingAccountId) setDuplicateAccountId(data.existingAccountId);
        setSaving(false);
        return;
      }
      setShowForm(false);
      setMessage(form.id ? "Account updated" : "Account added");
      await load();
    } catch {
      setMessage("Network error saving account");
    } finally {
      setSaving(false);
    }
  }

  function openExistingDuplicate() {
    const existing = accounts.find((a) => a.id === duplicateAccountId);
    if (existing) openEdit(existing);
    setDuplicateAccountId(null);
  }

  async function deleteAccount(a: EnrichedAccount) {
    if (!window.confirm(`Permanently delete ${a.account_name || a.email}? This only removes the saved account record — none of its linked ticket purchases are affected. To keep the record but mark it inactive, use Archive instead.`)) return;
    const res = await fetch(`/api/account-manager?id=${a.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? "Delete failed"); return; }
    setMessage("Account removed");
    await load();
  }

  async function toggleArchive(a: EnrichedAccount) {
    const nextStatus: AccountStatus = a.status === "archived" ? "active" : "archived";
    const res = await fetch("/api/account-manager", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, status: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? "Update failed"); return; }
    setMessage(nextStatus === "archived" ? "Account archived — its purchase history is preserved" : "Account restored");
    await load();
  }

  async function copyEmail(email: string | null) {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setMessage(`Copied ${email}`);
    } catch {
      setMessage("Couldn't copy to clipboard");
    }
  }

  function addFromCandidate(c: Candidate) {
    openCreate({ platform: c.platform, email: c.email, account_name: c.email.split("@")[0] });
  }

  function dismissCandidate(c: Candidate) {
    setCandidates((prev) => prev.filter((x) => !(x.platform === c.platform && x.email === c.email)));
  }

  async function viewHistory(a: EnrichedAccount) {
    setHistoryAccount(a);
    setHistoryRows(null);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/account-manager/purchases?accountId=${a.id}`);
      const data = await res.json();
      setHistoryRows(res.ok ? (data.purchases ?? []) : []);
    } finally {
      setHistoryLoading(false);
    }
  }

  function exportCSV() {
    const headers = ["Account Name", "Platform", "Email", "Phone", "Country", "Status", "Browser Profile #", "Browser Profile Tool", "Proxy Reference", "Tags", "Notes", "Purchases", "Total Spent", "Last Purchase", "Last Checked"];
    const rows = filtered.map((a) => [
      a.account_name, PLATFORM_LABELS[a.platform], a.email, a.phone, a.country, STATUS_LABELS[a.status],
      a.browser_profile_number, a.browser_profile_tool, a.proxy_reference,
      a.tags.join("; "), a.notes, a.purchase_count, a.total_spent, a.last_purchase_at, a.last_checked_at,
    ]);
    downloadCsv(`account-manager-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) { setMessage("File has no data rows"); return; }
    const headers = rows[0].map((h) => h.trim());
    const mapped: Record<number, string> = {};
    headers.forEach((h, i) => { mapped[i] = autoMapHeader(h, IMPORT_FIELD_ALIASES); });
    setImportHeaders(headers);
    setImportRows(rows.slice(1).filter((r) => r.some((c) => c.trim())));
    setImportColMap(mapped);
    setImportStep("map");
  }

  async function runImport() {
    setImporting(true);
    let added = 0, skipped = 0;
    for (const row of importRows) {
      const obj: Record<string, string> = {};
      for (let i = 0; i < importHeaders.length; i++) {
        const key = importColMap[i];
        if (key && key !== "skip" && row[i]?.trim()) obj[key] = row[i].trim();
      }
      if (!obj.email) { skipped++; continue; }
      const platform: Platform = obj.platform?.toLowerCase().includes("axs") ? "axs" : obj.platform?.toLowerCase().includes("ticketmaster") ? "ticketmaster" : "other";
      const statusKey = obj.status?.toLowerCase().replace(/\s+/g, "_");
      const res = await fetch("/api/account-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          account_name: obj.account_name || null,
          email: obj.email || null,
          phone: obj.phone || null,
          browser_profile_number: obj.browser_profile_number || null,
          browser_profile_tool: obj.browser_profile_tool || null,
          proxy_reference: obj.proxy_reference || null,
          country: obj.country || null,
          status: (ACCOUNT_STATUSES as readonly string[]).includes(statusKey) ? statusKey : "active",
          notes: obj.notes || null,
          tags: obj.tags ? obj.tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean) : [],
          source: "manual",
        }),
      });
      if (res.ok) added++; else skipped++; // duplicates (same platform+email already saved) land here — no existing detail is overwritten, per "no silent overwriting" in the brief
    }
    setImporting(false);
    setImportStep("idle");
    setImportRows([]);
    setImportHeaders([]);
    setMessage(`Import complete — ${added} account${added !== 1 ? "s" : ""} added, ${skipped} skipped`);
    await load();
  }

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <a key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`} target={item.target} rel={item.rel}>
                <NavIcon href={item.href} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Account Manager</p>
            <h2>Platform Accounts</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); e.target.value = ""; }} />
            <button className="secondary-button" type="button" onClick={exportCSV} disabled={filtered.length === 0}>Export CSV</button>
            <button className="primary-button" type="button" onClick={() => openCreate()}>Add Account</button>
          </div>
        </header>

        {message ? (
          <div className="feedback-banner" role="status">
            <span className="feedback-dot" /><span>{message}</span>
            {duplicateAccountId && (
              <button className="ghost-button" type="button" style={{ marginLeft: "0.75rem", padding: "2px 10px", fontSize: "0.8125rem" }} onClick={openExistingDuplicate}>
                Open existing account
              </button>
            )}
          </div>
        ) : null}

        {stats && tableReady && (
          <section className="kpi-grid" style={{ marginBottom: "1rem" }}>
            <article className="kpi-card">
              <p className="kpi-label">Total Accounts</p>
              <strong className="kpi-value">{stats.totalAccounts}</strong>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Ticketmaster</p>
              <strong className="kpi-value">{stats.ticketmasterAccounts}</strong>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">AXS</p>
              <strong className="kpi-value">{stats.axsAccounts}</strong>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Accounts With Tickets</p>
              <strong className="kpi-value">{stats.accountsWithTickets}</strong>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Unlinked Purchases</p>
              <strong className="kpi-value">{stats.unlinkedPurchases}</strong>
              <span className="kpi-trend">Couldn&apos;t be confidently matched to an account</span>
            </article>
          </section>
        )}

        {!tableReady && (
          <section className="table-card" style={{ padding: "1.5rem" }}>
            <p>Account Manager isn&apos;t fully set up on this environment yet. Please contact support.</p>
          </section>
        )}

        {candidates.length > 0 && (
          <section className="command-card" style={{ marginBottom: "1rem" }}>
            <div className="command-header">
              <div>
                <p className="section-tag">Discovered from your tickets</p>
                <h4>{candidates.length} Ticketmaster/AXS account{candidates.length !== 1 ? "s" : ""} found in your purchase history</h4>
              </div>
            </div>
            <div style={{ padding: "0 1.5rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
                These were found by looking at the account email on your existing tickets — nothing is saved until you confirm each one.
              </p>
              {candidates.slice(0, 20).map((c) => (
                <div key={`${c.platform}-${c.email}`} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <span className="badge-listed" style={{ flexShrink: 0 }}>{PLATFORM_LABELS[c.platform]}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8125rem", whiteSpace: "nowrap" }}>{c.orderCount} order{c.orderCount !== 1 ? "s" : ""}</span>
                  <button className="secondary-button" type="button" style={{ fontSize: "0.8125rem", padding: "4px 10px" }} onClick={() => addFromCandidate(c)}>Add</button>
                  <button className="ghost-button" type="button" style={{ fontSize: "0.8125rem", padding: "4px 10px" }} onClick={() => dismissCandidate(c)}>Dismiss</button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="command-card">
          <div className="command-header" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <input className="field" style={{ maxWidth: 260 }} placeholder="Search accounts..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="field" style={{ maxWidth: 160 }} value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as never)}>
              <option value="all">All platforms</option>
              <option value="ticketmaster">Ticketmaster</option>
              <option value="axs">AXS</option>
              <option value="other">Other</option>
            </select>
            <select className="field" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as never)}>
              <option value="all">All statuses</option>
              {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select className="field" style={{ maxWidth: 150 }} value={ticketsFilter} onChange={(e) => setTicketsFilter(e.target.value as never)}>
              <option value="all">Tickets: any</option>
              <option value="has">Has tickets</option>
              <option value="none">No tickets</option>
            </select>
            <select className="field" style={{ maxWidth: 150 }} value={proxyFilter} onChange={(e) => setProxyFilter(e.target.value as never)}>
              <option value="all">Proxy: any</option>
              <option value="has">Has proxy</option>
              <option value="none">No proxy</option>
            </select>
            <select className="field" style={{ maxWidth: 150 }} value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value as never)}>
              <option value="all">Phone: any</option>
              <option value="has">Has phone</option>
              <option value="none">No phone</option>
            </select>
            {allTags.length > 0 && (
              <select className="field" style={{ maxWidth: 150 }} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="all">All tags</option>
                {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <select className="field" style={{ maxWidth: 170 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as never)}>
              <option value="recent">Most recent purchase</option>
              <option value="name">Name</option>
              <option value="purchases">Most purchases</option>
              <option value="spent">Highest spend</option>
              <option value="profile">Profile number</option>
            </select>
          </div>

          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
              No accounts yet. Add one, import a list, or confirm one of the accounts discovered above.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Account</th><th>Platform</th><th>Email</th><th>Status</th>
                    <th>Phone</th><th>Browser Profile</th><th>Proxy</th><th>Tags</th>
                    <th>Purchases</th><th>Total Spent</th><th>Last Purchase</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.account_name || "—"}
                        {!a.account_name && !a.phone && !a.browser_profile_number ? (
                          <span style={{ display: "block", fontSize: "0.6875rem", color: "var(--muted)" }}>Missing optional details</span>
                        ) : null}
                      </td>
                      <td><span className="badge-listed">{PLATFORM_LABELS[a.platform]}</span></td>
                      <td>
                        {a.email || "—"}
                        {a.email && (
                          <button className="ghost-button" type="button" title="Copy email" style={{ padding: "0 4px", marginLeft: 4, fontSize: "0.75rem" }} onClick={() => void copyEmail(a.email)}>⧉</button>
                        )}
                      </td>
                      <td>
                        <span className={
                          a.status === "active" ? "badge-sold" :
                          a.status === "needs_attention" ? "badge-problem" :
                          "badge-unlisted"
                        }>
                          {STATUS_LABELS[a.status]}
                        </span>
                      </td>
                      <td>{a.phone || "—"}</td>
                      <td>{[a.browser_profile_tool, a.browser_profile_number].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{a.proxy_reference || "—"}</td>
                      <td>{a.tags.join(", ") || "—"}</td>
                      <td>
                        <button className="ghost-button" type="button" style={{ padding: "2px 8px", fontSize: "0.8125rem" }} onClick={() => void viewHistory(a)}>
                          {a.purchase_count}
                        </button>
                      </td>
                      <td>{formatCurrency(a.total_spent)}</td>
                      <td>{a.last_purchase_at ? new Date(a.last_purchase_at).toLocaleDateString("en-GB") : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="ghost-button" type="button" style={{ padding: "2px 8px", fontSize: "0.8125rem" }} onClick={() => openEdit(a)}>Edit</button>
                        <button className="ghost-button" type="button" style={{ padding: "2px 8px", fontSize: "0.8125rem" }} onClick={() => void toggleArchive(a)}>
                          {a.status === "archived" ? "Restore" : "Archive"}
                        </button>
                        <button className="ghost-button" type="button" style={{ padding: "2px 8px", fontSize: "0.8125rem" }} onClick={() => void deleteAccount(a)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* ── Add/Edit drawer ── */}
      {showForm && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{form.id ? "Edit account" : "New account"}</p>
              <h4>{form.id ? "Edit account" : "Add account"}</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setShowForm(false)}>×</button>
          </div>
          <div className="drawer-content">
            <div className="drawer-grid">
              <label>
                <span>Platform</span>
                <select className="field" value={form.platform} onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value as Platform }))}>
                  <option value="ticketmaster">Ticketmaster</option>
                  <option value="axs">AXS</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span>Account name</span>
                <input className="field" placeholder="e.g. John's TM account" value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
              </label>
              <label>
                <span>Email *</span>
                <input className="field" type="email" placeholder="account@email.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label>
                <span>Phone</span>
                <input className="field" placeholder="+44..." value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label>
                <span>Country / Region</span>
                <input className="field" placeholder="e.g. UK, US" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
              </label>
              <label>
                <span>Status</span>
                <select className="field" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AccountStatus }))}>
                  {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label>
                <span>Browser profile number</span>
                <input className="field" placeholder="e.g. Profile 14" value={form.browser_profile_number} onChange={(e) => setForm((f) => ({ ...f, browser_profile_number: e.target.value }))} />
              </label>
              <label>
                <span>Browser profile tool</span>
                <input className="field" placeholder="e.g. AdsPower, GoLogin, Multilogin" value={form.browser_profile_tool} onChange={(e) => setForm((f) => ({ ...f, browser_profile_tool: e.target.value }))} />
              </label>
              <label>
                <span>Proxy reference</span>
                <input className="field" placeholder="e.g. UK-residential-03" value={form.proxy_reference} onChange={(e) => setForm((f) => ({ ...f, proxy_reference: e.target.value }))} />
              </label>
              <label>
                <span>Tags (comma separated)</span>
                <input className="field" placeholder="e.g. priority, UK, mobile-verified" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              </label>
              <label>
                <span>Account created (if known)</span>
                <input className="field" type="date" value={form.account_created_at} onChange={(e) => setForm((f) => ({ ...f, account_created_at: e.target.value }))} />
              </label>
              <label>
                <span>Last checked</span>
                <input className="field" type="date" value={form.last_checked_at} onChange={(e) => setForm((f) => ({ ...f, last_checked_at: e.target.value }))} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Notes</span>
                <textarea className="field" rows={3} placeholder="e.g. Account requires checking, phone number needs updating..." value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
            <div className="drawer-actions">
              <button className="ghost-button" type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="primary-button" type="button" onClick={() => void saveForm()} disabled={saving}>
                {saving ? "Saving..." : form.id ? "Save changes" : "Add account"}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ── Purchase history drawer ── */}
      {historyAccount && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">Purchase history</p>
              <h4>{historyAccount.account_name || historyAccount.email}</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setHistoryAccount(null)}>×</button>
          </div>
          <div className="drawer-content">
            {historyLoading ? (
              <p style={{ color: "var(--muted)" }}>Loading...</p>
            ) : !historyRows || historyRows.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No linked purchases found for this account&apos;s email.</p>
            ) : (
              <div className="table-scroll">
                <table className="premium-table">
                  <thead><tr><th>Event</th><th>Venue</th><th>Date</th><th>Qty</th><th>Cost</th><th>Status</th></tr></thead>
                  <tbody>
                    {historyRows.map((r) => (
                      <tr key={r.id as number}>
                        <td>{String(r.event_name ?? "—")}</td>
                        <td>{String(r.venue ?? "—")}</td>
                        <td>{String(r.event_date ?? "—")}</td>
                        <td>{String(r.qty_bought ?? "—")}</td>
                        <td>{formatCurrency((r.total_cost as number) ?? null)}</td>
                        <td>{String(r.listing_status ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── Bulk import drawer ── */}
      {importStep !== "idle" && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">Import accounts</p>
              <h4>Map columns — {importRows.length} rows detected</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => { setImportStep("idle"); setImportRows([]); }}>×</button>
          </div>
          <div className="drawer-content">
            <div className="drawer-grid">
              {importHeaders.map((h, i) => (
                <label key={i}>
                  <span>{h}</span>
                  <select className="field" value={importColMap[i] ?? "skip"} onChange={(e) => setImportColMap((prev) => ({ ...prev, [i]: e.target.value }))}>
                    <option value="skip">— Skip —</option>
                    {IMPORT_FIELD_ALIASES.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="drawer-actions">
              <button className="ghost-button" type="button" onClick={() => { setImportStep("idle"); setImportRows([]); }}>Cancel</button>
              <button className="primary-button" type="button" onClick={() => void runImport()} disabled={importing}>
                {importing ? "Importing..." : `Import ${importRows.length} rows`}
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
