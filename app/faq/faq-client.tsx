"use client";

import Link from "next/link";
import { useState, useMemo, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type FAQ = {
  id: string;
  q: string;
  a: string | string[];
  isNew?: boolean;
  comingSoon?: boolean;
  popular?: boolean;
};
type Category = { id: string; label: string; faqs: FAQ[] };

// ── Data ──────────────────────────────────────────────────────────────────────

const CATS: Category[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    faqs: [
      {
        id: "gs-1",
        q: "What is TixTracker?",
        a: "TixTracker is an automated ticket management dashboard built for ticket resellers. It tracks purchases, inventory, listings, sales, payouts, profit, ROI, and analytics across multiple platforms — all from one centralised inbox-powered dashboard.",
        popular: true,
      },
      {
        id: "gs-2",
        q: "Who is TixTracker built for?",
        a: "TixTracker is built for both beginner and experienced ticket resellers who want to reduce admin time and eliminate the risk of losing track of tickets, sales, payouts, or inventory. Whether you're managing a handful of events or hundreds of listings across multiple platforms, TixTracker keeps everything in one place.",
        popular: true,
      },
      {
        id: "gs-3",
        q: "Do I need spreadsheets anymore?",
        a: "No. TixTracker is designed to fully replace manual spreadsheets. Your dashboard updates automatically as purchases and sales are detected — giving you a live, accurate view of your book at all times.",
      },
    ],
  },
  {
    id: "ticket-imports",
    label: "Ticket Imports",
    faqs: [
      {
        id: "ti-1",
        q: "How are tickets imported?",
        a: "TixTracker scans your connected inbox for supported ticket confirmation emails and automatically extracts the relevant data into your dashboard — no copy-pasting or manual entry required.",
        popular: true,
      },
      {
        id: "ti-2",
        q: "Which email providers are supported?",
        a: "Gmail is currently supported, with additional email providers planned for future updates.",
      },
      {
        id: "ti-3",
        q: "Can I add tickets manually?",
        a: "Yes. Tickets can also be added manually through the dashboard at any time, giving you full flexibility alongside automated imports.",
      },
      {
        id: "ti-4",
        q: "What ticket information gets extracted?",
        a: [
          "Event name and artist",
          "Venue and location",
          "Event date and time",
          "Section, row, and seat numbers",
          "Quantity purchased",
          "Cost price and booking reference",
          "Source platform",
        ],
      },
    ],
  },
  {
    id: "sales",
    label: "Sales Tracking",
    faqs: [
      {
        id: "st-1",
        q: "Which platforms are currently supported for sales tracking?",
        a: [
          "Ticketmaster",
          "AXS",
          "Viagogo",
          "StubHub (coming soon)",
          "Lysted (coming soon)",
        ],
      },
      {
        id: "st-2",
        q: "Can TixTracker track payouts?",
        a: "Yes. Pending payouts, completed payouts, and expected payment dates can all be tracked and monitored within the dashboard.",
      },
      {
        id: "st-3",
        q: "Does it support partial sales?",
        a: "Yes. Inventory updates dynamically as tickets sell. If you sell two tickets from a batch of four, the remaining quantity is automatically updated in your dashboard.",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory Management",
    faqs: [
      {
        id: "inv-1",
        q: "Can I see how many tickets I still own?",
        a: "Yes. TixTracker automatically tracks your remaining inventory and sold quantities per event, giving you a real-time view of what you still hold.",
      },
      {
        id: "inv-2",
        q: "Can I organise tickets by event?",
        a: "Yes. Tickets are automatically grouped by event, venue, artist, and status — making it easy to navigate and manage large volumes of inventory.",
      },
      {
        id: "inv-3",
        q: "Can I archive old tickets?",
        a: "Yes. Completed or past events can be archived to keep your active dashboard clean and focused. Archived tickets remain accessible for reporting and reference.",
      },
    ],
  },
  {
    id: "analytics",
    label: "Analytics & Profit Tracking",
    faqs: [
      {
        id: "an-1",
        q: "What analytics does TixTracker include?",
        a: [
          "Profit tracking per event and overall",
          "Revenue and gross income tracking",
          "Automated ROI calculations",
          "Cost and fee tracking",
          "Inventory value",
          "Sales performance over time",
          "Event-level performance breakdown",
          "Platform comparisons",
        ],
        popular: true,
      },
      {
        id: "an-2",
        q: "Can I export data?",
        a: "Yes. CSV export functionality is supported, allowing you to pull data into external tools or share with accountants as needed.",
      },
      {
        id: "an-3",
        q: "Does it calculate ROI automatically?",
        a: "Yes. ROI and profit calculations are fully automated based on your imported purchase prices and confirmed sale data. No manual calculations required.",
      },
    ],
  },
  {
    id: "gmail",
    label: "Gmail & Privacy",
    faqs: [
      {
        id: "gm-1",
        q: "Is my Gmail connection secure?",
        a: "Yes. TixTracker uses secure OAuth authentication to connect to Gmail and never stores your Gmail password. Access is scoped to reading only the relevant ticket-related emails.",
        popular: true,
      },
      {
        id: "gm-2",
        q: "Do you read all of my emails?",
        a: "No. The system only scans for supported ticket confirmation email formats — it does not access, read, or store any unrelated emails from your inbox.",
      },
      {
        id: "gm-3",
        q: "Can I use a forwarding address instead?",
        a: "Yes. Many users prefer to forward only ticket-related emails to a dedicated inbox and connect that to TixTracker. This gives you additional privacy control and keeps your main inbox separate.",
      },
      {
        id: "gm-4",
        q: "Is my data stored securely?",
        a: "Yes. All user data is encrypted at rest and in transit. We follow industry-standard security practices to ensure your data remains protected.",
      },
    ],
  },
  {
    id: "platforms",
    label: "Platforms Supported",
    faqs: [
      {
        id: "pl-1",
        q: "Which ticketing platforms does TixTracker currently support?",
        a: ["Ticketmaster (UK, US, EU, AU)", "AXS", "Viagogo"],
      },
      {
        id: "pl-2",
        q: "Which platforms are coming soon?",
        a: ["StubHub", "Lysted", "Additional secondary marketplaces"],
        comingSoon: true,
        isNew: true,
      },
      {
        id: "pl-3",
        q: "Which regions are supported?",
        a: "TixTracker currently supports UK, US, EU, and AU regions for supported platforms. Additional regional support is being added continuously.",
      },
    ],
  },
  {
    id: "billing",
    label: "Billing & Subscription",
    faqs: [
      {
        id: "bi-1",
        q: "How much does TixTracker cost?",
        a: "TixTracker is €19.99 per month with full access to all features included. No tiers, no add-ons, no hidden fees.",
        popular: true,
      },
      {
        id: "bi-2",
        q: "Is there a free trial?",
        a: "Free trial details are coming soon. Sign up for early access to be notified when a trial becomes available.",
        comingSoon: true,
      },
      {
        id: "bi-3",
        q: "Will there be different pricing plans?",
        a: "Additional Starter, Pro, and Team plans are being considered for future development based on user feedback and demand. Details will be announced in due course.",
        comingSoon: true,
      },
      {
        id: "bi-4",
        q: "Can I cancel my subscription anytime?",
        a: "Yes. There are no long-term contracts. You can cancel your subscription at any time directly from your account settings.",
      },
    ],
  },
  {
    id: "upcoming",
    label: "Upcoming Features",
    faqs: [
      {
        id: "up-1",
        q: "What features are coming soon?",
        a: [
          "StubHub integration",
          "Lysted integration",
          "Advanced analytics dashboard",
          "Mobile app",
          "Discord bot integrations",
          "Auto-categorisation of imports",
          "Faster import scanning",
          "Team and multi-user accounts",
          "Smart notifications and alerts",
        ],
        comingSoon: true,
        isNew: true,
      },
      {
        id: "up-2",
        q: "Will auto-listing be supported?",
        a: "Auto-listing is planned for future development, subject to marketplace API availability and terms of service. This is on the roadmap and will be announced when progress is made.",
        comingSoon: true,
      },
      {
        id: "up-3",
        q: "Is there a mobile app?",
        a: "A dedicated mobile app is on the roadmap. In the meantime, the web dashboard is fully mobile-responsive and optimised for use on all devices.",
        comingSoon: true,
        isNew: true,
      },
    ],
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    faqs: [
      {
        id: "tr-1",
        q: "My tickets are not importing — what should I do?",
        a: [
          "Verify your Gmail connection is active in Settings",
          "Click Refresh to trigger a new inbox scan",
          "Confirm the email is from a supported platform in a recognised format",
          "Allow up to 5 minutes for the scan to complete",
          "If the issue persists, reach out via Discord or contact support",
        ],
      },
      {
        id: "tr-2",
        q: "My payout figure looks incorrect — why?",
        a: "Payout amounts may appear lower than expected due to marketplace processing timelines. Platforms typically process payouts 5–10 business days after an event. TixTracker reflects the data available in your confirmation emails — if the final payout differs, you can manually update the figure in the dashboard.",
      },
      {
        id: "tr-3",
        q: "The dashboard doesn't look right on my phone",
        a: "Mobile optimisation is actively being improved across all pages of TixTracker. If you notice a specific layout issue, please report it via the Discord community so it can be prioritised.",
      },
    ],
  },
];

// JSON-LD schema for Google rich snippets
const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: CATS.flatMap((c) => c.faqs).map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: Array.isArray(f.a) ? f.a.join(". ") : f.a,
    },
  })),
};

// ── Sub-components ────────────────────────────────────────────────────────────

const DiscordPath =
  "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.014.043.031.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 13.298 13.298 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z";

function DiscordIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={DiscordPath} />
    </svg>
  );
}

function FaqItem({
  faq,
  open,
  onToggle,
}: {
  faq: FAQ;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className={`faq-item${open ? " faq-item-open" : ""}`}>
      <button
        id={`faq-btn-${faq.id}`}
        className="faq-item-btn"
        onClick={() => onToggle(faq.id)}
        aria-expanded={open}
        aria-controls={`faq-body-${faq.id}`}
      >
        <span className="faq-item-q">{faq.q}</span>
        <span className="faq-item-right">
          {faq.isNew && (
            <span className="faq-badge-new" aria-label="Recently added">
              New
            </span>
          )}
          {faq.comingSoon && (
            <span className="faq-badge-soon" aria-label="Coming soon">
              Soon
            </span>
          )}
          <svg
            className={`faq-chevron${open ? " faq-chevron-open" : ""}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div
        id={`faq-body-${faq.id}`}
        className={`faq-item-body${open ? " faq-item-body-open" : ""}`}
        role="region"
        aria-labelledby={`faq-btn-${faq.id}`}
      >
        <div className="faq-item-body-inner">
          <div className="faq-item-a">
            {Array.isArray(faq.a) ? (
              <ul className="faq-item-list">
                {faq.a.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>{faq.a}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FaqClient() {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return CATS.map((cat) => ({
      ...cat,
      faqs: cat.faqs.filter((f) => {
        if (activeCat !== "all" && activeCat !== cat.id) return false;
        if (!q) return true;
        const text = `${f.q} ${Array.isArray(f.a) ? f.a.join(" ") : f.a}`.toLowerCase();
        return text.includes(q);
      }),
    })).filter((c) => c.faqs.length > 0);
  }, [search, activeCat]);

  const popular = useMemo(
    () => CATS.flatMap((c) => c.faqs).filter((f) => f.popular),
    [],
  );

  const totalResults = filtered.reduce((s, c) => s + c.faqs.length, 0);
  const isFiltered = !!search || activeCat !== "all";

  return (
    <div className="faq-shell">
      {/* JSON-LD schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA) }}
      />

      {/* Nav */}
      <nav className="faq-top-nav" role="navigation" aria-label="Site navigation">
        <div className="faq-top-nav-inner">
          <Link href="/">
            <img src="/logo.png" alt="TixTracker" className="faq-nav-logo" />
          </Link>
          <div className="faq-nav-right">
            <Link href="/#features" className="faq-nav-link">Features</Link>
            <Link href="/#pricing" className="faq-nav-link">Pricing</Link>
            <a
              href="https://discord.gg/X3AY2KDg9v"
              target="_blank"
              rel="noopener noreferrer"
              className="faq-nav-discord"
            >
              <DiscordIcon size={14} />
              <span>Discord</span>
            </a>
            <Link href="/login" className="faq-nav-signin">Sign In →</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="faq-hero" aria-labelledby="faq-page-title">
        <div className="faq-hero-glow" />
        <div className="faq-hero-inner">
          <p className="faq-eyebrow">Help &amp; Support</p>
          <h1 className="faq-title" id="faq-page-title">How can we help?</h1>
          <p className="faq-hero-sub">
            Find answers to common questions about TixTracker.
          </p>
        </div>
      </section>

      {/* Sticky search + tabs */}
      <div className="faq-sticky-bar" role="search" aria-label="Search and filter FAQ">
        <div className="faq-sticky-inner">
          <div className="faq-search-wrap">
            <svg
              className="faq-search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              className="faq-search-input"
              type="search"
              placeholder="Search questions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search frequently asked questions"
            />
            {search && (
              <button
                className="faq-search-clear"
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <div className="faq-tabs" role="tablist" aria-label="Filter by category">
            <button
              role="tab"
              aria-selected={activeCat === "all"}
              className={`faq-tab${activeCat === "all" ? " faq-tab-active" : ""}`}
              onClick={() => setActiveCat("all")}
            >
              All
            </button>
            {CATS.map((cat) => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={activeCat === cat.id}
                className={`faq-tab${activeCat === cat.id ? " faq-tab-active" : ""}`}
                onClick={() => setActiveCat(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="faq-body">
        {/* Desktop sticky sidebar */}
        <aside className="faq-sidebar" aria-label="FAQ categories">
          <p className="faq-sidebar-heading">Categories</p>
          <nav>
            <button
              className={`faq-sidebar-cat${activeCat === "all" ? " faq-sidebar-cat-active" : ""}`}
              onClick={() => setActiveCat("all")}
            >
              All questions
            </button>
            {CATS.map((cat) => (
              <button
                key={cat.id}
                className={`faq-sidebar-cat${activeCat === cat.id ? " faq-sidebar-cat-active" : ""}`}
                onClick={() => setActiveCat(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="faq-main" id="faq-main" aria-label="FAQ content">
          {/* Popular questions — shown only when no filter/search active */}
          {!isFiltered && (
            <section className="faq-section" aria-label="Popular questions">
              <h2 className="faq-section-title">
                <span className="faq-section-icon">★</span>
                Popular questions
              </h2>
              <div className="faq-items">
                {popular.map((f) => (
                  <FaqItem key={f.id} faq={f} open={openIds.has(f.id)} onToggle={toggle} />
                ))}
              </div>
            </section>
          )}

          {/* Search results count */}
          {search && (
            <p className="faq-results-count" role="status" aria-live="polite">
              {totalResults === 0
                ? "No results"
                : `${totalResults} result${totalResults !== 1 ? "s" : ""}`}{" "}
              for <strong>&ldquo;{search}&rdquo;</strong>
            </p>
          )}

          {/* Empty state */}
          {totalResults === 0 && (
            <div className="faq-empty" role="status">
              <div className="faq-empty-icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h4>No results found</h4>
              <p>
                Try a different search term or{" "}
                <button
                  className="faq-empty-reset"
                  onClick={() => {
                    setSearch("");
                    setActiveCat("all");
                  }}
                >
                  browse all questions
                </button>
              </p>
            </div>
          )}

          {/* FAQ sections */}
          {filtered.map((cat) => (
            <section
              key={cat.id}
              id={`cat-${cat.id}`}
              className="faq-section"
              aria-label={cat.label}
            >
              <h2 className="faq-section-title">{cat.label}</h2>
              <div className="faq-items">
                {cat.faqs.map((f) => (
                  <FaqItem key={f.id} faq={f} open={openIds.has(f.id)} onToggle={toggle} />
                ))}
              </div>
            </section>
          ))}

          {/* Still need help */}
          <section className="faq-help" aria-label="Contact support">
            <div className="faq-help-glow" />
            <div className="faq-help-inner">
              <h3 className="faq-help-title">Still need help?</h3>
              <p className="faq-help-sub">
                Join our Discord community or reach out directly and we&apos;ll get back to you.
              </p>
              <div className="faq-help-btns">
                <a
                  href="https://discord.gg/X3AY2KDg9v"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="faq-discord-btn"
                >
                  <DiscordIcon size={16} />
                  Join Discord
                </a>
                <a href="mailto:support@tixtracker.app" className="faq-contact-btn">
                  Contact Support
                </a>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Footer */}
      <footer className="faq-footer">
        <Link href="/">
          <img src="/logo.png" alt="TixTracker" className="faq-footer-logo" />
        </Link>
        <p className="faq-footer-copy">© 2025 TixTracker · Built for ticket resellers.</p>
        <Link href="/" className="faq-footer-back">
          ← Back to home
        </Link>
      </footer>
    </div>
  );
}
