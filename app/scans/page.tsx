import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import ScansClient from "./scans-client";

export default async function ScansPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <ScansClient />;
}
