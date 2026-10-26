import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { matchesPlatform } from "@/src/lib/account-manager";

export const runtime = "nodejs";

// Itemised purchase history for one account — the main list route only
// returns aggregated stats (count/total), since an account's full order
// list could be long. Looked up by account id (not email directly) so
// the client never has to pass a raw email around. Also returns the
// account's own fields, since this is the sole data source for the
// standalone /account-manager/[accountId] details page.
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  const { data: account, error: accountError } = await supabase
    .from("ticket_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (accountError || !account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (!account.email) return NextResponse.json({ account, purchases: [] });

  const { data: rawPurchases, error } = await supabase
    .from("orders")
    .select("id, event_name, venue, event_date, qty_bought, total_cost, sold_total, listing_status, booking_ref, source_type, created_at")
    .ilike("account_email", account.email)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Platform-aware: the same email can be a distinct account on both
  // Ticketmaster and AXS, so without this an order could appear under
  // both accounts' histories (the real bug this fixes — confirmed via a
  // live report of two accounts sharing an email both showing 152).
  const purchases = (rawPurchases ?? []).filter((o) => matchesPlatform(account.platform, o.source_type));

  return NextResponse.json({ account, purchases });
}
