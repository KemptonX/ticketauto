import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { syncPresaleGmailInbox } from "@/src/lib/presale-sync";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: gmailAccounts } = await supabase
    .from("gmail_accounts")
    .select("id, email, access_token, refresh_token, token_expiry")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("provider", "gmail");

  let totalScanned = 0;
  let totalInserted = 0;
  const errors: string[] = [];

  for (const account of gmailAccounts ?? []) {
    if (!account.access_token) continue;
    try {
      const result = await syncPresaleGmailInbox({ supabase, gmailAccount: account, userId: user.id });
      totalScanned += result.scanned;
      totalInserted += result.inserted;
    } catch (err) {
      errors.push(`${account.email}: ${err instanceof Error ? err.message : "scan failed"}`);
    }
  }

  return NextResponse.json({ ok: true, scanned: totalScanned, inserted: totalInserted, errors });
}
