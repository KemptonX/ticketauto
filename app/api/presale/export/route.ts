import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { buildCSV, buildXLSX } from "@/src/lib/presale-import";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const format   = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const campaign = url.searchParams.get("campaign");

  let query = supabase
    .from("presale_entries")
    .select("campaign, account_email, presale_code, slot_start, slot_end, notes, created_at")
    .eq("user_id", user.id)
    .order("slot_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (campaign) query = query.eq("campaign", campaign);

  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  type Row = {
    campaign: string;
    account_email: string;
    presale_code: string | null;
    slot_start: string | null;
    slot_end: string | null;
    notes: string | null;
    created_at: string;
  };

  const entries = (data ?? []) as Row[];
  const today   = new Date().toISOString().slice(0, 10);
  const base    = campaign ? `presales-${campaign}-${today}` : `presales-${today}`;

  if (format === "xlsx") {
    return new Response(new Uint8Array(buildXLSX(entries)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }

  return new Response(buildCSV(entries), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.csv"`,
    },
  });
}
