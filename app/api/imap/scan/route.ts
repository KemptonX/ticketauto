import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { syncImapInbox } from "@/src/lib/imap-sync";
import type { ImapAccount } from "@/src/lib/imap-sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: rows, error: fetchError } = await supabase
      .from("imap_accounts")
      .select("id, host, port, username, password_encrypted, use_tls, mailbox, unread_only, mark_read, last_synced_at")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, inserted: 0, updated: 0, insertedRefs: [], updatedRefs: [], accountResults: [] });
    }

    const accounts: ImapAccount[] = (rows as Array<Omit<ImapAccount, "password"> & { password_encrypted: string }>)
      .map((r) => ({ ...r, password: r.password_encrypted }));

    let totalScanned = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    const allInsertedRefs: string[] = [];
    const allUpdatedRefs: string[] = [];
    const accountResults: { email: string; inserted: number; updated: number }[] = [];
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const result = await syncImapInbox({ supabase, imapAccount: account, userId: user.id });
        totalScanned += result.scanned;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        allInsertedRefs.push(...result.insertedRefs);
        allUpdatedRefs.push(...result.updatedRefs);
        accountResults.push({ email: result.email, inserted: result.inserted, updated: result.updated });
      } catch (err) {
        errors.push(`${account.username}@${account.host}: ${err instanceof Error ? err.message : "scan failed"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: totalScanned,
      inserted: totalInserted,
      updated: totalUpdated,
      insertedRefs: allInsertedRefs,
      updatedRefs: allUpdatedRefs,
      accountResults,
      errors,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Scan failed" }, { status: 500 });
  }
}
