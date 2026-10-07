import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import {
  computeOverview,
  computeReadiness,
  resolveUkTaxYear,
  resolveCompanyFinancialYear,
  resolvePresetPeriod,
  resolveCustomPeriod,
  resolvePrimaryPeriod,
  resolveYearToDate,
  type PeriodRange,
} from "@/src/lib/accounting";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "uk_tax_year";
  const offset = Number(url.searchParams.get("offset") ?? "0") || 0;
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const { data: profile } = await supabase
    .from("accounting_profiles")
    .select("business_structure, company_year_end")
    .eq("user_id", user.id)
    .maybeSingle();

  const businessStructure = (profile?.business_structure as "sole_trader" | "limited_company") ?? "sole_trader";
  const companyYearEnd = (profile?.company_year_end as string | null) ?? null;
  const now = new Date();

  let period: PeriodRange;
  switch (kind) {
    case "uk_tax_year":
      period = resolveUkTaxYear(now, offset);
      break;
    case "company_fy":
      if (!companyYearEnd) {
        return NextResponse.json(
          { error: "Company financial year end isn't set up yet — complete business settings first." },
          { status: 400 },
        );
      }
      period = resolveCompanyFinancialYear(companyYearEnd, now, offset);
      break;
    case "this_month":
    case "last_month":
    case "this_quarter":
      period = resolvePresetPeriod(kind, now);
      break;
    case "year_to_date":
      period = resolveYearToDate(businessStructure, companyYearEnd, now);
      break;
    case "previous_accounting_year":
      period = resolvePrimaryPeriod(businessStructure, companyYearEnd, now, 1);
      break;
    case "custom":
      if (!start || !end) {
        return NextResponse.json({ error: "Custom period needs both start and end dates" }, { status: 400 });
      }
      period = resolveCustomPeriod(start, end);
      break;
    default:
      return NextResponse.json({ error: `Unknown period kind: ${kind}` }, { status: 400 });
  }

  const [figures, readiness] = await Promise.all([
    computeOverview(supabase, user.id, period),
    computeReadiness(supabase, user.id, period),
  ]);
  return NextResponse.json({ period, figures, readiness });
}
