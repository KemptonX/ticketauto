import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { entitiesOverlap } from "@/src/lib/accounting";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("accounting_entities")
    .select("*")
    .eq("user_id", user.id)
    .order("effective_from", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entities: data ?? [] });
}

const ALLOWED_FIELDS = new Set([
  "entity_type", "display_name", "trading_name", "company_name", "company_number",
  "incorporation_date", "trading_start_date", "effective_from", "effective_to",
  "accounting_reference_date", "base_currency", "vat_registered", "vat_number",
]);

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown> & { id?: number };

  if (!body.entity_type || !body.display_name || !body.effective_from) {
    return NextResponse.json({ error: "entity_type, display_name and effective_from are required" }, { status: 400 });
  }
  if (body.entity_type === "limited_company" && !body.accounting_reference_date) {
    return NextResponse.json({ error: "A limited company needs an accounting reference date (company year end)" }, { status: 400 });
  }

  const insert: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) insert[key] = value === "" ? null : value;
  }

  // Overlap check against this user's other entities — never allow two
  // entities to silently both claim the same date.
  const { data: existing } = await supabase
    .from("accounting_entities")
    .select("id, effective_from, effective_to")
    .eq("user_id", user.id);

  const candidate = { effective_from: insert.effective_from as string, effective_to: (insert.effective_to as string | null) ?? null };
  const conflict = (existing ?? []).find(
    (e) => e.id !== body.id && entitiesOverlap(candidate, { effective_from: e.effective_from, effective_to: e.effective_to }),
  );
  if (conflict) {
    return NextResponse.json(
      { error: `This date range overlaps with another entity already on file (id ${conflict.id}). Adjust the effective dates so entity periods don't overlap.` },
      { status: 400 },
    );
  }

  let result;
  if (body.id) {
    result = await supabase.from("accounting_entities").update(insert).eq("id", body.id).eq("user_id", user.id).select("*").single();
  } else {
    result = await supabase.from("accounting_entities").insert(insert).select("*").single();
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ entity: result.data });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("accounting_entities").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
