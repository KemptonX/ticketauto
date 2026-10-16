import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import ArchivedSalesClient from "./archived-sales-client";

export default async function ArchivedSalesPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <ArchivedSalesClient />;
}
