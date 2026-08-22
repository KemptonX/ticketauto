import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { fixOverMatchedSales, rematchViagogoSales } from "@/src/lib/viagogo-sales-sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const fixed = await fixOverMatchedSales(supabase, user.id);
    let rematched = 0;
    if (fixed > 0) {
      rematched = await rematchViagogoSales({ supabase, userId: user.id });
    }

    return NextResponse.json({ ok: true, fixed, rematched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
