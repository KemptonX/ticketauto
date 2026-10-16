import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import AnalyticsClient from "./analytics-client";

export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <AnalyticsClient />;
}
