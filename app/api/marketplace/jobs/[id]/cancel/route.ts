// POST /api/marketplace/jobs/[id]/cancel — cancel a queued job (not one already running)

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: job } = await supabase
      .from("marketplace_listing_jobs")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Can only cancel if not yet started or not in final state
    const terminalStatuses = ["listed", "failed", "cancelled", "unknown_needs_review"];
    if (terminalStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: `Job is already in terminal state '${job.status}' and cannot be cancelled` },
        { status: 409 }
      );
    }

    // If the job is past the submitting step, do NOT cancel — it may have already listed
    const tooLateStatuses = ["submitting_listing", "waiting_for_confirmation"];
    if (tooLateStatuses.includes(job.status)) {
      return NextResponse.json(
        {
          error: `Job is at step '${job.status}'. Cancelling now could result in unknown listing state. Check Viagogo directly.`,
          status: job.status,
        },
        { status: 409 }
      );
    }

    await supabase.from("marketplace_listing_jobs").update({
      status: "cancelled",
      current_step: "cancelled",
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", user.id);

    // Reset draft status so user can re-submit
    await supabase.from("marketplace_listing_drafts")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      // Find draft linked to this job (drafts have the job_id via submitted draft_id -> jobs)
      // We use the job's draft_id relationship
      .eq("id",
        (await supabase.from("marketplace_listing_jobs").select("draft_id").eq("id", id).single())
          .data?.draft_id ?? ""
      );

    await supabase.from("marketplace_listing_logs").insert({
      user_id: user.id,
      job_id: id,
      action: "job_cancelled",
      status: "cancelled",
      message: "Job cancelled by user",
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to cancel job" }, { status: 500 });
  }
}
