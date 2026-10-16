import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import ViagogoCalculatorClient from "./viagogo-calculator-client";

export default async function ViagogoCalculatorPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <ViagogoCalculatorClient />;
}
