import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

function isMissingTableError(message: string | undefined): boolean {
  return !!message && /relation .* does not exist|could not find the table/i.test(message);
}

type BulkItem = { platform: string; email: string; account_name?: string | null };

// Adds many confirmed discovery candidates (or CSV import rows) in one
// request instead of one round-trip per row — matters once a customer
// has dozens or hundreds of accounts to confirm at once. Inserted one
// row at a time server-side (not a single multi-row insert) so one
// already-existing duplicate can't fail the whole batch; each row's
// outcome is reported individually.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { items?: BulkItem[] } | null;
  const items = body?.items;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items is required and must be a non-empty array" }, { status: 400 });
  }
  if (items.length > 500) {
    return NextResponse.json({ error: "Add at most 500 accounts at a time" }, { status: 400 });
  }

  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    const email = (item.email ?? "").trim();
    const platform = item.platform || "other";
    if (!email) { skipped++; continue; }

    const { error } = await supabase.from("ticket_accounts").insert({
      user_id: user.id,
      platform,
      email,
      account_name: item.account_name || null,
      source: "auto_discovered",
    });

    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json({ error: "Account Manager isn't fully set up yet — please contact support." }, { status: 503 });
      }
      if (error.code === "23505") { skipped++; continue; } // already saved — not an error, just nothing to do
      skipped++;
      errors.push(`${email}: ${error.message}`);
      continue;
    }
    added++;
  }

  return NextResponse.json({ added, skipped, errors });
}
