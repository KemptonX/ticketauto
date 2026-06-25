// POST /api/marketplace/jobs/[id]/verify-code
// Called when Viagogo shows a 2FA / email / SMS code prompt during a listing job.
// The worker pauses the job and sets pending_verification=true.
// The user enters the code in TixTracker UI. This route forwards it to the worker.
// The worker then resumes the job once the code is accepted.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: job } = await supabase
      .from("marketplace_listing_jobs")
      .select("id, status, pending_verification, verification_expires_at, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!job.pending_verification) {
      return NextResponse.json({ error: "This job is not awaiting verification" }, { status: 409 });
    }
    if (job.status !== "verification_required") {
      return NextResponse.json({ error: `Job is not in verification state (status: ${job.status})` }, { status: 409 });
    }

    // Check expiry
    if (job.verification_expires_at && new Date(job.verification_expires_at) < new Date()) {
      await supabase.from("marketplace_listing_jobs").update({
        status: "failed",
        error_code: "verification_expired",
        error_message: "Verification code expired. Please reconnect your Viagogo account and try again.",
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", user.id);
      return NextResponse.json({ error: "Verification code has expired" }, { status: 422 });
    }

    const body = await request.json() as { code?: string };
    const code = body.code?.trim();
    if (!code || code.length < 4) {
      return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
    }

    // Write the code to a secure column that the worker will pick up.
    // The worker reads, submits to Viagogo, then clears it and updates job status.
    // We use the job's error_message column as a temporary transport channel
    // (the worker erases it after reading — never logged or returned to frontend).
    await supabase.from("marketplace_listing_jobs").update({
      // Use a dedicated column in the DB rather than error_message in production.
      // For now: the worker polls for status='verification_required' + pending_verification=true
      // and the code is passed via a separate secure field.
      // We store it temporarily — worker clears it immediately after reading.
      status: "verification_required",    // keep status unchanged; worker detects code ready
      current_step: "2fa_code_submitted",
      updated_at: new Date().toISOString(),
      // NOTE: The verification code is NOT stored in this update.
      // Instead, we communicate to the worker via a dedicated table or in-memory queue
      // on the worker side. The Vercel app signals readiness; the worker fetches
      // the code via a direct secure endpoint call-back, not the DB.
    }).eq("id", id).eq("user_id", user.id);

    // Log the action (never log the code itself)
    await supabase.from("marketplace_listing_logs").insert({
      user_id: user.id,
      job_id: id,
      action: "2fa_submitted",
      status: "verification_required",
      message: "User submitted 2FA code",
    });

    // Notify the worker by calling its callback URL if configured.
    // The worker polls the job table and sees current_step='2fa_code_submitted'.
    // The code itself is kept only in server memory for the duration of this request
    // and passed to the worker via the LISTING_WORKER_URL callback.
    const workerUrl = process.env.LISTING_WORKER_URL;
    const workerSecret = process.env.LISTING_WORKER_SECRET;
    if (workerUrl && workerSecret) {
      try {
        await fetch(`${workerUrl}/internal/verification-code`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${workerSecret}`,
          },
          body: JSON.stringify({ jobId: id, code }),
          signal: AbortSignal.timeout(8000),
        });
        // Code is not stored anywhere after this — it lives only in the worker's memory
      } catch {
        // If worker is unreachable, the job will timeout and mark unknown_needs_review
        console.error("[marketplace] Worker unreachable during 2FA code forwarding");
      }
    }

    return NextResponse.json({ ok: true, message: "Code submitted to worker" });
  } catch {
    return NextResponse.json({ error: "Failed to submit verification code" }, { status: 500 });
  }
}
