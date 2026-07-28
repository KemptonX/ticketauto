"use client";

import Link from "next/link";
import { useState } from "react";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Presale & Codes", href: "/presale", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "FAQ", href: "/faq", active: true, target: "_blank", rel: "noopener noreferrer" },
];

async function handleLogout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export default function GuidesClient() {
  const [search, setSearch] = useState("");

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
                target={item.target}
                rel={item.rel}
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
            <p className="eyebrow">Resources</p>
            <h2>Guides</h2>
          </div>
          <div className="topbar-actions">
            <input
              className="field field-search"
              placeholder="Search guides..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
          </div>
        </header>

        <section className="table-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Help &amp; Resources</p>
              <h4>Getting started</h4>
            </div>
          </div>
          <div className="state-card">
            <div className="state-orb state-orb-muted" />
            <h5>No guides yet</h5>
            <p>Guides and resources will appear here once added.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
