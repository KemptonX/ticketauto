import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import TaxAccountsClient from "./tax-accounts-client";

export default async function TaxAccountsPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <TaxAccountsClient />;
}
