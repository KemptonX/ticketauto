-- SMS verification code forwarding (SMSPass.io -> Discord)
-- Run in the Supabase SQL editor.
--
-- Each user can paste their own SMSPass.io API key here. A single polling
-- endpoint (app/api/cron/sms-codes/route.ts), triggered externally on a
-- short interval, loops over every active row in this table, fetches any
-- new SMS since last_seen_at, and forwards it to that user's Discord
-- webhook. The API key is encrypted at rest using the same
-- VIAGOGO_CREDENTIAL_ENCRYPTION_KEY already used for marketplace
-- credentials (src/lib/marketplace/encryption.ts) — no new encryption key
-- was introduced.

create table if not exists sms_pass_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  api_key_encrypted text not null,
  -- Optional override — if null, the poller falls back to this user's
  -- existing user_settings.discord_webhook_url (the same one used for
  -- order/sale/payout alerts).
  discord_webhook_url text,
  is_active boolean not null default true,
  -- Newest message timestamp already forwarded to Discord — the poller
  -- only fetches messages strictly after this, so nothing is sent twice.
  last_seen_at timestamptz,
  -- Small rolling buffer of "from|message|timestamp" fingerprints for the
  -- last-seen batch, as a safety net against exact-boundary duplicates
  -- (e.g. two messages landing in the same second, or an overlapping poll).
  recent_signatures text[] not null default '{}',
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sms_pass_accounts enable row level security;

drop policy if exists "sms_pass_accounts_owner" on sms_pass_accounts;
create policy "sms_pass_accounts_owner" on sms_pass_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
