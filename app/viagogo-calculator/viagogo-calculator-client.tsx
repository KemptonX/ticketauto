"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

type UkField = "display" | "listing" | "payout";

const CURRENCIES = [
  { code: "EUR", label: "EUR — Euro", symbol: "€" },
  { code: "USD", label: "USD — US Dollar", symbol: "$" },
  { code: "AUD", label: "AUD — Australian Dollar", symbol: "A$" },
  { code: "CAD", label: "CAD — Canadian Dollar", symbol: "C$" },
  { code: "MXN", label: "MXN — Mexican Peso", symbol: "MX$" },
  { code: "SEK", label: "SEK — Swedish Krona", symbol: "kr" },
  { code: "NOK", label: "NOK — Norwegian Krone", symbol: "kr" },
  { code: "DKK", label: "DKK — Danish Krone", symbol: "kr" },
  { code: "PLN", label: "PLN — Polish Zloty", symbol: "zł" },
  { code: "CHF", label: "CHF — Swiss Franc", symbol: "Fr" },
];

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: true },
  { label: "Scans", href: "/scans", active: false },
  { label: "Clients", href: "/clients", active: false },
];

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

// UK formulas:
// listing = ROUND(display / 1.1799, 2)
// payout  = ROUND(listing * 0.88, 2)
function calcUkFromDisplay(display: number) {
  const listing = r2(display / 1.1799);
  const payout = r2(listing * 0.88);
  return { display, listing, payout };
}

function calcUkFromListing(listing: number) {
  const display = r2(listing * 1.1799);
  const payout = r2(listing * 0.88);
  return { display, listing, payout };
}

function calcUkFromPayout(payout: number) {
  const listing = r2(payout / 0.88);
  const display = r2(listing * 1.1799);
  return { display, listing, payout };
}

export default function ViagogoCalculatorClient() {
  const [ukDisplay, setUkDisplay] = useState("");
  const [ukListing, setUkListing] = useState("");
  const [ukPayout, setUkPayout] = useState("");

  // Currency converter state
  const [fxAmount, setFxAmount] = useState("");
  const [fxCurrency, setFxCurrency] = useState("EUR");
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [fxRateOverride, setFxRateOverride] = useState("");
  const [fxRatesLoading, setFxRatesLoading] = useState(false);
  const [fxRatesError, setFxRatesError] = useState("");

  useEffect(() => {
    setFxRatesLoading(true);
    fetch("https://api.frankfurter.app/latest?from=GBP")
      .then((r) => r.json())
      .then((data: { rates?: Record<string, number> }) => {
        if (data.rates) {
          setFxRates(data.rates);
        } else {
          setFxRatesError("Could not load rates");
        }
      })
      .catch(() => setFxRatesError("Could not load rates"))
      .finally(() => setFxRatesLoading(false));
  }, []);

  // When currency changes, clear the manual override so it auto-refills
  function handleFxCurrencyChange(code: string) {
    setFxCurrency(code);
    setFxRateOverride("");
  }

  const liveRate = fxRates[fxCurrency] ?? null;
  const displayRate = fxRateOverride !== "" ? parseFloat(fxRateOverride) : (liveRate ?? NaN);
  const fxAmountNum = parseFloat(fxAmount);
  const gbpEquivalent = !isNaN(fxAmountNum) && !isNaN(displayRate) && displayRate > 0
    ? r2(fxAmountNum / displayRate)
    : null;

  const currencyMeta = CURRENCIES.find((c) => c.code === fxCurrency) ?? CURRENCIES[0];

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handleUkChange(field: UkField, raw: string) {
    const num = parseFloat(raw);

    if (field === "display") {
      setUkDisplay(raw);
      if (!isNaN(num) && num > 0) {
        const r = calcUkFromDisplay(num);
        setUkListing(String(r.listing));
        setUkPayout(String(r.payout));
      } else {
        setUkListing("");
        setUkPayout("");
      }
    } else if (field === "listing") {
      setUkListing(raw);
      if (!isNaN(num) && num > 0) {
        const r = calcUkFromListing(num);
        setUkDisplay(String(r.display));
        setUkPayout(String(r.payout));
      } else {
        setUkDisplay("");
        setUkPayout("");
      }
    } else {
      setUkPayout(raw);
      if (!isNaN(num) && num > 0) {
        const r = calcUkFromPayout(num);
        setUkDisplay(String(r.display));
        setUkListing(String(r.listing));
      } else {
        setUkDisplay("");
        setUkListing("");
      }
    }
  }

  function resetUk() {
    setUkDisplay("");
    setUkListing("");
    setUkPayout("");
  }

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
            <p className="eyebrow">Tools</p>
            <h2>Viagogo Calculator</h2>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="section-tag">Calculator</p>
            <h3>Work out fees, payout and profit before you list.</h3>
          </div>
        </section>

        <section className="command-card">
          <div className="command-header">
            <span className="section-tag" style={{ margin: 0 }}>viagogo.co.uk</span>
            <button type="button" className="ghost-button" onClick={resetUk}>
              Reset
            </button>
          </div>
        </section>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <h4>Enter any value to calculate the others</h4>
            </div>
          </div>

          <div className="calc-grid">
            <div className="calc-field">
              <p className="kpi-label">Display price</p>
              <p className="calc-hint">What the buyer sees on viagogo</p>
              <div className="calc-input-wrap">
                <span className="calc-prefix">£</span>
                <input
                  className="field calc-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={ukDisplay}
                  onChange={(e) => handleUkChange("display", e.target.value)}
                />
              </div>
            </div>

            <div className="calc-field">
              <p className="kpi-label">Listing price</p>
              <p className="calc-hint">display ÷ 1.1799</p>
              <div className="calc-input-wrap">
                <span className="calc-prefix">£</span>
                <input
                  className="field calc-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={ukListing}
                  onChange={(e) => handleUkChange("listing", e.target.value)}
                />
              </div>
            </div>

            <div className="calc-field">
              <p className="kpi-label">Payout</p>
              <p className="calc-hint">listing × 0.88</p>
              <div className="calc-input-wrap">
                <span className="calc-prefix">£</span>
                <input
                  className="field calc-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={ukPayout}
                  onChange={(e) => handleUkChange("payout", e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Currency converter */}
        <section className="command-card" style={{ borderRadius: "16px" }}>
          <div className="command-header" style={{ marginBottom: "20px" }}>
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Currency</p>
              <h4 style={{ marginTop: "4px" }}>Convert to GBP</h4>
            </div>
            {fxRatesLoading && (
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Loading rates…</span>
            )}
            {fxRatesError && (
              <span style={{ fontSize: "12px", color: "#f87171" }}>{fxRatesError}</span>
            )}
            {!fxRatesLoading && !fxRatesError && liveRate && (
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Live rate · 1 GBP = {liveRate.toFixed(4)} {fxCurrency}
              </span>
            )}
          </div>

          <div className="calc-grid">
            {/* Amount paid */}
            <div className="calc-field">
              <p className="kpi-label">Amount paid</p>
              <p className="calc-hint">Cost in foreign currency</p>
              <div className="calc-input-wrap">
                <span className="calc-prefix">{currencyMeta.symbol}</span>
                <input
                  className="field calc-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={fxAmount}
                  onChange={(e) => setFxAmount(e.target.value)}
                />
              </div>
            </div>

            {/* Currency + rate */}
            <div className="calc-field">
              <p className="kpi-label">Currency</p>
              <p className="calc-hint">Select foreign currency</p>
              <select
                className="field"
                style={{ height: "46px", paddingLeft: "12px" }}
                value={fxCurrency}
                onChange={(e) => handleFxCurrencyChange(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Exchange rate (editable) */}
            <div className="calc-field">
              <p className="kpi-label">Exchange rate</p>
              <p className="calc-hint">GBP per {fxCurrency} · adjust for provider fees</p>
              <div className="calc-input-wrap">
                <span className="calc-prefix" style={{ fontSize: "11px", minWidth: "28px" }}>÷</span>
                <input
                  className="field calc-input"
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder={liveRate ? liveRate.toFixed(4) : "—"}
                  value={fxRateOverride}
                  onChange={(e) => setFxRateOverride(e.target.value)}
                />
              </div>
              {fxRateOverride !== "" && liveRate && (
                <button
                  type="button"
                  className="ghost-button"
                  style={{ marginTop: "6px", fontSize: "11px", padding: "3px 8px" }}
                  onClick={() => setFxRateOverride("")}
                >
                  Reset to live rate
                </button>
              )}
            </div>
          </div>

          {/* Result */}
          {gbpEquivalent !== null && (
            <div style={{
              marginTop: "20px",
              padding: "16px 20px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
            }}>
              <div>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  GBP equivalent
                </p>
                <p style={{ margin: "4px 0 0", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.04em", color: "var(--text-primary)" }}>
                  £{gbpEquivalent.toFixed(2)}
                </p>
              </div>
              <div style={{ textAlign: "right", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                <div>{currencyMeta.symbol}{parseFloat(fxAmount || "0").toFixed(2)} {fxCurrency}</div>
                <div>÷ {(!isNaN(displayRate) ? displayRate : liveRate ?? 0).toFixed(4)}</div>
                {fxRateOverride !== "" && (
                  <div style={{ color: "#f59e0b", fontSize: "11px" }}>⚠ Using manual rate</div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
