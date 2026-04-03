import OrdersClient from "./orders-client";
import { requireSession } from "@/src/lib/whop-auth";

export default async function OrdersPage() {
  await requireSession();

  return <OrdersClient />;
}
