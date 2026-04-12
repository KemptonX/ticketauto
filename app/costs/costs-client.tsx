"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabase";
import { formatCurrency } from "@/src/lib/currency";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

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

function formatBilledDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
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
  const [billedDate, setBilledDate] = useState(() => new Date().toISOString().slice(0, 10));

  // filters
  const [filterSearch, setFilterSearch] = useState("");
  const [filterCycle, setFilterCycle] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");

  useEffect(() => {
    void loadOverheads().then(() => autoAddMonthlyCharges());
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage("Not signed in"); setSubmitting(false); return; }

    const { error } = await supabase.from("overheads").insert({
      user_id: user.id,
      name: name.trim(),
      amount: parseFloat(amount),
      billing_cycle: cycle,
      category: category.trim() || null,
      notes: notes.trim() || null,
      created_at: billedDate || new Date().toISOString().slice(0, 10),
    });

    if (error) {
      setMessage(error.message);
    } else {
      setName("");
      setAmount("");
      setCycle("monthly");
      setCategory("");
      setNotes("");
      setBilledDate(new Date().toISOString().slice(0, 10));
      setMessage("Cost added");
      void loadOverheads();
    }
    setSubmitting(false);
  }

  function exportCSV() {
    const rows = filteredOverheads.length > 0 ? filteredOverheads : overheads;
    if (rows.length === 0) { setMessage("Nothing to export"); return; }

    const headers = ["Name", "Category", "Billed Date", "Amount (£)", "Billing Cycle", "Monthly Equiv (£)", "Notes"];
    const data = rows.map(o => [
      o.name,
      o.category ?? "",
      formatBilledDate(o.created_at),
      o.amount.toFixed(2),
      CYCLES.find(c => c.value === o.billing_cycle)?.label ?? o.billing_cycle,
      o.billing_cycle === "one-off" ? "" : toMonthly(o.amount, o.billing_cycle).toFixed(2),
      o.notes ?? "",
    ]);

    const csv = [headers, ...data]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ticketauto-costs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function removeOverhead(id: number) {
    const { error } = await supabase.from("overheads").delete().eq("id", id);
    if (error) { setMessage(error.message); return; }
    setMessage("Cost removed");
    void loadOverheads();
  }

  async function toggleCycle(o: Overhead) {
    const next: BillingCycle = o.billing_cycle === "monthly" ? "one-off" : "monthly";
    const { error } = await supabase.from("overheads").update({ billing_cycle: next }).eq("id", o.id);
    if (error) { setMessage(error.message); return; }
    setMessage(next === "monthly" ? "Set to monthly — will auto-renew each month" : "Set to one-off");
    void loadOverheads();
  }

  async function autoAddMonthlyCharges() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("overheads")
      .select("*")
      .eq("billing_cycle", "monthly")
      .order("created_at", { ascending: false });

    if (!data || data.length === 0) return;

    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

    // Group by name+amount, find most recent per group
    const seen = new Map<string, Overhead>();
    for (const row of data as Overhead[]) {
      const key = `${row.name}__${row.amount}`;
      if (!seen.has(key)) seen.set(key, row);
    }

    const toInsert: Overhead[] = [];
    for (const [, row] of seen) {
      const lastDate = new Date(row.created_at);
      const lastKey = `${lastDate.getFullYear()}-${lastDate.getMonth()}`;
      if (lastKey !== thisMonthKey) {
        toInsert.push(row);
      }
    }

    if (toInsert.length === 0) return;

    await supabase.from("overheads").insert(
      toInsert.map((row) => ({
        user_id: user.id,
        name: row.name,
        amount: row.amount,
        billing_cycle: "monthly" as BillingCycle,
        category: row.category,
        notes: row.notes,
      }))
    );

    void loadOverheads();
    setMessage(`Auto-added ${toInsert.length} monthly charge${toInsert.length > 1 ? "s" : ""} for ${now.toLocaleString("en-GB", { month: "long" })}`);
  }

  const totals = useMemo(() => {
    const monthly = overheads.reduce((sum, o) => sum + toMonthly(o.amount, o.billing_cycle), 0);
    const annual = monthly * 12;
    const oneOff = overheads.filter(o => o.billing_cycle === "one-off").reduce((sum, o) => sum + o.amount, 0);
    return { monthly, annual, oneOff };
  }, [overheads]);

  const categoryOptions = useMemo(() => {
    const vals = [...new Set(overheads.map(o => o.category).filter(Boolean))] as string[];
    return ["All", ...vals];
  }, [overheads]);

  const filteredOverheads = useMemo(() => {
    return overheads.filter(o => {
      const matchSearch = filterSearch === "" ||
        [o.name, o.category, o.notes].filter(Boolean).some(v => v!.toLowerCase().includes(filterSearch.toLowerCase()));
      const matchCycle = filterCycle === "All" || o.billing_cycle === filterCycle;
      const matchCategory = filterCategory === "All" || o.category === filterCategory;
      return matchSearch && matchCycle && matchCategory;
    });
  }, [overheads, filterSearch, filterCycle, filterCategory]);

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />

          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-item${item.active ? " nav-item-active" : ""}`}
              >
                <NavIcon href={item.href} />
                <span>{item.label}</span>
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
            <h2>Costs</h2>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary-button" onClick={exportCSV} disabled={overheads.length === 0}>
              Export CSV
            </button>
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
                <span className="filter-label">Billed date</span>
                <input className="field" type="date" value={billedDate} onChange={e => setBilledDate(e.target.value)} />
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
            <span className="table-count">{filteredOverheads.length} of {overheads.length} items</span>
          </div>

          <div className="command-grid" style={{ padding: "0 0 16px" }}>
            <label className="filter-field">
              <span className="filter-label">Search</span>
              <input className="field field-search" placeholder="Name, category, notes..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-label">Cycle</span>
              <select className="field" value={filterCycle} onChange={e => setFilterCycle(e.target.value)}>
                <option value="All">All</option>
                {CYCLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-label">Category</span>
              <select className="field" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="filter-field" style={{ alignSelf: "flex-end" }}>
              <button type="button" className="ghost-button" onClick={() => { setFilterSearch(""); setFilterCycle("All"); setFilterCategory("All"); }}>
                Reset
              </button>
            </label>
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
                    <th>Billed</th>
                    <th>Amount</th>
                    <th>Cycle</th>
                    <th>Monthly equiv.</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOverheads.map(o => (
                    <tr key={o.id}>
                      <td><strong>{o.name}</strong></td>
                      <td>{o.category || "—"}</td>
                      <td>{formatBilledDate(o.created_at)}</td>
                      <td>{formatCurrency(o.amount)}</td>
                      <td><span className={`status-badge ${o.billing_cycle === "monthly" ? "badge-sold" : "badge-listed"}`}>{CYCLES.find(c => c.value === o.billing_cycle)?.label}</span></td>
                      <td className="value-up">{o.billing_cycle === "one-off" ? "—" : formatCurrency(toMonthly(o.amount, o.billing_cycle))}</td>
                      <td>{o.notes || "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void toggleCycle(o)}
                            title={o.billing_cycle === "monthly" ? "Switch to one-off" : "Switch to monthly"}
                          >
                            {o.billing_cycle === "monthly" ? "→ One-off" : "→ Monthly"}
                          </button>
                          <button type="button" className="ghost-button danger-button" onClick={() => void removeOverhead(o.id)}>
                            Remove
                          </button>
                        </div>
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
