import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import PresaleClient from "./presale-client";

export default async function PresalePage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <PresaleClient />;
}
