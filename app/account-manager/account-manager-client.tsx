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

type Candidate = {
  platform: Platform;
  email: string;
  orderCount: number;
  lastSeenAt: string;
  needsReview: boolean;
  reviewReason: string | null;
};

type Stats = {
  totalAccounts: number;
  ticketmasterAccounts: number;
  axsAccounts: number;
  linkedPurchases: number;
};

type DismissedItem = { platform: string; email: string; dismissed_at: string };

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

const DISCOVERY_PAGE_SIZE = 20;

function platformTag(platform: Platform) {
  const cls = platform === "ticketmaster" ? "am-tag-blue" : platform === "axs" ? "am-tag-purple" : "am-tag-neutral";
  return <span className={`am-tag ${cls}`}>{PLATFORM_LABELS[platform]}</span>;
}

function statusTag(status: AccountStatus) {
  const cls = status === "active" ? "am-tag-green" : status === "needs_attention" ? "am-tag-amber" : status === "archived" ? "am-tag-neutral" : "am-tag-neutral";
  return <span className={`am-tag ${cls}`}>{STATUS_LABELS[status]}</span>;
}

function FieldView({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, gridColumn: span ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 14, whiteSpace: span ? "pre-wrap" : undefined }}>{value || "—"}</span>
    </div>
  );
}

export default function AccountManagerClient() {
  const [accounts, setAccounts] = useState<EnrichedAccount[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dismissedCount, setDismissedCount] = useState(0);
  const [tableReady, setTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [duplicateAccountId, setDuplicateAccountId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"mine" | "discovered">("mine");

  // My Accounts — primary + advanced (popover) filters
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ticketsFilter, setTicketsFilter] = useState<"all" | "has" | "none">("all");
  const [proxyFilter, setProxyFilter] = useState<"all" | "has" | "none">("all");
  const [phoneFilter, setPhoneFilter] = useState<"all" | "has" | "none">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "purchases" | "spent" | "profile">("recent");
  const filtersPopoverRef = useRef<HTMLDivElement>(null);

  // Discovered Accounts
  const [discoverySearch, setDiscoverySearch] = useState("");
  const [discoveryPlatformFilter, setDiscoveryPlatformFilter] = useState<"all" | Platform>("all");
  const [discoveryPage, setDiscoveryPage] = useState(1);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [addingSelected, setAddingSelected] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissedList, setDismissedList] = useState<DismissedItem[] | null>(null);
  const [dismissedLoading, setDismissedLoading] = useState(false);

  // Add Account modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [saving, setSaving] = useState(false);

  // Account details drawer
  const [detailsAccount, setDetailsAccount] = useState<EnrichedAccount | null>(null);
  const [detailsEditMode, setDetailsEditMode] = useState(false);
  const [detailsForm, setDetailsForm] = useState<FormState>(EMPTY_FORM);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [historyRows, setHistoryRows] = useState<Record<string, unknown>[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Row action menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Bulk import
  const [importStep, setImportStep] = useState<"idle" | "map">("idle");
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
      setDismissedCount(data.dismissedCount ?? 0);
      setTableReady(data.tableReady !== false);
      setSelectedCandidates(new Set());
    } catch {
      setMessage("Network error loading accounts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // Close an open row menu or filter popover on outside click.
  useEffect(() => {
    if (!openMenuId && !filtersOpen) return;
    function onDocClick(e: MouseEvent) {
      if (openMenuId && menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
      if (filtersOpen && filtersPopoverRef.current && !filtersPopoverRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenuId, filtersOpen]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => a.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [accounts]);

  const advancedFilterCount = [ticketsFilter, proxyFilter, phoneFilter].filter((f) => f !== "all").length + (tagFilter !== "all" ? 1 : 0);
  const anyFilterActive = advancedFilterCount > 0 || platformFilter !== "all" || statusFilter !== "all" || search.trim() !== "";

  function resetFilters() {
    setSearch(""); setPlatformFilter("all"); setStatusFilter("all");
    setTicketsFilter("all"); setProxyFilter("all"); setPhoneFilter("all"); setTagFilter("all");
  }

  const filteredAccounts = useMemo(() => {
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
    else sorted.sort((a, b) => (b.last_purchase_at ?? a.created_at).localeCompare(a.last_purchase_at ?? a.created_at));
    return sorted;
  }, [accounts, platformFilter, statusFilter, ticketsFilter, proxyFilter, phoneFilter, tagFilter, search, sortBy]);

  const discoveryFiltered = useMemo(() => {
    let rows = candidates;
    if (discoveryPlatformFilter !== "all") rows = rows.filter((c) => c.platform === discoveryPlatformFilter);
    if (discoverySearch.trim()) {
      const q = discoverySearch.trim().toLowerCase();
      rows = rows.filter((c) => c.email.toLowerCase().includes(q));
    }
    return rows;
  }, [candidates, discoveryPlatformFilter, discoverySearch]);

  const discoveryTotalPages = Math.max(1, Math.ceil(discoveryFiltered.length / DISCOVERY_PAGE_SIZE));
  const discoveryPageClamped = Math.min(discoveryPage, discoveryTotalPages);
  const discoveryPageRows = discoveryFiltered.slice((discoveryPageClamped - 1) * DISCOVERY_PAGE_SIZE, discoveryPageClamped * DISCOVERY_PAGE_SIZE);

  function candidateKey(c: { platform: Platform; email: string }) {
    return `${c.platform}__${c.email.toLowerCase()}`;
  }

  function toggleCandidate(c: Candidate) {
    const key = candidateKey(c);
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const keys = discoveryPageRows.map(candidateKey);
    const allSelected = keys.every((k) => selectedCandidates.has(k));
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }

  async function addSelectedCandidates() {
    const items = candidates
      .filter((c) => selectedCandidates.has(candidateKey(c)))
      .map((c) => ({ platform: c.platform, email: c.email }));
    if (items.length === 0) return;
    setAddingSelected(true);
    try {
      const res = await fetch("/api/account-manager/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error ?? "Failed to add selected accounts"); return; }
      setMessage(`Added ${data.added} account${data.added !== 1 ? "s" : ""}${data.skipped ? `, skipped ${data.skipped}` : ""}`);
      setActiveTab("mine");
      await load();
    } catch {
      setMessage("Network error adding accounts");
    } finally {
      setAddingSelected(false);
    }
  }

  async function addOneCandidate(c: Candidate) {
    setAddingSelected(true);
    try {
      const res = await fetch("/api/account-manager/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ platform: c.platform, email: c.email }] }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error ?? "Failed to add account"); return; }
      setMessage(data.added > 0 ? "Account added" : "That account was already saved");
      await load();
    } catch {
      setMessage("Network error adding account");
    } finally {
      setAddingSelected(false);
    }
  }

  async function dismissCandidate(c: Candidate) {
    setCandidates((prev) => prev.filter((x) => candidateKey(x) !== candidateKey(c)));
    setSelectedCandidates((prev) => { const next = new Set(prev); next.delete(candidateKey(c)); return next; });
    setDismissedCount((n) => n + 1);
    await fetch("/api/account-manager/discovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: c.platform, email: c.email }),
    });
  }

  async function openDismissedPanel() {
    setShowDismissed(true);
    setDismissedLoading(true);
    try {
      const res = await fetch("/api/account-manager/discovery");
      const data = await res.json();
      setDismissedList(res.ok ? (data.dismissed ?? []) : []);
    } finally {
      setDismissedLoading(false);
    }
  }

  async function restoreDismissed(d: DismissedItem) {
    await fetch(`/api/account-manager/discovery?platform=${encodeURIComponent(d.platform)}&email=${encodeURIComponent(d.email)}`, { method: "DELETE" });
    setDismissedList((prev) => prev?.filter((x) => !(x.platform === d.platform && x.email === d.email)) ?? null);
    setDismissedCount((n) => Math.max(0, n - 1));
    setMessage("Suggestion restored — it will reappear in Discovered Accounts");
    await load();
  }

  function openAddModal(prefill?: Partial<FormState>) {
    setForm({ ...EMPTY_FORM, ...prefill });
    setShowMoreFields(false);
    setDuplicateAccountId(null);
    setShowAddModal(true);
  }

  async function saveNewAccount() {
    const email = form.email.trim();
    if (!email) { setMessage("An email address is required"); return; }
    setSaving(true);
    setMessage("");
    setDuplicateAccountId(null);
    try {
      const res = await fetch("/api/account-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: form.platform,
          account_name: form.account_name.trim() || null,
          email,
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
          source: "manual",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Save failed");
        if (data.existingAccountId) setDuplicateAccountId(data.existingAccountId);
        return;
      }
      setShowAddModal(false);
      setMessage("Account added");
      await load();
    } catch {
      setMessage("Network error saving account");
    } finally {
      setSaving(false);
    }
  }

  function openExistingDuplicate() {
    const existing = accounts.find((a) => a.id === duplicateAccountId);
    setShowAddModal(false);
    setDuplicateAccountId(null);
    if (existing) openDetails(existing, true);
  }

  function formFromAccount(a: EnrichedAccount): FormState {
    return {
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
    };
  }

  async function openDetails(a: EnrichedAccount, editMode = false) {
    setOpenMenuId(null);
    setDetailsAccount(a);
    setDetailsForm(formFromAccount(a));
    setDetailsEditMode(editMode);
    setHistoryRows(null);
    if (a.purchase_count > 0) {
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/account-manager/purchases?accountId=${a.id}`);
        const data = await res.json();
        setHistoryRows(res.ok ? (data.purchases ?? []) : []);
      } finally {
        setHistoryLoading(false);
      }
    } else {
      setHistoryRows([]);
    }
  }

  async function saveDetails() {
    if (!detailsAccount) return;
    setDetailsSaving(true);
    try {
      const res = await fetch("/api/account-manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: detailsForm.id,
          platform: detailsForm.platform,
          account_name: detailsForm.account_name.trim() || null,
          email: detailsForm.email.trim() || null,
          phone: detailsForm.phone.trim() || null,
          browser_profile_number: detailsForm.browser_profile_number.trim() || null,
          browser_profile_tool: detailsForm.browser_profile_tool.trim() || null,
          proxy_reference: detailsForm.proxy_reference.trim() || null,
          country: detailsForm.country.trim() || null,
          status: detailsForm.status,
          notes: detailsForm.notes.trim() || null,
          tags: detailsForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
          account_created_at: detailsForm.account_created_at || null,
          last_checked_at: detailsForm.last_checked_at ? new Date(detailsForm.last_checked_at).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error ?? "Save failed"); return; }
      setMessage("Account updated");
      setDetailsAccount({ ...detailsAccount, ...data.account });
      setDetailsEditMode(false);
      await load();
    } catch {
      setMessage("Network error saving account");
    } finally {
      setDetailsSaving(false);
    }
  }

  async function toggleArchive(a: EnrichedAccount) {
    setOpenMenuId(null);
    const nextStatus: AccountStatus = a.status === "archived" ? "active" : "archived";
    const res = await fetch("/api/account-manager", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, status: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? "Update failed"); return; }
    setMessage(nextStatus === "archived" ? "Account archived — its purchase history is preserved" : "Account restored");
    if (detailsAccount?.id === a.id) setDetailsAccount({ ...detailsAccount, status: nextStatus });
    await load();
  }

  async function deleteAccount(a: EnrichedAccount) {
    setOpenMenuId(null);
    if (!window.confirm(`Permanently delete ${a.account_name || a.email}? This only removes the saved account record — none of its linked ticket purchases are affected. To keep the record but mark it inactive, use Archive instead.`)) return;
    const res = await fetch(`/api/account-manager?id=${a.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? "Delete failed"); return; }
    setMessage("Account removed");
    if (detailsAccount?.id === a.id) setDetailsAccount(null);
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

  function exportCSV() {
    const headers = ["Account Name", "Platform", "Email", "Phone", "Country", "Status", "Browser Profile #", "Browser Profile Tool", "Proxy Reference", "Tags", "Notes", "Purchases", "Total Spent", "Last Purchase", "Last Checked"];
    const rows = filteredAccounts.map((a) => [
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
      if (res.ok) added++; else skipped++;
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
            <h2>Account Manager</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: "4px 0 0" }}>
              Keep your Ticketmaster and AXS accounts organised in one place.
            </p>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}>Import Accounts</button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); e.target.value = ""; }} />
            <button className="primary-button" type="button" onClick={() => openAddModal()}>Add Account</button>
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

        {!tableReady && (
          <section className="table-card" style={{ padding: "1.5rem" }}>
            <p>Account Manager isn&apos;t fully set up on this environment yet. Please contact support.</p>
          </section>
        )}

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
              <p className="kpi-label">Linked Purchases</p>
              <strong className="kpi-value">{stats.linkedPurchases}</strong>
              <span className="kpi-trend">Orders matched to a saved account</span>
            </article>
          </section>
        )}

        {tableReady && (
          <div className="view-toggle" style={{ marginBottom: "1rem", alignSelf: "flex-start" }}>
            <button type="button" className={`toggle-btn${activeTab === "mine" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("mine")}>
              My Accounts{accounts.length > 0 ? ` (${accounts.length})` : ""}
            </button>
            <button type="button" className={`toggle-btn${activeTab === "discovered" ? " toggle-btn-active" : ""}`} onClick={() => setActiveTab("discovered")}>
              Discovered Accounts{candidates.length > 0 ? ` (${candidates.length})` : ""}
            </button>
          </div>
        )}

        {/* ───────────────────────── My Accounts ───────────────────────── */}
        {tableReady && activeTab === "mine" && (
          <section className="command-card">
            {accounts.length > 0 && (
              <div className="command-header" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                <input className="field" style={{ maxWidth: 240 }} placeholder="Search accounts..." value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="field" style={{ maxWidth: 150 }} value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as never)}>
                  <option value="all">All platforms</option>
                  <option value="ticketmaster">Ticketmaster</option>
                  <option value="axs">AXS</option>
                  <option value="other">Other</option>
                </select>
                <select className="field" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as never)}>
                  <option value="all">All statuses</option>
                  {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>

                <div className="am-popover-wrap" ref={filtersPopoverRef}>
                  <button type="button" className="secondary-button am-filter-btn" onClick={() => setFiltersOpen((v) => !v)}>
                    More Filters
                    {advancedFilterCount > 0 && <span className="am-filter-count">{advancedFilterCount}</span>}
                  </button>
                  {filtersOpen && (
                    <div className="am-popover">
                      <div className="am-popover-row">
                        <span className="am-popover-label">Tickets</span>
                        <select className="field" value={ticketsFilter} onChange={(e) => setTicketsFilter(e.target.value as never)}>
                          <option value="all">Any</option>
                          <option value="has">Has tickets</option>
                          <option value="none">No tickets</option>
                        </select>
                      </div>
                      <div className="am-popover-row">
                        <span className="am-popover-label">Proxy</span>
                        <select className="field" value={proxyFilter} onChange={(e) => setProxyFilter(e.target.value as never)}>
                          <option value="all">Any</option>
                          <option value="has">Has proxy</option>
                          <option value="none">No proxy</option>
                        </select>
                      </div>
                      <div className="am-popover-row">
                        <span className="am-popover-label">Phone</span>
                        <select className="field" value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value as never)}>
                          <option value="all">Any</option>
                          <option value="has">Has phone</option>
                          <option value="none">No phone</option>
                        </select>
                      </div>
                      {allTags.length > 0 && (
                        <div className="am-popover-row">
                          <span className="am-popover-label">Tag</span>
                          <select className="field" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                            <option value="all">All tags</option>
                            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      )}
                      <div className="am-popover-row">
                        <span className="am-popover-label">Sort by</span>
                        <select className="field" value={sortBy} onChange={(e) => setSortBy(e.target.value as never)}>
                          <option value="recent">Most recent purchase</option>
                          <option value="name">Name</option>
                          <option value="purchases">Most purchases</option>
                          <option value="spent">Highest spend</option>
                          <option value="profile">Profile number</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {anyFilterActive && <button type="button" className="ghost-button" onClick={resetFilters}>Reset</button>}

                <button type="button" className="ghost-button" style={{ marginLeft: "auto" }} onClick={exportCSV} disabled={filteredAccounts.length === 0}>
                  Export CSV
                </button>
              </div>
            )}

            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
            ) : accounts.length === 0 ? (
              <div className="am-empty">
                <h4>No accounts added yet</h4>
                <p>Organise your Ticketmaster and AXS accounts, or import the ones you already use.</p>
                <div className="am-empty-actions">
                  <button className="primary-button" type="button" onClick={() => openAddModal()}>Add Account</button>
                  {candidates.length > 0 && (
                    <button className="secondary-button" type="button" onClick={() => setActiveTab("discovered")}>
                      Review {candidates.length} Discovered Account{candidates.length !== 1 ? "s" : ""}
                    </button>
                  )}
                  <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
                </div>
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="am-empty">
                <h4>No accounts match these filters</h4>
                <p>Try a different search term or reset your filters.</p>
                <div className="am-empty-actions">
                  <button className="secondary-button" type="button" onClick={resetFilters}>Reset filters</button>
                </div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Platform</th><th>Account Email</th><th>Name</th><th>Profile</th>
                      <th>Purchases</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map((a) => (
                      <tr key={a.id} onClick={() => void openDetails(a, false)} style={{ cursor: "pointer" }}>
                        <td>{platformTag(a.platform)}</td>
                        <td>
                          <span className="am-email-cell">
                            <span className="am-email-text">{a.email || "—"}</span>
                            {a.email && (
                              <button className="am-copy-btn" type="button" title="Copy email" onClick={(e) => { e.stopPropagation(); void copyEmail(a.email); }}>⧉</button>
                            )}
                          </span>
                        </td>
                        <td>{a.account_name || "—"}</td>
                        <td>{a.browser_profile_number || "—"}</td>
                        <td>{a.purchase_count}</td>
                        <td>{statusTag(a.status)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="am-menu-wrap" ref={openMenuId === a.id ? menuRef : undefined}>
                            <button className="am-menu-trigger" type="button" onClick={() => setOpenMenuId(openMenuId === a.id ? null : a.id)}>⋯</button>
                            {openMenuId === a.id && (
                              <div className="am-menu">
                                <button className="am-menu-item" type="button" onClick={() => void openDetails(a, true)}>Edit</button>
                                <button className="am-menu-item" type="button" onClick={() => void toggleArchive(a)}>{a.status === "archived" ? "Restore" : "Archive"}</button>
                                <button className="am-menu-item am-menu-item-danger" type="button" onClick={() => void deleteAccount(a)}>Delete</button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ───────────────────────── Discovered Accounts ───────────────────────── */}
        {tableReady && activeTab === "discovered" && (
          <section className="command-card">
            <div className="command-header" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.4rem" }}>
              <h4 style={{ margin: 0 }}>{candidates.length} potential account{candidates.length !== 1 ? "s" : ""} found</h4>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "13px" }}>
                We found these email addresses in your Ticketmaster and AXS purchase history. Review them and choose which accounts you&apos;d like to manage.
              </p>
            </div>

            {candidates.length === 0 ? (
              <div className="am-empty">
                <h4>No new suggestions right now</h4>
                <p>We&apos;ll surface new ones here automatically as new Ticketmaster or AXS purchases come in.</p>
                {dismissedCount > 0 && (
                  <div className="am-empty-actions">
                    <button className="ghost-button" type="button" onClick={() => void openDismissedPanel()}>View dismissed ({dismissedCount})</button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="command-header" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                  <input className="field" style={{ maxWidth: 240 }} placeholder="Search suggestions..." value={discoverySearch} onChange={(e) => { setDiscoverySearch(e.target.value); setDiscoveryPage(1); }} />
                  <select className="field" style={{ maxWidth: 160 }} value={discoveryPlatformFilter} onChange={(e) => { setDiscoveryPlatformFilter(e.target.value as never); setDiscoveryPage(1); }}>
                    <option value="all">All platforms</option>
                    <option value="ticketmaster">Ticketmaster</option>
                    <option value="axs">AXS</option>
                  </select>
                  {dismissedCount > 0 && (
                    <button className="ghost-button" type="button" style={{ marginLeft: "auto" }} onClick={() => void openDismissedPanel()}>
                      View dismissed ({dismissedCount})
                    </button>
                  )}
                </div>

                {selectedCandidates.size > 0 && (
                  <div className="feedback-banner" role="status" style={{ margin: "0 1.5rem 1rem" }}>
                    <span>{selectedCandidates.size} selected</span>
                    <button className="primary-button" type="button" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: "0.8125rem" }} disabled={addingSelected} onClick={() => void addSelectedCandidates()}>
                      {addingSelected ? "Adding..." : "Add Selected Accounts"}
                    </button>
                  </div>
                )}

                <div className="table-scroll">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input type="checkbox" checked={discoveryPageRows.length > 0 && discoveryPageRows.every((c) => selectedCandidates.has(candidateKey(c)))} onChange={toggleSelectAllOnPage} />
                        </th>
                        <th>Platform</th><th>Email</th><th>Purchases</th><th>Last Purchase</th><th>Review</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoveryPageRows.map((c) => {
                        const key = candidateKey(c);
                        return (
                          <tr key={key}>
                            <td><input type="checkbox" checked={selectedCandidates.has(key)} onChange={() => toggleCandidate(c)} /></td>
                            <td>{platformTag(c.platform)}</td>
                            <td>{c.email}</td>
                            <td>{c.orderCount}</td>
                            <td>{new Date(c.lastSeenAt).toLocaleDateString("en-GB")}</td>
                            <td>
                              {c.needsReview ? (
                                <span className="am-tag am-tag-amber" title={c.reviewReason ?? undefined}>Needs review</span>
                              ) : (
                                <span style={{ color: "var(--text-muted)", fontSize: 12.5 }}>—</span>
                              )}
                              {c.needsReview && c.reviewReason && (
                                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, maxWidth: 220 }}>{c.reviewReason}</div>
                              )}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <button className="secondary-button" type="button" style={{ padding: "4px 10px", fontSize: "0.8125rem" }} onClick={() => void addOneCandidate(c)}>Add</button>
                              <button className="ghost-button" type="button" style={{ padding: "4px 10px", fontSize: "0.8125rem" }} onClick={() => void dismissCandidate(c)}>Dismiss</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {discoveryTotalPages > 1 && (
                  <div className="am-pagination">
                    <button className="ghost-button" type="button" disabled={discoveryPageClamped === 1} onClick={() => setDiscoveryPage((p) => Math.max(1, p - 1))}>Previous</button>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {discoveryPageClamped} of {discoveryTotalPages}</span>
                    <button className="ghost-button" type="button" disabled={discoveryPageClamped === discoveryTotalPages} onClick={() => setDiscoveryPage((p) => Math.min(discoveryTotalPages, p + 1))}>Next</button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>

      {/* ── Dismissed suggestions panel ── */}
      {showDismissed && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">Discovered accounts</p>
              <h4>Dismissed suggestions</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setShowDismissed(false)}>×</button>
          </div>
          <div className="drawer-content">
            {dismissedLoading ? (
              <p style={{ color: "var(--muted)" }}>Loading...</p>
            ) : !dismissedList || dismissedList.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No dismissed suggestions.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {dismissedList.map((d) => (
                  <div key={`${d.platform}-${d.email}`} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", border: "1px solid var(--border)", borderRadius: 8 }}>
                    {platformTag(d.platform as Platform)}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{d.email}</span>
                    <button className="secondary-button" type="button" style={{ fontSize: "0.8125rem", padding: "4px 10px" }} onClick={() => void restoreDismissed(d)}>Restore</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── Add Account modal (progressive disclosure) ── */}
      {showAddModal && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">New account</p>
              <h4>Add account</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setShowAddModal(false)}>×</button>
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
                <span>Email address *</span>
                <input className="field" type="email" placeholder="account@email.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label>
                <span>Account name (optional)</span>
                <input className="field" placeholder="e.g. John's TM account" value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
              </label>
            </div>

            {!showMoreFields ? (
              <button type="button" className="am-progressive-toggle" onClick={() => setShowMoreFields(true)}>+ More details (optional)</button>
            ) : (
              <>
                <p className="am-section-title" style={{ marginTop: 18 }}>More details</p>
                <div className="drawer-grid">
                  <label><span>Phone</span><input className="field" placeholder="+44..." value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></label>
                  <label><span>Country / Region</span><input className="field" placeholder="e.g. UK, US" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} /></label>
                  <label><span>Status</span>
                    <select className="field" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AccountStatus }))}>
                      {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </label>
                  <label><span>Browser profile number</span><input className="field" placeholder="e.g. Profile 14" value={form.browser_profile_number} onChange={(e) => setForm((f) => ({ ...f, browser_profile_number: e.target.value }))} /></label>
                  <label><span>Browser profile tool</span><input className="field" placeholder="e.g. AdsPower, GoLogin" value={form.browser_profile_tool} onChange={(e) => setForm((f) => ({ ...f, browser_profile_tool: e.target.value }))} /></label>
                  <label><span>Proxy reference</span><input className="field" placeholder="e.g. UK-residential-03" value={form.proxy_reference} onChange={(e) => setForm((f) => ({ ...f, proxy_reference: e.target.value }))} /></label>
                  <label><span>Tags (comma separated)</span><input className="field" placeholder="e.g. priority, UK" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} /></label>
                  <label><span>Account created</span><input className="field" type="date" value={form.account_created_at} onChange={(e) => setForm((f) => ({ ...f, account_created_at: e.target.value }))} /></label>
                  <label><span>Last checked</span><input className="field" type="date" value={form.last_checked_at} onChange={(e) => setForm((f) => ({ ...f, last_checked_at: e.target.value }))} /></label>
                  <label style={{ gridColumn: "1 / -1" }}><span>Notes</span><textarea className="field" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
                </div>
              </>
            )}

            <div className="drawer-actions">
              <button className="ghost-button" type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="primary-button" type="button" onClick={() => void saveNewAccount()} disabled={saving}>
                {saving ? "Saving..." : "Add Account"}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ── Account details drawer ── */}
      {detailsAccount && (
        <aside className="details-drawer details-drawer-open">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{PLATFORM_LABELS[detailsAccount.platform]} account</p>
              <h4>{detailsAccount.account_name || detailsAccount.email}</h4>
            </div>
            <button className="drawer-close" type="button" onClick={() => setDetailsAccount(null)}>×</button>
          </div>
          <div className="drawer-content">
            <p className="am-section-title">Account information</p>
            <div className="drawer-grid">
              {detailsEditMode ? (
                <>
                  <label><span>Platform</span>
                    <select className="field" value={detailsForm.platform} onChange={(e) => setDetailsForm((f) => ({ ...f, platform: e.target.value as Platform }))}>
                      <option value="ticketmaster">Ticketmaster</option>
                      <option value="axs">AXS</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label><span>Email</span><input className="field" type="email" value={detailsForm.email} onChange={(e) => setDetailsForm((f) => ({ ...f, email: e.target.value }))} /></label>
                  <label><span>Name</span><input className="field" value={detailsForm.account_name} onChange={(e) => setDetailsForm((f) => ({ ...f, account_name: e.target.value }))} /></label>
                  <label><span>Phone</span><input className="field" value={detailsForm.phone} onChange={(e) => setDetailsForm((f) => ({ ...f, phone: e.target.value }))} /></label>
                  <label><span>Country</span><input className="field" value={detailsForm.country} onChange={(e) => setDetailsForm((f) => ({ ...f, country: e.target.value }))} /></label>
                  <label><span>Status</span>
                    <select className="field" value={detailsForm.status} onChange={(e) => setDetailsForm((f) => ({ ...f, status: e.target.value as AccountStatus }))}>
                      {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <FieldView label="Platform" value={PLATFORM_LABELS[detailsAccount.platform]} />
                  <FieldView label="Email" value={detailsAccount.email ?? ""} />
                  <FieldView label="Name" value={detailsAccount.account_name ?? ""} />
                  <FieldView label="Phone" value={detailsAccount.phone ?? ""} />
                  <FieldView label="Country" value={detailsAccount.country ?? ""} />
                  <FieldView label="Status" value={STATUS_LABELS[detailsAccount.status]} />
                </>
              )}
            </div>

            <p className="am-section-title">Browser & profile details</p>
            <div className="drawer-grid">
              {detailsEditMode ? (
                <>
                  <label><span>Browser profile number</span><input className="field" value={detailsForm.browser_profile_number} onChange={(e) => setDetailsForm((f) => ({ ...f, browser_profile_number: e.target.value }))} /></label>
                  <label><span>Browser profile tool</span><input className="field" value={detailsForm.browser_profile_tool} onChange={(e) => setDetailsForm((f) => ({ ...f, browser_profile_tool: e.target.value }))} /></label>
                  <label><span>Proxy reference</span><input className="field" value={detailsForm.proxy_reference} onChange={(e) => setDetailsForm((f) => ({ ...f, proxy_reference: e.target.value }))} /></label>
                </>
              ) : (
                <>
                  <FieldView label="Browser profile number" value={detailsAccount.browser_profile_number ?? ""} />
                  <FieldView label="Browser profile tool" value={detailsAccount.browser_profile_tool ?? ""} />
                  <FieldView label="Proxy reference" value={detailsAccount.proxy_reference ?? ""} />
                </>
              )}
            </div>

            <p className="am-section-title">Purchase history</p>
            <div className="drawer-grid" style={{ marginBottom: 12 }}>
              <FieldView label="Total purchases" value={String(detailsAccount.purchase_count)} />
              <FieldView label="Total spend" value={formatCurrency(detailsAccount.total_spent)} />
              <FieldView label="Last purchase" value={detailsAccount.last_purchase_at ? new Date(detailsAccount.last_purchase_at).toLocaleDateString("en-GB") : ""} />
            </div>
            {historyLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading linked orders...</p>
            ) : !historyRows || historyRows.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No linked purchases found for this account&apos;s email.</p>
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

            <p className="am-section-title">Notes & organisation</p>
            <div className="drawer-grid">
              {detailsEditMode ? (
                <>
                  <label><span>Tags (comma separated)</span><input className="field" value={detailsForm.tags} onChange={(e) => setDetailsForm((f) => ({ ...f, tags: e.target.value }))} /></label>
                  <label><span>Account created</span><input className="field" type="date" value={detailsForm.account_created_at} onChange={(e) => setDetailsForm((f) => ({ ...f, account_created_at: e.target.value }))} /></label>
                  <label><span>Last checked</span><input className="field" type="date" value={detailsForm.last_checked_at} onChange={(e) => setDetailsForm((f) => ({ ...f, last_checked_at: e.target.value }))} /></label>
                  <label style={{ gridColumn: "1 / -1" }}><span>Notes</span><textarea className="field" rows={3} value={detailsForm.notes} onChange={(e) => setDetailsForm((f) => ({ ...f, notes: e.target.value }))} /></label>
                </>
              ) : (
                <>
                  <FieldView label="Tags" value={detailsAccount.tags.join(", ")} />
                  <FieldView label="Account created" value={detailsAccount.account_created_at ? new Date(detailsAccount.account_created_at).toLocaleDateString("en-GB") : ""} />
                  <FieldView label="Last checked" value={detailsAccount.last_checked_at ? new Date(detailsAccount.last_checked_at).toLocaleDateString("en-GB") : ""} />
                  <FieldView label="Notes" value={detailsAccount.notes ?? ""} span />
                </>
              )}
            </div>

            <div className="drawer-actions">
              {detailsEditMode ? (
                <>
                  <button className="ghost-button" type="button" onClick={() => { setDetailsEditMode(false); setDetailsForm(formFromAccount(detailsAccount)); }}>Cancel</button>
                  <button className="primary-button" type="button" onClick={() => void saveDetails()} disabled={detailsSaving}>{detailsSaving ? "Saving..." : "Save changes"}</button>
                </>
              ) : (
                <>
                  <button className="ghost-button am-menu-item-danger" type="button" onClick={() => void deleteAccount(detailsAccount)}>Delete</button>
                  <button className="ghost-button" type="button" onClick={() => void toggleArchive(detailsAccount)}>{detailsAccount.status === "archived" ? "Restore" : "Archive"}</button>
                  <button className="primary-button" type="button" onClick={() => setDetailsEditMode(true)}>Edit</button>
                </>
              )}
            </div>
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
