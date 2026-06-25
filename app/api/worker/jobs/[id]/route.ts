// POST /api/worker/jobs/[id]
// Worker calls this to report progress, save results, and complete/fail a job.
// Secured by LISTING_WORKER_SECRET bearer token.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { encryptCredential } from "@/src/lib/marketplace/encryption";
import type { JobStatus, JobUpdatePayload } from "@/src/lib/marketplace/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function authoriseWorker(request: NextRequest): boolean {
  const secret = process.env.LISTING_WORKER_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

const TERMINAL_STATUSES: JobStatus[] = [
  "listed", "failed", "cancelled", "unknown_needs_review",
];

export async function POST(request: NextRequest, { params }: Params) {
  if (!authoriseWorker(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const now = new Date().toISOString();

    const { data: job } = await supabase
      .from("marketplace_listing_jobs")
      .select("id, user_id, order_id, marketplace_account_id, draft_id, status")
      .eq("id", id)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Do not update already-terminal jobs to prevent accidental overwrites
    if (TERMINAL_STATUSES.includes(job.status as JobStatus)) {
      return NextResponse.json({ error: `Job already in terminal state: ${job.status}` }, { status: 409 });
    }

    const body = await request.json() as JobUpdatePayload & {
      encryptedSession?: string;   // worker passes new session data after successful login
    };

    const update: Record<string, unknown> = {
      status: body.status,
      current_step: body.currentStep ?? body.status,
      updated_at: now,
    };

    if (body.errorCode) update.error_code = body.errorCode;
    if (body.errorMessage) update.error_message = body.errorMessage;
    if (body.resultListingId) update.result_listing_id = body.resultListingId;
    if (body.resultListingUrl) update.result_listing_url = body.resultListingUrl;
    if (typeof body.pendingVerification === "boolean") update.pending_verification = body.pendingVerification;
    if (body.verificationExpiresAt) update.verification_expires_at = body.verificationExpiresAt;
    if (body.lockedBy) update.locked_by = body.lockedBy;

    if (body.status === "listed") {
      update.completed_at = now;
      update.locked_at = null;
    } else if (TERMINAL_STATUSES.includes(body.status)) {
      update.failed_at = now;
      update.locked_at = null;
    }

    await supabase.from("marketplace_listing_jobs").update(update).eq("id", id);

    // If worker provides a new encrypted session, save it to the account
    if (body.encryptedSession && job.marketplace_account_id) {
      await supabase.from("marketplace_accounts").update({
        encrypted_session_data: body.encryptedSession,
        status: "connected",
        can_list: true,
        last_login_at: now,
        last_checked_at: now,
        last_successful_action_at: body.status === "listed" ? now : undefined,
        last_error_code: null,
        last_error_message: null,
        pending_2fa_since: null,
        updated_at: now,
      }).eq("id", job.marketplace_account_id);
    }

    // On success: create confirmed marketplace_listings record
    if (body.status === "listed" && body.resultListingId) {
      const { data: draft } = await supabase
        .from("marketplace_listing_drafts")
        .select("*")
        .eq("id", job.draft_id)
        .single();

      if (draft) {
        const externalId = `tixtracker_draft_${job.draft_id}`;

        await supabase.from("marketplace_listings").upsert(
          {
            user_id: job.user_id,
            order_id: job.order_id,
            marketplace_account_id: job.marketplace_account_id,
            job_id: id,
            draft_id: job.draft_id,
            marketplace: draft.marketplace,
            external_id: externalId,
            viagogo_event_id: draft.viagogo_event_id,
            viagogo_listing_id: body.resultListingId,
            viagogo_listing_url: body.resultListingUrl ?? null,
            status: "active",
            quantity_listed: draft.quantity,
            section: draft.section,
            row: draft.row,
            seats: draft.seat_from && draft.seat_to ? `${draft.seat_from}-${draft.seat_to}` : null,
            price_per_ticket: draft.price_per_ticket,
            currency: draft.currency,
            face_value: draft.face_value_per_ticket,
            listed_at: now,
            last_synced_at: now,
            updated_at: now,
          },
          { onConflict: "external_id" }
        );

        // Update order listing_status to Listed
        await supabase
          .from("orders")
          .update({ listing_status: "Listed", updated_at: now })
          .eq("id", job.order_id)
          .eq("user_id", job.user_id);
      }
    }

    // On account-level errors, update account status
    if (body.status === "needs_reconnect" && job.marketplace_account_id) {
      await supabase.from("marketplace_accounts").update({
        status: "needs_reconnect",
        can_list: false,
        last_error_code: body.errorCode ?? "session_expired",
        last_error_message: body.errorMessage ?? "Session expired during listing",
        updated_at: now,
      }).eq("id", job.marketplace_account_id);
    }
    if (body.status === "verification_required" && job.marketplace_account_id) {
      await supabase.from("marketplace_accounts").update({
        pending_2fa_since: now,
        updated_at: now,
      }).eq("id", job.marketplace_account_id);
    }

    // Log the step
    const logAction =
      body.status === "listed" ? "listed" :
      body.status === "failed" ? "failed" :
      body.status === "unknown_needs_review" ? "unknown_needs_review" :
      body.currentStep ?? body.status;

    await supabase.from("marketplace_listing_logs").insert({
      user_id: job.user_id,
      order_id: job.order_id,
      job_id: id,
      action: logAction,
      status: body.status,
      message: body.errorMessage ?? body.currentStep ?? body.status,
      error_code: body.errorCode ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[worker/jobs/update] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
