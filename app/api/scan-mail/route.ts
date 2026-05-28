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

    // Fetch Gmail and IMAP accounts in parallel
    const [gmailResult, imapResult] = await Promise.all([
      supabase
        .from("gmail_accounts")
        .select("id, email, access_token, refresh_token, token_expiry, provider")
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("imap_accounts")
        .select("id, host, port, username, password_encrypted, use_tls, mailbox, unread_only, mark_read, last_synced_at")
        .eq("user_id", user.id)
        .eq("is_active", true),
    ]);

    const allAccounts = gmailResult.data ?? [];
    const imapAccounts: ImapAccount[] = (
      (imapResult.data as Array<Omit<ImapAccount, "password"> & { password_encrypted: string }>) ?? []
    ).map((r) => ({ ...r, password: r.password_encrypted }));

    if (allAccounts.length === 0 && imapAccounts.length === 0) {
      return NextResponse.json(
        { error: "Connect an inbox in Connections before running a scan" },
        { status: 400 },
      );
    }

    const errors: string[] = [];

    // Build Gmail/Outlook scan tasks — skip accounts without OAuth tokens
    const gmailTasks = allAccounts.map(async (account) => {
      if (!account.access_token) {
        return { ok: false as const, email: account.email, message: "OAuth incomplete" };
      }
      try {
        const result =
          account.provider === "outlook"
            ? await syncOutlookInbox({ supabase, outlookAccount: account, userId: user.id })
            : await syncGmailInbox({ supabase, gmailAccount: account, userId: user.id });
        return { ok: true as const, result, provider: account.provider as string };
      } catch (err) {
        return { ok: false as const, email: account.email, message: err instanceof Error ? err.message : "scan failed" };
      }
    });

    // Build IMAP scan tasks
    const imapTasks = imapAccounts.map(async (account) => {
      try {
        const result = await syncImapInbox({ supabase, imapAccount: account, userId: user.id });
        return { ok: true as const, result };
      } catch (err) {
        return { ok: false as const, email: `${account.username}@${account.host}`, message: err instanceof Error ? err.message : "scan failed" };
      }
    });

    // Run all scans in parallel
    const [gmailSettled, imapSettled] = await Promise.all([
      Promise.allSettled(gmailTasks),
      Promise.allSettled(imapTasks),
    ]);

    let totalScanned = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    const allInsertedRefs: string[] = [];
    const allUpdatedRefs: string[] = [];
    const accountResults: { email: string; provider: string; inserted: number; updated: number }[] = [];

    for (const settled of gmailSettled) {
      if (settled.status === "rejected") { errors.push(`scan error: ${settled.reason}`); continue; }
      const r = settled.value;
      if (!r.ok) { errors.push(`${r.email}: ${r.message}`); continue; }
      totalScanned += r.result.scanned;
      totalInserted += r.result.inserted;
      totalUpdated += r.result.updated;
      allInsertedRefs.push(...r.result.insertedRefs);
      allUpdatedRefs.push(...r.result.updatedRefs);
      accountResults.push({ email: r.result.email, provider: r.provider, inserted: r.result.inserted, updated: r.result.updated });
    }

    for (const settled of imapSettled) {
      if (settled.status === "rejected") { errors.push(`imap error: ${settled.reason}`); continue; }
      const r = settled.value;
      if (!r.ok) { errors.push(`${r.email}: ${r.message}`); continue; }
      totalScanned += r.result.scanned;
      totalInserted += r.result.inserted;
      totalUpdated += r.result.updated;
      allInsertedRefs.push(...r.result.insertedRefs);
      allUpdatedRefs.push(...r.result.updatedRefs);
      accountResults.push({ email: r.result.email, provider: "imap", inserted: r.result.inserted, updated: r.result.updated });
    }

    const { data: logRow } = await supabase
      .from("sync_log")
      .insert({ user_id: user.id, scan_type: "orders", scanned: totalScanned, inserted: totalInserted, updated: totalUpdated })
      .select("id")
      .single();

    if (logRow?.id) {
      await supabase
        .from("sync_log")
        .update({ account_results: accountResults, errors_detail: errors })
        .eq("id", logRow.id);
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
