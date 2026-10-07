import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import {
  computeOverview,
  computeDataQuality,
  resolvePrimaryPeriod,
  selfAssessmentDeadline,
  type BusinessStructure,
  type AccountingBasis,
} from "@/src/lib/accounting";

export const runtime = "nodejs";

const YEARS_TO_CHECK = 5;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("accounting_profiles")
    .select("business_structure, company_year_end, accounting_basis")
    .eq("user_id", user.id)
    .maybeSingle();

  const businessStructure = (profile?.business_structure as BusinessStructure) ?? "sole_trader";
  const companyYearEnd = (profile?.company_year_end as string | null) ?? null;
  const accountingBasis: AccountingBasis =
    businessStructure === "limited_company" ? "traditional" : ((profile?.accounting_basis as AccountingBasis) ?? "cash");
  const now = new Date();

  const { data: statusRows } = await supabase
    .from("tax_year_status")
    .select("period_start, period_end, status")
    .eq("user_id", user.id);
  const statusByRange = new Map(
    (statusRows ?? []).map((r: { period_start: string; period_end: string; status: string }) => [`${r.period_start}|${r.period_end}`, r.status]),
  );

  const years = await Promise.all(
    Array.from({ length: YEARS_TO_CHECK }, (_, i) => i).map(async (offset) => {
      const period = resolvePrimaryPeriod(businessStructure, companyYearEnd, now, offset);
      const [figures, dataQuality] = await Promise.all([
        computeOverview(supabase, user.id, period, accountingBasis),
        computeDataQuality(supabase, user.id, period),
      ]);

      const hasData = figures.recordCounts.sales > 0 || figures.recordCounts.purchases > 0 || figures.recordCounts.expenses > 0;
      const storedStatus = statusByRange.get(`${period.start}|${period.end}`);
      const isCurrent = offset === 0;
      const ended = period.end < now.toISOString().slice(0, 10);

      if (!hasData && !isCurrent && !storedStatus) return null;

      const criticalCount = dataQuality.critical.reduce((s, i) => s + i.count, 0);
      const status = storedStatus ?? (isCurrent ? "in_progress" : ended ? (criticalCount === 0 ? "ready_for_accountant" : "needs_review") : "in_progress");

      return {
        period,
        isCurrent,
        ended,
        status,
        readinessScore: dataQuality.score,
        criticalCount,
        income: figures.income,
        estimatedProfit: figures.estimatedProfit,
        selfAssessmentDeadline: selfAssessmentDeadline(period),
      };
    }),
  );

  return NextResponse.json({
    businessStructure,
    years: years.filter((y): y is NonNullable<typeof y> => y != null),
  });
}
