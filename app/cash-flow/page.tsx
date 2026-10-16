import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import CashFlowClient from "./cash-flow-client";

export default async function CashFlowPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <CashFlowClient />;
}
