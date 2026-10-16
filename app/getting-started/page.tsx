import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import GettingStartedClient from "./getting-started-client";

export default async function GettingStartedPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <GettingStartedClient />;
}
