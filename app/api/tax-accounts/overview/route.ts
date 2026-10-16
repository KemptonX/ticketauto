import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import {
  computeOverview,
  computeReadiness,
  resolveCustomPeriod,
  resolvePresetPeriod,
  selfAssessmentDeadline,
  type PeriodRange,
  type AccountingBasis,
} from "@/src/lib/accounting";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "custom";
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const entityType = url.searchParams.get("entityType"); // "sole_trader" | "limited_company"
  const now = new Date();

  let period: PeriodRange;
  if (kind === "this_month" || kind === "last_month" || kind === "this_quarter") {
    period = resolvePresetPeriod(kind, now);
  } else {
    if (!start || !end) return NextResponse.json({ error: "start and end dates are required" }, { status: 400 });
    period = resolveCustomPeriod(start, end);
  }

  const periodIsOpen = period.end >= now.toISOString().slice(0, 10);

  let accountingBasis: AccountingBasis = "traditional";
  if (entityType === "sole_trader") {
    const { data: profile } = await supabase.from("accounting_profiles").select("accounting_basis").eq("user_id", user.id).maybeSingle();
    accountingBasis = (profile?.accounting_basis as AccountingBasis) ?? "cash";
  }

  const [figures, readiness] = await Promise.all([
    computeOverview(supabase, user.id, period, periodIsOpen, accountingBasis),
    computeReadiness(supabase, user.id, period, true),
  ]);

  return NextResponse.json({
    period,
    figures,
    readiness,
    selfAssessmentDeadline: selfAssessmentDeadline(period),
  });
}
