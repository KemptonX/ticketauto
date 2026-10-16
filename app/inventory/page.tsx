import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import InventoryClient from "./inventory-client";

export default async function InventoryPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <InventoryClient />;
}
