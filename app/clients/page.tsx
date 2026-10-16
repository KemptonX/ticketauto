import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import ClientsClient from "./clients-client";

export default async function ClientsPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <ClientsClient />;
}
