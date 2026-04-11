import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { syncOutlookInbox } from "@/src/lib/outlook-sync";

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

    const { data: outlookAccounts, error: accountError } = await supabase
      .from("gmail_accounts")
      .select("id, email, access_token, refresh_token, token_expiry")
      .eq("is_active", true)
      .eq("provider", "outlook")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (accountError) {
      return NextResponse.json({ error: accountError.message }, { status: 500 });
    }

    if (!outlookAccounts || outlookAccounts.length === 0) {
      return NextResponse.json(
        { error: "Connect Outlook in Connections before running a scan" },
        { status: 400 },
      );
    }

    let totalScanned = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    const allInsertedRefs: string[] = [];
    const allUpdatedRefs: string[] = [];
    const accountResults: { email: string; inserted: number; updated: number }[] = [];
    const errors: string[] = [];

    for (const outlookAccount of outlookAccounts) {
      if (!outlookAccount.access_token) {
        errors.push(`${outlookAccount.email}: OAuth incomplete`);
        continue;
      }

      try {
        const result = await syncOutlookInbox({
          supabase,
          outlookAccount,
          userId: user.id,
        });

        totalScanned += result.scanned;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        allInsertedRefs.push(...result.insertedRefs);
        allUpdatedRefs.push(...result.updatedRefs);
        accountResults.push({ email: result.email, inserted: result.inserted, updated: result.updated });
      } catch (err) {
        errors.push(`${outlookAccount.email}: ${err instanceof Error ? err.message : "scan failed"}`);
      }
    }

    await supabase.from("sync_log").insert({
      user_id: user.id,
      scan_type: "orders",
      scanned: totalScanned,
      inserted: totalInserted,
      updated: totalUpdated,
    });

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
