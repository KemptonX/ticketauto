import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import GuidesClient from "./guides-client";

export default async function GuidesPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <GuidesClient />;
}
