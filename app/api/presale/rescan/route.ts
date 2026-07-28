import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { syncPresaleFromInboundEvents } from "@/src/lib/presale-sync";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncPresaleFromInboundEvents({ supabase, userId: user.id });
    return NextResponse.json({ ok: true, scanned: result.scanned, inserted: result.inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scan failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
