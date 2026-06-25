// POST /api/marketplace/drafts/[id]/submit
// Creates a listing job from a validated draft.
// Draft must be in 'ready' status. Only one active job per order allowed.

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

    // Load and verify draft
    const { data: draft } = await supabase
      .from("marketplace_listing_drafts")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    if (draft.status !== "ready") {
      return NextResponse.json(
        { error: `Draft must be validated before submitting. Current status: '${draft.status}'. Run /validate first.` },
        { status: 422 }
      );
    }

    // Verify account belongs to this user and is connected + can_list
    const { data: acct } = await supabase
      .from("marketplace_accounts")
      .select("id, status, can_list")
      .eq("id", draft.marketplace_account_id)
      .eq("user_id", user.id)
      .single();
    if (!acct) return NextResponse.json({ error: "Viagogo account not found" }, { status: 404 });
    if (acct.status !== "connected") {
      return NextResponse.json(
        { error: `Viagogo account is not connected (status: ${acct.status})` },
        { status: 422 }
      );
    }
    if (!acct.can_list) {
      return NextResponse.json(
        { error: "Viagogo account cannot list tickets" },
        { status: 422 }
      );
    }

    // Duplicate protection: check no active job for this order
    const { data: activeJob } = await supabase
      .from("marketplace_listing_jobs")
      .select("id, status")
      .eq("order_id", draft.order_id)
      .eq("user_id", user.id)
      .not("status", "in", '("listed","failed","cancelled","unknown_needs_review")')
      .maybeSingle();
    if (activeJob) {
      return NextResponse.json(
        { error: "A listing job is already running for this ticket", jobId: activeJob.id },
        { status: 409 }
      );
    }

    // Duplicate protection: check no active listing on Viagogo already
    const { data: activeListing } = await supabase
      .from("marketplace_listings")
      .select("id")
      .eq("order_id", draft.order_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (activeListing) {
      return NextResponse.json(
        { error: "This ticket already has an active Viagogo listing" },
        { status: 409 }
      );
    }

    // Create the job
    const { data: job, error: jobError } = await supabase
      .from("marketplace_listing_jobs")
      .insert({
        user_id: user.id,
        order_id: draft.order_id,
        marketplace_account_id: draft.marketplace_account_id,
        draft_id: id,
        marketplace: draft.marketplace,
        status: "queued",
        current_step: "queued",
        attempt_count: 0,
        max_attempts: 1,
        pending_verification: false,
      })
      .select("id, status, created_at")
      .single();

    if (jobError) {
      // Unique index on (order_id) for active jobs will catch race conditions
      if (jobError.code === "23505") {
        return NextResponse.json(
          { error: "A listing job was just created for this ticket (concurrent submit)" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    // Mark draft as submitted
    await supabase
      .from("marketplace_listing_drafts")
      .update({ status: "submitted", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);

    await supabase.from("marketplace_listing_logs").insert({
      user_id: user.id,
      order_id: draft.order_id,
      job_id: job.id,
      action: "job_queued",
      status: "queued",
      message: `Listing job ${job.id} queued for order ${draft.order_id}`,
    });

    return NextResponse.json({ ok: true, jobId: job.id, status: "queued" });
  } catch {
    return NextResponse.json({ error: "Failed to submit listing" }, { status: 500 });
  }
}
