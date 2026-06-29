"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SPLIT_RULE_LABELS, splitRulesForQty } from "@/src/lib/marketplace/types";
import type { SplitRule, TicketStorageProvider, JobStatus, ValidationError } from "@/src/lib/marketplace/types";

type Order = {
  id: number;
  event_name: string | null;
  event_date: string | null;
  venue: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  qty_bought: number | null;
  total_cost: number | null;
  source_type: string | null;
  booking_ref: string | null;
};

type MarketplaceAccount = {
  id: string;
  marketplace: string;
  display_email: string | null;
  status: string;
  can_list: boolean;
};

type EventMatch = {
  id: string;
  viagogo_event_id: string;
  viagogo_event_name: string;
  viagogo_event_date: string;
  viagogo_event_url: string;
  viagogo_venue: string;
  viagogo_city: string;
  viagogo_country: string;
  tixtracker_event_name: string;
  tixtracker_event_date: string;
  tixtracker_venue: string;
  confirmed_by_user: boolean;
  match_status: string;
};

type Draft = {
  id: string;
  order_id: number;
  marketplace_account_id: string | null;
  event_match_id: string | null;
  viagogo_event_id: string | null;
  status: string;
  quantity: number | null;
  split_rule: string | null;
  ticket_type: string;
  ticket_storage_provider: string | null;
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  price_per_ticket: number | null;
  currency: string;
  face_value_per_ticket: number | null;
  listing_features: string;
  comments: string;
  restrictions: string;
  limitations: string;
  about_you_confirmed: boolean;
  terms_confirmed: boolean;
  validation_errors: ValidationError[] | null;
};

type JobPoll = {
  id: string;
  status: JobStatus;
  current_step: string | null;
  error_message: string | null;
  result_listing_id: string | null;
  result_listing_url: string | null;
  pending_verification: boolean;
  verification_expires_at: string | null;
};

const RESTRICTIONS = [
  "none",
  "Standing 14+",
  "Standing 16+",
  "No Under 14s",
  "No Under 16s",
  "Under 14 accompanied by an adult",
  "Under 15s accompanied by an adult",
  "Under 16s accompanied by an adult",
];
const COMMENTS_OPTIONS = ["none", "Standing only"];
const FEATURES_OPTIONS  = ["none"];
const LIMITATIONS_OPTIONS = ["none"];

const STORAGE_PROVIDERS: { value: TicketStorageProvider; label: string }[] = [
  { value: "ticketmaster", label: "Ticketmaster" },
  { value: "axs",          label: "AXS" },
  { value: "seatgeek",     label: "SeatGeek" },
  { value: "other",        label: "Other" },
];

const JOB_STEP_LABELS: Partial<Record<JobStatus, string>> = {
  queued:                    "Queued — waiting for worker",
  logging_in:                "Logging in to Viagogo…",
  session_checking:          "Checking session…",
  opening_event_page:        "Opening Viagogo event page…",
  verifying_event:           "Verifying event name and date…",
  clicking_sell:             "Clicking Sell…",
  selecting_quantity:        "Selecting quantity…",
  selecting_split_rule:      "Selecting split rule…",
  filling_ticket_details:    "Filling ticket details…",
  filling_features_restrictions: "Filling features and restrictions…",
  selecting_ticket_provider: "Selecting ticket provider…",
  filling_seat_details:      "Entering seat details…",
  filling_price:             "Entering price…",
  final_review:              "Final safety check…",
  submitting_listing:        "Submitting listing…",
  waiting_for_confirmation:  "Waiting for Viagogo confirmation…",
  listed:                    "Listed successfully",
  failed:                    "Listing failed",
  needs_reconnect:           "Account needs reconnection",
  verification_required:     "Verification required",
  unknown_needs_review:      "Unknown state — check Viagogo manually",
  cancelled:                 "Cancelled",
};

export default function ListingDraftModal({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"load" | "event" | "details" | "confirm" | "job">("load");
  const [account, setAccount] = useState<MarketplaceAccount | null>(null);
  const [accountError, setAccountError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [eventMatch, setEventMatch] = useState<EventMatch | null>(null);
  const [manualEventId, setManualEventId] = useState("");
  const [manualEventUrl, setManualEventUrl] = useState("");
  const [manualEventDate, setManualEventDate] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [eventConfirmed, setEventConfirmed] = useState(false);
  const [validating, setValidating] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobPoll, setJobPoll] = useState<JobPoll | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Face value helper
  const derivedFaceValue =
    order.total_cost && order.qty_bought
      ? Number((order.total_cost / order.qty_bought).toFixed(2))
      : null;

  // ── Load existing draft or create one ─────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      // Load Viagogo account
      const acctRes = await fetch("/api/marketplace/accounts");
      if (acctRes.ok) {
        const { accounts } = await acctRes.json() as { accounts: MarketplaceAccount[] };
        const vg = accounts.find((a) => a.marketplace === "viagogo") ?? null;
        setAccount(vg);
        if (!vg) {
          setAccountError("No Viagogo account connected. Go to Settings > Accounts to add one.");
        } else if (vg.status === "disconnected" || vg.status === "login_failed") {
          setAccountError(`Viagogo account status is '${vg.status}'. Please reconnect in Settings > Accounts before listing.`);
        }
      }

      // Load or create draft
      const draftRes = await fetch(`/api/marketplace/drafts?orderId=${order.id}`);
      if (draftRes.ok) {
        const { drafts } = await draftRes.json() as { drafts: Draft[] };
        const existing = drafts.find((d) => d.status !== "submitted" && d.status !== "cancelled") ?? null;
        if (existing) {
          setDraft(existing);
          if (existing.event_match_id) setEventConfirmed(true);
        } else {
          // Create a fresh draft
          const createRes = await fetch("/api/marketplace/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order_id: order.id,
              marketplace_account_id: (acctRes.ok
                ? ((await (await fetch("/api/marketplace/accounts")).json()) as { accounts: MarketplaceAccount[] }).accounts.find((a) => a.marketplace === "viagogo")?.id
                : null),
            }),
          });
          if (createRes.ok) {
            const { draft: newDraft } = await createRes.json() as { draft: Draft };
            setDraft(newDraft);
          }
        }
      }
      setStep("event");
    })();
  }, [order.id]);

  // ── Polling job status ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    function startPoll() {
      pollRef.current = setInterval(async () => {
        const res = await fetch(`/api/marketplace/jobs/${jobId}`);
        if (!res.ok) return;
        const { job } = await res.json() as { job: JobPoll };
        setJobPoll(job);
        const terminal = ["listed","failed","unknown_needs_review","cancelled","needs_reconnect"];
        if (terminal.includes(job.status) && !job.pending_verification) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 3000);
    }
    startPoll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  async function patchDraft(fields: Record<string, unknown>) {
    if (!draft) return;
    const res = await fetch(`/api/marketplace/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (res.ok) {
      const { draft: updated } = await res.json() as { draft: Draft };
      setDraft(updated);
    }
  }

  async function saveEventMatch() {
    if (!draft || !manualEventId.trim()) {
      setMatchError("Paste the Viagogo event ID or URL.");
      return;
    }
    setMatchLoading(true);
    setMatchError("");

    // Parse event ID and URL from input
    let eventId = manualEventId.trim();
    let eventUrl = "";
    if (eventId.includes("viagogo.co.uk") || eventId.includes("viagogo.com")) {
      eventUrl = eventId.split("?")[0]; // strip query params from URL
      // Extract numeric ID from patterns like /E-160409382 or /E160409382
      const urlMatch = eventId.match(/\/E-?(\d+)/i) ?? eventId.match(/\/(\d+)(?:[?#/]|$)/);
      if (urlMatch) eventId = urlMatch[1];
    }

    // Upsert event match
    const res = await fetch("/api/marketplace/event-matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: order.id,
        draft_id: draft.id,
        viagogo_event_id: eventId,
        viagogo_event_url: eventUrl || null,
        viagogo_event_date: manualEventDate.trim() || null,
        tixtracker_event_name: order.event_name,
        tixtracker_event_date: order.event_date,
        tixtracker_venue: order.venue,
        match_method: "manual_search",
      }),
    });

    if (res.ok) {
      const { match } = await res.json() as { match: EventMatch };
      setEventMatch(match);
      setEventConfirmed(true);
      setMatchLoading(false);
    } else {
      const { error } = await res.json() as { error: string };
      setMatchError(error ?? "Failed to save event match");
      setMatchLoading(false);
    }
  }

  async function confirmEventMatch() {
    if (!draft || !eventMatch) return;
    // Check dates match exactly
    if (eventMatch.tixtracker_event_date && eventMatch.viagogo_event_date) {
      if (eventMatch.tixtracker_event_date !== eventMatch.viagogo_event_date) {
        setMatchError(
          `Date mismatch: TixTracker has ${eventMatch.tixtracker_event_date} but Viagogo event is ${eventMatch.viagogo_event_date}. Cannot list on this event.`
        );
        return;
      }
    }
    // Confirm in DB
    const res = await fetch(`/api/marketplace/event-matches/${eventMatch.id}/confirm`, {
      method: "POST",
    });
    if (res.ok) {
      const { match } = await res.json() as { match: EventMatch };
      setEventMatch(match);
      setEventConfirmed(true);
      await patchDraft({ event_match_id: match.id, viagogo_event_id: match.viagogo_event_id });
      setStep("details");
    }
  }

  async function validate() {
    if (!draft) return;
    setValidating(true);
    setSubmitError("");
    const res = await fetch(`/api/marketplace/drafts/${draft.id}/validate`, { method: "POST" });
    const result = await res.json() as { valid: boolean; errors: ValidationError[] };
    setDraft((d) => d ? { ...d, validation_errors: result.valid ? null : result.errors, status: result.valid ? "ready" : "draft" } : d);
    setValidating(false);
    if (result.valid) setStep("confirm");
    else setSubmitError(`${result.errors.length} issue(s) need to be fixed before listing.`);
  }

  async function submitJob() {
    if (!draft) return;
    setSubmitError("");
    const res = await fetch(`/api/marketplace/drafts/${draft.id}/submit`, { method: "POST" });
    const json = await res.json() as { jobId?: string; error?: string };
    if (!res.ok || !json.jobId) {
      setSubmitError(json.error ?? "Failed to start listing job");
      return;
    }
    setJobId(json.jobId);
    setStep("job");
  }

  async function submitVerifyCode() {
    if (!jobId || !verifyCode.trim()) return;
    setVerifySubmitting(true);
    const res = await fetch(`/api/marketplace/jobs/${jobId}/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: verifyCode.trim() }),
    });
    if (!res.ok) {
      const { error } = await res.json() as { error: string };
      setSubmitError(error ?? "Failed to submit code");
    }
    setVerifyCode("");
    setVerifySubmitting(false);
  }

  // ── Qty + split rules ─────────────────────────────────────────────────────────
  const qty = draft?.quantity ?? order.qty_bought ?? 1;
  const validSplitRules = splitRulesForQty(qty);
  const currentSplitRule = draft?.split_rule as SplitRule | null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 900,
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "2rem 1rem", overflowY: "auto",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--surface-card, #141414)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        width: "100%", maxWidth: 640,
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
              List on Viagogo
            </p>
            <h3 style={{ margin: "2px 0 0", fontSize: "1rem" }}>
              {order.event_name ?? "Ticket"}
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
              {order.event_date} · {order.venue}
            </p>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "1.5rem", cursor: "pointer", padding: "0 0.25rem", lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* Account error banner */}
        {accountError && (
          <div style={{
            margin: "1rem 1.5rem 0",
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, padding: "0.75rem 1rem",
            fontSize: "0.8125rem", color: "#ef4444", lineHeight: 1.6,
          }}>
            <strong>Account issue:</strong> {accountError}
          </div>
        )}

        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ── Step: Load ── */}
          {step === "load" && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
              Loading…
            </div>
          )}

          {/* ── Step: Event matching ── */}
          {(step === "event" || step === "details" || step === "confirm") && (
            <Section title="Viagogo event" tag="Step 1">
              {/* TixTracker side */}
              <MatchCard label="TixTracker ticket">
                <MatchRow label="Event" value={order.event_name} />
                <MatchRow label="Date" value={order.event_date} />
                <MatchRow label="Venue" value={order.venue} />
                <MatchRow label="Ref" value={order.booking_ref} />
              </MatchCard>

              {!eventConfirmed ? (
                <>
                  <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
                    Find the correct event on Viagogo and paste the Viagogo event URL or event ID below.
                    The event date must match exactly.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label className="filter-field">
                      <span className="filter-label">Viagogo event URL or event ID</span>
                      <input className="field" placeholder="https://www.viagogo.co.uk/…  or  1234567"
                        value={manualEventId} onChange={(e) => setManualEventId(e.target.value)} />
                    </label>
                    <label className="filter-field">
                      <span className="filter-label">Viagogo event date (as shown on Viagogo)</span>
                      <input className="field" type="date"
                        value={manualEventDate}
                        onChange={(e) => setManualEventDate(e.target.value)}
                        placeholder="YYYY-MM-DD" />
                    </label>
                  </div>
                  {matchError && <p style={{ margin: 0, fontSize: "0.8125rem", color: "#ef4444" }}>{matchError}</p>}
                  <button type="button" className="secondary-button" style={{ alignSelf: "flex-start" }}
                    onClick={() => void saveEventMatch()} disabled={matchLoading}>
                    {matchLoading ? "Saving…" : "Save event match"}
                  </button>
                </>
              ) : eventMatch ? (
                <>
                  <MatchCard label="Matched Viagogo event" highlight>
                    <MatchRow label="Event" value={eventMatch.viagogo_event_name} />
                    <MatchRow label="Date" value={eventMatch.viagogo_event_date} />
                    <MatchRow label="Venue" value={eventMatch.viagogo_venue} />
                    <MatchRow label="City" value={eventMatch.viagogo_city} />
                    <MatchRow label="Viagogo ID" value={eventMatch.viagogo_event_id} />
                    {eventMatch.viagogo_event_url && (
                      <a href={eventMatch.viagogo_event_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: "0.8125rem", color: "#60a5fa" }}>
                        View on Viagogo ↗
                      </a>
                    )}
                  </MatchCard>

                  {/* Date check */}
                  {eventMatch.tixtracker_event_date !== eventMatch.viagogo_event_date && (
                    <div style={{
                      background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)",
                      borderRadius: 8, padding: "0.75rem", fontSize: "0.8125rem", color: "#ef4444",
                    }}>
                      <strong>Date mismatch — listing blocked.</strong>{" "}
                      TixTracker: {eventMatch.tixtracker_event_date} · Viagogo: {eventMatch.viagogo_event_date}
                    </div>
                  )}

                  {eventMatch.tixtracker_event_date === eventMatch.viagogo_event_date && !eventMatch.confirmed_by_user && (
                    <>
                      {matchError && <p style={{ margin: 0, fontSize: "0.8125rem", color: "#ef4444" }}>{matchError}</p>}
                      <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", fontSize: "0.8125rem", cursor: "pointer", lineHeight: 1.5 }}>
                        <input type="checkbox" checked={false}
                          onChange={() => void confirmEventMatch()} style={{ marginTop: 2, accentColor: "#22c55e" }} />
                        I confirm this is the correct Viagogo event and the date matches exactly.
                      </label>
                    </>
                  )}

                  {eventMatch.confirmed_by_user && (
                    <div style={{
                      background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)",
                      borderRadius: 8, padding: "0.75rem", fontSize: "0.8125rem", color: "#22c55e",
                    }}>
                      ✓ Event confirmed. Dates match exactly.
                    </div>
                  )}

                  {step === "event" && eventMatch.confirmed_by_user && (
                    <button type="button" className="primary-button" style={{ alignSelf: "flex-start" }}
                      onClick={() => setStep("details")}>
                      Continue to listing details →
                    </button>
                  )}

                  <button type="button" className="secondary-button" style={{ alignSelf: "flex-start" }}
                    onClick={() => { setEventConfirmed(false); setEventMatch(null); }}>
                    Change event
                  </button>
                </>
              ) : null}
            </Section>
          )}

          {/* ── Step: Listing details ── */}
          {(step === "details" || step === "confirm") && draft && (
            <Section title="Listing details" tag="Step 2">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <label className="filter-field">
                  <span className="filter-label">Quantity *</span>
                  <input className="field" type="number" min={1} max={order.qty_bought ?? 99}
                    value={draft.quantity ?? ""}
                    onChange={(e) => void patchDraft({ quantity: parseInt(e.target.value) })} />
                </label>

                <label className="filter-field">
                  <span className="filter-label">Split rule {qty > 1 ? "*" : ""}</span>
                  <select className="field"
                    value={draft.split_rule ?? ""}
                    onChange={(e) => void patchDraft({ split_rule: e.target.value || null })}>
                    <option value="">— Select —</option>
                    {validSplitRules.map((r) => (
                      <option key={r} value={r}>{SPLIT_RULE_LABELS[r]}</option>
                    ))}
                  </select>
                </label>

                <label className="filter-field">
                  <span className="filter-label">Section *</span>
                  <input className="field" placeholder="e.g. G2"
                    value={draft.section ?? ""}
                    onChange={(e) => void patchDraft({ section: e.target.value })} />
                </label>

                <label className="filter-field">
                  <span className="filter-label">Row *</span>
                  <input className="field" placeholder="e.g. LL"
                    value={draft.row ?? ""}
                    onChange={(e) => void patchDraft({ row: e.target.value })} />
                </label>

                <label className="filter-field">
                  <span className="filter-label">First seat *</span>
                  <input className="field" placeholder="e.g. 42"
                    value={draft.seat_from ?? ""}
                    onChange={(e) => void patchDraft({ seat_from: e.target.value })} />
                </label>

                <label className="filter-field">
                  <span className="filter-label">Last seat *</span>
                  <input className="field" placeholder="e.g. 45"
                    value={draft.seat_to ?? ""}
                    onChange={(e) => void patchDraft({ seat_to: e.target.value })} />
                </label>

                <label className="filter-field">
                  <span className="filter-label">Price per ticket (£) *</span>
                  <input className="field" type="number" min={0.01} step={0.01}
                    value={draft.price_per_ticket ?? ""}
                    onChange={(e) => void patchDraft({ price_per_ticket: parseFloat(e.target.value) })} />
                </label>

                <label className="filter-field">
                  <span className="filter-label">Face value per ticket (£) *</span>
                  <input className="field" type="number" min={0.01} step={0.01}
                    value={draft.face_value_per_ticket ?? derivedFaceValue ?? ""}
                    onChange={(e) => void patchDraft({ face_value_per_ticket: parseFloat(e.target.value) })} />
                  {derivedFaceValue && !draft.face_value_per_ticket && (
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                      Auto-calculated from total cost: £{derivedFaceValue}
                    </span>
                  )}
                </label>

                <label className="filter-field" style={{ gridColumn: "span 2" }}>
                  <span className="filter-label">Ticket storage provider *</span>
                  <select className="field"
                    value={draft.ticket_storage_provider ?? ""}
                    onChange={(e) => void patchDraft({ ticket_storage_provider: e.target.value || null })}>
                    <option value="">— Select where your tickets are stored —</option>
                    {STORAGE_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                    Auto-detected from source: {draft.ticket_storage_provider ?? "not detected"}. Verify this is correct.
                  </span>
                </label>
              </div>

              <Section title="Features, comments and restrictions" tag="Step 3" nested>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <label className="filter-field">
                    <span className="filter-label">Listing features</span>
                    <select className="field" value={draft.listing_features}
                      onChange={(e) => void patchDraft({ listing_features: e.target.value })}>
                      {FEATURES_OPTIONS.map((o) => <option key={o} value={o}>{o === "none" ? "No features" : o}</option>)}
                    </select>
                  </label>

                  <label className="filter-field">
                    <span className="filter-label">Comments</span>
                    <select className="field" value={draft.comments}
                      onChange={(e) => void patchDraft({ comments: e.target.value })}>
                      {COMMENTS_OPTIONS.map((o) => <option key={o} value={o}>{o === "none" ? "No comments" : o}</option>)}
                    </select>
                  </label>

                  <label className="filter-field">
                    <span className="filter-label">Restrictions</span>
                    <select className="field" value={draft.restrictions}
                      onChange={(e) => void patchDraft({ restrictions: e.target.value })}>
                      {RESTRICTIONS.map((o) => <option key={o} value={o}>{o === "none" ? "No restrictions" : o}</option>)}
                    </select>
                  </label>

                  <label className="filter-field">
                    <span className="filter-label">Limitations</span>
                    <select className="field" value={draft.limitations}
                      onChange={(e) => void patchDraft({ limitations: e.target.value })}>
                      {LIMITATIONS_OPTIONS.map((o) => <option key={o} value={o}>{o === "none" ? "No limitations" : o}</option>)}
                    </select>
                  </label>
                </div>

                {/* About You confirmation */}
                <div style={{
                  background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "0.875rem 1rem",
                }}>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
                    About you (required by Viagogo / Consumer Rights Act)
                  </p>
                  <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)", lineHeight: 1.6 }}>
                    If you work for Viagogo or are the organiser of this event, you are required by
                    section 90(6) of the Consumer Rights Act to declare it. TixTracker will select
                    "Neither of these" on your behalf.
                  </p>
                  <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", fontSize: "0.8125rem", cursor: "pointer", lineHeight: 1.5 }}>
                    <input type="checkbox"
                      checked={draft.about_you_confirmed}
                      onChange={(e) => void patchDraft({ about_you_confirmed: e.target.checked })}
                      style={{ marginTop: 2, accentColor: "#22c55e" }} />
                    I confirm I am neither the event organiser nor employed by Viagogo.
                    TixTracker may select "Neither of these" on my behalf.
                  </label>
                </div>

                {/* Terms */}
                <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", fontSize: "0.8125rem", cursor: "pointer", lineHeight: 1.5 }}>
                  <input type="checkbox"
                    checked={draft.terms_confirmed}
                    onChange={(e) => void patchDraft({ terms_confirmed: e.target.checked })}
                    style={{ marginTop: 2, accentColor: "#22c55e" }} />
                  I confirm I have the right to sell these tickets and agree to Viagogo&apos;s
                  Terms &amp; Conditions. TixTracker may tick the required boxes on my behalf.
                </label>
              </Section>

              {/* Validation errors */}
              {draft.validation_errors && draft.validation_errors.length > 0 && (
                <div style={{
                  background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 8, padding: "0.875rem 1rem",
                }}>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", fontWeight: 600, color: "#ef4444" }}>
                    {draft.validation_errors.length} issue(s) to fix:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {draft.validation_errors.map((e, i) => (
                      <li key={i} style={{ fontSize: "0.8125rem", color: "#ef4444" }}>
                        <strong>{e.field}:</strong> {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button type="button" className="primary-button"
                  onClick={() => void validate()}
                  disabled={validating || !draft.about_you_confirmed || !draft.terms_confirmed}>
                  {validating ? "Validating…" : "Validate details"}
                </button>
                {submitError && <span style={{ fontSize: "0.8125rem", color: "#ef4444" }}>{submitError}</span>}
              </div>
            </Section>
          )}

          {/* ── Step: Confirm + submit ── */}
          {step === "confirm" && draft && eventMatch && (
            <Section title="Final confirmation" tag="Step 4">
              <div style={{
                background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)",
                borderRadius: 8, padding: "1rem",
              }}>
                <p style={{ margin: "0 0 0.75rem", fontWeight: 600, fontSize: "0.875rem" }}>Validation passed. Review your listing:</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1.5rem", fontSize: "0.8125rem" }}>
                  <SummaryRow label="Event" value={eventMatch.viagogo_event_name} />
                  <SummaryRow label="Date" value={eventMatch.viagogo_event_date} />
                  <SummaryRow label="Venue" value={eventMatch.viagogo_venue} />
                  <SummaryRow label="Viagogo ID" value={eventMatch.viagogo_event_id} />
                  <SummaryRow label="Quantity" value={String(draft.quantity)} />
                  <SummaryRow label="Split rule" value={draft.split_rule ? SPLIT_RULE_LABELS[draft.split_rule as SplitRule] : "—"} />
                  <SummaryRow label="Section" value={draft.section} />
                  <SummaryRow label="Row" value={draft.row} />
                  <SummaryRow label="Seats" value={`${draft.seat_from} – ${draft.seat_to}`} />
                  <SummaryRow label="Price" value={`£${draft.price_per_ticket}`} />
                  <SummaryRow label="Face value" value={`£${draft.face_value_per_ticket}`} />
                  <SummaryRow label="Provider" value={draft.ticket_storage_provider} />
                  <SummaryRow label="Restrictions" value={draft.restrictions !== "none" ? draft.restrictions : "None"} />
                  <SummaryRow label="Comments" value={draft.comments !== "none" ? draft.comments : "None"} />
                  <SummaryRow label="About you" value="Neither of these" />
                </div>
                <p style={{ margin: "1rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Card and payout method will not be changed. Only the above fields will be filled.
                </p>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="secondary-button" onClick={() => setStep("details")}>
                  ← Back to edit
                </button>
                <button type="button" className="primary-button"
                  style={{ background: "#22c55e", color: "#000" }}
                  onClick={() => void submitJob()}>
                  Start listing on Viagogo
                </button>
                {submitError && <span style={{ fontSize: "0.8125rem", color: "#ef4444" }}>{submitError}</span>}
              </div>
            </Section>
          )}

          {/* ── Step: Job progress ── */}
          {step === "job" && jobId && (
            <Section title="Listing in progress" tag="Worker">
              <JobProgress
                jobId={jobId}
                poll={jobPoll}
                verifyCode={verifyCode}
                onVerifyCodeChange={setVerifyCode}
                onVerifySubmit={() => void submitVerifyCode()}
                verifySubmitting={verifySubmitting}
                onClose={onClose}
              />
            </Section>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────────

function Section({ title, tag, nested, children }: {
  title: string; tag: string; nested?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "0.875rem",
      ...(nested ? { background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem" } : {}),
    }}>
      <div>
        <p style={{ margin: 0, fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
          {tag}
        </p>
        <h4 style={{ margin: "2px 0 0", fontSize: "0.9375rem" }}>{title}</h4>
      </div>
      {children}
    </div>
  );
}

function MatchCard({ label, children, highlight }: { label: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? "rgba(96,165,250,0.06)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${highlight ? "rgba(96,165,250,0.3)" : "var(--border)"}`,
      borderRadius: 8, padding: "0.875rem 1rem",
    }}>
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>
        {label}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {children}
      </div>
    </div>
  );
}

function MatchRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <span style={{ color: "var(--muted)", minWidth: 60 }}>{label}:</span>
      <span>{value ?? <span style={{ color: "var(--muted)" }}>—</span>}</span>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--muted)", fontWeight: 600 }}>{label}</p>
      <p style={{ margin: 0, fontSize: "0.8125rem" }}>{value ?? "—"}</p>
    </div>
  );
}

function JobProgress({
  jobId, poll, verifyCode, onVerifyCodeChange, onVerifySubmit, verifySubmitting, onClose
}: {
  jobId: string;
  poll: JobPoll | null;
  verifyCode: string;
  onVerifyCodeChange: (v: string) => void;
  onVerifySubmit: () => void;
  verifySubmitting: boolean;
  onClose: () => void;
}) {
  const status = poll?.status ?? "queued";
  const label = JOB_STEP_LABELS[status] ?? status;
  const terminal = ["listed","failed","unknown_needs_review","cancelled","needs_reconnect"];
  const isTerminal = terminal.includes(status);
  const isSuccess = status === "listed";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {!isTerminal && (
          <div style={{
            width: 16, height: 16, borderRadius: "50%",
            border: "2px solid #60a5fa",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
        )}
        {isSuccess && <span style={{ color: "#22c55e", fontSize: "1.25rem" }}>✓</span>}
        {!isSuccess && isTerminal && <span style={{ color: "#ef4444", fontSize: "1.25rem" }}>✕</span>}
        <span style={{
          fontSize: "0.9375rem",
          fontWeight: 600,
          color: isSuccess ? "#22c55e" : isTerminal ? "#ef4444" : "var(--foreground)",
        }}>
          {label}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
        Job ID: {jobId}
      </p>

      {poll?.error_message && (
        <div style={{
          background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 8, padding: "0.75rem", fontSize: "0.8125rem", color: "#ef4444",
        }}>
          {poll.error_message}
        </div>
      )}

      {status === "listed" && poll?.result_listing_url && (
        <div style={{
          background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.3)",
          borderRadius: 8, padding: "0.75rem", fontSize: "0.8125rem",
        }}>
          <p style={{ margin: "0 0 0.5rem", color: "#22c55e", fontWeight: 600 }}>Listing created.</p>
          <a href={poll.result_listing_url} target="_blank" rel="noopener noreferrer"
            style={{ color: "#60a5fa" }}>
            View on Viagogo ↗
          </a>
          {poll.result_listing_id && (
            <p style={{ margin: "0.25rem 0 0", color: "var(--muted)" }}>
              Listing ID: {poll.result_listing_id}
            </p>
          )}
        </div>
      )}

      {status === "unknown_needs_review" && (
        <div style={{
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 8, padding: "0.875rem", fontSize: "0.8125rem", color: "#f59e0b", lineHeight: 1.6,
        }}>
          <strong>Unknown state.</strong> The worker encountered an unexpected situation near the end of the listing flow.
          Please check your Viagogo account directly to see if the listing was created.
          Do not submit a new listing until you have confirmed the status on Viagogo.
        </div>
      )}

      {status === "verification_required" && poll?.pending_verification && (
        <div style={{
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 8, padding: "0.875rem",
          display: "flex", flexDirection: "column", gap: "0.75rem",
        }}>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "#f59e0b", fontWeight: 600 }}>
            Viagogo requires a verification code.
          </p>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
            Check your email or phone for a code from Viagogo and enter it below.
            {poll.verification_expires_at && ` Code expires at ${new Date(poll.verification_expires_at).toLocaleTimeString()}.`}
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input className="field" placeholder="Enter code"
              value={verifyCode} onChange={(e) => onVerifyCodeChange(e.target.value)}
              style={{ maxWidth: 160 }} />
            <button type="button" className="primary-button"
              onClick={onVerifySubmit} disabled={verifySubmitting || !verifyCode.trim()}>
              {verifySubmitting ? "Submitting…" : "Submit code"}
            </button>
          </div>
        </div>
      )}

      {isTerminal && !poll?.pending_verification && (
        <button type="button" className="secondary-button" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          Close
        </button>
      )}
    </div>
  );
}
