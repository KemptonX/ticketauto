import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import CostsClient from "./costs-client";

export default async function CostsPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <CostsClient />;
}
