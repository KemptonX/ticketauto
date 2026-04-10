"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";

type BillingCycle = "monthly" | "annual" | "weekly" | "one-off";

type Overhead = {
  id: number;
  user_id: string;
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  category: string | null;
  notes: string | null;
  created_at: string;
};

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Costs", href: "/costs", active: true },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
];

const CYCLES: { value: BillingCycle; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
  { value: "weekly", label: "Weekly" },
  { value: "one-off", label: "One-off" },
];

function toMonthly(amount: number, cycle: BillingCycle): number {
  switch (cycle) {
    case "weekly": return amount * 52 / 12;
    case "annual": return amount / 12;
    case "one-off": return 0;
    default: return amount;
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function CostsClient() {
  const [overheads, setOverheads] = useState<Overhead[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    void loadOverheads();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function loadOverheads() {
    setLoading(true);
    const { data, error } = await supabase
      .from("overheads")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setOverheads((data as Overhead[]) || []);
    setLoading(false);
  }

  async function addOverhead(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !amount) return;
    setSubmitting(true);

    const { error } = await supabase.from("overheads").insert({
      name: name.trim(),
      amount: parseFloat(amount),
      billing_cycle: cycle,
      category: category.trim() || null,
      notes: notes.trim() || null,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setName("");
      setAmount("");
      setCycle("monthly");
      setCategory("");
      setNotes("");
      setMessage("Cost added");
      void loadOverheads();
    }
    setSubmitting(false);
  }

  async function removeOverhead(id: number) {
    const { error } = await supabase.from("overheads").delete().eq("id", id);
    if (error) { setMessage(error.message); return; }
    setMessage("Cost removed");
    void loadOverheads();
  }

  const totals = useMemo(() => {
    const monthly = overheads.reduce((sum, o) => sum + toMonthly(o.amount, o.billing_cycle), 0);
    const annual = monthly * 12;
    const oneOff = overheads.filter(o => o.billing_cycle === "one-off").reduce((sum, o) => sum + o.amount, 0);
    return { monthly, annual, oneOff };
  }, [overheads]);

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <div className="brand-mark">TA</div>
          <div className="sidebar-brand">
            <p className="sidebar-kicker">Ticket desk</p>
            <h1>TicketAuto</h1>
          </div>

          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-item${item.active ? " nav-item-active" : ""}`}
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-settings-box">
            <p className="sidebar-panel-label">Settings</p>
            <div className="sidebar-settings-actions">
              <Link href="/connections" className="sidebar-panel-link">
                Connections
              </Link>
              <button type="button" className="sidebar-panel-link sidebar-logout-button" onClick={handleLogout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Finance</p>
            <h2>Costs</h2>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="section-tag">Overheads</p>
            <h3>Track proxies, bots, subscriptions and running costs.</h3>
          </div>
          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Monthly</span>
              <strong>{formatCurrency(totals.monthly)}</strong>
            </div>
            <div>
              <span className="hero-meta-label">Annual</span>
              <strong>{formatCurrency(totals.annual)}</strong>
            </div>
          </div>
        </section>

        {message && <div className="feedback-banner">{message}</div>}

        <section className="kpi-grid">
          <article className="kpi-card">
            <p className="kpi-label">Monthly total</p>
            <strong className="kpi-value">{formatCurrency(totals.monthly)}</strong>
            <span className="kpi-trend">Recurring costs per month</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Annual total</p>
            <strong className="kpi-value">{formatCurrency(totals.annual)}</strong>
            <span className="kpi-trend">Projected over 12 months</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">One-off costs</p>
            <strong className="kpi-value">{formatCurrency(totals.oneOff)}</strong>
            <span className="kpi-trend">Not included in monthly</span>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Total items</p>
            <strong className="kpi-value">{overheads.length}</strong>
            <span className="kpi-trend">{overheads.length === 1 ? "1 overhead tracked" : `${overheads.length} overheads tracked`}</span>
          </article>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Add cost</p>
              <h4>New overhead</h4>
            </div>
          </div>

          <form className="costs-form" onSubmit={addOverhead}>
            <div className="command-grid">
              <label className="filter-field">
                <span className="filter-label">Name</span>
                <input className="field" placeholder="e.g. Proxy subscription" value={name} onChange={e => setName(e.target.value)} required />
              </label>
              <label className="filter-field">
                <span className="filter-label">Amount (£)</span>
                <input className="field" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
              </label>
              <label className="filter-field">
                <span className="filter-label">Billing cycle</span>
                <select className="field" value={cycle} onChange={e => setCycle(e.target.value as BillingCycle)}>
                  {CYCLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="filter-field">
                <span className="filter-label">Category</span>
                <input className="field" placeholder="e.g. Bots, Proxies, Tools" value={category} onChange={e => setCategory(e.target.value)} />
              </label>
              <label className="filter-field">
                <span className="filter-label">Notes</span>
                <input className="field" placeholder="Optional notes" value={notes} onChange={e => setNotes(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? "Adding..." : "Add cost"}
            </button>
          </form>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Overheads</p>
              <h4>All costs</h4>
            </div>
            <span className="table-count">{overheads.length} items</span>
          </div>

          {loading ? (
            <div className="state-card">
              <div className="state-orb" />
              <h5>Loading costs...</h5>
            </div>
          ) : overheads.length === 0 ? (
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>No overheads yet</h5>
              <p>Add your first cost above to start tracking.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Cycle</th>
                    <th>Monthly equiv.</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {overheads.map(o => (
                    <tr key={o.id}>
                      <td><strong>{o.name}</strong></td>
                      <td>{o.category || "—"}</td>
                      <td>{formatCurrency(o.amount)}</td>
                      <td><span className="status-badge badge-listed">{CYCLES.find(c => c.value === o.billing_cycle)?.label}</span></td>
                      <td className="value-up">{o.billing_cycle === "one-off" ? "—" : formatCurrency(toMonthly(o.amount, o.billing_cycle))}</td>
                      <td>{o.notes || "—"}</td>
                      <td>
                        <button type="button" className="ghost-button danger-button" onClick={() => void removeOverhead(o.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
