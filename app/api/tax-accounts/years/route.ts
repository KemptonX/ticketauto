import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import {
  computeOverview,
  computeReadiness,
  fetchEntities,
  generatePeriodsForEntity,
  selfAssessmentDeadline,
  withinPeriod,
  type AccountingBasis,
} from "@/src/lib/accounting";

export const runtime = "nodejs";

const PERIODS_PER_ENTITY = 3;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const entities = await fetchEntities(supabase, user.id);

  if (entities.length === 0) {
    return NextResponse.json({ needsEntitySetup: true, entities: [], years: [] });
  }

  const { data: profile } = await supabase
    .from("accounting_profiles")
    .select("accounting_basis")
    .eq("user_id", user.id)
    .maybeSingle();
  const soleTraderBasis: AccountingBasis = (profile?.accounting_basis as AccountingBasis) ?? "cash";

  const { data: statusRows } = await supabase
    .from("tax_year_status")
    .select("period_start, period_end, status")
    .eq("user_id", user.id);
  const statusByRange = new Map(
    (statusRows ?? []).map((r: { period_start: string; period_end: string; status: string }) => [`${r.period_start}|${r.period_end}`, r.status]),
  );

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  const years: unknown[] = [];
  for (const entity of entities) {
    const periods = generatePeriodsForEntity(entity, now, PERIODS_PER_ENTITY);
    for (const period of periods) {
      const periodIsOpen = period.end >= todayIso;
      const basis: AccountingBasis = entity.entityType === "limited_company" ? "traditional" : soleTraderBasis;
      const [figures, readiness] = await Promise.all([
        computeOverview(supabase, user.id, period, periodIsOpen, basis),
        computeReadiness(supabase, user.id, period, true),
      ]);

      const hasAnyData = figures.recordCounts.sales > 0 || figures.recordCounts.purchases > 0 || figures.recordCounts.expenses > 0;
      if (!hasAnyData && !periodIsOpen && !statusByRange.get(`${period.start}|${period.end}`)) continue;

      const storedStatus = statusByRange.get(`${period.start}|${period.end}`);
      years.push({
        period,
        entityId: entity.id,
        entityDisplayName: entity.displayName,
        entityType: entity.entityType,
        isCurrent: periodIsOpen,
        ended: !periodIsOpen,
        status: storedStatus ?? readiness.status,
        periodScore: readiness.periodScore,
        historicalCoverageComplete: readiness.historicalCoverageComplete,
        criticalRecordCount: readiness.criticalRecordCount,
        reviewRecordCount: readiness.reviewRecordCount,
        issueTypeCount: readiness.issueTypeCount,
        unassignedPurchaseCount: readiness.unassignedPurchaseCount,
        unassignedSaleCount: readiness.unassignedSaleCount,
        income: figures.income,
        estimatedProfit: figures.estimatedProfit,
        unassignedIncome: figures.unassignedIncome,
        selfAssessmentDeadline: selfAssessmentDeadline(period),
      });
    }
  }

  // Detect transaction activity that falls outside every configured
  // entity's date range — proof that entity history setup is incomplete,
  // surfaced rather than silently ignored.
  const { data: dateProbe } = await supabase.from("orders").select("purchased_at").eq("user_id", user.id).not("purchased_at", "is", null);
  const uncoveredCount = (dateProbe ?? []).filter(
    (o: { purchased_at: string }) => !entities.some((e) => withinPeriod(o.purchased_at, { start: e.effectiveFrom, end: e.effectiveTo ?? "9999-12-31" })),
  ).length;

  return NextResponse.json({
    needsEntitySetup: false,
    entities,
    years,
    uncoveredTransactionCount: uncoveredCount,
  });
}
