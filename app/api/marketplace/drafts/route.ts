// GET  /api/marketplace/drafts?orderId=  — list drafts for an order
// POST /api/marketplace/drafts           — create or update a draft

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { providerFromSourceType } from "@/src/lib/marketplace/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const orderId = request.nextUrl.searchParams.get("orderId");
    if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

    // Verify order belongs to user before returning drafts
    const { data: order } = await supabase
      .from("orders").select("id, user_id").eq("id", orderId).eq("user_id", user.id).single();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("marketplace_listing_drafts")
      .select("*")
      .eq("order_id", orderId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ drafts: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Failed to load drafts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.order_id);
    if (!orderId) return NextResponse.json({ error: "order_id is required" }, { status: 400 });

    // Verify order belongs to user + not already sold/archived
    const { data: order } = await supabase
      .from("orders")
      .select("id, user_id, qty_bought, total_cost, section, row, seat_from, seat_to, source_type, listing_status")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const blocked = ["Archived", "Ignored", "Sold"];
    if (blocked.includes(order.listing_status ?? "")) {
      return NextResponse.json(
        { error: `Order is ${order.listing_status} and cannot be listed` },
        { status: 422 }
      );
    }

    // Check no active listing job already running for this order
    const { data: activeJob } = await supabase
      .from("marketplace_listing_jobs")
      .select("id, status")
      .eq("order_id", orderId)
      .eq("user_id", user.id)
      .not("status", "in", '("listed","failed","cancelled","unknown_needs_review")')
      .maybeSingle();
    if (activeJob) {
      return NextResponse.json(
        { error: "A listing job is already running for this ticket", jobId: activeJob.id },
        { status: 409 }
      );
    }

    // Check no active marketplace listing
    const { data: activeListing } = await supabase
      .from("marketplace_listings")
      .select("id, status")
      .eq("order_id", orderId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (activeListing) {
      return NextResponse.json(
        { error: "This ticket already has an active listing on Viagogo" },
        { status: 409 }
      );
    }

    // Auto-detect ticket storage provider from source_type
    const detectedProvider = providerFromSourceType(order.source_type as string);
    const faceValue = order.total_cost && order.qty_bought
      ? Number((order.total_cost / order.qty_bought).toFixed(2))
      : null;

    const row = {
      user_id: user.id,
      order_id: orderId,
      marketplace: "viagogo",
      marketplace_account_id: (body.marketplace_account_id as string) || null,
      event_match_id: null,
      viagogo_event_id: null,
      status: "draft",
      quantity: (body.quantity as number) ?? order.qty_bought ?? 1,
      split_rule: (body.split_rule as string) || null,
      ticket_type: "mobile_transfer",
      ticket_storage_provider: (body.ticket_storage_provider as string) || detectedProvider || null,
      section: (body.section as string) || order.section || null,
      row: (body.row as string) || order.row || null,
      seat_from: (body.seat_from as string) || order.seat_from || null,
      seat_to: (body.seat_to as string) || order.seat_to || null,
      price_per_ticket: (body.price_per_ticket as number) || null,
      currency: (body.currency as string) || "GBP",
      face_value_per_ticket: (body.face_value_per_ticket as number) || faceValue,
      listing_features: (body.listing_features as string) || "none",
      comments: (body.comments as string) || "none",
      restrictions: (body.restrictions as string) || "none",
      limitations: (body.limitations as string) || "none",
      about_you_confirmed: false,
      terms_confirmed: false,
      validation_errors: null,
      updated_at: new Date().toISOString(),
    };

    const { data: draft, error } = await supabase
      .from("marketplace_listing_drafts")
      .insert(row)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("marketplace_listing_logs").insert({
      user_id: user.id,
      order_id: orderId,
      action: "draft_created",
      status: "draft",
      message: `Listing draft created for order ${orderId}`,
    });

    return NextResponse.json({ ok: true, draft });
  } catch {
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 });
  }
}
