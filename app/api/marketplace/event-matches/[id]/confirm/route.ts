// POST /api/marketplace/event-matches/[id]/confirm
// User explicitly confirms this Viagogo event matches their ticket.
// Enforces exact event date match before confirming.

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

    const { data: match } = await supabase
      .from("viagogo_event_matches")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!match) return NextResponse.json({ error: "Event match not found" }, { status: 404 });

    // Mandatory: exact date match before confirmation is allowed
    if (
      match.tixtracker_event_date &&
      match.viagogo_event_date &&
      match.tixtracker_event_date !== match.viagogo_event_date
    ) {
      return NextResponse.json(
        {
          error: `Event date mismatch. TixTracker: ${match.tixtracker_event_date}, Viagogo: ${match.viagogo_event_date}. Confirmation blocked.`,
          dateMismatch: true,
        },
        { status: 422 }
      );
    }

    const { data: confirmed, error } = await supabase
      .from("viagogo_event_matches")
      .update({
        confirmed_by_user: true,
        match_status: "confirmed",
        confirmed_at: new Date().toISOString(),
        rejected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, match: confirmed });
  } catch {
    return NextResponse.json({ error: "Failed to confirm event match" }, { status: 500 });
  }
}
