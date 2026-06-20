import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { rematchViagogoSales, syncViagogoSalesImapInbox, syncViagogoSalesInbox, syncViagogoSalesOutlookInbox, syncStubHubSalesInbox, syncStubHubSalesOutlookInbox, syncStubHubSalesImapInbox } from "@/src/lib/viagogo-sales-sync";

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

    const [
      { data: gmailAccounts, error: accountError },
      { data: imapRows, error: imapError },
    ] = await Promise.all([
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
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }
    if (imapError) {
      return NextResponse.json({ error: imapError.message }, { status: 500 });
    }

    const readyOAuthAccounts = (gmailAccounts ?? []).filter((account) => account.access_token);
    const readyImapAccounts = ((imapRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      ...(r as object),
      password: r.password_encrypted as string,
    })) as import("@/src/lib/imap-sync").ImapAccount[];

    if (readyOAuthAccounts.length === 0 && readyImapAccounts.length === 0) {
      return NextResponse.json(
        { error: "Connect Gmail, Outlook, or IMAP in Connections before scanning sales" },
        { status: 400 },
      );
    }

    const totals = {
      scanned: 0,
      inserted: 0,
      matched: 0,
      accounts: readyOAuthAccounts.length + readyImapAccounts.length,
    };

    for (const account of readyOAuthAccounts) {
      if (account.provider === "outlook") {
        const vg = await syncViagogoSalesOutlookInbox({ supabase, outlookAccount: account, userId: user.id });
        totals.scanned += vg.scanned;
        totals.inserted += vg.inserted;
        totals.matched += vg.matched;
        const sh = await syncStubHubSalesOutlookInbox({ supabase, outlookAccount: account, userId: user.id });
        totals.scanned += sh.scanned;
        totals.inserted += sh.inserted;
        totals.matched += sh.matched;
      } else {
        const vg = await syncViagogoSalesInbox({ supabase, gmailAccount: account, userId: user.id });
        totals.scanned += vg.scanned;
        totals.inserted += vg.inserted;
        totals.matched += vg.matched;
        const sh = await syncStubHubSalesInbox({ supabase, gmailAccount: account, userId: user.id });
        totals.scanned += sh.scanned;
        totals.inserted += sh.inserted;
        totals.matched += sh.matched;
      }
    }

    for (const account of readyImapAccounts) {
      const vg = await syncViagogoSalesImapInbox({ supabase, imapAccount: account, userId: user.id });
      totals.scanned += vg.scanned;
      totals.inserted += vg.inserted;
      totals.matched += vg.matched;
      const sh = await syncStubHubSalesImapInbox({ supabase, imapAccount: account, userId: user.id });
      totals.scanned += sh.scanned;
      totals.inserted += sh.inserted;
      totals.matched += sh.matched;
    }

    totals.matched += await rematchViagogoSales({
      supabase,
      userId: user.id,
    });

    await supabase.from("sync_log").insert({
      user_id: user.id,
      scan_type: "sales",
      scanned: totals.scanned,
      inserted: totals.inserted,
      matched: totals.matched,
      accounts_scanned: totals.accounts,
    });

    return NextResponse.json({ ok: true, ...totals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sales scan error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
