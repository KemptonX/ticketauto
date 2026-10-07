import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["in_progress", "needs_review", "ready_for_accountant", "sent_to_accountant", "filed"]);

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json()) as { periodKind?: string; periodStart?: string; periodEnd?: string; status?: string };
  const { periodKind, periodStart, periodEnd, status } = body;

  if (!periodKind || !periodStart || !periodEnd || !status || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  const { error } = await supabase.from("tax_year_status").upsert(
    {
      user_id: user.id,
      period_kind: periodKind,
      period_start: periodStart,
      period_end: periodEnd,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,period_start,period_end" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
