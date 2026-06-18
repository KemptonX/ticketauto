import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { getSession } from "@/src/lib/whop-auth";
import WhopVerifyForm from "./whop-verify-form";

export default async function WhopVerifyPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const session = await getSession();
  if (session) {
    redirect("/orders");
  }

  return (
    <main className="auth-page">
      <WhopVerifyForm />
    </main>
  );
}
