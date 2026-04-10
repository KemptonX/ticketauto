# TicketAuto Technical Handoff

## 1. Project Overview

### What the project is
TicketAuto is a multi-user ticket tracking dashboard for ticket resellers. It ingests purchase emails from Ticketmaster and sale emails from Viagogo, stores the extracted ticket/sale data in Supabase, and presents it in a dark SaaS-style dashboard.

### Primary purpose
The app helps a reseller answer:
- What tickets do I currently hold?
- What stock is left by event?
- What have I sold?
- How much have I spent?
- What profit and ROI am I making?
- Which sales match which inventory orders?

### Target users
- Primary: individual ticket resellers
- Secondary: small teams or close-friend beta testers using isolated member accounts

### Core workflows
- A member signs in
- A member connects a Gmail account
- The app scans unread Ticketmaster emails and creates/updates inventory rows
- The app scans unread Viagogo emails and creates/matches sales rows
- The dashboard, inventory, sales, and analytics pages read from Supabase

---

## 2. Tech Stack

### Frontend
- TypeScript
- React 19
- Next.js 16.2.2 (App Router)
- CSS via `app/globals.css`
- No component library like shadcn installed; styling is custom

### Backend / Server
- Next.js route handlers under `app/api/*`
- Node.js runtime for Gmail and sales scan routes

### Database / Auth
- Supabase
- Supabase Auth for member login/signup
- Supabase Postgres as the main database
- Row Level Security (RLS) for member isolation

### External APIs / Integrations
- Gmail API
- Google OAuth 2.0
- Google OAuth user info endpoint
- Whop API scaffolding exists but is not currently the active auth system

### Hosting / Deployment
- Vercel
- GitHub main branch auto-deploys to Vercel

### Tooling / Dev
- TypeScript compiler (`npx tsc --noEmit`)
- ESLint configured
- Tailwind packages are present in `package.json`, but the app is mainly using custom CSS rather than Tailwind utility classes

---

## 3. Architecture

### High-level structure
This is a monolithic Next.js App Router application with:
- client-rendered dashboard pages
- server route handlers for scans and OAuth
- Supabase as both auth and database
- Gmail as the ingestion source

### Request flow
1. User signs in via Supabase Auth
2. `middleware.ts` checks auth for protected pages and APIs
3. Client pages query Supabase directly using the browser client
4. Server routes use the Supabase SSR server client
5. Gmail scan routes fetch Gmail data server-side
6. Parsed data is inserted or updated in Supabase

### Frontend/backend separation
- Frontend pages live in `app/*`
- Server API logic lives in `app/api/*`
- Shared business logic lives in `src/lib/*`

### Main server modules
- `src/lib/gmail-sync.ts`
  - Ticketmaster parsing and order insert/update logic
- `src/lib/viagogo-sales-sync.ts`
  - Viagogo parsing, matching, rematching, and sales insert/update logic
- `src/lib/archive-rules.ts`
  - Auto-archive rules for expired sales
- `src/lib/supabase.ts`
  - browser Supabase client
- `src/lib/supabase-server.ts`
  - server Supabase client

---

## 4. Main Pages

### `/orders`
Primary dashboard / ticket desk.

Purpose:
- view live tickets
- edit ticket details
- set status
- set sold total
- scan Gmail for Ticketmaster orders

Main file:
- `app/orders/orders-client.tsx`

### `/inventory`
Grouped stock view by event.

Purpose:
- see stock left
- see stock value
- see grouped holdings by event
- filter by artist / status / month / account

Main file:
- `app/inventory/inventory-client.tsx`

### `/sales`
Viagogo sales desk.

Purpose:
- scan unread Viagogo sale emails
- match sales to inventory
- view sold-for, cost, profit, ROI
- archive sale rows
- manually unmatch / match sale rows

Main file:
- `app/sales/sales-client.tsx`

### `/archived-sales`
Archive view for sales that have been moved out of the active sales desk.

Purpose:
- restore archived sales
- delete archived sales
- inspect archived sales values

Main file:
- `app/archived-sales/archived-sales-client.tsx`

### `/analytics`
Performance overview page.

Purpose:
- total profit
- ROI
- tickets sold
- average time to sell
- visual summaries/charts by event/status/etc.

Main file:
- `app/analytics/analytics-client.tsx`

### `/connections`
Member Gmail inbox management.

Purpose:
- connect Gmail via Google OAuth
- add/manage inbox records
- set primary inbox
- pause/resume/remove inbox

Main file:
- `app/connections/connections-client.tsx`

### `/login`
Member sign-in/sign-up page using Supabase Auth.

Files:
- `app/login/page.tsx`
- `app/login/login-form.tsx`

---

## 5. Automation Flows

## 5.1 Ticketmaster Order Scan

### Trigger
- User clicks `Scan Gmail` on `/orders`
- API route: `POST /api/scan-gmail`

### Query used
In `src/lib/gmail-sync.ts`:

```ts
const GMAIL_QUERY = 'is:unread ticketmaster ("Order Update" OR "ticket confirmation" OR "You\'re in!")';
```

### What it does
- reads unread Ticketmaster emails from the connected Gmail account
- extracts booking ref, event, venue, date, seats, qty, cost
- inserts a new `orders` row if booking ref is new
- updates an existing `orders` row if booking ref already exists
- marks the Gmail message as processed:
  - removes `UNREAD`
  - adds the `My Tickets` label

### Output
- inserts or updates `orders`
- updates `gmail_accounts.last_synced_at`
- returns:
  - `scanned`
  - `inserted`
  - `updated`
  - `insertedRefs`
  - `updatedRefs`

### Important current behavior
- dedupe key is `booking_ref`
- existing rows are updated instead of duplicated
- if an updated row was archived/null-status, the scanner now revives it into the live desk as `Unlisted`

---

## 5.2 Viagogo Sales Scan

### Trigger
- User clicks `Scan Sales` on `/sales`
- API route: `POST /api/scan-sales`

### Query used
In `src/lib/viagogo-sales-sync.ts`:

```ts
const GMAIL_QUERY = 'is:unread from:orders.viagogo.com ("Please transfer the tickets for sale" OR "Please send your tickets") newer_than:120d';
```

### What it does
- reads unread Viagogo emails
- supports both email patterns:
  - `Please transfer the tickets for sale`
  - `Please send your tickets`
- parses:
  - external sale ID
  - event
  - venue
  - event date
  - sold date
  - buyer email
  - qty sold
  - price per ticket
  - total sold for / payout
  - section / row / seat range
- inserts or updates `sales`
- attempts automatic matching to `orders`
- runs a rematch pass against existing unmatched sales
- marks messages processed:
  - removes `UNREAD`
  - adds `My Sales`

### Output
- inserts/updates `sales`
- links `sales.inventory_order_id` when matched
- updates `orders.sold_total` and `orders.listing_status` via sales sync helpers

### Matching rules currently include
- event name similarity
- venue similarity
- event date similarity
- section / row / seat checks
- quantity usage checks per order
- general admission synonyms
- section-number fallback for cases like:
  - `Circle 8`
  - `BLK8`

### Additional behavior
- manual match / unmatch exists in UI
- rematch pass can heal old unmatched rows on later scans

---

## 5.3 Sales Archiving

### Trigger
- automatic on page load and on sales scan
- manual via `Archive Sale` button

### Rule
- sales with an `event_date` older than 1 day after the event are auto-moved to `sale_status = 'Archived'`

### Where it runs
- `src/lib/archive-rules.ts`
- called from:
  - `app/sales/sales-client.tsx`
  - `app/archived-sales/archived-sales-client.tsx`
  - `app/api/scan-sales/route.ts`

### Output
- archived sales disappear from `/sales`
- archived sales appear in `/archived-sales`

---

## 5.4 Ticket Auto-Archive

### Current state
Disabled.

### Reason
Auto-archiving tickets caused unsold ticket rows to disappear unexpectedly. The current helper restores archived orders back into:
- `Sold` if `sold_total > 0`
- `Unlisted` if unsold

### Current practical effect
- ticket rows are not auto-hidden anymore
- only sales are auto-archived

---

## 6. Integrations

## 6.1 Supabase

Used for:
- auth
- orders table
- sales table
- gmail_accounts table
- RLS / member separation

Connection files:
- `src/lib/supabase.ts`
- `src/lib/supabase-server.ts`

---

## 6.2 Google OAuth

Used for:
- connecting member Gmail inboxes

Routes:
- `app/api/gmail/connect/route.ts`
- `app/api/gmail/callback/route.ts`

Flow:
1. User clicks `Connect Gmail`
2. App redirects to Google OAuth consent
3. Callback exchanges auth code for tokens
4. App fetches Google profile
5. App inserts/updates `gmail_accounts`

Stored token data:
- access token
- refresh token
- token expiry
- scope
- Google subject/user ID

---

## 6.3 Gmail API

Used for:
- scanning Ticketmaster inbox emails
- scanning Viagogo sales emails
- labeling processed messages

Calls made directly from server-side code via `fetch`

---

## 6.4 Whop

Current status:
- partially scaffolded
- not active as the main auth system

Relevant files:
- `src/lib/whop-auth.ts`
- `app/api/auth/whop-login/route.ts`

Notes:
- Supabase Auth is the actual active member auth layer
- Whop work was attempted earlier but is currently legacy/inactive

---

## 7. Database Schema

## 7.1 `public.orders`

Purpose:
- stores Ticketmaster inventory / ticket purchase rows

Known fields used in app:
- `id`
- `user_id`
- `booking_ref`
- `event_name`
- `venue`
- `event_date`
- `purchased_at`
- `account_email`
- `section`
- `row`
- `seat_from`
- `seat_to`
- `qty_bought`
- `total_cost`
- `sold_total`
- `listing_status`
- `source_type`
- `created_at`

Relationships:
- `user_id -> auth.users.id`
- referenced by `sales.inventory_order_id`

Important constraints:
- unique index on `(user_id, booking_ref)` where booking ref is not null

Used by:
- Dashboard
- Inventory
- Analytics
- Sales matching

---

## 7.2 `public.gmail_accounts`

Purpose:
- stores connected Gmail inboxes per member

Fields from SQL:
- `id`
- `user_id`
- `email`
- `display_name`
- `provider`
- `status`
- `sync_mode`
- `is_primary`
- `is_active`
- `access_token`
- `refresh_token`
- `token_expiry`
- `last_synced_at`
- `created_at`
- `updated_at`
- `scope`
- `google_subject`

Relationships:
- `user_id -> auth.users.id`

Constraints:
- unique `(user_id, email)`
- unique `(user_id, google_subject)` where subject is not null

Used by:
- `/connections`
- Gmail OAuth callback
- both scan routes

---

## 7.3 `public.sales`

Purpose:
- stores Viagogo sale records

Fields from SQL:
- `id`
- `user_id`
- `gmail_account_id`
- `source`
- `source_message_id`
- `external_sale_id`
- `subject`
- `event_name`
- `venue`
- `event_date`
- `sold_at`
- `account_email`
- `buyer_email`
- `qty_sold`
- `price_per_ticket`
- `sale_total`
- `payout_total`
- `currency`
- `section`
- `row`
- `seat_from`
- `seat_to`
- `sale_status`
- `inventory_order_id`
- `match_confidence`
- `created_at`
- `updated_at`

Relationships:
- `user_id -> auth.users.id`
- `gmail_account_id -> gmail_accounts.id`
- `inventory_order_id -> orders.id`

Constraints:
- unique `(user_id, source_message_id)`
- unique index on `(user_id, source, external_sale_id)` where external sale id is not null

Used by:
- Sales page
- Archived Sales page
- Analytics
- Inventory stock hiding logic

---

## 8. Current Features (Built and Working)

### Authentication / Access
- Supabase member sign-up/sign-in
- protected routes via middleware
- logout route

### Gmail Connections
- per-member Gmail inbox connection via Google OAuth
- multiple inbox records supported
- primary inbox selection
- active/paused inbox states
- remove inbox

### Orders / Dashboard
- view ticket rows
- filters
- inline status editing
- inline sold total editing
- drawer for full detail
- manual add row
- delete row
- Ticketmaster Gmail scanning
- duplicate prevention by booking ref
- update existing booking ref rows on rescan
- scan result now distinguishes `new` vs `updated`

### Inventory
- grouped by event
- KPI cards
- filters:
  - search
  - artist
  - status
  - event date
  - month
  - account
  - sort by date
- grouped chips:
  - stock left
  - stock value
  - status breakdown
- subtracts archived matched sales quantity from inventory visibility

### Sales
- Viagogo inbox scan
- supports both Viagogo email variants
- automatic matching
- rematching pass
- manual unmatch
- manual match suggestions with ranked candidates
- sale archive button
- delete sale
- grouped event cards
- filters:
  - search
  - match state
  - month
  - account
  - sort by event date
- sold for / cost / profit / ROI display

### Archived Sales
- dedicated archive page
- restore archived sale
- delete archived sale
- money breakdown table

### Analytics
- KPI summaries
- chart-driven dashboard
- profit / ROI / ticket sold analysis
- event/status breakdowns

### Member isolation
- RLS by `user_id`
- per-user orders
- per-user Gmail accounts
- per-user sales

---

## 9. In-Progress / Partially Built

### Whop access control
- code exists
- not the active auth system
- should be treated as unfinished / dormant

### Ticket auto-archive
- helper exists in `src/lib/archive-rules.ts`
- sales archiving is active
- ticket auto-archive was rolled back after causing confusion
- current helper mainly restores hidden ticket rows

### Sales matching quality
- much improved, but still heuristic
- manual match/unmatch remains important for edge cases

### Inventory/archive interplay
- inventory now subtracts archived matched sales quantity
- may still need refinement for more complex partial-sale scenarios

---

## 10. Planned / Roadmap Features

These were discussed or implied during development but are not fully built:

- sync history / activity log
- archived tickets page
- cleaner onboarding for new users
- stronger admin/user separation
- production polish for debug leftovers
- move `middleware.ts` to Next.js `proxy` convention
- stronger analytics polish and chart validation
- automatic scheduled scans instead of manual button-only scans
- notifications / alerts for risk or new activity
- broader quality checks around parsing unusual Ticketmaster / Viagogo email templates

---

## 11. File / Folder Structure

```text
C:\TicketAuto
├── app
│   ├── analytics
│   │   ├── analytics-client.tsx
│   │   └── page.tsx
│   ├── api
│   │   ├── auth
│   │   │   ├── logout
│   │   │   │   └── route.ts
│   │   │   └── whop-login
│   │   │       └── route.ts
│   │   ├── gmail
│   │   │   ├── callback
│   │   │   │   └── route.ts
│   │   │   └── connect
│   │   │       └── route.ts
│   │   ├── scan-gmail
│   │   │   └── route.ts
│   │   └── scan-sales
│   │       └── route.ts
│   ├── archived-sales
│   │   ├── archived-sales-client.tsx
│   │   └── page.tsx
│   ├── connections
│   │   ├── connections-client.tsx
│   │   └── page.tsx
│   ├── inventory
│   │   ├── inventory-client.tsx
│   │   └── page.tsx
│   ├── login
│   │   ├── login-form.tsx
│   │   └── page.tsx
│   ├── orders
│   │   ├── orders-client.tsx
│   │   └── page.tsx
│   ├── sales
│   │   ├── page.tsx
│   │   └── sales-client.tsx
│   ├── test-supabase
│   │   └── page.tsx
│   ├── favicon.ico
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── public
├── src
│   └── lib
│       ├── archive-rules.ts
│       ├── gmail-sync.ts
│       ├── supabase-server.ts
│       ├── supabase.ts
│       ├── viagogo-sales-sync.ts
│       └── whop-auth.ts
├── supabase
│   ├── gmail-accounts.sql
│   ├── member-isolation.sql
│   └── sales.sql
├── middleware.ts
├── package.json
├── next.config.ts
├── tsconfig.json
└── TECHNICAL_HANDOFF.md
```

---

## 12. Key Logic / Critical Implementations

## 12.1 Ticketmaster dedupe and update-by-booking-ref

File:
- `src/lib/gmail-sync.ts`

Important behavior:
- booking ref is the identity key
- if booking ref exists, the row is updated instead of duplicated

Why it matters:
- users often receive multiple Ticketmaster emails for the same order
- scans should enrich an existing row rather than create duplicates

Critical idea:
```ts
const existingOrder = await findExistingOrder(...)
if (existingOrder) {
  await supabase.from("orders").update({...}).eq("id", existingOrder.id)
}
```

---

## 12.2 Viagogo dedupe by external sale ID

File:
- `src/lib/viagogo-sales-sync.ts`

Important behavior:
- prefers `external_sale_id`
- falls back to `source_message_id`

Why it matters:
- Viagogo may send multiple emails for the same sale lifecycle
- sales should update existing rows instead of duplicating

---

## 12.3 Sales rematch pass

File:
- `src/lib/viagogo-sales-sync.ts`
- function: `rematchViagogoSales(...)`

Purpose:
- old unmatched rows can be rematched using newer matching rules
- avoids requiring delete/recreate for every matching improvement

---

## 12.4 General-admission and section-number matching

File:
- `src/lib/viagogo-sales-sync.ts`

Important business rule:
- `TICKET`, `General Admission`, `Standing`, `Floor`, etc. are treated as equivalent GA-like labels
- section-number fallback exists so labels like `BLK8` and `Circle 8` can match on the numeric component

---

## 12.5 Archived sales affecting inventory stock

File:
- `app/inventory/inventory-client.tsx`

Important behavior:
- inventory subtracts quantity already consumed in `sale_status = 'Archived'` matched sales
- fully consumed orders disappear from stock
- partially consumed orders show remaining quantity

---

## 13. Known Issues / Bugs / Rough Edges

### 1. `middleware.ts` is deprecated in Next 16
- Next.js warns to move from `middleware` to `proxy`
- app still works, but this should be modernized

### 2. `member-isolation.sql` uses `create policy if not exists`
- some Supabase/Postgres setups reject this syntax
- use `drop policy if exists` + `create policy` if needed

### 3. Archived sales page was recently normalized
- now uses the proper premium table layout
- was previously using an incompatible grid layout

### 4. Viagogo scan currently calls `markMessageProcessed(...)` twice
- in `src/lib/viagogo-sales-sync.ts`
- likely harmless but redundant
- should be cleaned up

### 5. Sales matching is heuristic, not deterministic
- same-show tickets with weak seat/location evidence can still need manual review
- manual match/unmatch remains necessary

### 6. Inventory filter logic likely has a bug
- `dateFilterOptions` include `This month`
- filter logic still references `Upcoming`
- `monthFilter` is computed but does not appear to be enforced in the current filter predicate

### 7. Homepage is plain and visually inconsistent
- `app/page.tsx` still uses inline styles and a simple button
- not aligned with the premium dashboard theme

### 8. Whop code remains in the repo
- not currently active
- can confuse a new developer if treated as live auth

### 9. No formal test suite
- no Jest/Vitest/Playwright setup
- validation is currently mostly manual + `npx tsc --noEmit`

### 10. Encoding artifacts
- some strings may still contain odd characters such as `â€”` in source files due historical Windows encoding rewrites

---

## 14. Environment Variables and Config

### Current env vars used
- `NEXT_PUBLIC_SUPABASE_URL`
  - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Supabase anonymous/public key
- `SUPABASE_SERVICE_ROLE_KEY`
  - service role key; use carefully
- `WHOP_API_KEY`
  - Whop API key for the old/inactive Whop flow
- `WHOP_SESSION_SECRET`
  - Whop session signing secret for old/inactive session helper
- `GOOGLE_CLIENT_ID`
  - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`
  - Google OAuth client secret
- `GOOGLE_OAUTH_REDIRECT_URI`
  - present in env, but current Gmail connect/callback routes now derive callback from request URL dynamically

### Notes
- local values live in `.env.local`
- Vercel needs matching values in project environment variables
- secrets were manually rotated/edited during development; do not assume old screenshots or pasted values are still valid

---

## 15. Deployment Setup

### Hosting
- Vercel

### Source control
- GitHub repo: `KemptonX/ticketauto`

### Deployment flow
- push to `main`
- Vercel auto-deploys

### Important notes
- Google OAuth needs both local and live redirect URIs configured in Google Cloud if you want both environments to work
- the live production domain used during development was:
  - `https://ticketauto-psi.vercel.app`

### Build validation
Used repeatedly during development:
- `npx tsc --noEmit`
- `npm run build`

---

## 16. Architectural Decisions / Tradeoffs

### 1. Monolith over separate services
Decision:
- keep everything inside the Next.js app

Why:
- simpler deployment on Vercel
- easier for one-person iteration

Tradeoff:
- parsing + UI + API + auth are tightly coupled

### 2. Gmail-based ingestion instead of direct marketplace APIs
Decision:
- parse Ticketmaster and Viagogo emails

Why:
- works with the reseller’s actual purchase/sale inbox workflow
- no need for marketplace API access

Tradeoff:
- parsing is fragile and format-dependent
- email subject/body changes can break extraction

### 3. Booking ref as Ticketmaster identity key
Decision:
- one order row per booking ref per user

Why:
- strongest stable dedupe key available from Ticketmaster emails

Tradeoff:
- rescans update existing rows instead of making visible “new” entries

### 4. External sale ID as sales identity key
Decision:
- dedupe by `external_sale_id` where possible

Why:
- stronger than email-message-based dedupe for Viagogo

Tradeoff:
- requires reliable parsing from email content

### 5. Sales archived, tickets not auto-archived
Decision:
- keep auto-archive for sales
- disable ticket auto-archive after it caused confusion

Why:
- sales are naturally historical
- tickets disappearing from inventory/dashboard was too risky

Tradeoff:
- no full archived-tickets workflow yet

### 6. Client-side data pages with direct Supabase reads
Decision:
- dashboard pages query Supabase from the browser

Why:
- fast to iterate
- easier for live-updating management pages

Tradeoff:
- some state/debug behavior is less explicit than a fully server-driven page model

---

## 17. Practical Advice for the Next Assistant

If continuing this project, start here:

1. Read:
- `src/lib/gmail-sync.ts`
- `src/lib/viagogo-sales-sync.ts`
- `app/orders/orders-client.tsx`
- `app/inventory/inventory-client.tsx`
- `app/sales/sales-client.tsx`

2. Treat these as live/active:
- Supabase Auth
- Gmail OAuth
- Gmail scan routes
- sales matching logic

3. Treat these as legacy or dormant:
- Whop session/auth files
- old local Python parser assumptions

4. Before changing filters/matching:
- run `npx tsc --noEmit`
- be careful with user-facing row visibility rules

5. The most sensitive logic areas are:
- ticket dedupe/update by booking ref
- sales dedupe by external sale ID
- sales-to-order matching
- inventory remaining quantity math
- archive visibility rules

---

## 18. Recommended Next Steps

High-value next work:
- add a sync history / activity log
- add an Archived Tickets page
- clean up `middleware.ts` → `proxy`
- fix inventory month/date filter inconsistencies
- remove duplicate `markMessageProcessed` in sales sync
- improve parser observability/debugging for failed email extraction

