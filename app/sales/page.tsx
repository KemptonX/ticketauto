import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import SalesClient from "./sales-client";

export default async function SalesPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <SalesClient />;
}
