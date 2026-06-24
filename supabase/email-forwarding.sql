-- ─── Email Forwarding Settings ───────────────────────────────────────────────
-- One row per user. The forwarding_token is the routing key for inbound emails.
-- It is stable: it never changes unless the user explicitly regenerates it.
-- Token survives email changes, provider changes, redeploys, logout/login.

create table if not exists public.email_forwarding_settings (
  id                              uuid        primary key default gen_random_uuid(),
  user_id                         uuid        not null references auth.users(id) on delete cascade,
  forwarding_token                text        not null,
  forwarding_email                text        not null,
  status                          text        not null default 'active',  -- active | disabled
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  last_received_at                timestamptz,
  last_successful_import_at       timestamptz,
  disabled_at                     timestamptz,
  latest_verification_code        text,
  latest_verification_link        text,
  latest_verification_received_at timestamptz,

  constraint email_forwarding_settings_user_id_key    unique (user_id),
  constraint email_forwarding_settings_token_key      unique (forwarding_token),
  constraint email_forwarding_settings_status_check   check (status in ('active', 'disabled'))
);

-- RLS: users can only read/update their own settings
alter table public.email_forwarding_settings enable row level security;

create policy "owner select forwarding settings"
  on public.email_forwarding_settings for select
  using (auth.uid() = user_id);

create policy "owner update forwarding settings"
  on public.email_forwarding_settings for update
  using (auth.uid() = user_id);

-- Service role can insert (used when generating first token via API route)
create policy "service role insert forwarding settings"
  on public.email_forwarding_settings for insert
  with check (true);

-- ─── Inbound Email Events Log ─────────────────────────────────────────────────
-- Audit trail for every email received via Postmark inbound.
-- Used for duplicate detection, debugging and verification code storage.

create table if not exists public.inbound_email_events (
  id                      bigserial   primary key,
  user_id                 uuid        references auth.users(id) on delete set null,
  forwarding_setting_id   uuid        references public.email_forwarding_settings(id) on delete set null,
  postmark_message_id     text,
  original_message_id     text,
  recipient_email         text,
  sender_email            text,
  subject                 text,
  received_at             timestamptz,
  normalized_hash         text,
  provider_detected       text,
  booking_ref_detected    text,
  processing_status       text        not null default 'received',
  -- received | ignored | verification_email | duplicate | imported | updated
  -- no_ref_ignored | failed | unknown_token | disabled_token
  error_message           text,
  created_at              timestamptz not null default now()
);

-- RLS: users can only read their own events
alter table public.inbound_email_events enable row level security;

create policy "owner select inbound events"
  on public.inbound_email_events for select
  using (auth.uid() = user_id);

-- Webhook (service role) can insert events
create policy "service role insert inbound events"
  on public.inbound_email_events for insert
  with check (true);

-- Indexes
create index if not exists inbound_email_events_pmid_idx
  on public.inbound_email_events(postmark_message_id)
  where postmark_message_id is not null;

create index if not exists inbound_email_events_user_id_idx
  on public.inbound_email_events(user_id);

create index if not exists inbound_email_events_fwd_setting_idx
  on public.inbound_email_events(forwarding_setting_id);
