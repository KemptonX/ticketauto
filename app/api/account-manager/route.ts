import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { ACCOUNT_STATUSES, buildDiscoveryCandidates } from "@/src/lib/account-manager";

export const runtime = "nodejs";

// Returns true for the specific Postgrest "missing table" error, so the
// client can show a clear "not set up yet" state instead of a raw error
// if migration 0012 hasn't been applied yet — same pattern used
// throughout this app for every feature that depends on an unapplied
// migration.
function isMissingTableError(message: string | undefined): boolean {
  return !!message && /relation .* does not exist|could not find the table/i.test(message);
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const { data: accounts, error } = await supabase
    .from("ticket_accounts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error.message)) {
      return NextResponse.json({ accounts: [], tableReady: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich each account with its purchase history, matched by email —
  // see migration 0012's comment for why this is computed rather than a
  // stored foreign key. Paginated fetch of this user's orders (not
  // capped at Supabase's default 1000) so the stats are correct even for
  // a large account.
  const PAGE = 1000;
  type OrderRow = { account_email: string | null; total_cost: number | null; sold_total: number | null; event_date: string | null; created_at: string };
  const allOrders: OrderRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: ordersError } = await supabase
      .from("orders")
      .select("account_email, total_cost, sold_total, event_date, created_at")
      .not("account_email", "is", null)
      .range(from, from + PAGE - 1);
    if (ordersError || !data || data.length === 0) break;
    allOrders.push(...(data as OrderRow[]));
    if (data.length < PAGE) break;
  }

  const byEmail = new Map<string, { count: number; totalCost: number; totalSold: number; lastPurchaseAt: string }>();
  for (const o of allOrders) {
    const key = (o.account_email ?? "").trim().toLowerCase();
    if (!key) continue;
    const stat = byEmail.get(key) ?? { count: 0, totalCost: 0, totalSold: 0, lastPurchaseAt: "" };
    stat.count += 1;
    stat.totalCost += o.total_cost ?? 0;
    stat.totalSold += o.sold_total ?? 0;
    if (o.created_at > stat.lastPurchaseAt) stat.lastPurchaseAt = o.created_at;
    byEmail.set(key, stat);
  }

  const enriched = (accounts ?? []).map((a) => {
    const key = (a.email ?? "").trim().toLowerCase();
    const stat = key ? byEmail.get(key) : undefined;
    return {
      ...a,
      purchase_count: stat?.count ?? 0,
      total_spent: stat?.totalCost ?? 0,
      total_sold: stat?.totalSold ?? 0,
      last_purchase_at: stat?.lastPurchaseAt || null,
    };
  });

  // Discovery candidates: Ticketmaster/AXS accounts seen in existing
  // orders that aren't saved here yet — never auto-created, just
  // surfaced for the customer to confirm or dismiss. Dismissed
  // candidates (migration 0013) are excluded the same way an already-
  // saved account is, so a dismissal actually sticks across refreshes.
  const { data: dismissedRows } = await supabase
    .from("dismissed_account_candidates")
    .select("platform, email");
  const existingKeys = new Set([
    ...(accounts ?? [])
      .filter((a) => a.email)
      .map((a) => `${a.platform}__${(a.email ?? "").trim().toLowerCase()}`),
    ...(dismissedRows ?? []).map((d) => `${d.platform}__${d.email.trim().toLowerCase()}`),
  ]);
  const existingEmails = new Set((accounts ?? []).map((a) => (a.email ?? "").trim().toLowerCase()).filter(Boolean));
  const { data: classifiableOrders } = await supabase
    .from("orders")
    .select("account_email, source_type, created_at")
    .not("account_email", "is", null)
    .limit(5000);
  const candidates = buildDiscoveryCandidates(classifiableOrders ?? [], existingKeys);

  // Dashboard stats — all computed from the real data just fetched above,
  // nothing hardcoded. "Linked purchases" = orders whose account_email
  // matches a saved account; deliberately not showing "unlinked
  // purchases" as a top-level figure any more — with 0 accounts saved it
  // trivially equals the user's total order count, which read as an
  // alarming number rather than a meaningful one.
  const matchedOrderCount = allOrders.filter((o) => {
    const key = (o.account_email ?? "").trim().toLowerCase();
    return key && existingEmails.has(key);
  }).length;
  const stats = {
    totalAccounts: (accounts ?? []).length,
    ticketmasterAccounts: (accounts ?? []).filter((a) => a.platform === "ticketmaster").length,
    axsAccounts: (accounts ?? []).filter((a) => a.platform === "axs").length,
    linkedPurchases: matchedOrderCount,
  };

  return NextResponse.json({ accounts: enriched, candidates, stats, dismissedCount: (dismissedRows ?? []).length, tableReady: true });
}

const ALLOWED_FIELDS = new Set([
  "platform", "account_name", "email", "phone", "browser_profile_number",
  "browser_profile_tool", "proxy_reference", "country", "status", "notes",
  "tags", "source", "account_created_at", "last_checked_at",
]);

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "An email address is required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address" }, { status: 400 });
  }
  if (body.status && !ACCOUNT_STATUSES.includes(body.status as never)) {
    return NextResponse.json({ error: `Status must be one of: ${ACCOUNT_STATUSES.join(", ")}` }, { status: 400 });
  }

  const platform = typeof body.platform === "string" && body.platform ? body.platform : "other";

  const insert: Record<string, unknown> = { user_id: user.id };
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) insert[key] = value === "" ? null : value;
  }
  insert.email = email;
  insert.platform = platform;

  const { data, error } = await supabase.from("ticket_accounts").insert(insert).select("*").single();
  if (error) {
    if (isMissingTableError(error.message)) {
      return NextResponse.json({ error: "Account Manager isn't fully set up yet — please contact support." }, { status: 503 });
    }
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("ticket_accounts")
        .select("id, account_name, email")
        .eq("user_id", user.id)
        .eq("platform", platform)
        .ilike("email", email)
        .maybeSingle();
      return NextResponse.json(
        {
          error: `An account with this email already exists on this platform${existing?.account_name ? ` (${existing.account_name})` : ""}.`,
          existingAccountId: existing?.id ?? null,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ account: data });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as (Record<string, unknown> & { id?: string }) | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (body.status && !ACCOUNT_STATUSES.includes(body.status as never)) {
    return NextResponse.json({ error: `Status must be one of: ${ACCOUNT_STATUSES.join(", ")}` }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) update[key] = value === "" ? null : value;
  }

  const { data, error } = await supabase
    .from("ticket_accounts")
    .update(update)
    .eq("id", body.id)
    .eq("user_id", user.id) // defense-in-depth alongside RLS, same pattern used by tax-accounts/entities
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ account: data });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("ticket_accounts").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
