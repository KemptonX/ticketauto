import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { rematchViagogoSales, syncViagogoSalesInbox } from "@/src/lib/viagogo-sales-sync";

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

    const { data: gmailAccounts, error: accountError } = await supabase
      .from("gmail_accounts")
      .select("id, email, access_token, refresh_token, token_expiry")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    const readyAccounts = (gmailAccounts || []).filter((account) => account.access_token);

    if (readyAccounts.length === 0) {
      return NextResponse.json(
        { error: "Connect Gmail in Connections before scanning sales" },
        { status: 400 },
      );
    }

    const totals = {
      scanned: 0,
      inserted: 0,
      matched: 0,
      accounts: readyAccounts.length,
    };

    for (const gmailAccount of readyAccounts) {
      const result = await syncViagogoSalesInbox({
        supabase,
        gmailAccount,
        userId: user.id,
      });

      totals.scanned += result.scanned;
      totals.inserted += result.inserted;
      totals.matched += result.matched;
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
