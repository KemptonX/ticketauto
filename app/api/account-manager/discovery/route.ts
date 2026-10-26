import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

function isMissingTableError(message: string | undefined): boolean {
  return !!message && /relation .* does not exist|could not find the table/i.test(message);
}

// Persists dismissing a discovered-account suggestion (migration 0013)
// so it survives a page refresh. Nothing here ever touches orders or
// ticket_accounts — it only remembers "don't suggest this again" per
// user.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { platform?: string; email?: string } | null;
  if (!body?.platform || !body?.email) {
    return NextResponse.json({ error: "platform and email are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("dismissed_account_candidates")
    .upsert(
      { user_id: user.id, platform: body.platform, email: body.email.trim().toLowerCase() },
      { onConflict: "user_id,platform,email", ignoreDuplicates: true },
    );

  if (error) {
    if (isMissingTableError(error.message)) {
      // Dismissal just won't persist until this migration is applied —
      // the client already removed it from view locally, so this is a
      // soft no-op rather than an error the user needs to see.
      return NextResponse.json({ ok: true, persisted: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, persisted: true });
}

// Lists this user's dismissed suggestions (for a "view dismissed" list).
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("dismissed_account_candidates")
    .select("platform, email, dismissed_at")
    .order("dismissed_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error.message)) return NextResponse.json({ dismissed: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ dismissed: data ?? [] });
}

// Restores a dismissed suggestion so it can reappear in discovery.
export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const email = url.searchParams.get("email");
  if (!platform || !email) return NextResponse.json({ error: "platform and email are required" }, { status: 400 });

  const { error } = await supabase
    .from("dismissed_account_candidates")
    .delete()
    .eq("user_id", user.id)
    .eq("platform", platform)
    .ilike("email", email);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
