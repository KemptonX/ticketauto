import { redirect } from "next/navigation";
import LoginForm from "./login-form";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Only bounce an already-signed-in user away from /login if they'd
    // actually be let into a protected page — otherwise this creates an
    // infinite redirect loop: requireActiveAccess() on e.g. /orders sends
    // a lapsed-entitlement user back to /login (their Supabase SESSION is
    // still valid even though their Whop membership isn't), and without
    // this check, /login would immediately bounce them straight back to
    // /orders, which bounces them back here, forever.
    //
    // Discord-only enforcement here was reverted (see require-access.ts) —
    // an email/password session is entitled again, same as before.
    const discordIdentity = user.identities?.find((i) => i.provider === "discord");
    let isEntitled = true;
    if (discordIdentity) {
      const { data: entitlement } = await supabase
        .from("whop_entitlements")
        .select("is_entitled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (entitlement && entitlement.is_entitled === false) isEntitled = false;
    }
    if (isEntitled) {
      redirect("/orders");
    }
    // Not entitled: fall through and render the login page itself, where
    // the lapsed-membership error message (if any, from the ?error= query
    // param) is shown — the user needs a path to actually see why they're
    // stuck, not just an endless bounce.
  }

  return (
    <main className="auth-page">
      <LoginForm />
    </main>
  );
}
