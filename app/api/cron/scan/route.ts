import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncGmailInbox } from "@/src/lib/gmail-sync";
import { rematchViagogoSales, syncViagogoSalesInbox } from "@/src/lib/viagogo-sales-sync";
import { syncImapInbox } from "@/src/lib/imap-sync";
import type { ImapAccount } from "@/src/lib/imap-sync";

export const runtime = "nodejs";

type GmailAccount = {
  id: string;
  user_id: string;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  is_primary: boolean;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: accounts, error } = await supabase
    .from("gmail_accounts")
    .select("id, user_id, email, access_token, refresh_token, token_expiry, is_primary")
    .eq("is_active", true)
    .not("access_token", "is", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byUser = new Map<string, GmailAccount[]>();
  for (const account of (accounts as GmailAccount[]) || []) {
    if (!byUser.has(account.user_id)) {
      byUser.set(account.user_id, []);
    }
    byUser.get(account.user_id)!.push(account);
  }

  // Fetch all active IMAP accounts grouped by user
  const { data: imapRows } = await supabase
    .from("imap_accounts")
    .select("id, user_id, host, port, username, password, use_tls, mailbox, unread_only, mark_read")
    .eq("is_active", true);

  type ImapAccountWithUser = ImapAccount & { user_id: string };
  const imapByUser = new Map<string, ImapAccountWithUser[]>();
  for (const row of (imapRows as ImapAccountWithUser[]) ?? []) {
    if (!imapByUser.has(row.user_id)) imapByUser.set(row.user_id, []);
    imapByUser.get(row.user_id)!.push(row);
  }

  const allUserIds = new Set([...byUser.keys(), ...imapByUser.keys()]);

  const summary = {
    users: byUser.size,
    ordersScanned: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    salesScanned: 0,
    salesInserted: 0,
    salesMatched: 0,
    errors: [] as string[],
  };

  for (const userId of allUserIds) {
    const userAccounts = byUser.get(userId) ?? [];

    // Gmail (orders) — primary account only
    if (userAccounts.length > 0) {
      const primaryAccount = userAccounts.find((a) => a.is_primary) ?? userAccounts[0];
      try {
        const orderResult = await syncGmailInbox({
          supabase,
          gmailAccount: primaryAccount,
          userId,
        });
        summary.ordersScanned += orderResult.scanned;
        summary.ordersInserted += orderResult.inserted;
        summary.ordersUpdated += orderResult.updated ?? 0;
        await supabase.from("sync_log").insert({
          user_id: userId,
          scan_type: "orders",
          scanned: orderResult.scanned,
          inserted: orderResult.inserted,
          updated: orderResult.updated ?? 0,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Gmail scan failed";
        summary.errors.push(`orders:${userId.slice(0, 8)}: ${msg}`);
      }
    }

    // IMAP orders — all IMAP accounts for this user
    for (const imapAccount of imapByUser.get(userId) ?? []) {
      try {
        const result = await syncImapInbox({ supabase, imapAccount, userId });
        summary.ordersScanned += result.scanned;
        summary.ordersInserted += result.inserted;
        summary.ordersUpdated += result.updated ?? 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "IMAP scan failed";
        summary.errors.push(`imap:${imapAccount.username}@${imapAccount.host}: ${msg}`);
      }
    }

    // Viagogo sales — all accounts for this user
    let salesScanned = 0;
    let salesInserted = 0;
    let salesMatched = 0;

    for (const account of userAccounts) {
      try {
        const salesResult = await syncViagogoSalesInbox({
          supabase,
          gmailAccount: account,
          userId,
        });
        salesScanned += salesResult.scanned;
        salesInserted += salesResult.inserted;
        salesMatched += salesResult.matched;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sales scan failed";
        summary.errors.push(`sales:${account.email}: ${msg}`);
      }
    }

    try {
      salesMatched += await rematchViagogoSales({ supabase, userId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rematch failed";
      summary.errors.push(`rematch:${userId.slice(0, 8)}: ${msg}`);
    }

    summary.salesScanned += salesScanned;
    summary.salesInserted += salesInserted;
    summary.salesMatched += salesMatched;

    await supabase.from("sync_log").insert({
      user_id: userId,
      scan_type: "sales",
      scanned: salesScanned,
      inserted: salesInserted,
      matched: salesMatched,
      accounts_scanned: userAccounts.length,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
