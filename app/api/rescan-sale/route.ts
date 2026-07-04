import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { reparseSaleFromGmail } from "@/src/lib/viagogo-sales-sync";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { saleId } = (await req.json()) as { saleId?: number };
  if (!saleId) return NextResponse.json({ error: "saleId required" }, { status: 400 });

  const result = await reparseSaleFromGmail({ supabase, userId: user.id, saleId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
