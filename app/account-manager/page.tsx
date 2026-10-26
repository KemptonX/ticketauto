import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import AccountManagerClient from "./account-manager-client";

export default async function AccountManagerPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <AccountManagerClient />;
}
