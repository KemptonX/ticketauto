-- Onboarding/setup-progress tracking for user_settings. NOT YET APPLIED.
--
-- Why: there was previously no way to tell a brand-new signup apart from
-- an existing customer anywhere in the app — app/auth/callback/route.ts
-- and app/login/page.tsx only ever branch on session/entitlement state,
-- never on whether this is someone's first login. That's what the new
-- getting-started wizard (app/getting-started) needs to know whether to
-- show itself.
--
-- Safe/additive: three new nullable (or default-empty) columns on the
-- existing user_settings table. No existing column, row, or constraint is
-- touched. Backfilled below so every account that exists AT MIGRATION TIME
-- is immediately marked as already onboarded — only a signup created AFTER
-- this migration runs will ever see onboarding_completed_at as null, which
-- is what the dashboard checks to decide whether to show the wizard.

alter table public.user_settings
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_current_step text,
  add column if not exists onboarding_skipped_steps text[] not null default '{}';

-- Backfill: mark every existing auth user as already onboarded, including
-- accounts that have never had a user_settings row at all (user_settings
-- appears to have been created outside this repo's migration history —
-- there is no earlier "create table" to depend on, so this upserts rather
-- than assumes a row already exists).
insert into public.user_settings (user_id, onboarding_completed_at)
select id, now() from auth.users
on conflict (user_id) do update
  set onboarding_completed_at = coalesce(public.user_settings.onboarding_completed_at, now());
