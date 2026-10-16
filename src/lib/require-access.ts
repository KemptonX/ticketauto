import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// Single shared gate for every protected page's server component
// (SEC-002 + SEC-001 remediation combined): checks the user is signed in
// AND, for Discord-login users, that their cached Whop entitlement
// (whop_entitlements.is_entitled) hasn't lapsed. Replaces each page
// independently re-implementing its own getUser() check (or, for 4 pages
// found by the audit, having no check at all) with one call.
//
// Does NOT replace middleware/proxy.ts — this is a second, independent
// layer, deliberately redundant with it. A manually-maintained route
// allowlist (what proxy.ts currently is) is fragile by nature; calling
// this at the top of every protected page.tsx is the safe default until
// the pages are restructured under a shared route-group layout (see the
// report's recommended follow-up — not done in this pass, since moving
// every protected page's folder is a bigger structural change than
// fits a controlled, incrementally-verified stage).
//
// Default-allow when a Discord user has no whop_entitlements row yet:
// covers Discord users who logged in before migration 0006 existed. Those
// get a real row — and real enforcement — starting from their NEXT login
// or the first whop-refresh cron run, whichever comes first, rather than
// being instantly locked out the moment this deploys.
//
// Discord-only login was briefly enforced here (denying any session with
// no Discord identity) but reverted: real existing email/password
// customers were locked out immediately with no migration path in place
// yet, which is a worse outcome than the bypass risk this was meant to
// close. Re-apply this once those customers have had a chance to migrate
// via /account-access (see that route) — don't just silently leave it
// off indefinitely.
export async function requireActiveAccess(
  supabase: SupabaseClient,
): Promise<User> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const discordIdentity = user.identities?.find((i) => i.provider === "discord");
  if (!discordIdentity) {
    return user; // email/password account — temporarily restored, see comment above
  }

  const { data: entitlement } = await supabase
    .from("whop_entitlements")
    .select("is_entitled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (entitlement && entitlement.is_entitled === false) {
    redirect("/login?error=" + encodeURIComponent("Your TixTracker membership is no longer active. Please renew via Whop to regain access."));
  }

  return user;
}

// Decides whether a signed-in user should be sent through the
// getting-started wizard instead of straight to the dashboard. See
// supabase/migrations/0008_onboarding.sql — existing accounts are
// backfilled to onboarding_completed_at = now() at migration time, so
// this only ever returns true for a signup created after that migration
// runs, and only until they finish or skip the wizard.
//
// The orders-count check is deliberate belt-and-suspenders: it means an
// active user is never shown onboarding even in an edge case where
// onboarding_completed_at wasn't set for some reason (e.g. this code ran
// before migration 0008 was applied, or a row was created some other
// way) — having real inventory is itself proof setup already happened.
//
// Tolerates migration 0008 not being applied yet: a missing column
// surfaces as a Postgrest error, which this treats as "don't show
// onboarding" (the safe default — never show an unfinished feature to an
// existing, working account just because a query failed).
export async function shouldShowOnboarding(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  if (settings?.onboarding_completed_at) return false;

  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return false;

  return true;
}
