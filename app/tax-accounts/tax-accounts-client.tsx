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
  business_structure: "sole_trader",
  country: "GB",
  base_currency: "GBP",
  accounting_basis: "cash",
  trading_name: "",
  company_name: "",
  company_number: "",
  company_year_end: "",
  vat_registered: false,
  vat_registration_date: "",
  vat_number: "",
  vat_scheme: "",
  utr: "",
  accountant_name: "",
  accountant_email: "",
  tax_reserve_percent: 25,
  associated_companies: 0,
  internal_notes: "",
  setup_completed: false,
};

type PeriodRange = { kind: string; label: string; shortLabel: string; start: string; end: string };

type OverviewFigures = {
  income: number;
  costOfSales: number;
  ticketPurchases: number;
  marketplaceFees: number;
  runningCosts: number;
  refunds: number;
  estimatedProfit: number;
  unsoldInventoryCost: number;
  expiredUnsoldStockCost: number;
  cashReceived: number;
  pendingPayoutCount: number;
  salesWithUnknownFees: number;
  recordCounts: { sales: number; purchases: number; expenses: number; payouts: number };
  refundsTrackedNote: string;
};

type DataQualityIssue = { severity: "critical" | "review" | "evidence"; label: string; count: number; orderIds: number[] };
type DataQualityResult = { score: number; critical: DataQualityIssue[]; review: DataQualityIssue[]; evidence: DataQualityIssue[]; totalChecked: number };

type YearCard = {
  period: PeriodRange;
  isCurrent: boolean;
  ended: boolean;
  status: string;
  readinessScore: number;
  criticalCount: number;
  income: number;
  estimatedProfit: number;
  selfAssessmentDeadline: string | null;
};

type Tab = "overview" | "review" | "transactions" | "accountant-pack" | "settings";

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In Progress",
  needs_review: "Needs Review",
  ready_for_accountant: "Ready for Accountant",
  sent_to_accountant: "Sent to Accountant",
  filed: "Filed",
};

function Info({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.12)",
        fontSize: 10, color: "var(--text-secondary)", cursor: "help", marginLeft: 6,
      }}
    >
      i
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export default function TaxAccountsClient() {
  useRatesReady();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [years, setYears] = useState<YearCard[]>([]);
  const [yearsLoading, setYearsLoading] = useState(false);
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);

  const [figures, setFigures] = useState<OverviewFigures | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQualityResult | null>(null);
  const [accountingBasis, setAccountingBasis] = useState<AccountingBasis>("cash");
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => { void loadProfile(); }, []);

  useEffect(() => {
    if (profile?.setup_completed) void loadYears();
     
  }, [profile?.setup_completed]);

  // Default to the most urgent year: a previous year that's ended and not
  // yet finished, if its deadline is within the next ~10 months (filing
  // season); otherwise the current year.
  useEffect(() => {
    if (years.length === 0 || selectedOffset != null) return;
    const urgentPrevious = years.find(
      (y) => !y.isCurrent && y.ended && !["sent_to_accountant", "filed"].includes(y.status) && y.selfAssessmentDeadline && daysUntil(y.selfAssessmentDeadline) < 300,
    );
    const target = urgentPrevious ?? years.find((y) => y.isCurrent) ?? years[0];
    if (target) setSelectedOffset(years.indexOf(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years]);

  useEffect(() => {
    if (selectedOffset == null || years.length === 0) return;
    const y = years[selectedOffset];
    if (y) void loadOverview(y.period);
     
  }, [selectedOffset, years]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadProfile() {
    setLoading(true);
    try {
      const res = await fetch("/api/tax-accounts/profile");
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        setForm({ ...EMPTY_PROFILE, ...data.profile });
      } else {
        setProfile(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(markComplete: boolean) {
    setSaving(true);
    setMessage("");
    try {
      const payload = { ...form, setup_completed: markComplete || form.setup_completed };
      const res = await fetch("/api/tax-accounts/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
      } else {
        setProfile(data.profile);
        setForm({ ...EMPTY_PROFILE, ...data.profile });
        setMessage(markComplete ? "Tax & Accounts is set up." : "Saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function loadYears() {
    setYearsLoading(true);
    try {
      const res = await fetch("/api/tax-accounts/years");
      const data = await res.json();
      if (data.years) setYears(data.years);
    } finally {
      setYearsLoading(false);
    }
  }

  async function loadOverview(p: PeriodRange) {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const params = new URLSearchParams({ kind: p.kind, start: p.start, end: p.end });
      // uk_tax_year / company_fy are resolved server-side by offset; since we
      // already know the exact dates, ask via custom to avoid re-deriving offset.
      const useKind = p.kind === "uk_tax_year" || p.kind === "company_fy" ? "custom" : p.kind;
      params.set("kind", useKind);
      const res = await fetch(`/api/tax-accounts/overview?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setOverviewError(data.error);
        setFigures(null);
        setDataQuality(null);
      } else {
        setFigures(data.figures);
        setDataQuality(data.dataQuality);
        setAccountingBasis(data.accountingBasis);
      }
    } finally {
      setOverviewLoading(false);
    }
  }

  async function setYearStatus(y: YearCard, status: string) {
    await fetch("/api/tax-accounts/year-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodKind: y.period.kind, periodStart: y.period.start, periodEnd: y.period.end, status }),
    });
    void loadYears();
  }

  const isLimitedCompany = form.business_structure === "limited_company";
  const yearNoun = isLimitedCompany ? "Accounting Year" : "Tax Year";

  const selectedYear = selectedOffset != null ? years[selectedOffset] : null;

  const filingBanner = useMemo(() => {
    return years.find(
      (y) => !y.isCurrent && y.ended && !["sent_to_accountant", "filed"].includes(y.status) && y.selfAssessmentDeadline && daysUntil(y.selfAssessmentDeadline) < 300 && daysUntil(y.selfAssessmentDeadline) > -60,
    );
  }, [years]);

  if (loading) {
    return (
      <div className="orders-shell">
        <aside className="orders-sidebar">
          <div><SidebarLogo /><nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`} target={item.target} rel={item.rel}>
                <NavIcon href={item.href} /><span>{item.label}</span>
              </Link>
            ))}
          </nav></div>
          <SidebarFooter onLogout={handleLogout} />
        </aside>
        <main className="orders-main">
          <p style={{ padding: 24, color: "var(--text-secondary)" }}>Loading…</p>
        </main>
      </div>
    );
  }

  const needsSetup = !profile || !profile.setup_completed;

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className={`nav-item${item.active ? " nav-item-active" : ""}`} target={item.target} rel={item.rel}>
                <NavIcon href={item.href} /><span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Finance</p>
            <h2>Tax &amp; Accounts</h2>
          </div>
        </header>

        {message && <div className="feedback-banner">{message}</div>}

        {needsSetup ? (
          <SetupForm form={form} setForm={setForm} isLimitedCompany={isLimitedCompany} saving={saving} onSave={() => void saveProfile(true)} />
        ) : (
          <>
            {filingBanner && filingBanner.period.shortLabel !== selectedYear?.period.shortLabel && (
              <section className="feedback-banner" style={{ cursor: "pointer" }} onClick={() => setSelectedOffset(years.indexOf(filingBanner))}>
                <strong>{filingBanner.period.shortLabel} Self Assessment</strong> — deadline {filingBanner.selfAssessmentDeadline ? fmtDate(filingBanner.selfAssessmentDeadline) : ""}.
                Your records are {filingBanner.readinessScore}% ready. <span style={{ textDecoration: "underline" }}>Finish {filingBanner.period.shortLabel}</span>
              </section>
            )}

            <section className="hero-card">
              <div style={{ width: "100%" }}>
                <p className="section-tag">{yearNoun}</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className="field"
                    style={{ fontSize: 18, fontWeight: 600, maxWidth: 260 }}
                    value={selectedOffset ?? ""}
                    onChange={(e) => setSelectedOffset(Number(e.target.value))}
                  >
                    {years.map((y, i) => (
                      <option key={y.period.shortLabel} value={i}>
                        {y.period.shortLabel}{y.isCurrent ? " — In Progress" : ""}
                      </option>
                    ))}
                  </select>
                  {selectedYear && (
                    <span style={{ color: "var(--text-secondary)" }}>
                      {fmtDate(selectedYear.period.start)} – {fmtDate(selectedYear.period.end)}
                    </span>
                  )}
                  {selectedYear && (
                    <span
                      className="kpi-trend"
                      style={{
                        padding: "2px 10px", borderRadius: 999,
                        background: selectedYear.status === "filed" || selectedYear.status === "sent_to_accountant" ? "rgba(103,240,165,0.15)" : selectedYear.status === "ready_for_accountant" ? "rgba(79,195,255,0.15)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      {STATUS_LABEL[selectedYear.status] ?? selectedYear.status}
                    </span>
                  )}
                </div>
                {selectedYear?.selfAssessmentDeadline && (
                  <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
                    Self Assessment deadline <strong>{fmtDate(selectedYear.selfAssessmentDeadline)}</strong>
                  </p>
                )}
                <p style={{ color: "var(--text-muted)", marginTop: 8, fontSize: 13 }}>
                  Accounting method: <strong>{accountingBasis === "cash" ? "Cash Basis" : "Traditional Accounting"}</strong>
                  <Info text={accountingBasis === "cash"
                    ? "Income is included when payment was actually received and expenses when they were actually paid. Event dates never determine the tax year."
                    : "Income and expenses are recognised at the transaction/invoice date, following standard accounting treatment. Event dates never determine the tax year."} />
                  {" · "}
                  <Link href="#settings" onClick={() => setActiveTab("settings")} style={{ textDecoration: "underline" }}>Change</Link>
                </p>
              </div>
            </section>

            {years.length > 1 && (
              <section className="kpi-grid" style={{ gridTemplateColumns: `repeat(${Math.min(years.length, 4)}, 1fr)` }}>
                {years.slice(0, 4).map((y, i) => (
                  <article
                    key={y.period.shortLabel}
                    className="kpi-card"
                    style={{ cursor: "pointer", outline: i === selectedOffset ? "2px solid var(--accent-pink)" : "none" }}
                    onClick={() => setSelectedOffset(i)}
                  >
                    <p className="kpi-label">{y.period.shortLabel}{y.isCurrent ? " (current)" : ""}</p>
                    <strong className="kpi-value">{y.readinessScore}% ready</strong>
                    <span className="kpi-trend">{formatCurrency(y.income)} income{y.criticalCount > 0 ? ` · ${y.criticalCount} issue${y.criticalCount === 1 ? "" : "s"}` : ""}</span>
                  </article>
                ))}
              </section>
            )}

            <section className="table-card" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 16px" }}>
              {([
                { id: "overview", label: "Overview" },
                { id: "review", label: `Review${dataQuality ? ` (${dataQuality.critical.length + dataQuality.review.length})` : ""}` },
                { id: "transactions", label: "Transactions" },
                { id: "accountant-pack", label: "Accountant Pack" },
                { id: "settings", label: "Settings" },
              ] as { id: Tab; label: string }[]).map((t) => (
                <button key={t.id} type="button" className={t.id === activeTab ? "primary-button" : "secondary-button"} onClick={() => setActiveTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </section>

            {overviewError && <div className="feedback-banner">{overviewError}</div>}
            {(overviewLoading || yearsLoading) && <p style={{ padding: 16, color: "var(--text-secondary)" }}>Calculating…</p>}

            {!overviewLoading && activeTab === "overview" && figures && dataQuality && selectedYear && (
              <OverviewTab figures={figures} dataQuality={dataQuality} year={selectedYear} taxReservePercent={form.tax_reserve_percent} onReview={() => setActiveTab("review")} />
            )}

            {!overviewLoading && activeTab === "review" && dataQuality && (
              <ReviewTab dataQuality={dataQuality} />
            )}

            {activeTab === "transactions" && (
              <ComingSoon title="Transactions" body="A universal, filterable ledger across purchases, sales, expenses, payouts, refunds and director transactions is coming in the next phase." />
            )}

            {!overviewLoading && activeTab === "accountant-pack" && figures && dataQuality && selectedYear && (
              <AccountantPackTab figures={figures} dataQuality={dataQuality} year={selectedYear} onMarkSent={() => void setYearStatus(selectedYear, "sent_to_accountant")} onMarkFiled={() => void setYearStatus(selectedYear, "filed")} />
            )}

            {activeTab === "settings" && (
              <SetupForm form={form} setForm={setForm} isLimitedCompany={isLimitedCompany} saving={saving} onSave={() => void saveProfile(false)} isSettingsMode />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <section className="table-card" style={{ padding: 32, textAlign: "center" }}>
      <p className="section-tag">{title}</p>
      <p style={{ color: "var(--text-secondary)", maxWidth: 520, margin: "8px auto 0" }}>{body}</p>
    </section>
  );
}

function OverviewTab({
  figures, dataQuality, year, taxReservePercent, onReview,
}: {
  figures: OverviewFigures;
  dataQuality: DataQualityResult;
  year: YearCard;
  taxReservePercent: number;
  onReview: () => void;
}) {
  const criticalCount = dataQuality.critical.reduce((s, i) => s + i.count, 0);
  const taxReserve = Math.max(0, figures.estimatedProfit) * (taxReservePercent / 100);

  return (
    <>
      <section className="table-card" style={{ padding: 20 }}>
        <div className="table-card-header">
          <div>
            <p className="section-tag">Accountant Readiness</p>
            <h4 style={{ color: dataQuality.score >= 90 ? "#67F0A5" : dataQuality.score >= 70 ? "inherit" : "#FF7D7D" }}>
              {dataQuality.score}% Ready
            </h4>
          </div>
          <button type="button" className="secondary-button" onClick={onReview}>
            {criticalCount > 0 ? `Review ${criticalCount} Issue${criticalCount === 1 ? "" : "s"}` : "Review"}
          </button>
        </div>
        {criticalCount === 0 ? (
          <p style={{ color: "#67F0A5" }}>✓ No critical issues found for {year.period.shortLabel}.</p>
        ) : (
          <p style={{ color: "var(--text-secondary)" }}>{criticalCount} important issue{criticalCount === 1 ? "" : "s"} could affect your totals — see Review.</p>
        )}
        {dataQuality.evidence.length > 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>
            {dataQuality.evidence.reduce((s, i) => s + i.count, 0)} records have no attached evidence — this barely affects readiness and is normal for historic/imported data.
          </p>
        )}
      </section>

      <section className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="kpi-card">
          <p className="kpi-label">Income<Info text="Money recognised as business income for this period, based on your configured accounting method." /></p>
          <strong className="kpi-value">{formatCurrency(figures.income)}</strong>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Business Costs<Info text="Ticket purchase costs for tickets sold, marketplace fees and running costs, all for this period." /></p>
          <strong className="kpi-value">{formatCurrency(figures.costOfSales + figures.marketplaceFees + figures.runningCosts)}</strong>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Estimated Profit<Info text="Income minus Business Costs and Refunds. An estimate — your accountant calculates the final figure." /></p>
          <strong className="kpi-value" style={{ color: figures.estimatedProfit >= 0 ? "#67F0A5" : "#FF7D7D" }}>{formatCurrency(figures.estimatedProfit)}</strong>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Suggested Tax Reserve<Info text="A cash-management guide only, based on your configured reserve percentage. Not a calculation of what you owe HMRC." /></p>
          <strong className="kpi-value">{formatCurrency(taxReserve)}</strong>
          <span className="kpi-trend">{taxReservePercent}% of estimated profit</span>
        </article>
      </section>

      <section className="table-card" style={{ padding: 20 }}>
        <p className="section-tag">Breakdown</p>
        <div className="command-grid">
          <Row label="Ticket purchases" value={figures.ticketPurchases} />
          <Row label="Marketplace fees" value={figures.marketplaceFees} />
          <Row label="Running costs" value={figures.runningCosts} />
          <Row label="Refunds" value={figures.refunds} note={figures.refunds === 0 ? figures.refundsTrackedNote : undefined} />
        </div>
        {(figures.unsoldInventoryCost > 0 || figures.expiredUnsoldStockCost > 0) && (
          <div className="command-grid" style={{ marginTop: 12 }}>
            <Row label="Unsold ticket inventory (not yet past event)" value={figures.unsoldInventoryCost} />
            {figures.expiredUnsoldStockCost > 0 && (
              <Row label="Unresolved stock (event already passed, never sold)" value={figures.expiredUnsoldStockCost} tone="risk" />
            )}
          </div>
        )}
        {figures.pendingPayoutCount > 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>
            {figures.pendingPayoutCount} sale{figures.pendingPayoutCount === 1 ? "" : "s"} awaiting payout — not yet counted as income under Cash Basis until the money actually arrives.
          </p>
        )}
      </section>

      <section className="table-card" style={{ padding: 20 }}>
        <p className="section-tag">Records</p>
        <p style={{ color: "var(--text-secondary)" }}>
          {figures.recordCounts.sales} sale{figures.recordCounts.sales === 1 ? "" : "s"} · {figures.recordCounts.purchases} purchase{figures.recordCounts.purchases === 1 ? "" : "s"} · {figures.recordCounts.expenses} expense{figures.recordCounts.expenses === 1 ? "" : "s"} · {figures.recordCounts.payouts} payout{figures.recordCounts.payouts === 1 ? "" : "s"}
        </p>
      </section>
    </>
  );
}

function Row({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: "risk" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}{note && <Info text={note} />}</span>
      <strong style={{ color: tone === "risk" ? "#FF7D7D" : "inherit" }}>{formatCurrency(value)}</strong>
    </div>
  );
}

function IssueGroup({ title, issues, tone }: { title: string; issues: DataQualityIssue[]; tone: "risk" | "default" | "muted" }) {
  if (issues.length === 0) return null;
  const color = tone === "risk" ? "#FF7D7D" : tone === "muted" ? "var(--text-muted)" : "inherit";
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ color, fontWeight: 600, marginBottom: 6 }}>{title}</p>
      <ul style={{ paddingLeft: 18 }}>
        {issues.map((issue) => (
          <li key={issue.label} style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{issue.label}</li>
        ))}
      </ul>
    </div>
  );
}

function ReviewTab({ dataQuality }: { dataQuality: DataQualityResult }) {
  const noCritical = dataQuality.critical.length === 0;
  const noReview = dataQuality.review.length === 0;

  return (
    <section className="table-card" style={{ padding: 20 }}>
      <p className="section-tag">Records Check</p>
      {noCritical && noReview ? (
        <p style={{ color: "#67F0A5", marginBottom: 16 }}>✓ No critical or review issues found for this period.</p>
      ) : (
        <>
          <IssueGroup title="Critical — these can change your totals" issues={dataQuality.critical} tone="risk" />
          <IssueGroup title="Review — worth a second look" issues={dataQuality.review} tone="default" />
        </>
      )}
      <IssueGroup title="Supporting evidence — minor, doesn't affect readiness much" issues={dataQuality.evidence} tone="muted" />

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>
        Jumping straight to the exact affected tickets/sales from each issue is coming in the next phase — for now, check the Tickets/Sales pages using the counts above as a guide.
      </p>
    </section>
  );
}

function AccountantPackTab({
  figures, dataQuality, year, onMarkSent, onMarkFiled,
}: {
  figures: OverviewFigures;
  dataQuality: DataQualityResult;
  year: YearCard;
  onMarkSent: () => void;
  onMarkFiled: () => void;
}) {
  const criticalCount = dataQuality.critical.reduce((s, i) => s + i.count, 0);
  return (
    <section className="table-card" style={{ padding: 24 }}>
      <p className="section-tag">Ready to Create Accountant Pack</p>
      <h3>Your {year.period.shortLabel} accounts</h3>
      <div className="command-grid" style={{ marginTop: 16 }}>
        <Row label="Income" value={figures.income} />
        <Row label="Business Costs" value={figures.costOfSales + figures.marketplaceFees + figures.runningCosts} />
        <Row label="Estimated Profit" value={figures.estimatedProfit} />
      </div>
      <p style={{ marginTop: 16, color: criticalCount > 0 ? "#FF7D7D" : "#67F0A5" }}>
        {criticalCount > 0 ? `${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} outstanding` : "No critical issues outstanding"}
      </p>
      <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
        Period: {fmtDate(year.period.start)} – {fmtDate(year.period.end)}. Only transactions inside this exact range are included — nothing from another tax year leaks in.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <button type="button" className="primary-button" disabled>
          Export (Excel/ZIP) — coming in the next phase
        </button>
        <button type="button" className="secondary-button" onClick={onMarkSent}>Mark Sent to Accountant</button>
        <button type="button" className="secondary-button" onClick={onMarkFiled}>Mark Filed</button>
      </div>
    </section>
  );
}

function SetupForm({
  form, setForm, isLimitedCompany, saving, onSave, isSettingsMode,
}: {
  form: Profile;
  setForm: React.Dispatch<React.SetStateAction<Profile>>;
  isLimitedCompany: boolean;
  saving: boolean;
  onSave: () => void;
  isSettingsMode?: boolean;
}) {
  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <section className="table-card" style={{ padding: 24 }}>
      <div className="table-card-header">
        <div>
          <p className="section-tag">{isSettingsMode ? "Business Settings" : "Set up Tax & Accounts"}</p>
          <h4>{isSettingsMode ? "Business & tax settings" : "A few details before we start tracking"}</h4>
        </div>
      </div>

      <div className="command-grid">
        <label className="filter-field">
          <span className="filter-label">Business structure</span>
          <select className="field" value={form.business_structure} onChange={(e) => set("business_structure", e.target.value as BusinessStructure)}>
            <option value="sole_trader">Sole Trader</option>
            <option value="limited_company">Limited Company</option>
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-label">Country</span>
          <select className="field" value={form.country} onChange={(e) => set("country", e.target.value)}>
            <option value="GB">United Kingdom</option>
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-label">Base accounting currency</span>
          <select className="field" value={form.base_currency} onChange={(e) => set("base_currency", e.target.value)}>
            <option value="GBP">GBP</option>
          </select>
        </label>

        {!isLimitedCompany && (
          <label className="filter-field">
            <span className="filter-label">
              Accounting basis
              <Info text="Cash Basis: income/expenses recorded when money actually moves. Traditional Accounting: recorded when invoiced/incurred. Most small sole traders use Cash Basis — confirm with your accountant." />
            </span>
            <select className="field" value={form.accounting_basis ?? "cash"} onChange={(e) => set("accounting_basis", e.target.value as AccountingBasis)}>
              <option value="cash">Cash Basis</option>
              <option value="traditional">Traditional Accounting</option>
            </select>
          </label>
        )}
      </div>

      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field">
          <span className="filter-label">Trading name</span>
          <input className="field" value={form.trading_name ?? ""} onChange={(e) => set("trading_name", e.target.value)} />
        </label>

        {isLimitedCompany && (
          <>
            <label className="filter-field">
              <span className="filter-label">Limited company name</span>
              <input className="field" value={form.company_name ?? ""} onChange={(e) => set("company_name", e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">Company number</span>
              <input className="field" value={form.company_number ?? ""} onChange={(e) => set("company_number", e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">Company financial year end</span>
              <input className="field" type="date" value={form.company_year_end ?? ""} onChange={(e) => set("company_year_end", e.target.value)} />
            </label>
          </>
        )}

        <label className="filter-field">
          <span className="filter-label">UTR (optional)</span>
          <input className="field" value={form.utr ?? ""} onChange={(e) => set("utr", e.target.value)} placeholder="Not required to use this feature" />
        </label>
      </div>

      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field">
          <span className="filter-label">VAT registered?</span>
          <select className="field" value={form.vat_registered ? "yes" : "no"} onChange={(e) => set("vat_registered", e.target.value === "yes")}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        {form.vat_registered && (
          <>
            <label className="filter-field">
              <span className="filter-label">VAT registration date</span>
              <input className="field" type="date" value={form.vat_registration_date ?? ""} onChange={(e) => set("vat_registration_date", e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">VAT number</span>
              <input className="field" value={form.vat_number ?? ""} onChange={(e) => set("vat_number", e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">VAT scheme</span>
              <input className="field" value={form.vat_scheme ?? ""} onChange={(e) => set("vat_scheme", e.target.value)} placeholder="e.g. Standard, Flat Rate" />
            </label>
          </>
        )}
      </div>

      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field">
          <span className="filter-label">Accountant name</span>
          <input className="field" value={form.accountant_name ?? ""} onChange={(e) => set("accountant_name", e.target.value)} />
        </label>
        <label className="filter-field">
          <span className="filter-label">Accountant email</span>
          <input className="field" type="email" value={form.accountant_email ?? ""} onChange={(e) => set("accountant_email", e.target.value)} />
        </label>
        <label className="filter-field">
          <span className="filter-label">
            Tax reserve %
            <Info text="A cash-management guide only — the percentage of profit you set aside for tax. Not a calculation of what you actually owe." />
          </span>
          <input className="field" type="number" min="0" max="100" value={form.tax_reserve_percent} onChange={(e) => set("tax_reserve_percent", Number(e.target.value))} />
        </label>
        {isLimitedCompany && (
          <label className="filter-field">
            <span className="filter-label">Associated companies</span>
            <input className="field" type="number" min="0" value={form.associated_companies} onChange={(e) => set("associated_companies", Number(e.target.value))} />
          </label>
        )}
      </div>

      <div className="command-grid" style={{ marginTop: 16 }}>
        <label className="filter-field" style={{ gridColumn: "1 / -1" }}>
          <span className="filter-label">Internal notes (optional)</span>
          <input className="field" value={form.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} />
        </label>
      </div>

      <button type="button" className="primary-button" style={{ marginTop: 20 }} disabled={saving} onClick={onSave}>
        {saving ? "Saving…" : isSettingsMode ? "Save settings" : "Set up Tax & Accounts"}
      </button>
    </section>
  );
}
