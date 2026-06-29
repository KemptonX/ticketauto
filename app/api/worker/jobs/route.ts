// GET /api/worker/jobs
// Railway worker polls this to claim the next queued listing job.
// Secured by LISTING_WORKER_SECRET bearer token.
// Returns at most one job at a time (concurrency = 1).

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/src/lib/supabase-service";
import { decryptCredential } from "@/src/lib/marketplace/encryption";

export const runtime = "nodejs";

function authoriseWorker(request: NextRequest): boolean {
  const secret = process.env.LISTING_WORKER_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authoriseWorker(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const workerId = request.headers.get("x-worker-id") ?? "worker";

    // Claim the oldest queued job atomically using a DB-level update
    // Locks the row so a second concurrent request cannot claim the same job
    const { data: jobs } = await supabase
      .from("marketplace_listing_jobs")
      .select("id, user_id, order_id, marketplace_account_id, draft_id")
      .eq("status", "queued")
      .is("locked_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    const job = jobs?.[0] ?? null;
    if (!job) return NextResponse.json({ job: null });

    // Attempt to lock it
    const now = new Date().toISOString();
    const { error: lockError } = await supabase
      .from("marketplace_listing_jobs")
      .update({
        status: "logging_in",
        current_step: "logging_in",
        locked_at: now,
        locked_by: workerId,
        started_at: now,
        attempt_count: 1,
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("status", "queued")  // Only lock if still queued (prevents race)
      .is("locked_at", null);

    if (lockError) return NextResponse.json({ job: null });

    // Load the full draft
    const { data: draft } = await supabase
      .from("marketplace_listing_drafts")
      .select("*")
      .eq("id", job.draft_id)
      .single();

    if (!draft) {
      await supabase.from("marketplace_listing_jobs").update({
        status: "failed",
        error_code: "draft_not_found",
        error_message: "Draft was deleted before job could run",
        failed_at: now,
        updated_at: now,
      }).eq("id", job.id);
      return NextResponse.json({ job: null });
    }

    // Load account credentials (encrypted) — worker decrypts on its end
    const { data: acct } = await supabase
      .from("marketplace_accounts")
      .select("id, display_email, encrypted_credentials, encrypted_session_data, status, can_list")
      .eq("id", job.marketplace_account_id)
      .single();

    if (!acct || !acct.encrypted_credentials) {
      await supabase.from("marketplace_listing_jobs").update({
        status: "failed",
        error_code: "account_not_found",
        error_message: "Marketplace account missing or credentials not stored",
        failed_at: now,
        updated_at: now,
      }).eq("id", job.id);
      return NextResponse.json({ job: null });
    }

    // Load event match
    const { data: eventMatch } = await supabase
      .from("viagogo_event_matches")
      .select("*")
      .eq("id", draft.event_match_id)
      .single();

    if (!eventMatch || !eventMatch.confirmed_by_user) {
      await supabase.from("marketplace_listing_jobs").update({
        status: "failed",
        error_code: "event_match_not_confirmed",
        error_message: "Event match was not confirmed before job started",
        failed_at: now,
        updated_at: now,
      }).eq("id", job.id);
      return NextResponse.json({ job: null });
    }

    // Decrypt credentials server-side and send to worker over TLS
    // The worker is on Railway and communicates over HTTPS only
    let credentials: { email: string; password: string } | null = null;
    try {
      credentials = JSON.parse(decryptCredential(acct.encrypted_credentials));
    } catch {
      await supabase.from("marketplace_listing_jobs").update({
        status: "failed",
        error_code: "credential_decrypt_failed",
        error_message: "Failed to decrypt account credentials",
        failed_at: now,
        updated_at: now,
      }).eq("id", job.id);
      return NextResponse.json({ job: null });
    }

    let sessionData: unknown = null;
    if (acct.encrypted_session_data) {
      try {
        sessionData = JSON.parse(decryptCredential(acct.encrypted_session_data));
      } catch {
        // Session data invalid — worker will log in fresh
        sessionData = null;
      }
    }

    await supabase.from("marketplace_listing_logs").insert({
      user_id: job.user_id,
      order_id: job.order_id,
      job_id: job.id,
      action: "job_started",
      status: "logging_in",
      message: `Job claimed by worker ${workerId}`,
    });

    // Return all data the worker needs.
    // Credentials travel over HTTPS only. Never logged.
    return NextResponse.json({
      job: {
        id: job.id,
        userId: job.user_id,
        orderId: job.order_id,
        draft: {
          id: draft.id,
          marketplace: draft.marketplace,
          viagogoEventId: draft.viagogo_event_id,
          quantity: draft.quantity,
          splitRule: draft.split_rule,
          ticketType: draft.ticket_type,
          ticketStorageProvider: draft.ticket_storage_provider,
          section: draft.section,
          row: draft.row,
          seatFrom: draft.seat_from,
          seatTo: draft.seat_to,
          pricePerTicket: draft.price_per_ticket,
          currency: draft.currency,
          faceValuePerTicket: draft.face_value_per_ticket,
          listingFeatures: draft.listing_features,
          comments: draft.comments,
          restrictions: draft.restrictions,
          limitations: draft.limitations,
          aboutYouConfirmed: draft.about_you_confirmed,
          termsConfirmed: draft.terms_confirmed,
        },
        eventMatch: {
          viagogoEventId: eventMatch.viagogo_event_id,
          viagogoEventUrl: eventMatch.viagogo_event_url,
          viagogoEventName: eventMatch.viagogo_event_name,
          viagogoEventDate: eventMatch.viagogo_event_date,
          tixTrackerEventDate: eventMatch.tixtracker_event_date,
          tixTrackerEventName: eventMatch.tixtracker_event_name,
          viagogoVenue: eventMatch.viagogo_venue,
        },
        account: {
          id: acct.id,
          displayEmail: acct.display_email,
          credentials,     // { email, password }
          sessionData,     // cookies/session or null
        },
      },
    });
  } catch (err) {
    console.error("[worker/jobs] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
