-- Account Manager — persisted dismissals for discovered account suggestions.
-- NOT YET APPLIED.
--
-- Without this, dismissing a discovery suggestion only lasted until the
-- next page load (the candidate list is recomputed fresh from orders
-- every time). This table remembers a dismissal per user so it survives
-- a refresh, while still allowing the suggestion to be found again later
-- (nothing here is ever auto-deleted; the UI offers a "view dismissed"
-- list to restore one).
--
-- Safe/additive: one new table, RLS enabled, user-scoped, no change to
-- any existing table.

create table if not exists public.dismissed_account_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  email text not null,
  dismissed_at timestamptz not null default now()
);

alter table public.dismissed_account_candidates enable row level security;

drop policy if exists dismissed_account_candidates_owner on public.dismissed_account_candidates;
create policy dismissed_account_candidates_owner on public.dismissed_account_candidates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create unique index if not exists idx_dismissed_candidates_user_platform_email
  on public.dismissed_account_candidates (user_id, lower(platform), lower(email));
