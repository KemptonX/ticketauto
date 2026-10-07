import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

const ALLOWED_FIELDS = new Set([
  "business_structure",
  "country",
  "base_currency",
  "accounting_basis",
  "trading_name",
  "company_name",
  "company_number",
  "company_year_end",
  "vat_registered",
  "vat_registration_date",
  "vat_number",
  "vat_scheme",
  "utr",
  "accountant_name",
  "accountant_email",
  "tax_reserve_percent",
  "associated_companies",
  "internal_notes",
  "setup_completed",
]);

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("accounting_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const update: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) update[key] = value;
  }

  const { data, error } = await supabase
    .from("accounting_profiles")
    .upsert(update, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
