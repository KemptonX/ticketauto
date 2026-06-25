// GET    /api/marketplace/drafts/[id]  — get a single draft
// PATCH  /api/marketplace/drafts/[id]  — update draft fields
// DELETE /api/marketplace/drafts/[id]  — delete draft (only if not submitted)

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_PATCH_FIELDS = new Set([
  "marketplace_account_id",
  "event_match_id",
  "viagogo_event_id",
  "quantity",
  "split_rule",
  "ticket_type",
  "ticket_storage_provider",
  "section",
  "row",
  "seat_from",
  "seat_to",
  "price_per_ticket",
  "currency",
  "face_value_per_ticket",
  "listing_features",
  "comments",
  "restrictions",
  "limitations",
  "about_you_confirmed",
  "terms_confirmed",
]);

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data, error } = await supabase
      .from("marketplace_listing_drafts")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !data) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json({ draft: data });
  } catch {
    return NextResponse.json({ error: "Failed to load draft" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: existing } = await supabase
      .from("marketplace_listing_drafts")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!existing) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (existing.status === "submitted") {
      return NextResponse.json({ error: "Cannot edit a submitted draft" }, { status: 409 });
    }

    const body = await request.json() as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, val] of Object.entries(body)) {
      if (ALLOWED_PATCH_FIELDS.has(key)) update[key] = val;
    }

    // Changing core details resets validation
    const coreFields = ["quantity","section","row","seat_from","seat_to","price_per_ticket","event_match_id"];
    if (coreFields.some((f) => f in body)) {
      update.validation_errors = null;
      update.status = "draft";
    }

    const { data, error } = await supabase
      .from("marketplace_listing_drafts")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, draft: data });
  } catch {
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: existing } = await supabase
      .from("marketplace_listing_drafts")
      .select("id, status")
      .eq("id", id).eq("user_id", user.id).single();
    if (!existing) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (existing.status === "submitted") {
      return NextResponse.json({ error: "Cannot delete a submitted draft" }, { status: 409 });
    }

    await supabase.from("marketplace_listing_drafts").delete().eq("id", id).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  }
}
