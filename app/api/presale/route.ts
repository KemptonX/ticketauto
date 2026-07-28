import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

// GET — fetch all presale entries for the current user
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("presale_entries")
    .select("*")
    .eq("user_id", user.id)
    .order("slot_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}

// POST — manually add a presale entry
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    campaign: string;
    account_email: string;
    presale_code?: string | null;
    slot_start?: string | null;
    slot_end?: string | null;
    notes?: string | null;
    source_message_id?: string | null;
  };

  if (!body.campaign || !body.account_email) {
    return NextResponse.json({ error: "campaign and account_email are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("presale_entries")
    .insert({
      user_id: user.id,
      campaign: body.campaign,
      account_email: body.account_email,
      presale_code: body.presale_code ?? null,
      slot_start: body.slot_start ?? null,
      slot_end: body.slot_end ?? null,
      notes: body.notes ?? null,
      source_message_id: body.source_message_id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

// PATCH — update account_email on an existing entry
export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, account_email } = await request.json() as { id: number; account_email: string };
  if (!id || !account_email?.trim()) {
    return NextResponse.json({ error: "id and account_email are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("presale_entries")
    .update({ account_email: account_email.trim() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — remove an entry by id
export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await request.json() as { id: number };
  const { error } = await supabase
    .from("presale_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
