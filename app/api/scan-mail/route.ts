import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { syncGmailInbox } from "@/src/lib/gmail-sync";
import { syncOutlookInbox } from "@/src/lib/outlook-sync";
import { syncImapInbox } from "@/src/lib/imap-sync";
import type { ImapAccount } from "@/src/lib/imap-sync";

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

    const { data: allAccounts, error: accountError } = await supabase
      .from("gmail_accounts")
      .select("id, email, access_token, refresh_token, token_expiry, provider")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    if ((!allAccounts || allAccounts.length === 0)) {
      return NextResponse.json(
        { error: "Connect an inbox in Connections before running a scan" },
        { status: 400 },
      );
    }

    let totalScanned = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    const allInsertedRefs: string[] = [];
    const allUpdatedRefs: string[] = [];
    const accountResults: { email: string; provider: string; inserted: number; updated: number }[] = [];
    const errors: string[] = [];

    for (const account of allAccounts ?? []) {
      if (!account.access_token) {
        errors.push(`${account.email}: OAuth incomplete`);
        continue;
      }

      try {
        const result =
          account.provider === "outlook"
            ? await syncOutlookInbox({ supabase, outlookAccount: account, userId: user.id })
            : await syncGmailInbox({ supabase, gmailAccount: account, userId: user.id });

        totalScanned += result.scanned;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        allInsertedRefs.push(...result.insertedRefs);
        allUpdatedRefs.push(...result.updatedRefs);
        accountResults.push({
          email: result.email,
          provider: account.provider,
          inserted: result.inserted,
          updated: result.updated,
        });
      } catch (err) {
        errors.push(`${account.email}: ${err instanceof Error ? err.message : "scan failed"}`);
      }
    }

    // IMAP accounts
    const { data: imapAccounts } = await supabase
      .from("imap_accounts")
      .select("id, host, port, username, password, use_tls, mailbox, unread_only, mark_read")
      .eq("is_active", true);

    for (const account of (imapAccounts as ImapAccount[]) ?? []) {
      try {
        const result = await syncImapInbox({ supabase, imapAccount: account, userId: user.id });
        totalScanned += result.scanned;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        allInsertedRefs.push(...result.insertedRefs);
        allUpdatedRefs.push(...result.updatedRefs);
        accountResults.push({
          email: result.email,
          provider: "imap",
          inserted: result.inserted,
          updated: result.updated,
        });
      } catch (err) {
        errors.push(`${account.username}@${account.host}: ${err instanceof Error ? err.message : "scan failed"}`);
      }
    }

    const { data: logRow } = await supabase.from("sync_log").insert({
      user_id: user.id,
      scan_type: "orders",
      scanned: totalScanned,
      inserted: totalInserted,
      updated: totalUpdated,
    }).select("id").single();

    if (logRow?.id) {
      await supabase.from("sync_log").update({
        account_results: accountResults,
        errors_detail: errors,
      }).eq("id", logRow.id);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
