import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { syncGmailInbox } from "@/src/lib/gmail-sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "You must be signed in" }, { status: 401 });
    }

    const { data: gmailAccount, error: accountError } = await supabase
      .from("gmail_accounts")
      .select("id, email, access_token, refresh_token, token_expiry")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    if (!gmailAccount) {
      return NextResponse.json(
        { error: "Connect Gmail in Connections before running a scan" },
        { status: 400 },
      );
    }

    if (!gmailAccount.access_token) {
      return NextResponse.json(
        { error: `Gmail OAuth is incomplete for ${gmailAccount.email}` },
        { status: 400 },
      );
    }

    const result = await syncGmailInbox({
      supabase,
      gmailAccount,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
