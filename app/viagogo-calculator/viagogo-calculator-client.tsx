"use client";

import Link from "next/link";
import { useState } from "react";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

type Market = "uk" | "com";
type UkField = "display" | "listing" | "payout";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: true },
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
  const [market, setMarket] = useState<Market>("uk");

  // UK state
  const [ukDisplay, setUkDisplay] = useState("");
  const [ukListing, setUkListing] = useState("");
  const [ukPayout, setUkPayout] = useState("");

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handleUkChange(field: UkField, raw: string) {
    // Allow free typing — only calculate when a valid number is entered
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
            <div className="view-toggle">
              <button
                type="button"
                className={`toggle-btn${market === "uk" ? " toggle-btn-active" : ""}`}
                onClick={() => setMarket("uk")}
              >
                viagogo.co.uk
              </button>
              <button
                type="button"
                className={`toggle-btn${market === "com" ? " toggle-btn-active" : ""}`}
                onClick={() => setMarket("com")}
              >
                viagogo.com
              </button>
            </div>
            {market === "uk" && (
              <button type="button" className="ghost-button" onClick={resetUk}>
                Reset
              </button>
            )}
          </div>
        </section>

        {market === "uk" && (
          <section className="table-card">
            <div className="table-card-header">
              <div>
                <p className="section-tag">viagogo.co.uk</p>
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
        )}

        {market === "com" && (
          <section className="table-card">
            <div className="table-card-header">
              <div>
                <p className="section-tag">viagogo.com</p>
                <h4>Coming soon</h4>
              </div>
            </div>
            <div className="state-card">
              <div className="state-orb state-orb-muted" />
              <h5>Formula not set up yet</h5>
              <p>Add the .com instructions to unlock this calculator.</p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
