// GET /api/marketplace/jobs/[id]  — poll job status (called by UI every few seconds)

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: job, error } = await supabase
      .from("marketplace_listing_jobs")
      .select(
        "id, status, current_step, attempt_count, started_at, completed_at, failed_at, error_code, error_message, result_listing_id, result_listing_url, pending_verification, verification_expires_at, created_at, updated_at"
      )
      .eq("id", id)
      .eq("user_id", user.id)   // never expose another user's job
      .single();

    if (error || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // If job is listed, also return the confirmed listing record
    let listing = null;
    if (job.status === "listed") {
      const { data } = await supabase
        .from("marketplace_listings")
        .select("id, viagogo_listing_id, viagogo_listing_url, status, quantity_listed, price_per_ticket, currency, listed_at")
        .eq("job_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      listing = data ?? null;
    }

    return NextResponse.json({ job, listing });
  } catch {
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}
