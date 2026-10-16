import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { requireActiveAccess } from "@/src/lib/require-access";
import OrdersClient from "./orders-client";

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();
  await requireActiveAccess(supabase);
  return <OrdersClient />;
}
