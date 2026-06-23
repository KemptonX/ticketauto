import Link from "next/link";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import DeskClient from "./desk-client";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) return <DeskClient />;

  return (
    <div className="lp-shell">

      {/* ── Background ambient glows ── */}
      <div className="lp-bg-glow lp-bg-glow-1" />
      <div className="lp-bg-glow lp-bg-glow-2" />
      <div className="lp-bg-glow lp-bg-glow-3" />

      {/* ── Nav ── */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <img src="/logo.png" alt="TixTracker" className="lp-nav-logo" />
          <nav className="lp-nav-links">
            <a href="#features" className="lp-nav-link">Features</a>
            <a href="#pricing" className="lp-nav-link">Pricing</a>
            <Link href="/faq" className="lp-nav-link">FAQ</Link>
            <a href="https://discord.gg/X3AY2KDg9v" target="_blank" rel="noopener noreferrer" className="lp-nav-discord">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.014.043.031.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 13.298 13.298 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Community
            </a>
            <Link href="/login" className="lp-nav-signin">Sign In →</Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-badge">
            <span className="lp-badge-dot" />
            Inbox-powered ticket intelligence
          </div>

          <h1 className="lp-headline">
            Know <span className="lp-gradient-text">your book.</span>
          </h1>

          <p className="lp-subheadline">
            Automatically track purchases, sales, inventory and live profit across Ticketmaster,
            AXS, Viagogo, StubHub, Lysted and other major ticketing platforms —
            all from one inbox-powered dashboard.
          </p>

          <div className="lp-cta-row">
            <Link href="/login" className="lp-cta-primary">
              Get Early Access
            </Link>
            <a href="#features" className="lp-cta-secondary">
              Explore Features
            </a>
          </div>
          <p className="lp-cta-footnote">Built for ticket resellers</p>
        </div>
      </section>

      {/* ── Dashboard preview ── */}
      <section className="lp-preview-wrap">
        <div className="lp-preview-glow" />
        <div className="lp-preview-frame">
          <div className="lp-chrome">
            <span className="lp-chrome-dot lp-dot-r" />
            <span className="lp-chrome-dot lp-dot-y" />
            <span className="lp-chrome-dot lp-dot-g" />
            <span className="lp-chrome-url">tixtracker.app/dashboard</span>
          </div>
          <div className="lp-preview-body">
            {/* Sidebar */}
            <div className="lp-prev-sidebar">
              <div className="lp-prev-brand">
                <div className="lp-prev-logo-mark">Tt</div>
                <span className="lp-prev-logo-name">TixTracker</span>
              </div>
              {["Dashboard","Tickets","Sales","Analytics","Cash Flow","Costs","Calculator","Scans","Clients","Guides"].map((n, i) => (
                <div key={n} className={`lp-prev-nav-item${i === 0 ? " lp-prev-nav-active" : ""}`}>{n}</div>
              ))}
            </div>

            {/* Main */}
            <div className="lp-prev-main">
              {/* Topbar */}
              <div className="lp-prev-topbar">
                <div>
                  <div className="lp-prev-eyebrow">Overview</div>
                  <div className="lp-prev-pagetitle">Dashboard</div>
                </div>
                <div className="lp-prev-topbar-right">
                  <div className="lp-prev-select">May 2025 ▾</div>
                  <div className="lp-prev-ghost-btn">Refresh</div>
                </div>
              </div>

              {/* Monthly goal */}
              <div className="lp-prev-goal">
                <div className="lp-prev-goal-top">
                  <div>
                    <div className="lp-prev-tag">May goal</div>
                    <div className="lp-prev-goal-nums">
                      <span className="lp-up">£3,240</span>
                      <span className="lp-prev-muted"> / £5,000</span>
                    </div>
                  </div>
                  <div className="lp-prev-ghost-btn" style={{ marginLeft: "auto" }}>Edit goal</div>
                </div>
                <div className="lp-prev-track"><div className="lp-prev-fill" style={{ width: "64.8%" }} /></div>
                <div className="lp-prev-goal-foot">
                  <span>64.8% of target</span><span>Projected: £5,180</span><span>£1,760 to go</span>
                </div>
              </div>

              {/* KPIs */}
              <div className="lp-prev-kpi-row">
                {[
                  { l: "Revenue this month", v: "£9,840", s: "gross income in May", up: true },
                  { l: "ROI this month", v: "49.2%", s: "return on sold tickets", up: true },
                  { l: "Open positions", v: "14", s: "actively listed" },
                  { l: "Tickets this month", v: "38", s: "11 sold · 27 to sell" },
                ].map(k => (
                  <div key={k.l} className="lp-prev-kpi">
                    <span>{k.l}</span>
                    <strong className={k.up ? "lp-up" : ""}>{k.v}</strong>
                    <small>{k.s}</small>
                  </div>
                ))}
              </div>

              {/* Tickets left table */}
              <div className="lp-prev-card">
                <div className="lp-prev-card-hd">
                  <div>
                    <div className="lp-prev-tag">May</div>
                    <div className="lp-prev-card-title">Tickets left to sell</div>
                  </div>
                  <span className="lp-prev-count">27 tickets left</span>
                </div>
                <div className="lp-prev-tbl-hd">
                  <span style={{ flex: 2 }}>Event</span>
                  <span>Section</span><span>Qty</span><span>Left</span><span>Status</span><span>Date</span>
                </div>
                {[
                  { e: "Coldplay · Wembley", sec: "Block A2", q: 4, l: 2, st: "listed", d: "3 May" },
                  { e: "Oasis · Heaton Park", sec: "Pitch GA", q: 6, l: 6, st: "listed", d: "8 May" },
                  { e: "Taylor Swift · O2", sec: "Floor", q: 4, l: 0, st: "sold", d: "10 May" },
                  { e: "Man Utd v Arsenal", sec: "East Stand", q: 4, l: 3, st: "listed", d: "11 May" },
                ].map(r => (
                  <div key={r.e} className="lp-prev-tbl-row">
                    <span style={{ flex: 2 }} className="lp-prev-tbl-event">{r.e}</span>
                    <span>{r.sec}</span>
                    <span>{r.q}</span>
                    <span className={r.l > 0 ? "lp-up" : "lp-prev-muted"}>{r.l || "—"}</span>
                    <span className={`lp-prev-badge lp-badge-${r.st}`}>{r.st === "sold" ? "Sold" : "Listed"}</span>
                    <span className="lp-prev-muted">{r.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platforms ── */}
      <section className="lp-platforms">
        <p className="lp-platforms-label">Works with every major ticketing platform</p>
        <div className="lp-platforms-row">
          {["Ticketmaster","AXS","Viagogo","StubHub"].map(p => (
            <span key={p} className="lp-platform-chip">{p}</span>
          ))}
          <span className="lp-platform-chip lp-platform-soon">Lysted <span className="lp-soon-badge">Soon</span></span>
        </div>
      </section>


      {/* ── Features ── */}
      <section className="lp-features" id="features">
        <div className="lp-section-header">
          <p className="lp-section-eyebrow">Everything you need</p>
          <h2 className="lp-section-title">Built for the full resale workflow</h2>
          <p className="lp-section-sub">From inbox scan to profit report — every step automated.</p>
        </div>
        <div className="lp-features-grid">
          {[
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              ),
              title: "Gmail Sync",
              desc: "Auto-scans your inbox for Ticketmaster, AXS and platform confirmation emails the moment they land.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              ),
              title: "Multi-Platform",
              desc: "Ticketmaster, AXS, Viagogo, StubHub, Lysted — UK, US, EU and AU regions all supported out of the box.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              ),
              title: "Viagogo Matching",
              desc: "Sales emails auto-matched to inventory. Qty split, payout tracking and profit synced instantly.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              ),
              title: "StubHub Tracking",
              desc: "StubHub sale confirmations parsed and matched to your open positions automatically.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                  <polyline points="2 17 12 22 22 17"/>
                  <polyline points="2 12 12 17 22 12"/>
                </svg>
              ),
              title: "Lysted Integration",
              desc: "Lysted support coming soon — sales will sync directly into your book automatically.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              ),
              title: "Live Profit",
              desc: "P&L updates in real time as sales come in. Net profit, ROI and cost-per-ticket per event.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              ),
              title: "Inventory Management",
              desc: "Full stock visibility — quantities, sections, accounts, and listing status across all events.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/>
                  <line x1="12" y1="20" x2="12" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              ),
              title: "ROI Analytics",
              desc: "Deep analytics on your best events, platforms and buying strategies. Know what actually works.",
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              ),
              title: "Event Tracking",
              desc: "Upcoming events dashboard with days-to-show countdown, urgency signals and sell-through rate.",
            },
          ].map(f => (
            <div key={f.title} className="lp-feature-card">
              <div className="lp-feature-icon">{f.icon}</div>
              <h3 className="lp-feature-title">{f.title}</h3>
              <p className="lp-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="lp-pricing" id="pricing">
        <div className="lp-section-header">
          <p className="lp-section-eyebrow">Simple pricing</p>
          <h2 className="lp-section-title">One plan. Everything included.</h2>
          <p className="lp-section-sub">No tiers, no add-ons, no surprises — just the full platform.</p>
        </div>
        <div className="lp-pricing-card-wrap">
          <div className="lp-pricing-card">
            <div className="lp-pricing-glow" />
            <div className="lp-pricing-badge">Full access</div>
            <div className="lp-pricing-price">
              <span className="lp-pricing-currency">£</span>
              <span className="lp-pricing-amount">19.99</span>
              <span className="lp-pricing-period">/ month</span>
            </div>
            <p className="lp-pricing-sub">Cancel anytime. No contracts.</p>
            <ul className="lp-pricing-features">
              {[
                "Gmail inbox sync — all platforms auto-detected",
                "Ticketmaster, AXS, Viagogo & StubHub tracking",
                "Live P&L per event — profit, ROI, cost-per-ticket",
                "Full inventory management & listing status",
                "Cash flow & cost tracking",
                "ROI analytics & event performance reports",
                "Upcoming events dashboard with countdown",
                "Unlimited events, tickets & sales",
                "Lysted integration (coming soon)",
              ].map(f => (
                <li key={f} className="lp-pricing-feature">
                  <span className="lp-pricing-check">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/login" className="lp-cta-primary" style={{ display: "block", textAlign: "center", marginTop: "8px" }}>
              Get Early Access
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp-final-cta">
        <div className="lp-final-glow" />
        <h2 className="lp-final-title">Ready to run your book properly?</h2>
        <p className="lp-final-sub">Join resellers already using TixTracker.</p>
        <Link href="/login" className="lp-cta-primary">
          Get Early Access
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <img src="/logo.png" alt="TixTracker" className="lp-footer-logo" />
        <p className="lp-footer-copy">© 2025 TixTracker · Built for professional ticket resellers.</p>
        <nav className="lp-footer-links" aria-label="Legal links">
          <a href="/privacy" className="lp-footer-link">Privacy Policy</a>
          <span className="lp-footer-sep">·</span>
          <a href="/terms" className="lp-footer-link">Terms of Service</a>
          <span className="lp-footer-sep">·</span>
          <a href="mailto:support@tixtracker.app" className="lp-footer-link">Contact</a>
        </nav>
      </footer>

    </div>
  );
}
