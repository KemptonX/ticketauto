"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/src/lib/currency";
import { useRatesReady } from "@/app/components/CurrencyProvider";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Tax & Accounts", href: "/tax-accounts", active: true },
  { label: "Accounts", href: "/account-manager", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Presale & Codes", href: "/presale", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "FAQ", href: "/faq", active: false, target: "_blank", rel: "noopener noreferrer" },
];

type BusinessStructure = "sole_trader" | "limited_company";
type AccountingBasis = "cash" | "traditional";

type Profile = {
  business_structure: BusinessStructure;
  country: string;
  base_currency: string;
  accounting_basis: AccountingBasis | null;
  trading_name: string | null;
  company_name: string | null;
  company_number: string | null;
  company_year_end: string | null;
  vat_registered: boolean;
  vat_registration_date: string | null;
  vat_number: string | null;
  vat_scheme: string | null;
  utr: string | null;
  accountant_name: string | null;
  accountant_email: string | null;
  tax_reserve_percent: number;
  associated_companies: number;
  internal_notes: string | null;
  setup_completed: boolean;
};

const EMPTY_PROFILE: Profile = {
  business_structure: "sole_trader", country: "GB", base_currency: "GBP", accounting_basis: "cash",
  trading_name: "", company_name: "", company_number: "", company_year_end: "",
  vat_registered: false, vat_registration_date: "", vat_number: "", vat_scheme: "", utr: "",
  accountant_name: "", accountant_email: "", tax_reserve_percent: 25, associated_companies: 0,
  internal_notes: "", setup_completed: false,
};

type Entity = {
  id: number; entity_type: BusinessStructure; display_name: string;
  trading_name: string | null; company_name: string | null; company_number: string | null;
  incorporation_date: string | null; trading_start_date: string | null;
  effective_from: string; effective_to: string | null; accounting_reference_date: string | null;
};

type PeriodRange = { kind: string; label: string; shortLabel: string; start: string; end: string };

type YearCard = {
  period: PeriodRange; entityId: number; entityDisplayName: string; entityType: BusinessStructure;
  isCurrent: boolean; ended: boolean; status: string; periodScore: number; historicalCoverageComplete: boolean;
  criticalRecordCount: number; reviewRecordCount: number; issueTypeCount: number;
  unassignedPurchaseCount: number; unassignedSaleCount: number;
  income: number; estimatedProfit: number; unassignedIncome: number; selfAssessmentDeadline: string | null;
};

type OverviewFigures = {
  income: number; costOfSales: number; ticketPurchases: number; marketplaceFees: number;
  marketplaceFeesUnverifiedCount: number; runningCosts: number; refunds: number; refundsTrackedNote: string;
  estimatedProfit: number; inventoryAsOf: string; unsoldInventoryCost: number; pastEventStockRequiringReview: number;
  cashReceived: number; payoutsCount: number; salesWithUnknownFees: number; pendingPayoutCount: number;
  outstandingPayoutAmount: number; outstandingPayoutCount: number;
  unassignedIncome: number; unassignedIncomeCount: number; unassignedPurchaseCost: number; unassignedPurchaseCount: number;
  recordCounts: { sales: number; purchases: number; expenses: number; payouts: number };
};

type DataQualityIssue = { severity: "critical" | "review" | "evidence"; label: string; count: number; orderIds: number[] };
type Readiness = {
  periodScore: number; historicalCoverageComplete: boolean; status: string;
  criticalRecordCount: number; reviewRecordCount: number; evidenceRecordCount: number;
  issueTypeCount: number; unassignedPurchaseCount: number; unassignedSaleCount: number;
  unassignedIncomeAmount: number; unassignedPurchaseCost: number;
  blockingReasons: string[]; critical: DataQualityIssue[]; review: DataQualityIssue[]; evidence: DataQualityIssue[];
};

type Tab = "overview" | "review" | "historical-data" | "transactions" | "accountant-pack" | "settings";

const STATUS_LABEL: Record<string, string> = {
  needs_setup: "Needs Setup", in_progress: "In Progress", needs_historical_review: "Needs Historical Review",
  needs_review: "Needs Review", ready_for_accountant: "Ready for Accountant",
  sent_to_accountant: "Sent to Accountant", filed: "Filed",
};

function Info({ text }: { text: string }) {
  return (
    <span title={text} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.12)", fontSize: 10, color: "var(--text-secondary)", cursor: "help", marginLeft: 6 }}>i</span>
  );
}

function fmtDate(iso: string) {
  // Parses the date components directly rather than going through
  // `new Date(iso string)`, which is timezone-unsafe for bare date strings —
  // a known, deliberately avoided bug from the previous version.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Sentinel used when a prior Sole Trader period's exact start is genuinely
// unknown and not needed for accounting purposes — tax-year inclusion is
// governed by each transaction's own date, not this boundary. Never
// displayed as if it were a real known date.
const OPEN_ENDED_START = "2000-01-01";

function fmtEffectiveFrom(iso: string) {
  return iso === OPEN_ENDED_START ? "before available records" : fmtDate(iso);
}

function daysUntil(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.ceil((new Date(y, m - 1, d).getTime() - Date.now()) / 86400000);
}

function readinessLine(r: { criticalRecordCount: number; reviewRecordCount: number; issueTypeCount: number }) {
  const total = r.criticalRecordCount + r.reviewRecordCount;
  if (total === 0) return "No critical or review issues found.";
  return `${total} record${total === 1 ? "" : "s"} need attention across ${r.issueTypeCount} issue type${r.issueTypeCount === 1 ? "" : "s"}`;
}

export default function TaxAccountsClient() {
  useRatesReady();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [entities, setEntities] = useState<Entity[]>([]);
  const [needsEntitySetup, setNeedsEntitySetup] = useState(false);
  const [uncoveredTransactionCount, setUncoveredTransactionCount] = useState(0);
  const [years, setYears] = useState<YearCard[]>([]);
  const [yearsLoading, setYearsLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const [figures, setFigures] = useState<OverviewFigures | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => { void loadProfile(); void loadYears(); }, []);

  useEffect(() => {
    if (years.length === 0 || selectedIdx != null) return;
    const urgentPrevious = years.find(
      (y) => !y.isCurrent && y.ended && !["sent_to_accountant", "filed"].includes(y.status) && y.selfAssessmentDeadline && daysUntil(y.selfAssessmentDeadline) < 300,
    );
    const target = urgentPrevious ?? years.find((y) => y.isCurrent) ?? years[0];
    if (target) setSelectedIdx(years.indexOf(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years]);

  useEffect(() => {
    if (selectedIdx == null || years.length === 0) return;
    const y = years[selectedIdx];
    if (y) void loadOverview(y.period, y.entityType);
     
  }, [selectedIdx, years]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadProfile() {
    setLoading(true);
    try {
      const res = await fetch("/api/tax-accounts/profile");
      const data = await res.json();
      if (data.profile) { setProfile(data.profile); setForm({ ...EMPTY_PROFILE, ...data.profile }); }
      else setProfile(null);
    } finally { setLoading(false); }
  }

  async function saveProfile(markComplete: boolean) {
    setSaving(true); setMessage("");
    try {
      const payload = { ...form, setup_completed: markComplete || form.setup_completed };
      const res = await fetch("/api/tax-accounts/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.error) setMessage(data.error);
      else { setProfile(data.profile); setForm({ ...EMPTY_PROFILE, ...data.profile }); setMessage(markComplete ? "Tax & Accounts is set up." : "Saved."); }
    } finally { setSaving(false); }
  }

  async function loadYears() {
    setYearsLoading(true);
    try {
      const res = await fetch("/api/tax-accounts/years");
      const data = await res.json();
      setNeedsEntitySetup(!!data.needsEntitySetup);
      setEntities(data.entities ?? []);
      setYears(data.years ?? []);
      setUncoveredTransactionCount(data.uncoveredTransactionCount ?? 0);
    } finally { setYearsLoading(false); }
  }

  async function createEntity(payload: Record<string, unknown>) {
    const res = await fetch("/api/tax-accounts/entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.error) { setMessage(data.error); return false; }
    return true;
  }

  async function loadOverview(p: PeriodRange, entityType: BusinessStructure) {
    setOverviewLoading(true); setOverviewError("");
    try {
      const params = new URLSearchParams({ kind: "custom", start: p.start, end: p.end, entityType });
      const res = await fetch(`/api/tax-accounts/overview?${params.toString()}`);
      const data = await res.json();
      if (data.error) { setOverviewError(data.error); setFigures(null); setReadiness(null); }
      else { setFigures(data.figures); setReadiness(data.readiness); }
    } finally { setOverviewLoading(false); }
  }

  async function setYearStatus(y: YearCard, status: string) {
    await fetch("/api/tax-accounts/year-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodKind: y.period.kind, periodStart: y.period.start, periodEnd: y.period.end, status }) });
    void loadYears();
  }

  const isLimitedCompany = form.business_structure === "limited_company";
  const selectedYear = selectedIdx != null ? years[selectedIdx] : null;

  const yearsByEntity = useMemo(() => {
    const map = new Map<number, YearCard[]>();
    for (const y of years) { const list = map.get(y.entityId) ?? []; list.push(y); map.set(y.entityId, list); }
    return map;
  }, [years]);

  const filingBanner = useMemo(() => years.find(
    (y) => !y.isCurrent && y.ended && !["sent_to_accountant", "filed"].includes(y.status) && y.selfAssessmentDeadline && daysUntil(y.selfAssessmentDeadline) < 300 && daysUntil(y.selfAssessmentDeadline) > -60,
  ), [years]);

  if (loading) {
    return (
      <div className="orders-shell">
        <aside className="orders-sidebar">
          <div><SidebarLogo /><nav className="sidebar-nav">{navItems.map((item) => (<Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`} target={item.target} rel={item.rel}><NavIcon href={item.href} /><span>{item.label}</span></Link>))}</nav></div>
          <SidebarFooter onLogout={handleLogout} />
        </aside>
        <main className="orders-main"><p style={{ padding: 24, color: "var(--text-secondary)" }}>Loading…</p></main>
      </div>
    );
  }

  const needsProfileSetup = !profile || !profile.setup_completed;

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div><SidebarLogo /><nav className="sidebar-nav">{navItems.map((item) => (<Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`} target={item.target} rel={item.rel}><NavIcon href={item.href} /><span>{item.label}</span></Link>))}</nav></div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main">
        <header className="topbar"><div><p className="eyebrow">Finance</p><h2>Tax &amp; Accounts</h2></div></header>

        {message && <div className="feedback-banner">{message}</div>}

        {needsProfileSetup ? (
          <SetupForm form={form} setForm={setForm} isLimitedCompany={isLimitedCompany} saving={saving} onSave={() => void saveProfile(true)} />
        ) : needsEntitySetup ? (
          <EntityHistorySetup profile={form} onCreate={createEntity} onDone={() => void loadYears()} />
        ) : (
          <>
            {uncoveredTransactionCount > 0 && (
              <section className="feedback-banner">
                <strong>{uncoveredTransactionCount} transaction{uncoveredTransactionCount === 1 ? "" : "s"}</strong> fall outside every business entity period you&apos;ve set up — they can&apos;t be assigned to a tax year yet. <Link href="#settings" onClick={() => setActiveTab("settings")} style={{ textDecoration: "underline" }}>Review business history</Link>
              </section>
            )}

            {filingBanner && filingBanner.period.shortLabel !== selectedYear?.period.shortLabel && (
              <section className="feedback-banner" style={{ cursor: "pointer" }} onClick={() => setSelectedIdx(years.indexOf(filingBanner))}>
                <strong>{filingBanner.period.shortLabel} Self Assessment</strong> — deadline {filingBanner.selfAssessmentDeadline ? fmtDate(filingBanner.selfAssessmentDeadline) : ""}. Your records are {filingBanner.periodScore}% ready. <span style={{ textDecoration: "underline" }}>Finish {filingBanner.period.shortLabel}</span>
              </section>
            )}

            <section className="table-card" style={{ padding: 20 }}>
              <p className="section-tag">Your Accounts</p>
              {Array.from(yearsByEntity.entries()).map(([entityId, entityYears]) => (
                <div key={entityId} style={{ marginBottom: 16 }}>
                  <h4 style={{ marginBottom: 8 }}>{entityYears[0].entityDisplayName}</h4>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {entityYears.map((y) => {
                      const idx = years.indexOf(y);
                      return (
                        <article key={y.period.shortLabel} className="kpi-card" style={{ cursor: "pointer", minWidth: 200, outline: idx === selectedIdx ? "2px solid var(--accent-pink)" : "none" }} onClick={() => setSelectedIdx(idx)}>
                          <p className="kpi-label">{y.period.shortLabel}</p>
                          <span className="kpi-trend" style={{ display: "block", marginBottom: 4 }}>{fmtDate(y.period.start)} – {fmtDate(y.period.end)}</span>
                          <strong className="kpi-value" style={{ fontSize: 18 }}>{STATUS_LABEL[y.status] ?? y.status}</strong>
                          <span className="kpi-trend">{y.periodScore}% of period records ready{y.criticalRecordCount > 0 ? ` · ${y.criticalRecordCount} critical` : ""}</span>
                          {!y.historicalCoverageComplete && <span className="kpi-trend" style={{ color: "#FFB84F" }}>{y.unassignedPurchaseCount + y.unassignedSaleCount} historic records unassigned</span>}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>

            {selectedYear && (
              <section className="hero-card">
                <div style={{ width: "100%" }}>
                  <p className="section-tag">{selectedYear.entityDisplayName}</p>
                  <h3>{selectedYear.period.shortLabel}</h3>
                  <p style={{ color: "var(--text-secondary)", marginTop: 4 }}>{fmtDate(selectedYear.period.start)} – {fmtDate(selectedYear.period.end)} · {STATUS_LABEL[selectedYear.status] ?? selectedYear.status}</p>
                  {selectedYear.selfAssessmentDeadline && <p style={{ color: "var(--text-secondary)", marginTop: 4 }}>Self Assessment deadline <strong>{fmtDate(selectedYear.selfAssessmentDeadline)}</strong></p>}
                  <p style={{ color: "var(--text-muted)", marginTop: 8, fontSize: 13 }}>
                    Accounting method: <strong>{selectedYear.entityType === "limited_company" ? "Traditional Accounting" : (form.accounting_basis === "cash" ? "Cash Basis" : "Traditional Accounting")}</strong>
                    <Info text="Income and expenses are assigned by real transaction date (sale date / payment date), based on the configured accounting method. Event dates never determine the tax year." />
                  </p>
                </div>
              </section>
            )}

            <section className="table-card" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 16px" }}>
              {([
                { id: "overview", label: "Overview" },
                { id: "review", label: `Review${readiness ? ` (${readiness.criticalRecordCount + readiness.reviewRecordCount})` : ""}` },
                { id: "historical-data", label: `Historical Data Check${readiness && !readiness.historicalCoverageComplete ? ` (${readiness.unassignedPurchaseCount + readiness.unassignedSaleCount})` : ""}` },
                { id: "transactions", label: "Transactions" },
                { id: "accountant-pack", label: "Accountant Pack" },
                { id: "settings", label: "Settings" },
              ] as { id: Tab; label: string }[]).map((t) => (
                <button key={t.id} type="button" className={t.id === activeTab ? "primary-button" : "secondary-button"} onClick={() => setActiveTab(t.id)}>{t.label}</button>
              ))}
            </section>

            {overviewError && <div className="feedback-banner">{overviewError}</div>}
            {(overviewLoading || yearsLoading) && <p style={{ padding: 16, color: "var(--text-secondary)" }}>Calculating…</p>}

            {!overviewLoading && activeTab === "overview" && figures && readiness && selectedYear && (
              <OverviewTab figures={figures} readiness={readiness} year={selectedYear} taxReservePercent={form.tax_reserve_percent} onReview={() => setActiveTab("review")} />
            )}

            {!overviewLoading && activeTab === "review" && readiness && <ReviewTab readiness={readiness} />}

            {!overviewLoading && activeTab === "historical-data" && readiness && figures && <HistoricalDataCheckTab readiness={readiness} />}

            {activeTab === "transactions" && <ComingSoon title="Transactions" body="A universal ledger filterable by entity, period, assigned/unassigned status, type and source is coming in the next phase." />}

            {!overviewLoading && activeTab === "accountant-pack" && figures && readiness && selectedYear && (
              <AccountantPackTab figures={figures} readiness={readiness} year={selectedYear} onMarkSent={() => void setYearStatus(selectedYear, "sent_to_accountant")} onMarkFiled={() => void setYearStatus(selectedYear, "filed")} />
            )}

            {activeTab === "settings" && (
              <>
                <SetupForm form={form} setForm={setForm} isLimitedCompany={isLimitedCompany} saving={saving} onSave={() => void saveProfile(false)} isSettingsMode />
                <EntityList entities={entities} onChanged={() => void loadYears()} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: React.ReactNode }) {
  return (<section className="table-card" style={{ padding: 32, textAlign: "center" }}><p className="section-tag">{title}</p><p style={{ color: "var(--text-secondary)", maxWidth: 520, margin: "8px auto 0" }}>{body}</p></section>);
}

function Row({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: "risk" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}{note && <Info text={note} />}</span>
      <strong style={{ color: tone === "risk" ? "#FF7D7D" : "inherit" }}>{formatCurrency(value)}</strong>
    </div>
  );
}

function OverviewTab({ figures, readiness, year, taxReservePercent, onReview }: { figures: OverviewFigures; readiness: Readiness; year: YearCard; taxReservePercent: number; onReview: () => void }) {
  const taxReserve = Math.max(0, figures.estimatedProfit) * (taxReservePercent / 100);
  const hasUnassigned = figures.unassignedIncomeCount > 0 || figures.unassignedPurchaseCount > 0;

  return (
    <>
      <section className="table-card" style={{ padding: 20 }}>
        <div className="table-card-header">
          <div>
            <p className="section-tag">Period Readiness</p>
            <h4 style={{ color: readiness.periodScore >= 90 ? "#67F0A5" : readiness.periodScore >= 70 ? "inherit" : "#FF7D7D" }}>{readiness.periodScore}% of this period&apos;s own records are ready</h4>
          </div>
          <button type="button" className="secondary-button" onClick={onReview}>{readinessLine(readiness)}</button>
        </div>
        {readiness.criticalRecordCount === 0 && readiness.reviewRecordCount === 0 ? (
          <p style={{ color: "#67F0A5" }}>✓ No critical or review issues found among {year.period.shortLabel}&apos;s own assigned records.</p>
        ) : (
          <p style={{ color: "var(--text-secondary)" }}>{readinessLine(readiness)} — see Review.</p>
        )}
        {readiness.evidenceRecordCount > 0 && <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>{readiness.evidenceRecordCount} records have no attached evidence — this barely affects readiness and is normal for historic/imported data.</p>}

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <p className="section-tag">Historical Data Coverage<Info text="Separate from the period score above — this tracks account-wide records that have no date at all, so they can't yet be confirmed as belonging to THIS or any other period. A clean period score doesn't override this." /></p>
          {readiness.historicalCoverageComplete ? (
            <p style={{ color: "#67F0A5" }}>✓ No undated historic records anywhere in the account.</p>
          ) : (
            <>
              <p style={{ color: "#FFB84F" }}>Needs historical review — this is why the status above may not say &quot;Ready for Accountant&quot; even with a clean period score.</p>
              <ul style={{ color: "var(--text-secondary)", paddingLeft: 18 }}>{readiness.blockingReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </>
          )}
        </div>
      </section>

      {hasUnassigned && (
        <section className="table-card" style={{ padding: 20, border: "1px solid rgba(255,125,125,0.4)" }}>
          <p className="section-tag" style={{ color: "#FF7D7D" }}>Unassigned Historic Transactions</p>
          <p style={{ color: "var(--text-secondary)" }}>Real money TixTracker found but couldn&apos;t confidently place in this tax year because the transaction date is unknown. Never silently dropped — review these to assign them correctly.</p>
          <div className="command-grid" style={{ marginTop: 10 }}>
            {figures.unassignedIncomeCount > 0 && <Row label={`Unassigned historic income (${figures.unassignedIncomeCount} sales)`} value={figures.unassignedIncome} tone="risk" />}
            {figures.unassignedPurchaseCount > 0 && <Row label={`Unassigned historic purchases (${figures.unassignedPurchaseCount} orders)`} value={figures.unassignedPurchaseCost} tone="risk" />}
          </div>
        </section>
      )}

      <section className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="kpi-card"><p className="kpi-label">Income<Info text="Revenue recognised in this period based on real sale dates and the configured accounting method." /></p><strong className="kpi-value">{formatCurrency(figures.income)}</strong></article>
        <article className="kpi-card"><p className="kpi-label">Business Costs<Info text="Ticket purchase costs for tickets sold, marketplace fees and running costs, all for this period." /></p><strong className="kpi-value">{formatCurrency(figures.costOfSales + figures.marketplaceFees + figures.runningCosts)}</strong></article>
        <article className="kpi-card"><p className="kpi-label">Estimated Profit<Info text="Income minus Business Costs and Refunds. An estimate — your accountant calculates the final figure." /></p><strong className="kpi-value" style={{ color: figures.estimatedProfit >= 0 ? "#67F0A5" : "#FF7D7D" }}>{formatCurrency(figures.estimatedProfit)}</strong></article>
        <article className="kpi-card"><p className="kpi-label">Suggested Tax Reserve<Info text="A cash-management guide only. Not a calculation of what you owe HMRC." /></p><strong className="kpi-value">{formatCurrency(taxReserve)}</strong><span className="kpi-trend">{taxReservePercent}% of estimated profit</span></article>
      </section>

      <section className="table-card" style={{ padding: 20 }}>
        <p className="section-tag">Breakdown</p>
        <div className="command-grid">
          <Row label="Ticket purchases" value={figures.ticketPurchases} />
          <Row label="Marketplace fees" value={figures.marketplaceFees} note={figures.marketplaceFeesUnverifiedCount > 0 ? `${figures.marketplaceFeesUnverifiedCount} sale(s) show identical sale/payout amounts — fee may be genuinely £0 or the source may only supply a net figure. See Review.` : undefined} />
          <Row label="Running costs" value={figures.runningCosts} />
          <Row label="Refunds" value={figures.refunds} note={figures.refundsTrackedNote} />
        </div>
      </section>

      <section className="table-card" style={{ padding: 20 }}>
        <p className="section-tag">Ticket Inventory at Period End</p>
        <p style={{ color: "var(--text-secondary)", marginBottom: 10 }}>As at {fmtDate(figures.inventoryAsOf)}</p>
        <div className="command-grid">
          <Row label="Unsold (event not yet past)" value={figures.unsoldInventoryCost} />
          <Row label="Past-event stock requiring review" value={figures.pastEventStockRequiringReview} tone={figures.pastEventStockRequiringReview > 0 ? "risk" : undefined} note="Events that have already happened with tickets that were never sold — needs a decision (write off / refunded / personal use), not silently treated as £0." />
        </div>
      </section>

      <section className="table-card" style={{ padding: 20 }}>
        <p className="section-tag">Revenue Recognised vs Cash Received<Info text="Income is recognised according to your accounting method (sale date, or payout date under Cash Basis). Cash Received is the actual money that landed in this period — these are deliberately kept separate so they're never confused." /></p>
        <div className="command-grid">
          <Row label="Cash received in period" value={figures.cashReceived} note="Actual payouts/settlements received during this period." />
          <Row label="Outstanding (recognised, not yet paid)" value={figures.outstandingPayoutAmount} note="Income already counted above, but the cash hasn't landed in this period yet — often because the payout arrives a few weeks after the sale, sometimes in the next tax year." />
        </div>
        <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>{figures.payoutsCount} payout{figures.payoutsCount === 1 ? "" : "s"} received in this period · {figures.outstandingPayoutCount} outstanding{figures.pendingPayoutCount > 0 ? ` · ${figures.pendingPayoutCount} sale(s) not yet recognised at all (Cash Basis, no payout date yet)` : ""}.</p>
      </section>

      <section className="table-card" style={{ padding: 20 }}>
        <p className="section-tag">Records</p>
        <p style={{ color: "var(--text-secondary)" }}>{figures.recordCounts.sales} sale{figures.recordCounts.sales === 1 ? "" : "s"} · {figures.recordCounts.purchases} purchase{figures.recordCounts.purchases === 1 ? "" : "s"} · {figures.recordCounts.expenses} expense{figures.recordCounts.expenses === 1 ? "" : "s"} · {figures.recordCounts.payouts} payout{figures.recordCounts.payouts === 1 ? "" : "s"}</p>
      </section>
    </>
  );
}

function IssueGroup({ title, issues, tone }: { title: string; issues: DataQualityIssue[]; tone: "risk" | "default" | "muted" }) {
  if (issues.length === 0) return null;
  const color = tone === "risk" ? "#FF7D7D" : tone === "muted" ? "var(--text-muted)" : "inherit";
  return (<div style={{ marginBottom: 16 }}><p style={{ color, fontWeight: 600, marginBottom: 6 }}>{title}</p><ul style={{ paddingLeft: 18 }}>{issues.map((issue) => (<li key={issue.label} style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{issue.label}</li>))}</ul></div>);
}

function HistoricalDataCheckTab({ readiness }: { readiness: Readiness }) {
  const feeIssue = readiness.review.find((i) => i.label.includes("identical sale and payout"));
  return (
    <section className="table-card" style={{ padding: 20 }}>
      <p className="section-tag">Historical Data Check</p>
      <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
        Records that existed before this feature could capture a date, or whose fee breakdown isn&apos;t available from the source. These are account-wide — not specific to the period you have open — because a record with no date could plausibly belong to any period.
      </p>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 600, color: readiness.unassignedPurchaseCount > 0 ? "#FF7D7D" : "#67F0A5" }}>Purchase dates missing</p>
        <p style={{ color: "var(--text-secondary)" }}>{readiness.unassignedPurchaseCount} record{readiness.unassignedPurchaseCount === 1 ? "" : "s"} · {formatCurrency(readiness.unassignedPurchaseCost)} purchase cost</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 600, color: readiness.unassignedSaleCount > 0 ? "#FF7D7D" : "#67F0A5" }}>Sale dates missing</p>
        <p style={{ color: "var(--text-secondary)" }}>{readiness.unassignedSaleCount} record{readiness.unassignedSaleCount === 1 ? "" : "s"} · {formatCurrency(readiness.unassignedIncomeAmount)} revenue</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 600, color: feeIssue ? "#FFB84F" : "#67F0A5" }}>Fee information incomplete</p>
        <p style={{ color: "var(--text-secondary)" }}>{feeIssue?.count ?? 0} sale{(feeIssue?.count ?? 0) === 1 ? "" : "s"} — marketplace fee not confirmed (identical sale/payout amount, or source only supplied a net figure)</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 600, color: "var(--text-muted)" }}>Supporting evidence unavailable<Info text="Low priority — a missing receipt doesn't mean the financial data is wrong." /></p>
        <p style={{ color: "var(--text-secondary)" }}>{readiness.evidenceRecordCount} record{readiness.evidenceRecordCount === 1 ? "" : "s"} have no original email captured</p>
      </div>

      {(readiness.unassignedPurchaseCount > 0 || readiness.unassignedSaleCount > 0) && (
        <div style={{ marginTop: 20, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>Why?</p>
          <p style={{ color: "var(--text-secondary)" }}>
            These records were imported before TixTracker stored a purchase or sale date for every transaction. Their cost/revenue is still preserved exactly as recorded — nothing has been lost or discarded. They haven&apos;t been assigned to a tax year because TixTracker will not guess a transaction date; event dates and import timestamps are deliberately never used as a substitute.
          </p>
        </div>
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>
        A bulk repair workflow (search/filter, multi-select, set dates or assign a period with the date explicitly marked unavailable) and a CSV-based repair tool are planned but not built yet — fixing these currently means editing the individual ticket/sale in Orders or Sales.
      </p>
    </section>
  );
}

function ReviewTab({ readiness }: { readiness: Readiness }) {
  const noneCritical = readiness.critical.length === 0 && readiness.review.length === 0;
  return (
    <section className="table-card" style={{ padding: 20 }}>
      <p className="section-tag">Records Check</p>
      <p style={{ marginBottom: 12 }}>{readinessLine(readiness)}</p>
      {readiness.blockingReasons.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, border: "1px solid rgba(255,125,125,0.4)", borderRadius: 8 }}>
          <p style={{ color: "#FF7D7D", fontWeight: 600, marginBottom: 6 }}>This period can&apos;t be marked Ready for Accountant until:</p>
          <ul style={{ paddingLeft: 18 }}>{readiness.blockingReasons.map((r) => <li key={r} style={{ color: "var(--text-secondary)" }}>{r}</li>)}</ul>
        </div>
      )}
      {noneCritical ? <p style={{ color: "#67F0A5", marginBottom: 16 }}>✓ No critical or review issues found for this period.</p> : (
        <>
          <IssueGroup title="Critical — these can change your totals" issues={readiness.critical} tone="risk" />
          <IssueGroup title="Review — worth a second look" issues={readiness.review} tone="default" />
        </>
      )}
      <IssueGroup title="Supporting evidence — minor, doesn't affect readiness much" issues={readiness.evidence} tone="muted" />
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>Jumping straight to the exact affected tickets/sales from each issue is coming in the next phase.</p>
    </section>
  );
}

function AccountantPackTab({ figures, readiness, year, onMarkSent, onMarkFiled }: { figures: OverviewFigures; readiness: Readiness; year: YearCard; onMarkSent: () => void; onMarkFiled: () => void }) {
  return (
    <section className="table-card" style={{ padding: 24 }}>
      <p className="section-tag">Accountant Pack</p>
      <h3>{year.entityDisplayName} — {year.period.shortLabel}</h3>
      <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
        Complete the highlighted accounting checks before generating your final pack. Exporting is deliberately held back until entity setup, historical data repair, the transactions ledger, refund handling, fee semantics and period-end inventory are all reliable — a pack built on top of unresolved data would mislead your accountant more than it would help them.
      </p>

      <div style={{ marginTop: 16 }}>
        <p style={{ fontWeight: 600, color: readiness.criticalRecordCount > 0 ? "#FF7D7D" : "#67F0A5" }}>{readiness.criticalRecordCount} critical issue{readiness.criticalRecordCount === 1 ? "" : "s"} in this period</p>
        <p style={{ fontWeight: 600, color: readiness.historicalCoverageComplete ? "#67F0A5" : "#FFB84F" }}>{readiness.unassignedPurchaseCount + readiness.unassignedSaleCount} unassigned historic record{readiness.unassignedPurchaseCount + readiness.unassignedSaleCount === 1 ? "" : "s"} account-wide</p>
        <p style={{ color: "var(--text-secondary)" }}>{readiness.reviewRecordCount} review item{readiness.reviewRecordCount === 1 ? "" : "s"} · {readiness.evidenceRecordCount} evidence warning{readiness.evidenceRecordCount === 1 ? "" : "s"} (low priority)</p>
      </div>

      <div className="command-grid" style={{ marginTop: 16 }}>
        <Row label="Assigned income (this period)" value={figures.income} />
        <Row label="Assigned purchase cost (this period)" value={figures.ticketPurchases} />
      </div>

      <p style={{ color: "var(--text-secondary)", marginTop: 12 }}>Period: {fmtDate(year.period.start)} – {fmtDate(year.period.end)}. A future export will only ever include {year.entityDisplayName} transactions inside this exact range — never mixed with another entity&apos;s accounts.</p>

      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <button type="button" className="secondary-button" onClick={onMarkSent}>Mark Sent to Accountant</button>
        <button type="button" className="secondary-button" onClick={onMarkFiled}>Mark Filed</button>
      </div>
    </section>
  );
}

function EntityList({ entities, onChanged }: { entities: Entity[]; onChanged: () => void }) {
  async function remove(id: number) {
    await fetch(`/api/tax-accounts/entities?id=${id}`, { method: "DELETE" });
    onChanged();
  }
  return (
    <section className="table-card" style={{ padding: 24, marginTop: 16 }}>
      <p className="section-tag">Business Entity History</p>
      <h4>Which legal entity owned which period</h4>
      <p style={{ color: "var(--text-secondary)", margin: "8px 0 16px" }}>This determines which tax year rules apply to each transaction, by its own date — never by whatever your current business type is.</p>
      {entities.map((e) => (
        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
          <div>
            <strong>{e.display_name}</strong>
            <span style={{ color: "var(--text-secondary)", marginLeft: 10 }}>{fmtEffectiveFrom(e.effective_from)} – {e.effective_to ?? "ongoing"}</span>
            {e.entity_type === "limited_company" && e.accounting_reference_date && <span style={{ color: "var(--text-muted)", marginLeft: 10 }}>ARD: {e.accounting_reference_date}</span>}
          </div>
          <button type="button" className="secondary-button" onClick={() => void remove(e.id)}>Remove</button>
        </div>
      ))}
    </section>
  );
}

function EntityHistorySetup({ profile, onCreate, onDone }: { profile: Profile; onCreate: (p: Record<string, unknown>) => Promise<boolean>; onDone: () => void }) {
  const isLtd = profile.business_structure === "limited_company";
  const [priorStructure, setPriorStructure] = useState<"sole_trader" | "another_ltd" | "none">("sole_trader");
  const [tradingStart, setTradingStart] = useState("");
  const [incorporationDate, setIncorporationDate] = useState("");
  const [ard, setArd] = useState(profile.company_year_end ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    if (isLtd) {
      if (!tradingStart) { setError("When KCX trading started is required — we never guess this."); setSubmitting(false); return; }
      if (!ard) { setError("Accounting reference date (company year end) is required."); setSubmitting(false); return; }

      if (priorStructure === "sole_trader") {
        const priorEnd = new Date(`${tradingStart}T00:00:00Z`);
        priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
        const ok1 = await onCreate({
          entity_type: "sole_trader",
          display_name: "Sole Trader",
          effective_from: OPEN_ENDED_START,
          effective_to: priorEnd.toISOString().slice(0, 10),
          base_currency: "GBP",
        });
        if (!ok1) { setSubmitting(false); return; }
      }

      const ok2 = await onCreate({
        entity_type: "limited_company",
        display_name: profile.company_name || profile.trading_name || "Limited Company",
        company_name: profile.company_name,
        company_number: profile.company_number,
        trading_name: profile.trading_name,
        incorporation_date: incorporationDate || null,
        trading_start_date: tradingStart,
        effective_from: tradingStart,
        effective_to: null,
        accounting_reference_date: ard,
        base_currency: profile.base_currency,
        vat_registered: profile.vat_registered,
        vat_number: profile.vat_number,
      });
      if (!ok2) { setSubmitting(false); return; }
    } else {
      await onCreate({
        entity_type: "sole_trader",
        display_name: profile.trading_name || "Sole Trader",
        trading_name: profile.trading_name,
        effective_from: OPEN_ENDED_START,
        effective_to: null,
        base_currency: profile.base_currency,
        vat_registered: profile.vat_registered,
        vat_number: profile.vat_number,
      });
    }
    setSubmitting(false);
    onDone();
  }

  return (
    <section className="table-card" style={{ padding: 24 }}>
      <p className="section-tag">Complete business history</p>
      <h3>We need to know when this business changed structure</h3>
      <p style={{ color: "var(--text-secondary)", margin: "8px 0 16px" }}>This ensures historical accounts are assigned to the right legal entity — we never assign older transactions to your current business type automatically.</p>

      {isLtd ? (
        <>
          <div className="command-grid">
            <label className="filter-field">
              <span className="filter-label">Before {profile.company_name || "your company"}, how were you trading?</span>
              <select className="field" value={priorStructure} onChange={(e) => setPriorStructure(e.target.value as typeof priorStructure)}>
                <option value="sole_trader">Sole Trader</option>
                <option value="another_ltd">Another Limited Company</option>
                <option value="none">I was not trading</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">When did {profile.company_name || "the company"} start trading?<Info text="Not necessarily the same as the incorporation date — this is when it actually started trading/taking transactions." /></span>
              <input className="field" type="date" value={tradingStart} onChange={(e) => setTradingStart(e.target.value)} required />
            </label>
            <label className="filter-field">
              <span className="filter-label">Incorporation date (optional)</span>
              <input className="field" type="date" value={incorporationDate} onChange={(e) => setIncorporationDate(e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">Accounting reference date (company year end)<Info text="The date already on file is 2027-04-04 — confirm or correct it. This is never silently changed." /></span>
              <input className="field" type="date" value={ard} onChange={(e) => setArd(e.target.value)} required />
            </label>
          </div>
          {priorStructure === "another_ltd" && <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>You can add the prior company as a separate entity afterwards from Settings.</p>}
        </>
      ) : (
        <p style={{ color: "var(--text-secondary)" }}>Your business is set up as a Sole Trader — we&apos;ll track your full history under standard UK tax years (6 April – 5 April).</p>
      )}

      {error && <p style={{ color: "#FF7D7D", marginTop: 12 }}>{error}</p>}
      <button type="button" className="primary-button" style={{ marginTop: 20 }} disabled={submitting} onClick={() => void submit()}>{submitting ? "Saving…" : "Save business history"}</button>
    </section>
  );
}

function SetupForm({ form, setForm, isLimitedCompany, saving, onSave, isSettingsMode }: { form: Profile; setForm: React.Dispatch<React.SetStateAction<Profile>>; isLimitedCompany: boolean; saving: boolean; onSave: () => void; isSettingsMode?: boolean }) {
  function set<K extends keyof Profile>(key: K, value: Profile[K]) { setForm((f) => ({ ...f, [key]: value })); }
  return (
    <section className="table-card" style={{ padding: 24 }}>
      <div className="table-card-header"><div><p className="section-tag">{isSettingsMode ? "Business Settings" : "Set up Tax & Accounts"}</p><h4>{isSettingsMode ? "Business & tax settings" : "A few details before we start tracking"}</h4></div></div>
      <div className="command-grid">
        <label className="filter-field"><span className="filter-label">Business structure</span><select className="field" value={form.business_structure} onChange={(e) => set("business_structure", e.target.value as BusinessStructure)}><option value="sole_trader">Sole Trader</option><option value="limited_company">Limited Company</option></select></label>
        <label className="filter-field"><span className="filter-label">Country</span><select className="field" value={form.country} onChange={(e) => set("country", e.target.value)}><option value="GB">United Kingdom</option></select></label>
        <label className="filter-field"><span className="filter-label">Base accounting currency</span><select className="field" value={form.base_currency} onChange={(e) => set("base_currency", e.target.value)}><option value="GBP">GBP</option></select></label>
        {!isLimitedCompany && (
          <label className="filter-field"><span className="filter-label">Accounting basis<Info text="Cash Basis: income/expenses recorded when money actually moves. Traditional Accounting: recorded when invoiced/incurred." /></span>
            <select className="field" value={form.accounting_basis ?? "cash"} onChange={(e) => set("accounting_basis", e.target.value as AccountingBasis)}><option value="cash">Cash Basis</option><option value="traditional">Traditional Accounting</option></select>
          </label>
        )}
      </div>
      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field"><span className="filter-label">Trading name</span><input className="field" value={form.trading_name ?? ""} onChange={(e) => set("trading_name", e.target.value)} /></label>
        {isLimitedCompany && (<>
          <label className="filter-field"><span className="filter-label">Limited company name</span><input className="field" value={form.company_name ?? ""} onChange={(e) => set("company_name", e.target.value)} /></label>
          <label className="filter-field"><span className="filter-label">Company number</span><input className="field" value={form.company_number ?? ""} onChange={(e) => set("company_number", e.target.value)} /></label>
          <label className="filter-field"><span className="filter-label">Company financial year end</span><input className="field" type="date" value={form.company_year_end ?? ""} onChange={(e) => set("company_year_end", e.target.value)} /></label>
        </>)}
        <label className="filter-field"><span className="filter-label">UTR (optional)</span><input className="field" value={form.utr ?? ""} onChange={(e) => set("utr", e.target.value)} placeholder="Not required to use this feature" /></label>
      </div>
      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field"><span className="filter-label">VAT registered?</span><select className="field" value={form.vat_registered ? "yes" : "no"} onChange={(e) => set("vat_registered", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
        {form.vat_registered && (<>
          <label className="filter-field"><span className="filter-label">VAT registration date</span><input className="field" type="date" value={form.vat_registration_date ?? ""} onChange={(e) => set("vat_registration_date", e.target.value)} /></label>
          <label className="filter-field"><span className="filter-label">VAT number</span><input className="field" value={form.vat_number ?? ""} onChange={(e) => set("vat_number", e.target.value)} /></label>
          <label className="filter-field"><span className="filter-label">VAT scheme</span><input className="field" value={form.vat_scheme ?? ""} onChange={(e) => set("vat_scheme", e.target.value)} placeholder="e.g. Standard, Flat Rate" /></label>
        </>)}
      </div>
      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field"><span className="filter-label">Accountant name</span><input className="field" value={form.accountant_name ?? ""} onChange={(e) => set("accountant_name", e.target.value)} /></label>
        <label className="filter-field"><span className="filter-label">Accountant email</span><input className="field" type="email" value={form.accountant_email ?? ""} onChange={(e) => set("accountant_email", e.target.value)} /></label>
        <label className="filter-field"><span className="filter-label">Tax reserve %<Info text="A cash-management guide only." /></span><input className="field" type="number" min="0" max="100" value={form.tax_reserve_percent} onChange={(e) => set("tax_reserve_percent", Number(e.target.value))} /></label>
        {isLimitedCompany && <label className="filter-field"><span className="filter-label">Associated companies</span><input className="field" type="number" min="0" value={form.associated_companies} onChange={(e) => set("associated_companies", Number(e.target.value))} /></label>}
      </div>
      <div className="command-grid" style={{ marginTop: 16 }}><label className="filter-field" style={{ gridColumn: "1 / -1" }}><span className="filter-label">Internal notes (optional)</span><input className="field" value={form.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} /></label></div>
      <button type="button" className="primary-button" style={{ marginTop: 20 }} disabled={saving} onClick={onSave}>{saving ? "Saving…" : isSettingsMode ? "Save settings" : "Set up Tax & Accounts"}</button>
    </section>
  );
}
