import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import ForwardMailClient from "./forward-mail-client";

export default async function ForwardMailPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <ForwardMailClient />;
}
