import { redirect } from "next/navigation";
import LoginForm from "./login-form";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/orders");
  }

  return (
    <main className="auth-page">
      <LoginForm />
    </main>
  );
}
