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

type PeriodKind =
  | "uk_tax_year" | "company_fy" | "this_month" | "last_month"
  | "this_quarter" | "year_to_date" | "previous_accounting_year" | "custom";

type PeriodRange = { kind: PeriodKind; label: string; start: string; end: string };

type OverviewFigures = {
  grossSales: number;
  costOfSales: number;
  marketplaceFees: number;
  otherExpenses: number;
  refunds: number;
  netTradingProfit: number;
  unsoldInventoryCost: number;
  cashReceived: number;
  salesWithUnknownFees: number;
  refundsTrackedNote: string;
};

type Readiness = { score: number; issues: { label: string; count: number }[]; totalChecked: number };

type Tab = "overview" | "transactions" | "expenses" | "reconciliation" | "vat" | "documents" | "accountant-pack" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "expenses", label: "Expenses" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "vat", label: "VAT" },
  { id: "documents", label: "Documents" },
  { id: "accountant-pack", label: "Accountant Pack" },
  { id: "settings", label: "Settings" },
];

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

export default function TaxAccountsClient() {
  useRatesReady();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [periodKind, setPeriodKind] = useState<PeriodKind>("uk_tax_year");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [period, setPeriod] = useState<PeriodRange | null>(null);
  const [figures, setFigures] = useState<OverviewFigures | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => { void loadProfile(); }, []);

  useEffect(() => {
    if (profile?.setup_completed) void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.setup_completed, periodKind, periodOffset, customStart, customEnd]);

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
        if (!data.profile.setup_completed) {
          setForm((f) => ({ ...f, ...data.profile }));
        }
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

  async function loadOverview() {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const params = new URLSearchParams({ kind: periodKind, offset: String(periodOffset) });
      if (periodKind === "custom") {
        if (!customStart || !customEnd) { setOverviewLoading(false); return; }
        params.set("start", customStart);
        params.set("end", customEnd);
      }
      const res = await fetch(`/api/tax-accounts/overview?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setOverviewError(data.error);
        setFigures(null);
        setReadiness(null);
        setPeriod(null);
      } else {
        setFigures(data.figures);
        setReadiness(data.readiness);
        setPeriod(data.period);
      }
    } finally {
      setOverviewLoading(false);
    }
  }

  const isLimitedCompany = form.business_structure === "limited_company";

  const readinessTone = useMemo(() => {
    if (!readiness) return "default";
    if (readiness.score >= 90) return "profit";
    if (readiness.score >= 70) return "default";
    return "risk";
  }, [readiness]);

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
          <SetupForm
            form={form}
            setForm={setForm}
            isLimitedCompany={isLimitedCompany}
            saving={saving}
            onSave={() => void saveProfile(true)}
          />
        ) : (
          <>
            <section className="table-card" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 16px" }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={t.id === activeTab ? "primary-button" : "secondary-button"}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </section>

            {activeTab === "overview" && (
              <OverviewTab
                isLimitedCompany={isLimitedCompany}
                hasCompanyYearEnd={!!form.company_year_end}
                periodKind={periodKind}
                setPeriodKind={setPeriodKind}
                periodOffset={periodOffset}
                setPeriodOffset={setPeriodOffset}
                customStart={customStart}
                setCustomStart={setCustomStart}
                customEnd={customEnd}
                setCustomEnd={setCustomEnd}
                period={period}
                figures={figures}
                readiness={readiness}
                readinessTone={readinessTone}
                loading={overviewLoading}
                error={overviewError}
                taxReservePercent={form.tax_reserve_percent}
              />
            )}

            {activeTab === "settings" && (
              <SetupForm
                form={form}
                setForm={setForm}
                isLimitedCompany={isLimitedCompany}
                saving={saving}
                onSave={() => void saveProfile(false)}
                isSettingsMode
              />
            )}

            {activeTab === "transactions" && (
              <ComingSoon
                title="Transactions"
                body="A universal, filterable ledger across purchases, sales, expenses, payouts, refunds and director transactions. Coming in the next phase."
              />
            )}
            {activeTab === "expenses" && (
              <ComingSoon
                title="Expenses"
                body={<>Your existing <Link href="/costs" style={{ textDecoration: "underline" }}>Costs</Link> page already tracks overheads, and they&rsquo;re already included in the Overview&rsquo;s Other Business Expenses figure above. A dedicated categorisation and tax-treatment view for each expense is coming next.</>}
              />
            )}
            {activeTab === "reconciliation" && (
              <ComingSoon
                title="Reconciliation"
                body="Matching sales against payouts — including one payout covering several sales — is next on the list."
              />
            )}
            {activeTab === "vat" && (
              <ComingSoon
                title="VAT"
                body="VAT registration status, the rolling 12-month threshold monitor, and per-sale VAT treatment classification are coming in a later phase."
              />
            )}
            {activeTab === "documents" && (
              <ComingSoon
                title="Documents"
                body="Attaching and tracking receipts/evidence against purchases, expenses and sales is coming in a later phase."
              />
            )}
            {activeTab === "accountant-pack" && (
              <ComingSoon
                title="Accountant Pack"
                body="The full Excel/ZIP export — P&L, sales ledger, purchases, expenses, inventory, VAT and more — is coming once the data underneath it (reconciliation, VAT, documents) is built."
              />
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
              <Info text="Cash Basis: you record income/expenses when money actually moves. Traditional Accounting: you record them when invoiced/incurred, regardless of when cash moves. Most small sole traders use Cash Basis — confirm with your accountant." />
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

function PeriodSelector({
  isLimitedCompany, hasCompanyYearEnd, periodKind, setPeriodKind, periodOffset, setPeriodOffset,
  customStart, setCustomStart, customEnd, setCustomEnd,
}: {
  isLimitedCompany: boolean;
  hasCompanyYearEnd: boolean;
  periodKind: PeriodKind;
  setPeriodKind: (k: PeriodKind) => void;
  periodOffset: number;
  setPeriodOffset: (n: number) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
}) {
  const primaryKind: PeriodKind = isLimitedCompany && hasCompanyYearEnd ? "company_fy" : "uk_tax_year";

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <select
        className="field"
        value={periodKind}
        onChange={(e) => { setPeriodKind(e.target.value as PeriodKind); setPeriodOffset(0); }}
      >
        <option value={primaryKind}>{isLimitedCompany ? "Company Financial Year" : "UK Tax Year"}</option>
        <option value="this_month">This Month</option>
        <option value="last_month">Last Month</option>
        <option value="this_quarter">This Quarter</option>
        <option value="year_to_date">Year to Date</option>
        <option value="previous_accounting_year">Previous Accounting Year</option>
        <option value="custom">Custom Range</option>
      </select>

      {(periodKind === "uk_tax_year" || periodKind === "company_fy") && (
        <select className="field" value={periodOffset} onChange={(e) => setPeriodOffset(Number(e.target.value))}>
          {Array.from({ length: 6 }, (_, i) => (
            <option key={i} value={i}>{i === 0 ? "Current period" : `${i} period${i > 1 ? "s" : ""} ago`}</option>
          ))}
        </select>
      )}

      {periodKind === "custom" && (
        <>
          <input className="field" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <span style={{ color: "var(--text-secondary)" }}>to</span>
          <input className="field" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </>
      )}
    </div>
  );
}

function OverviewTab(props: {
  isLimitedCompany: boolean;
  hasCompanyYearEnd: boolean;
  periodKind: PeriodKind;
  setPeriodKind: (k: PeriodKind) => void;
  periodOffset: number;
  setPeriodOffset: (n: number) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  period: PeriodRange | null;
  figures: OverviewFigures | null;
  readiness: Readiness | null;
  readinessTone: string;
  loading: boolean;
  error: string;
  taxReservePercent: number;
}) {
  const { figures, readiness, period, loading, error } = props;

  return (
    <>
      <section className="hero-card">
        <div>
          <p className="section-tag">Reporting period</p>
          <PeriodSelector {...props} />
          {period && (
            <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
              Showing <strong>{period.label}</strong> — {new Date(period.start).toLocaleDateString("en-GB")} to {new Date(period.end).toLocaleDateString("en-GB")}
            </p>
          )}
        </div>
      </section>

      {error && <div className="feedback-banner">{error}</div>}

      {loading && <p style={{ padding: 16, color: "var(--text-secondary)" }}>Calculating…</p>}

      {!loading && readiness && (
        <section className="table-card" style={{ padding: 20 }}>
          <div className="table-card-header">
            <div>
              <p className="section-tag">Accountant Readiness</p>
              <h4 style={{ color: readiness.score >= 90 ? "#67F0A5" : readiness.score >= 70 ? "inherit" : "#FF7D7D" }}>
                {readiness.score}% Ready
              </h4>
            </div>
          </div>
          {readiness.issues.length === 0 ? (
            <p style={{ color: "var(--text-secondary)" }}>
              No issues found in the {readiness.totalChecked} purchase{readiness.totalChecked === 1 ? "" : "s"} checked for this period.
            </p>
          ) : (
            <ul style={{ color: "var(--text-secondary)", paddingLeft: 18 }}>
              {readiness.issues.map((issue) => (
                <li key={issue.label}>{issue.label}</li>
              ))}
            </ul>
          )}
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>
            This score currently checks cost and evidence coverage on purchases. It will check reconciliation, VAT classification and documents too as those are built — the score will get more thorough, never less honest.
          </p>
        </section>
      )}

      {!loading && figures && (
        <section className="kpi-grid">
          <article className="kpi-card">
            <p className="kpi-label">Gross Sales<Info text="Total selling value before any costs or fees." /></p>
            <strong className="kpi-value">{formatCurrency(figures.grossSales)}</strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Ticket Cost of Sales<Info text="Ticket purchase costs associated with tickets sold during this period." /></p>
            <strong className="kpi-value">{formatCurrency(figures.costOfSales)}</strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Marketplace Fees<Info text="Fees deducted by marketplaces, derived from gross sale minus actual payout where both are known. Left out (not guessed) when only a net payout figure is available." /></p>
            <strong className="kpi-value">{formatCurrency(figures.marketplaceFees)}</strong>
            {figures.salesWithUnknownFees > 0 && (
              <span className="kpi-trend">{figures.salesWithUnknownFees} sale{figures.salesWithUnknownFees === 1 ? "" : "s"} with fee unknown</span>
            )}
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Other Business Expenses<Info text="From your Costs page — overheads logged within this period." /></p>
            <strong className="kpi-value">{formatCurrency(figures.otherExpenses)}</strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Refunds<Info text={figures.refundsTrackedNote} /></p>
            <strong className="kpi-value">{formatCurrency(figures.refunds)}</strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Net Trading Profit<Info text="Gross Sales minus Cost of Sales, Marketplace Fees, Other Expenses and Refunds." /></p>
            <strong className={`kpi-value ${figures.netTradingProfit >= 0 ? "" : ""}`} style={{ color: figures.netTradingProfit >= 0 ? "#67F0A5" : "#FF7D7D" }}>
              {formatCurrency(figures.netTradingProfit)}
            </strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Unsold Ticket Inventory<Info text="Purchase cost of tickets still unsold as of the period end — not an estimate of resale value." /></p>
            <strong className="kpi-value">{formatCurrency(figures.unsoldInventoryCost)}</strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Cash Received<Info text="Actual payouts/settlements received during this period — not the same as revenue earned in this period." /></p>
            <strong className="kpi-value">{formatCurrency(figures.cashReceived)}</strong>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Suggested Tax Reserve<Info text="A cash-management guide only, based on your configured reserve percentage. Not a calculation of what you owe HMRC." /></p>
            <strong className="kpi-value">{formatCurrency(Math.max(0, figures.netTradingProfit) * (props.taxReservePercent / 100))}</strong>
            <span className="kpi-trend">{props.taxReservePercent}% of net trading profit</span>
          </article>
        </section>
      )}
    </>
  );
}
