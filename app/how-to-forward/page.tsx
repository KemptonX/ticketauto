import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Forward Emails — TixTracker",
  description:
    "Step-by-step guides for forwarding ticket confirmation emails to TixTracker from Gmail, Outlook, Apple Mail, Yahoo Mail, ProtonMail, and more.",
};

const ADDR_PLACEHOLDER = "scan+yourtoken@inbound.tixtracker.app";

const S = {
  page: {
    minHeight: "100vh",
    background: "#0a0a0a",
    color: "rgba(255,255,255,0.85)",
    fontFamily: "var(--font-geist-sans, system-ui, sans-serif)",
    padding: "0 1rem 4rem",
  } as React.CSSProperties,
  inner: {
    maxWidth: 760,
    margin: "0 auto",
  } as React.CSSProperties,
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1.5rem 0",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    marginBottom: "2.5rem",
  } as React.CSSProperties,
  logo: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "#fff",
    textDecoration: "none",
    letterSpacing: "-0.02em",
  } as React.CSSProperties,
  backLink: {
    fontSize: "0.82rem",
    color: "rgba(255,255,255,0.45)",
    textDecoration: "none",
  } as React.CSSProperties,
  h1: {
    fontSize: "clamp(1.5rem, 4vw, 2rem)",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    margin: "0 0 0.5rem",
    lineHeight: 1.2,
  } as React.CSSProperties,
  lead: {
    fontSize: "0.95rem",
    color: "rgba(255,255,255,0.5)",
    margin: "0 0 2.5rem",
    lineHeight: 1.65,
  } as React.CSSProperties,
  addrBox: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 18px",
    borderRadius: 10,
    background: "rgba(165,170,255,0.07)",
    border: "1px solid rgba(165,170,255,0.2)",
    marginBottom: "2.5rem",
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  addrLabel: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#a5aaff",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  addrCode: {
    fontFamily: "var(--font-geist-mono, monospace)",
    fontSize: "0.82rem",
    color: "#a5aaff",
    wordBreak: "break-all" as const,
  } as React.CSSProperties,
  addrNote: {
    fontSize: "0.75rem",
    color: "rgba(255,255,255,0.35)",
    marginTop: 4,
  } as React.CSSProperties,
  providerCard: {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.025)",
    marginBottom: "1.5rem",
    overflow: "hidden",
  } as React.CSSProperties,
  providerHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "1rem 1.25rem",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  } as React.CSSProperties,
  providerDot: (color: string) => ({
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }) as React.CSSProperties,
  providerName: {
    fontWeight: 700,
    fontSize: "0.95rem",
    margin: 0,
  } as React.CSSProperties,
  providerSub: {
    fontSize: "0.75rem",
    color: "rgba(255,255,255,0.4)",
    marginLeft: "auto",
  } as React.CSSProperties,
  providerBody: {
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  } as React.CSSProperties,
  methodLabel: {
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.35)",
    marginBottom: 6,
  } as React.CSSProperties,
  ol: {
    margin: 0,
    paddingLeft: "1.4rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } as React.CSSProperties,
  li: {
    fontSize: "0.875rem",
    color: "rgba(255,255,255,0.65)",
    lineHeight: 1.6,
  } as React.CSSProperties,
  strong: {
    color: "rgba(255,255,255,0.9)",
    fontWeight: 600,
  } as React.CSSProperties,
  divider: {
    border: "none",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    margin: "0 0 1rem",
  } as React.CSSProperties,
  tip: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "rgba(103,240,165,0.07)",
    border: "1px solid rgba(103,240,165,0.2)",
    fontSize: "0.82rem",
    color: "rgba(255,255,255,0.6)",
    lineHeight: 1.55,
  } as React.CSSProperties,
  tipGreen: {
    color: "#67F0A5",
    fontWeight: 600,
  } as React.CSSProperties,
  note: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    fontSize: "0.82rem",
    color: "rgba(255,255,255,0.45)",
    lineHeight: 1.55,
  } as React.CSSProperties,
  sectionH2: {
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    color: "rgba(255,255,255,0.3)",
    margin: "2rem 0 1rem",
  } as React.CSSProperties,
};

function Step({ children }: { children: React.ReactNode }) {
  return <li style={S.li}>{children}</li>;
}
function B({ children }: { children: React.ReactNode }) {
  return <strong style={S.strong}>{children}</strong>;
}

export default function HowToForwardPage() {
  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.topbar}>
          <Link href="/" style={S.logo}>TixTracker</Link>
          <Link href="/settings?tab=connections" style={S.backLink}>← Back to Settings</Link>
        </div>

        <h1 style={S.h1}>How to forward emails to TixTracker</h1>
        <p style={S.lead}>
          Forward any ticket confirmation email to your unique TixTracker address and it will be scanned and imported automatically — no app access required. Works with every major email provider.
        </p>

        <div style={S.addrBox}>
          <span style={S.addrLabel}>Your address</span>
          <span style={S.addrCode}>{ADDR_PLACEHOLDER}</span>
        </div>
        <p style={{ ...S.addrNote, marginBottom: "2.5rem", marginTop: "-2rem" }}>
          Your actual forwarding address is shown in <Link href="/settings?tab=connections" style={{ color: "#a5aaff" }}>Settings → Connections</Link>. Copy it from there.
        </p>

        <div style={S.tip}>
          <span style={S.tipGreen}>Any provider works.</span> You can forward emails manually one at a time, or set up an automatic rule so every ticket email is forwarded without any extra clicks. Both methods work identically.
        </div>

        <h2 style={S.sectionH2}>Step-by-step guides</h2>

        {/* ── Gmail ── */}
        <div style={S.providerCard}>
          <div style={S.providerHeader}>
            <span style={S.providerDot("#EA4335")} />
            <p style={S.providerName}>Gmail</p>
            <span style={S.providerSub}>gmail.com</span>
          </div>
          <div style={S.providerBody}>
            <div>
              <p style={S.methodLabel}>Manual — forward one email at a time</p>
              <ol style={S.ol}>
                <Step>Open the ticket confirmation email in Gmail.</Step>
                <Step>Click the <B>three-dot menu (⋮)</B> in the top-right of the email, then click <B>Forward</B>.</Step>
                <Step>In the To field, enter your TixTracker forwarding address.</Step>
                <Step>Click <B>Send</B>. The email will be processed within seconds.</Step>
              </ol>
            </div>
            <hr style={S.divider} />
            <div>
              <p style={S.methodLabel}>Automatic — forward all matching emails without extra clicks</p>
              <ol style={S.ol}>
                <Step>In Gmail, click the <B>Settings cog → See all settings</B>.</Step>
                <Step>Go to the <B>Forwarding and POP/IMAP</B> tab.</Step>
                <Step>Click <B>Add a forwarding address</B> and paste your TixTracker address.</Step>
                <Step>Gmail will send a verification email to your TixTracker address. TixTracker receives it automatically — return to Settings and you&apos;ll see the verification code in the Email Forwarding section. Enter it in Gmail to confirm.</Step>
                <Step>(Recommended) Instead of forwarding all email, create a filter: go to <B>Settings → Filters and Blocked Addresses → Create a new filter</B>. In the <B>From</B> field add <code style={{ fontFamily: "monospace", fontSize: "0.8em" }}>ticketmaster.com OR axs.com OR viagogo.com OR stubhub.com OR ticombo.com</code>, then choose <B>Forward to</B> your TixTracker address.</Step>
              </ol>
            </div>
          </div>
        </div>

        {/* ── Outlook ── */}
        <div style={S.providerCard}>
          <div style={S.providerHeader}>
            <span style={S.providerDot("#0078D4")} />
            <p style={S.providerName}>Outlook / Hotmail / Live</p>
            <span style={S.providerSub}>outlook.com · hotmail.com · live.com</span>
          </div>
          <div style={S.providerBody}>
            <div>
              <p style={S.methodLabel}>Manual — forward one email at a time</p>
              <ol style={S.ol}>
                <Step>Open the ticket email in Outlook.</Step>
                <Step>Click <B>Forward</B> (or press <B>Ctrl + F</B>).</Step>
                <Step>Enter your TixTracker address in the To field and click <B>Send</B>.</Step>
              </ol>
            </div>
            <hr style={S.divider} />
            <div>
              <p style={S.methodLabel}>Automatic — via Outlook web rules</p>
              <ol style={S.ol}>
                <Step>Go to <B>outlook.com</B> and click <B>Settings (cog) → View all Outlook settings</B>.</Step>
                <Step>Go to <B>Mail → Rules → Add new rule</B>.</Step>
                <Step>Set the condition to <B>From</B> one of your ticket senders (e.g. ticketmaster.com).</Step>
                <Step>Set the action to <B>Forward to</B> and enter your TixTracker address.</Step>
                <Step>Click <B>Save</B>. New matching emails will be forwarded automatically.</Step>
              </ol>
            </div>
          </div>
        </div>

        {/* ── Apple Mail / iCloud ── */}
        <div style={S.providerCard}>
          <div style={S.providerHeader}>
            <span style={S.providerDot("#555") } />
            <p style={S.providerName}>Apple Mail / iCloud Mail</p>
            <span style={S.providerSub}>icloud.com · me.com · mac.com</span>
          </div>
          <div style={S.providerBody}>
            <div>
              <p style={S.methodLabel}>Manual — from Apple Mail (Mac)</p>
              <ol style={S.ol}>
                <Step>Select the ticket email in Apple Mail.</Step>
                <Step>Press <B>⇧⌘F</B> or go to <B>Message → Forward</B>.</Step>
                <Step>Enter your TixTracker address and click <B>Send</B>.</Step>
              </ol>
            </div>
            <hr style={S.divider} />
            <div>
              <p style={S.methodLabel}>Manual — from iCloud.com (web)</p>
              <ol style={S.ol}>
                <Step>Open the email at <B>icloud.com/mail</B>.</Step>
                <Step>Click the <B>Forward</B> arrow icon in the toolbar.</Step>
                <Step>Enter your TixTracker address and click <B>Send</B>.</Step>
              </ol>
            </div>
            <hr style={S.divider} />
            <div>
              <p style={S.methodLabel}>Automatic — iCloud rules</p>
              <ol style={S.ol}>
                <Step>Go to <B>icloud.com/mail</B> → <B>Settings (cog) → Rules → Add a Rule</B>.</Step>
                <Step>Set the condition: <B>From</B> contains your ticket sender domain.</Step>
                <Step>Set the action: <B>Forward to</B> your TixTracker address.</Step>
                <Step>Click <B>Done</B>.</Step>
              </ol>
            </div>
          </div>
        </div>

        {/* ── Yahoo ── */}
        <div style={S.providerCard}>
          <div style={S.providerHeader}>
            <span style={S.providerDot("#720E9E")} />
            <p style={S.providerName}>Yahoo Mail</p>
            <span style={S.providerSub}>yahoo.com · ymail.com</span>
          </div>
          <div style={S.providerBody}>
            <div>
              <p style={S.methodLabel}>Manual — forward one email at a time</p>
              <ol style={S.ol}>
                <Step>Open the ticket email in Yahoo Mail.</Step>
                <Step>Click the <B>Forward</B> button (paper plane with arrow) or press <B>F</B>.</Step>
                <Step>Enter your TixTracker address and click <B>Send</B>.</Step>
              </ol>
            </div>
            <hr style={S.divider} />
            <div style={S.note}>
              Yahoo Mail free accounts don&apos;t support automatic email forwarding to external addresses. Manual forwarding (above) is the easiest option. Yahoo Mail Pro and Yahoo Business Mail do support forwarding rules.
            </div>
          </div>
        </div>

        {/* ── ProtonMail ── */}
        <div style={S.providerCard}>
          <div style={S.providerHeader}>
            <span style={S.providerDot("#6D4AFF")} />
            <p style={S.providerName}>Proton Mail</p>
            <span style={S.providerSub}>proton.me · protonmail.com</span>
          </div>
          <div style={S.providerBody}>
            <div>
              <p style={S.methodLabel}>Manual — forward one email at a time</p>
              <ol style={S.ol}>
                <Step>Open the email in Proton Mail.</Step>
                <Step>Click the <B>Forward</B> button or press <B>Ctrl + Shift + F</B>.</Step>
                <Step>Enter your TixTracker address and click <B>Send</B>.</Step>
              </ol>
            </div>
            <hr style={S.divider} />
            <div>
              <p style={S.methodLabel}>Automatic — Proton Mail filters (paid plans)</p>
              <ol style={S.ol}>
                <Step>Go to <B>Settings → All settings → Filters → Add filter</B>.</Step>
                <Step>Add a condition matching your ticket sender (e.g. From contains ticketmaster.com).</Step>
                <Step>Add action <B>Forward to</B> and enter your TixTracker address.</Step>
                <Step>Save and enable the filter.</Step>
              </ol>
            </div>
          </div>
        </div>

        {/* ── Any other provider ── */}
        <div style={S.providerCard}>
          <div style={S.providerHeader}>
            <span style={S.providerDot("rgba(255,255,255,0.25)")} />
            <p style={S.providerName}>Any other email client</p>
            <span style={S.providerSub}>Zoho, Fastmail, Thunderbird, Samsung Mail…</span>
          </div>
          <div style={S.providerBody}>
            <p style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.65 }}>
              Every modern email client has a Forward button. Simply open the ticket confirmation email, click Forward, enter your TixTracker address, and send. If your provider supports inbox rules or filters, look for a <B>Forward to</B> action and apply it to emails from your ticket sender domains.
            </p>
          </div>
        </div>

        <div style={{ ...S.tip, marginTop: "1rem" }}>
          <span style={S.tipGreen}>Supported ticket providers:</span> Ticketmaster, AXS, Viagogo, StubHub, Ticombo — and more. If a provider isn&apos;t recognised yet, the email will still be received and logged, and support can be added.
        </div>

        <div style={{ marginTop: "2rem", textAlign: "center" as const }}>
          <Link href="/settings?tab=connections#email-forwarding-section" style={{ fontSize: "0.875rem", color: "#a5aaff", textDecoration: "none" }}>
            ← Back to Settings to copy your forwarding address
          </Link>
        </div>
      </div>
    </div>
  );
}
