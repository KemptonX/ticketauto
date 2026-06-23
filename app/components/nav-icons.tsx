// Shared sidebar navigation icons — no interactivity, no "use client" needed

type IconProps = { className?: string };

function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      className={`nav-item-icon${className ? ` ${className}` : ""}`}
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// ─── Page icons ───────────────────────────────────────────────────────────────

export function IconDashboard(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function IconTickets(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5V9z" />
      <line x1="9" y1="7" x2="9" y2="17" strokeDasharray="2 2" />
    </Icon>
  );
}

export function IconSales(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="12" y2="17" />
    </Icon>
  );
}

export function IconAnalytics(p: IconProps) {
  return (
    <Icon {...p}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </Icon>
  );
}

export function IconCosts(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </Icon>
  );
}

export function IconCalculator(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <rect x="7" y="5" width="10" height="4" rx="1" />
      <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
      <rect x="14" y="16.5" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconScans(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="22" y2="22" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="11" y1="8" x2="11" y2="14" />
    </Icon>
  );
}

export function IconClients(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
    </Icon>
  );
}

export function IconInventory(p: IconProps) {
  return (
    <Icon {...p}>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </Icon>
  );
}

export function IconGuides(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Icon>
  );
}

export function IconArchive(p: IconProps) {
  return (
    <Icon {...p}>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </Icon>
  );
}

export function IconCashFlow(p: IconProps) {
  return (
    <Icon {...p}>
      <polyline points="2 18 7 11 12 15 17 7 22 10" />
      <polyline points="17 7 22 7 22 12" />
      <line x1="2" y1="22" x2="22" y2="22" />
    </Icon>
  );
}

// ─── Sidebar footer icons ─────────────────────────────────────────────────────

export function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ─── Icon lookup by route href ────────────────────────────────────────────────

const ICON_MAP: Record<string, (p: IconProps) => React.JSX.Element> = {
  "/": IconDashboard,
  "/orders": IconTickets,
  "/sales": IconSales,
  "/analytics": IconAnalytics,
  "/cash-flow": IconCashFlow,
  "/costs": IconCosts,
  "/viagogo-calculator": IconCalculator,
  "/scans": IconScans,
  "/clients": IconClients,
  "/guides": IconGuides,
  "/faq": IconGuides,
  "/inventory": IconInventory,
  "/archived-orders": IconArchive,
  "/archived-sales": IconArchive,
  "/settings": IconSettings,
};

export function NavIcon({ href }: { href: string }) {
  const Icon = ICON_MAP[href] ?? IconDashboard;
  return <Icon />;
}

// ─── Sidebar brand mark ───────────────────────────────────────────────────────

export function SidebarLogo() {
  return (
    <div className="sidebar-brand-wrap">
      <img src="/logo.png" alt="TixTracker" className="sidebar-brand-img" />
      <span className="sidebar-version">v0.63</span>
    </div>
  );
}

// ─── Sidebar footer ───────────────────────────────────────────────────────────

export function SidebarFooter({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="sidebar-footer">
      <div className="sidebar-settings-box">
        <p className="sidebar-settings-label">Settings</p>
        <a href="/settings" className="sidebar-settings-row">
          <IconSettings />
          <span>Settings</span>
        </a>
        <button type="button" className="sidebar-settings-row sidebar-logout-row" onClick={onLogout}>
          <IconLogout />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}
