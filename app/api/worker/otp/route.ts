// GET /api/worker/otp?accountId=xxx
// Worker polls this after detecting a 2FA prompt.
// Returns the pending OTP code and clears it atomically.

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

function authoriseWorker(request: NextRequest): boolean {
  const secret = process.env.LISTING_WORKER_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authoriseWorker(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ otp: null });

  try {
    const supabase = await createSupabaseServerClient();

    const { data } = await supabase
      .from("marketplace_accounts")
      .select("id, pending_otp_code")
      .eq("id", accountId)
      .single();

    if (!data?.pending_otp_code) return NextResponse.json({ otp: null });

    // Clear it immediately so it can't be replayed
    await supabase
      .from("marketplace_accounts")
      .update({ pending_otp_code: null, updated_at: new Date().toISOString() })
      .eq("id", accountId);

    return NextResponse.json({ otp: data.pending_otp_code });
  } catch {
    return NextResponse.json({ otp: null });
  }
}
