// POST /api/marketplace/drafts/[id]/validate
// Validates a listing draft and saves validation errors to the draft record.
// Must be called before submit. Returns { valid, errors }.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { validateListingDraft } from "@/src/lib/marketplace/validation";
import type { ListingDraftInput, OrderSnapshot } from "@/src/lib/marketplace/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    // Load draft
    const { data: draft } = await supabase
      .from("marketplace_listing_drafts")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (draft.status === "submitted") {
      return NextResponse.json({ error: "Draft already submitted" }, { status: 409 });
    }

    // Load order (own data only)
    const { data: order } = await supabase
      .from("orders")
      .select("id, event_name, event_date, venue, section, row, seat_from, seat_to, qty_bought, total_cost, source_type, listing_status")
      .eq("id", draft.order_id)
      .eq("user_id", user.id)
      .single();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // Check Viagogo account belongs to user and is connected
    if (draft.marketplace_account_id) {
      const { data: acct } = await supabase
        .from("marketplace_accounts")
        .select("id, status, can_list")
        .eq("id", draft.marketplace_account_id)
        .eq("user_id", user.id)
        .single();
      if (!acct) {
        return NextResponse.json(
          { valid: false, errors: [{ field: "marketplaceAccountId", message: "Viagogo account not found or belongs to another user" }] },
          { status: 200 }
        );
      }
      if (acct.status === "disconnected" || acct.status === "login_failed") {
        return NextResponse.json(
          { valid: false, errors: [{ field: "marketplaceAccountId", message: `Viagogo account status is '${acct.status}'. Please reconnect before listing.` }] },
          { status: 200 }
        );
      }
    }

    // Verify event match is confirmed by user with exact date
    if (draft.event_match_id) {
      const { data: match } = await supabase
        .from("viagogo_event_matches")
        .select("id, confirmed_by_user, tixtracker_event_date, viagogo_event_date, match_status")
        .eq("id", draft.event_match_id)
        .eq("user_id", user.id)
        .single();

      if (!match || !match.confirmed_by_user || match.match_status !== "confirmed") {
        return NextResponse.json(
          { valid: false, errors: [{ field: "eventMatchId", message: "Viagogo event match has not been confirmed by you" }] },
          { status: 200 }
        );
      }
      const toIso = (d: string) => {
        if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
        const months: Record<string, string> = {
          jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
          jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
          january:"01",february:"02",march:"03",april:"04",june:"06",
          july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
        };
        const m = d.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (m) { const mo = months[m[2].toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[1].padStart(2,"0")}`; }
        return "";
      };
      // Mandatory: exact date match (normalize both sides)
      if (toIso(match.tixtracker_event_date) !== toIso(match.viagogo_event_date)) {
        return NextResponse.json(
          {
            valid: false,
            errors: [{
              field: "eventMatchId",
              message: `Event date mismatch: TixTracker has ${match.tixtracker_event_date}, Viagogo has ${match.viagogo_event_date}. Listing blocked.`
            }]
          },
          { status: 200 }
        );
      }
    }

    const draftInput: ListingDraftInput = {
      orderId: draft.order_id as number,
      marketplaceAccountId: draft.marketplace_account_id as string,
      viagogoEventId: draft.viagogo_event_id as string,
      eventMatchId: draft.event_match_id as string,
      quantity: draft.quantity as number,
      splitRule: draft.split_rule as ListingDraftInput["splitRule"],
      ticketType: draft.ticket_type as string,
      ticketStorageProvider: draft.ticket_storage_provider as ListingDraftInput["ticketStorageProvider"],
      section: draft.section as string,
      row: draft.row as string,
      seatFrom: draft.seat_from as string,
      seatTo: draft.seat_to as string,
      pricePerTicket: draft.price_per_ticket as number,
      currency: draft.currency as string,
      faceValuePerTicket: draft.face_value_per_ticket as number,
      listingFeatures: draft.listing_features as string,
      comments: draft.comments as string,
      restrictions: draft.restrictions as string,
      limitations: draft.limitations as string,
      aboutYouConfirmed: draft.about_you_confirmed as boolean,
      termsConfirmed: draft.terms_confirmed as boolean,
    };

    const orderSnap: OrderSnapshot = {
      id: order.id as number,
      event_name: order.event_name as string,
      event_date: order.event_date as string,
      venue: order.venue as string,
      section: order.section as string,
      row: order.row as string,
      seat_from: order.seat_from as string,
      seat_to: order.seat_to as string,
      qty_bought: order.qty_bought as number,
      total_cost: order.total_cost as number,
      source_type: order.source_type as string,
      listing_status: order.listing_status as string,
    };

    const result = validateListingDraft(draftInput, orderSnap);

    // Save validation result into the draft
    await supabase
      .from("marketplace_listing_drafts")
      .update({
        status: result.valid ? "ready" : "draft",
        validation_errors: result.valid ? null : result.errors,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    await supabase.from("marketplace_listing_logs").insert({
      user_id: user.id,
      order_id: draft.order_id,
      action: result.valid ? "validation_passed" : "validation_failed",
      status: result.valid ? "ready" : "failed",
      message: result.valid ? "Validation passed" : `${result.errors.length} validation error(s)`,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Validation failed unexpectedly" }, { status: 500 });
  }
}
