import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { clearSession } from "@/src/lib/whop-auth";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  await clearSession();
  return NextResponse.json({ ok: true });
}
