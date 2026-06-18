import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { scanViagogoLifecycleGmail, scanViagogoLifecycleOutlook, scanViagogoLifecycleImap } from "@/src/lib/sales-lifecycle-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "You must be signed in" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { cutoffDate?: string };
    let cutoffDate = body.cutoffDate;

    // Persist the cutoff date if provided
    if (cutoffDate) {
      await supabase
        .from("user_settings")
        .upsert(
          { user_id: user.id, sales_scan_cutoff_date: cutoffDate, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
    } else {
      // Load saved cutoff, or default to 90 days ago
      const { data: settings } = await supabase
        .from("user_settings")
        .select("sales_scan_cutoff_date")
        .eq("user_id", user.id)
        .maybeSingle();
      const saved = (settings as { sales_scan_cutoff_date?: string | null } | null)
        ?.sales_scan_cutoff_date;
      cutoffDate = saved ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    const [
      { data: gmailAccounts, error: accountError },
      { data: imapAccounts },
    ] = await Promise.all([
      supabase
        .from("gmail_accounts")
        .select("id, email, access_token, refresh_token, token_expiry, provider")
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("imap_accounts")
        .select("id, host, port, username, password, use_tls, mailbox, unread_only, mark_read, last_synced_at")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    const readyOAuthAccounts = (gmailAccounts ?? []).filter((a) => a.access_token);
    const readyImapAccounts = imapAccounts ?? [];

    if (readyOAuthAccounts.length === 0 && readyImapAccounts.length === 0) {
      return NextResponse.json(
        { error: "Connect Gmail, Outlook, or IMAP in Connections before scanning" },
        { status: 400 },
      );
    }

    const totals = {
      scanned: 0,
      processed: 0,
      updated: 0,
      needsReview: 0,
      alreadyProcessed: 0,
      errors: 0,
      accounts: readyOAuthAccounts.length + readyImapAccounts.length,
      cutoffDate,
      labelError: undefined as string | undefined,
    };

    for (const account of readyOAuthAccounts) {
      const result =
        account.provider === "outlook"
          ? await scanViagogoLifecycleOutlook({
              supabase,
              outlookAccount: account,
              userId: user.id,
              cutoffDate,
            })
          : await scanViagogoLifecycleGmail({
              supabase,
              gmailAccount: account,
              userId: user.id,
              cutoffDate,
            });

      totals.scanned += result.scanned;
      totals.processed += result.processed;
      totals.updated += result.updated;
      totals.needsReview += result.needsReview;
      totals.alreadyProcessed += result.alreadyProcessed;
      totals.errors += result.errors;
      if (result.labelError) totals.labelError = result.labelError;
    }

    for (const account of readyImapAccounts) {
      const result = await scanViagogoLifecycleImap({
        supabase,
        imapAccount: account,
        userId: user.id,
        cutoffDate,
      });

      totals.scanned += result.scanned;
      totals.processed += result.processed;
      totals.updated += result.updated;
      totals.needsReview += result.needsReview;
      totals.alreadyProcessed += result.alreadyProcessed;
      totals.errors += result.errors;
      if (result.labelError) totals.labelError = result.labelError;
    }

    return NextResponse.json({ ok: true, ...totals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown lifecycle scan error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
