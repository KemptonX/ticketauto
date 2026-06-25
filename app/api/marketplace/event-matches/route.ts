// POST /api/marketplace/event-matches — save a user-supplied Viagogo event match

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body = await request.json() as {
      order_id?: number;
      draft_id?: string;
      viagogo_event_id?: string;
      viagogo_event_url?: string;
      viagogo_event_name?: string;
      viagogo_event_date?: string;
      viagogo_venue?: string;
      viagogo_city?: string;
      viagogo_country?: string;
      tixtracker_event_name?: string;
      tixtracker_event_date?: string;
      tixtracker_venue?: string;
      match_method?: string;
    };

    const orderId = body.order_id;
    const viagogoEventId = body.viagogo_event_id?.trim();

    if (!orderId) return NextResponse.json({ error: "order_id is required" }, { status: 400 });
    if (!viagogoEventId) return NextResponse.json({ error: "viagogo_event_id is required" }, { status: 400 });

    // Verify order belongs to user
    const { data: order } = await supabase
      .from("orders")
      .select("id, event_name, event_date, venue")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // Upsert match for this order (one match per order per Viagogo event ID)
    const { data: match, error } = await supabase
      .from("viagogo_event_matches")
      .upsert(
        {
          user_id: user.id,
          order_id: orderId,
          tixtracker_event_name: body.tixtracker_event_name ?? order.event_name,
          tixtracker_event_date: body.tixtracker_event_date ?? order.event_date,
          tixtracker_venue: body.tixtracker_venue ?? order.venue,
          viagogo_event_id: viagogoEventId,
          viagogo_event_name: body.viagogo_event_name ?? null,
          viagogo_event_date: body.viagogo_event_date ?? null,
          viagogo_event_url: body.viagogo_event_url ?? null,
          viagogo_venue: body.viagogo_venue ?? null,
          viagogo_city: body.viagogo_city ?? null,
          viagogo_country: body.viagogo_country ?? null,
          match_method: body.match_method ?? "manual_search",
          match_status: "pending",
          confirmed_by_user: false,
          confirmed_at: null,
          rejected_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,order_id,viagogo_event_id" }
      )
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update draft if provided
    if (body.draft_id) {
      await supabase
        .from("marketplace_listing_drafts")
        .update({
          event_match_id: match.id,
          viagogo_event_id: viagogoEventId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.draft_id)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ ok: true, match });
  } catch {
    return NextResponse.json({ error: "Failed to save event match" }, { status: 500 });
  }
}
