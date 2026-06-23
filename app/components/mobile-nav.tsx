"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  IconDashboard, IconTickets, IconSales, IconAnalytics,
  IconCashFlow, IconCosts, IconCalculator, IconScans,
  IconInventory, IconGuides, IconSettings, IconLogout,
} from "./nav-icons";

const MAIN_TABS = [
  { href: "/",          label: "Dashboard", icon: () => <IconDashboard /> },
  { href: "/orders",    label: "Tickets",   icon: () => <IconTickets /> },
  { href: "/sales",     label: "Sales",     icon: () => <IconSales /> },
  { href: "/analytics", label: "Analytics", icon: () => <IconAnalytics /> },
];

const MORE_ITEMS = [
  { href: "/cash-flow",           label: "Cash Flow",   icon: () => <IconCashFlow /> },
  { href: "/costs",               label: "Costs",       icon: () => <IconCosts /> },
  { href: "/viagogo-calculator",  label: "Calculator",  icon: () => <IconCalculator /> },
  { href: "/scans",               label: "Scans",       icon: () => <IconScans /> },
  { href: "/inventory",           label: "Inventory",   icon: () => <IconInventory /> },
  { href: "/faq",                 label: "FAQ",         icon: () => <IconGuides />, newTab: true },
  { href: "/settings",            label: "Settings",    icon: () => <IconSettings /> },
];

export default function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Hide on auth / public pages
  if (pathname === "/login" || pathname.startsWith("/faq")) return null;

  const isMoreActive = MORE_ITEMS.some((item) => pathname === item.href);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      {moreOpen && (
        <div
          className="mob-more-overlay"
          aria-hidden
          onClick={() => setMoreOpen(false)}
        />
      )}

      {moreOpen && (
        <div className="mob-more-drawer" role="dialog" aria-label="More navigation">
          <div className="mob-more-handle" />
          <div className="mob-more-grid">
            {MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`mob-more-item${pathname === item.href ? " mob-more-item-active" : ""}`}
                onClick={() => setMoreOpen(false)}
                target={item.newTab ? "_blank" : undefined}
                rel={item.newTab ? "noopener noreferrer" : undefined}
              >
                {item.icon()}
                <span>{item.label}</span>
              </Link>
            ))}
            <button
              type="button"
              className="mob-more-item mob-more-logout"
              onClick={() => void handleLogout()}
            >
              <IconLogout />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}

      <nav className="mob-bottom-nav" aria-label="Main navigation">
        {MAIN_TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`mob-tab${active ? " mob-tab-active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => setMoreOpen(false)}
            >
              {tab.icon()}
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`mob-tab${isMoreActive || moreOpen ? " mob-tab-active" : ""}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-label="More"
        >
          <DotsIcon />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}

function DotsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="5"  cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
