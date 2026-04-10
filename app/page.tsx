import Link from "next/link";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import DeskClient from "./desk-client";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <DeskClient />;
  }

  return (
    <main className="home-shell">
      <div className="home-glow-top" />
      <div className="home-glow-bottom" />

      <div className="home-center">
        <div className="brand-mark home-brand-mark">TA</div>

        <p className="eyebrow home-eyebrow">Ticket intelligence</p>

        <h1 className="home-headline">Know your book.</h1>

        <p className="home-sub">
          Track stock, match Viagogo sales, and read live profit —
          <br />
          all from a single inbox-powered dashboard.
        </p>

        <div className="home-actions">
          <Link href="/login" className="primary-button home-cta-primary">
            Sign in
          </Link>
        </div>

        <div className="home-feature-row">
          <div className="home-feature">
            <span className="home-feature-dot home-dot-pink" />
            <div>
              <strong>Gmail sync</strong>
              <span>Ticketmaster orders in one scan</span>
            </div>
          </div>
          <div className="home-feature">
            <span className="home-feature-dot home-dot-purple" />
            <div>
              <strong>Sales matching</strong>
              <span>Viagogo sales auto-linked to inventory</span>
            </div>
          </div>
          <div className="home-feature">
            <span className="home-feature-dot home-dot-blue" />
            <div>
              <strong>Live profit</strong>
              <span>ROI and P&amp;L across every event</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
