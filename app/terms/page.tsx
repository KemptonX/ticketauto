import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — TixTracker",
  description: "Terms and conditions for using TixTracker.",
};

export default function TermsPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="legal-logo-link">
          <img src="/logo.png" alt="TixTracker" className="legal-logo" />
        </Link>
      </header>

      <main className="legal-content">
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: June 2025</p>

        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of TixTracker, a dashboard for
          professional ticket resellers operated by TixTracker (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
          &ldquo;our&rdquo;). By accessing or using TixTracker you agree to these Terms.
        </p>

        <h2>1. What TixTracker Does</h2>
        <p>
          TixTracker is a private dashboard that helps ticket resellers track ticket purchases, sales,
          transfers, payouts, profit, analytics and cash flow. Users may optionally connect a Gmail or
          Outlook inbox so TixTracker can automatically import ticket-related email data from supported
          providers (Ticketmaster, AXS, Viagogo, StubHub, Ticombo).
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old to use TixTracker. By using the service you represent
          that you meet this requirement.
        </p>

        <h2>3. User Responsibilities</h2>
        <p>You are responsible for:</p>
        <ul>
          <li>Keeping your account credentials secure</li>
          <li>All activity that occurs under your account</li>
          <li>Ensuring the accuracy of data you enter or import</li>
          <li>Complying with the terms of service of any connected email provider (Gmail, Outlook)</li>
          <li>
            Complying with applicable laws and regulations relating to ticket reselling in your
            jurisdiction
          </li>
        </ul>
        <p>
          You must not use TixTracker to process data you are not authorised to access, or for any
          unlawful purpose.
        </p>

        <h2>4. Gmail Connection — Optional</h2>
        <p>
          Connecting Gmail is entirely optional. If you choose to connect Gmail, TixTracker requests
          read-only access to scan your inbox for ticket-related emails from supported providers only.
          You can disconnect Gmail at any time from Settings. TixTracker is not responsible for any
          emails not detected or data not imported.
        </p>

        <h2>5. Data Accuracy</h2>
        <p>
          TixTracker attempts to extract ticket data from emails automatically. However, email formats
          vary and extraction may not be perfect. You are responsible for reviewing imported data and
          correcting any inaccuracies. TixTracker makes no guarantee that all emails will be scanned
          or that all extracted data will be accurate or complete.
        </p>

        <h2>6. No Affiliation With Ticket Platforms</h2>
        <p>
          TixTracker is an independent service and is not affiliated with, endorsed by, or partnered
          with Ticketmaster, AXS, Viagogo, StubHub, Ticombo or any other ticket platform or marketplace.
          These are trademarks of their respective owners.
        </p>

        <h2>7. Intellectual Property</h2>
        <p>
          All content, software and design in TixTracker is owned by TixTracker or its licensors.
          You may not copy, reproduce, distribute or create derivative works without our express
          written permission.
        </p>

        <h2>8. Disclaimer of Warranties</h2>
        <p>
          TixTracker is provided &ldquo;as is&rdquo; without warranty of any kind. We do not warrant that the
          service will be uninterrupted, error-free or that all email data will be successfully
          imported. Use of the service is at your own risk.
        </p>

        <h2>9. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, TixTracker shall not be liable for any indirect,
          incidental, special, consequential or punitive damages arising from your use of the service,
          including any loss of profit, data or revenue.
        </p>

        <h2>10. Account Termination</h2>
        <p>
          We reserve the right to suspend or terminate your account at any time if you violate these
          Terms or for any other reason at our sole discretion, with or without notice.
        </p>
        <p>
          You may close your account at any time by contacting{" "}
          <a href="mailto:support@tixtracker.app">support@tixtracker.app</a>. We will delete your
          account data within 30 days.
        </p>

        <h2>11. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify you of material changes by
          updating the date at the top of this page. Continued use of TixTracker after changes
          constitutes acceptance of the updated Terms.
        </p>

        <h2>12. Governing Law</h2>
        <p>
          These Terms are governed by the laws of England and Wales. Any disputes shall be subject
          to the exclusive jurisdiction of the courts of England and Wales.
        </p>

        <h2>13. Contact</h2>
        <p>
          Questions about these Terms?{" "}
          <a href="mailto:support@tixtracker.app">support@tixtracker.app</a>
        </p>
      </main>

      <footer className="legal-footer">
        <Link href="/">← Back to TixTracker</Link>
        <span>·</span>
        <Link href="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}
