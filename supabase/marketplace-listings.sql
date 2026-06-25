-- marketplace listing tables: event matches, listing drafts, jobs, confirmed listings, logs
-- Run in Supabase SQL Editor AFTER marketplace-accounts.sql

-- ─── Event matches ───────────────────────────────────────────────────────────

create table if not exists public.viagogo_event_matches (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  order_id                bigint references public.orders(id) on delete cascade,
  tixtracker_event_name   text,
  tixtracker_event_date   text,                                     -- ISO date, e.g. '2026-06-27'
  tixtracker_venue        text,
  viagogo_event_id        text not null,
  viagogo_event_name      text,
  viagogo_event_date      text,                                     -- as returned by Viagogo
  viagogo_event_url       text,
  viagogo_venue           text,
  viagogo_city            text,
  viagogo_country         text,
  match_method            text not null default 'auto',             -- 'auto' | 'manual_search'
  confidence_score        numeric(4,3),                             -- 0.000–1.000
  match_status            text not null default 'pending',          -- 'pending' | 'confirmed' | 'rejected'
  confirmed_by_user       boolean not null default false,
  confirmed_at            timestamptz,
  rejected_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.viagogo_event_matches enable row level security;

drop policy if exists "viagogo_event_matches_own" on public.viagogo_event_matches;
create policy "viagogo_event_matches_own"
  on public.viagogo_event_matches for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists viagogo_event_matches_order_idx
  on public.viagogo_event_matches(order_id, match_status);

-- ─── Listing drafts ──────────────────────────────────────────────────────────

create table if not exists public.marketplace_listing_drafts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  order_id                  bigint not null references public.orders(id) on delete cascade,
  marketplace_account_id    uuid references public.marketplace_accounts(id) on delete set null,
  marketplace               text not null default 'viagogo',
  event_match_id            uuid references public.viagogo_event_matches(id) on delete set null,
  viagogo_event_id          text,
  status                    text not null default 'draft',
    -- draft | validating | ready | submitted | cancelled
  -- Ticket details (may differ from order if user adjusts for listing)
  quantity                  integer,
  split_rule                text,
    -- any_quantity | all_together | no_single_left | no_one_or_three_left
  ticket_type               text not null default 'mobile_transfer',
  ticket_storage_provider   text,
    -- ticketmaster | axs | seatgeek | other | unknown
  section                   text,
  row                       text,
  seat_from                 text,
  seat_to                   text,
  price_per_ticket          numeric(10,2),
  currency                  text not null default 'GBP',
  face_value_per_ticket     numeric(10,2),
  -- Features / restrictions page
  listing_features          text not null default 'none',
  comments                  text not null default 'none',
  restrictions              text not null default 'none',
  limitations               text not null default 'none',
  -- Confirmations
  about_you_confirmed       boolean not null default false,
  terms_confirmed           boolean not null default false,
  -- Validation
  validation_errors         jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.marketplace_listing_drafts enable row level security;

drop policy if exists "marketplace_listing_drafts_own" on public.marketplace_listing_drafts;
create policy "marketplace_listing_drafts_own"
  on public.marketplace_listing_drafts for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists marketplace_listing_drafts_order_idx
  on public.marketplace_listing_drafts(order_id, status);

-- ─── Listing jobs ─────────────────────────────────────────────────────────────

create table if not exists public.marketplace_listing_jobs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  order_id                 bigint not null references public.orders(id) on delete cascade,
  marketplace_account_id   uuid references public.marketplace_accounts(id) on delete set null,
  draft_id                 uuid references public.marketplace_listing_drafts(id) on delete set null,
  marketplace              text not null default 'viagogo',
  status                   text not null default 'queued',
    -- queued | validating | logging_in | session_checking | opening_event_page |
    -- verifying_event | clicking_sell | selecting_quantity | selecting_split_rule |
    -- filling_ticket_details | filling_features_restrictions | selecting_ticket_provider |
    -- filling_seat_details | filling_price | final_review | submitting_listing |
    -- waiting_for_confirmation | listed | failed | needs_reconnect |
    -- verification_required | unknown_needs_review | cancelled
  current_step             text,
  attempt_count            integer not null default 0,
  max_attempts             integer not null default 1,             -- never blindly retry listing submit
  locked_at                timestamptz,
  locked_by                text,                                   -- worker instance identifier
  started_at               timestamptz,
  completed_at             timestamptz,
  failed_at                timestamptz,
  error_code               text,
  error_message            text,
  result_listing_id        text,                                   -- Viagogo listing ID after success
  result_listing_url       text,
  -- 2FA / verification
  pending_verification     boolean not null default false,
  verification_expires_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.marketplace_listing_jobs enable row level security;

drop policy if exists "marketplace_listing_jobs_own" on public.marketplace_listing_jobs;
create policy "marketplace_listing_jobs_own"
  on public.marketplace_listing_jobs for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Only one active job per order at a time
create unique index if not exists marketplace_listing_jobs_active_order_idx
  on public.marketplace_listing_jobs(order_id)
  where (status not in ('listed', 'failed', 'cancelled', 'unknown_needs_review'));

create index if not exists marketplace_listing_jobs_status_idx
  on public.marketplace_listing_jobs(status, created_at asc);

-- ─── Confirmed listings ───────────────────────────────────────────────────────

create table if not exists public.marketplace_listings (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  order_id                 bigint not null references public.orders(id) on delete cascade,
  marketplace_account_id   uuid references public.marketplace_accounts(id) on delete set null,
  job_id                   uuid references public.marketplace_listing_jobs(id) on delete set null,
  draft_id                 uuid references public.marketplace_listing_drafts(id) on delete set null,
  marketplace              text not null default 'viagogo',
  -- Stable ID used to detect duplicates across retries
  external_id              text not null,
  viagogo_event_id         text,
  viagogo_listing_id       text,
  viagogo_listing_url      text,
  status                   text not null default 'active',          -- active | sold | delisted | unknown
  quantity_listed          integer,
  section                  text,
  row                      text,
  seats                    text,
  price_per_ticket         numeric(10,2),
  currency                 text default 'GBP',
  face_value               numeric(10,2),
  listed_at                timestamptz,
  last_synced_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint marketplace_listings_external_id_unique unique (external_id)
);

alter table public.marketplace_listings enable row level security;

drop policy if exists "marketplace_listings_own" on public.marketplace_listings;
create policy "marketplace_listings_own"
  on public.marketplace_listings for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists marketplace_listings_order_idx
  on public.marketplace_listings(order_id, status);

-- ─── Listing logs ─────────────────────────────────────────────────────────────

create table if not exists public.marketplace_listing_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  order_id     bigint references public.orders(id) on delete set null,
  listing_id   uuid references public.marketplace_listings(id) on delete set null,
  job_id       uuid references public.marketplace_listing_jobs(id) on delete set null,
  action       text not null,
    -- draft_created | event_search | event_match_confirmed | validation_passed |
    -- validation_failed | job_queued | job_started | page_verified | quantity_selected |
    -- split_rule_selected | provider_selected | seats_entered | price_entered |
    -- final_check_passed | listing_attempted | listed | failed | unknown_needs_review |
    -- job_cancelled | 2fa_requested | 2fa_submitted
  status       text,
  message      text,
  error_code   text,
  created_at   timestamptz not null default now()
);

alter table public.marketplace_listing_logs enable row level security;

drop policy if exists "marketplace_listing_logs_own_select" on public.marketplace_listing_logs;
create policy "marketplace_listing_logs_own_select"
  on public.marketplace_listing_logs for select
  using (auth.uid() = user_id);

drop policy if exists "marketplace_listing_logs_own_insert" on public.marketplace_listing_logs;
create policy "marketplace_listing_logs_own_insert"
  on public.marketplace_listing_logs for insert
  with check (auth.uid() = user_id);

create index if not exists marketplace_listing_logs_job_idx
  on public.marketplace_listing_logs(job_id, created_at asc);
