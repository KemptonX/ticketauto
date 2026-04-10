"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

type GmailAccount = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  provider: string;
  status: string;
  sync_mode: string;
  is_primary: boolean;
  is_active: boolean;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  scope: string | null;
  google_subject: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
];

export default function ConnectionsClient() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");

    if (connected) {
      setMessage(`Gmail connected: ${connected}`);
      void loadAccounts(true);
      return;
    }

    if (error) {
      setMessage(formatOAuthError(error));
    }
  }, [searchParams]);

  async function loadAccounts(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const { data, error } = await supabase
      .from("gmail_accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      setAccounts((data as GmailAccount[]) || []);
      if (showRefreshing && !searchParams.get("connected")) {
        setMessage("Connections refreshed");
      }
    }

    setLoading(false);
    setRefreshing(false);
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();

    if (!trimmedEmail) {
      setMessage("Enter a Gmail address");
      return;
    }

    setSubmitting(true);
    setMessage("");

    const { error } = await supabase.from("gmail_accounts").insert({
      email: trimmedEmail,
      display_name: trimmedName || null,
      provider: "gmail",
      status: "Needs OAuth",
      sync_mode: "manual",
      is_primary: accounts.length === 0,
      is_active: true,
    });

    if (error) {
      setMessage(error.message);
      setSubmitting(false);
      return;
    }

    setEmail("");
    setDisplayName("");
    await loadAccounts(true);
    setMessage("Inbox added");
    setSubmitting(false);
  }

  async function toggleAccount(account: GmailAccount) {
    const nextActive = !account.is_active;
    const nextStatus = nextActive
      ? account.status === "Paused"
        ? account.access_token
          ? "Ready"
          : "Needs OAuth"
        : account.status
      : "Paused";

    const { error } = await supabase
      .from("gmail_accounts")
      .update({
        is_active: nextActive,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadAccounts(true);
    setMessage(nextActive ? "Inbox resumed" : "Inbox paused");
  }

  async function setPrimary(account: GmailAccount) {
    setMessage("");

    for (const current of accounts) {
      const shouldBePrimary = current.id === account.id;
      if (current.is_primary === shouldBePrimary) {
        continue;
      }

      const { error } = await supabase
        .from("gmail_accounts")
        .update({
          is_primary: shouldBePrimary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);

      if (error) {
        setMessage(error.message);
        return;
      }
    }

    await loadAccounts(true);
    setMessage("Primary inbox updated");
  }

  async function removeAccount(account: GmailAccount) {
    const confirmed = window.confirm(`Remove ${account.email} from this member profile?`);
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("gmail_accounts").delete().eq("id", account.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadAccounts(true);
    setMessage("Inbox removed");
  }

  const metrics = useMemo(() => {
    const connected = accounts.length;
    const active = accounts.filter((account) => account.is_active).length;
    const oauthReady = accounts.filter((account) => account.status === "Ready").length;
    const primary = accounts.find((account) => account.is_primary);

    return [
      {
        label: "Connected inboxes",
        value: String(connected),
        detail: connected === 1 ? "1 mailbox on this profile" : `${connected} mailboxes on this profile`,
      },
      {
        label: "OAuth ready",
        value: String(oauthReady),
        detail: oauthReady === 0 ? "No Google tokens yet" : `${oauthReady} inboxes authorised`,
      },
      {
        label: "Active sync",
        value: String(active),
        detail: active === 0 ? "No live inboxes" : `${active} inboxes ready`,
      },
      {
        label: "Primary inbox",
        value: primary ? primary.email.split("@")[0] : "None",
        detail: primary ? primary.email : "Pick one inbox to lead sync",
      },
    ];
  }, [accounts]);

  return (
    <div className="orders-shell connections-shell">
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
          <div className="sidebar-panel">
            <p className="sidebar-panel-label">Connections</p>
            <strong>Inbox access</strong>
            <span>Each member keeps their own Gmail links, sync state, and mailbox list.</span>
          </div>

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

      <main className="orders-main connections-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Mailbox desk</p>
            <h2>Connections</h2>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void loadAccounts(true)}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <Link href="/api/gmail/connect" className="primary-button">
              Connect Gmail
            </Link>
          </div>
        </header>

        <section className="hero-card connections-hero">
          <div>
            <p className="section-tag">Connections</p>
            <h3>Connect Gmail per member</h3>
          </div>

          <div className="hero-meta">
            <div>
              <span className="hero-meta-label">Inboxes</span>
              <strong>{accounts.length}</strong>
            </div>
            <div>
              <span className="hero-meta-label">OAuth ready</span>
              <strong>{accounts.filter((a) => a.status === "Ready").length}</strong>
            </div>
          </div>
        </section>

        {message ? <div className="feedback-banner">{message}</div> : null}

        <section className="kpi-grid connections-kpi-grid">
          {metrics.map((metric) => (
            <article key={metric.label} className="kpi-card">
              <p className="kpi-label">{metric.label}</p>
              <strong className="kpi-value">{metric.value}</strong>
              <span className="kpi-trend">{metric.detail}</span>
            </article>
          ))}
        </section>

        <section className="command-card connections-command-card">
          <div className="command-header">
            <div>
              <p className="section-tag">Gmail</p>
              <h4>Connect or stage an inbox</h4>
            </div>
          </div>

          <div className="connections-cta-row">
            <div className="connections-cta-copy">
              <strong>Fastest setup</strong>
              <span>Use Google OAuth so the member can authorise Gmail directly from this page.</span>
            </div>
            <Link href="/api/gmail/connect" className="primary-button">
              Connect Gmail
            </Link>
          </div>

          <form className="connections-form" onSubmit={addAccount}>
            <label className="field-label">
              <span>Email</span>
              <input
                className="command-input"
                type="email"
                placeholder="tickets@yourdomain.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field-label">
              <span>Label</span>
              <input
                className="command-input"
                type="text"
                placeholder="Main inbox"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>

            <button type="submit" className="secondary-button" disabled={submitting}>
              {submitting ? "Adding..." : "Add manually"}
            </button>
          </form>
        </section>

        <section className="table-card connections-list-card">
          <div className="table-card-header">
            <div>
              <p className="section-tag">Inboxes</p>
              <h4>Mailbox list</h4>
            </div>
            <span className="table-count">{accounts.length} total</span>
          </div>

          {loading ? (
            <div className="empty-state compact-empty-state">
              <h5>Loading inboxes...</h5>
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state connections-empty-state">
              <div className="empty-orb" />
              <h5>No inboxes yet</h5>
              <p>Connect Gmail to let this member sync their own mailbox.</p>
              <Link href="/api/gmail/connect" className="primary-button">
                Connect first inbox
              </Link>
            </div>
          ) : (
            <div className="connections-list">
              {accounts.map((account) => (
                <article key={account.id} className="connection-card">
                  <div className="connection-card-main">
                    <div className="connection-card-topline">
                      <strong>{account.display_name || account.email}</strong>
                      <div className="connection-badges">
                        <span className={`status-badge ${connectionStatusClass(account.status)}`}>
                          {account.status}
                        </span>
                        {account.is_primary ? <span className="status-badge badge-primary">Primary</span> : null}
                        {!account.is_active ? <span className="status-badge badge-paused">Paused</span> : null}
                      </div>
                    </div>
                    <p className="connection-email">{account.email}</p>
                    <div className="connection-meta-grid">
                      <div>
                        <span className="connection-meta-label">Provider</span>
                        <strong>{account.provider}</strong>
                      </div>
                      <div>
                        <span className="connection-meta-label">Mode</span>
                        <strong>{account.sync_mode}</strong>
                      </div>
                      <div>
                        <span className="connection-meta-label">Last sync</span>
                        <strong>{account.last_synced_at ? formatDateTime(account.last_synced_at) : "Pending"}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="connection-card-actions">
                    {account.status !== "Ready" ? (
                      <Link href="/api/gmail/connect" className="primary-button">
                        Connect
                      </Link>
                    ) : null}
                    {!account.is_primary ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void setPrimary(account)}
                      >
                        Set primary
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void toggleAccount(account)}
                    >
                      {account.is_active ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger-button"
                      onClick={() => void removeAccount(account)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

    </div>
  );
}

function connectionStatusClass(status: string) {
  switch (status) {
    case "Ready":
      return "badge-sold";
    case "Paused":
      return "badge-unlisted";
    case "Needs OAuth":
      return "badge-listed";
    default:
      return "badge-problem";
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatOAuthError(error: string) {
  switch (error) {
    case "access_denied":
      return "Google access was denied";
    case "state-mismatch":
      return "Google sign-in expired. Try Connect Gmail again.";
    case "missing-google-client":
    case "missing-google-config":
      return "Google OAuth env vars are missing";
    case "not-signed-in":
      return "Sign in before connecting Gmail";
    case "gmail-profile-failed":
      return "Google connected, but profile lookup failed";
    default:
      return error.replaceAll("-", " ");
  }
}



