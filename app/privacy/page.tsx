import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — TixTracker",
  description: "How TixTracker collects, uses and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="legal-logo-link">
          <img src="/logo.png" alt="TixTracker" className="legal-logo" />
        </Link>
      </header>

      <main className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: June 2025</p>

        <p>
          TixTracker (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) helps ticket resellers track ticket purchases, ticket
          sales, transfers, payouts, profit, analytics and cash flow. This Privacy Policy explains what
          data we collect, how we use it, and your rights over it.
        </p>

        <h2>1. Data We Collect</h2>
        <h3>Account data</h3>
        <p>
          When you create a TixTracker account we collect your email address and any profile
          information provided by the identity provider you use (Discord or email/password via
          Supabase Auth).
        </p>
        <h3>Ticket data you enter</h3>
        <p>
          Information you manually enter into TixTracker — event names, venue, dates, prices,
          quantities, sale prices, payout amounts, buyer details — is stored in our database and is
          visible only to you.
        </p>
        <h3>Google user data</h3>
        <p>
          If you choose to connect your Google account, TixTracker requests Gmail access
          (<code>https://www.googleapis.com/auth/gmail.modify</code> and{" "}
          <code>https://www.googleapis.com/auth/gmail.labels</code>) to scan ticket-related emails,
          mark successfully processed emails as read, and organise them with Gmail labels.
        </p>
        <p>TixTracker uses Google user data only to provide the following features inside your account:</p>
        <ul>
          <li>Automatically importing ticket purchase orders from confirmation emails</li>
          <li>Importing sale, transfer and payout information from provider emails</li>
          <li>Populating your TixTracker dashboard with ticket inventory, profit and analytics</li>
          <li>
            Marking successfully processed ticket emails as read so they are not re-scanned
            unnecessarily
          </li>
          <li>
            Creating and applying Gmail labels (such as &ldquo;My Tickets&rdquo;) to processed ticket
            emails to help you identify which emails have already been imported
          </li>
        </ul>
        <p>
          TixTracker only scans emails from supported ticket providers (Ticketmaster, AXS, Viagogo,
          StubHub, Ticombo). Unrelated personal emails are never read or processed.
        </p>
        <p>
          Extracted information may include: event name, venue, event date, order reference, ticket
          quantity, section, row, seat numbers, purchase price, sale price, payout amount, buyer
          details, platform and transfer status.
        </p>

        <h2>2. How We Use Your Data</h2>
        <ul>
          <li>To operate and provide the TixTracker service</li>
          <li>To display your ticket inventory, sales, profit and analytics</li>
          <li>To import ticket data from emails you authorise us to read</li>
          <li>To maintain and improve the service</li>
        </ul>

        <h2>3. What We Do Not Do With Google Data</h2>
        <ul>
          <li>We do <strong>not</strong> send emails from your account</li>
          <li>We do <strong>not</strong> compose emails</li>
          <li>We do <strong>not</strong> delete emails</li>
          <li>We do <strong>not</strong> permanently delete emails</li>
          <li>We do <strong>not</strong> archive unrelated emails</li>
          <li>We do <strong>not</strong> access Gmail data for advertising</li>
          <li>We do <strong>not</strong> sell Google user data</li>
          <li>We do <strong>not</strong> use Google user data for serving ads</li>
          <li>
            We do <strong>not</strong> allow humans to read your Google data unless required for
            security, legal compliance, debugging with your explicit permission, or support you have
            requested
          </li>
        </ul>
        <p>
          TixTracker Gmail access is limited to: reading ticket-related emails, marking those emails
          as read after successful import, and applying organisational labels to them. We do not
          scan or store unrelated personal emails.
        </p>

        <h2>4. Data Storage and Security</h2>
        <p>
          Your data is stored in Supabase (PostgreSQL), hosted on secure EU/US cloud infrastructure.
          OAuth tokens used to access Gmail are stored server-side and are never exposed to the
          browser or third parties. All connections use HTTPS/TLS.
        </p>
        <p>
          Access to your data is restricted by row-level security — only you can read or write your
          own account&apos;s data.
        </p>

        <h2>5. Data Sharing</h2>
        <p>
          We do not sell, rent or share your personal data with third parties for commercial
          purposes. We may share data with:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — our database and authentication provider
          </li>
          <li>
            <strong>Vercel</strong> — our hosting provider
          </li>
          <li>Law enforcement if required by applicable law</li>
        </ul>

        <h2>6. Connecting and Disconnecting Gmail</h2>
        <p>
          Gmail connection is optional. You can connect your Gmail account at any time from the
          Settings page inside TixTracker. You can disconnect your Gmail account at any time by
          visiting <strong>Settings → Connections</strong> and clicking <strong>Disconnect Gmail</strong>. Disconnecting removes our access to your Gmail and stops all
          future email scans.
        </p>
        <p>
          You can also revoke TixTracker&apos;s Gmail access at any time from your{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account permissions
          </a>{" "}
          page.
        </p>

        <h2>7. Data Deletion</h2>
        <p>
          You can request deletion of your TixTracker account and all associated data by contacting
          us at <a href="mailto:support@tixtracker.app">support@tixtracker.app</a>. We will process
          deletion requests within 30 days.
        </p>
        <p>
          Disconnecting Gmail (see Section 6) removes stored Gmail tokens from our database. Any
          ticket data already imported prior to disconnection remains in your TixTracker account
          unless you explicitly request account deletion.
        </p>

        <h2>8. Cookies</h2>
        <p>
          TixTracker uses cookies only for authentication session management. We do not use
          advertising cookies or third-party tracking cookies.
        </p>

        <h2>9. Children&apos;s Privacy</h2>
        <p>
          TixTracker is not directed at individuals under the age of 18. We do not knowingly collect
          personal data from children.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material
          changes by updating the date at the top of this page. Continued use of TixTracker after
          changes constitutes acceptance of the updated policy.
        </p>

        <h2>11. Contact</h2>
        <p>
          If you have questions about this Privacy Policy or your data, contact us at:{" "}
          <a href="mailto:support@tixtracker.app">support@tixtracker.app</a>
        </p>
      </main>

      <footer className="legal-footer">
        <Link href="/">← Back to TixTracker</Link>
        <span>·</span>
        <Link href="/terms">Terms of Service</Link>
      </footer>
    </div>
  );
}
