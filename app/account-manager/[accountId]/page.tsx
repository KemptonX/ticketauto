import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import AccountDetailsClient from "./account-details-client";

export default async function AccountDetailsPage({ params }: { params: Promise<{ accountId: string }> }) {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  const { accountId } = await params;
  return <AccountDetailsClient accountId={accountId} />;
}
