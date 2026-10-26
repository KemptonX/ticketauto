<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Development & deployment workflow

Standing instruction: for a completed, verified change, **commit, push, migrate (if additive) and deploy without asking first.** Investigate → Implement → Test → Commit → Push → Migrate if required → Deploy → Verify → Report.

## What runs automatically
1. `npx tsc --noEmit`, `npm test`, `npm run build` (webpack — Turbopack can't parse this project's generated CSS, see commit 6450c9b)
2. `git add` only the intended files, commit, `git push origin main`
3. GitHub Actions (`.github/workflows/deploy.yml`) picks up the push: re-runs typecheck + tests, `vercel build --prod`, `vercel deploy --prebuilt --prod`, then a health check against `https://www.tixtracker.app/`
4. That workflow is the **only** deploy path. A prior VPS/SSH/pm2 workflow existed at this same file path and failed on every single run for 2+ months (dead host) before being replaced 2026-10-26 — don't resurrect a second parallel deploy mechanism.

## Database migrations
- New migration files go in `supabase/migrations/`, numbered sequentially, written `if not exists` / idempotent.
- Purely additive migrations (new table, new column with a default, new index, new RLS policy) are safe to apply without asking.
- Never auto-apply: dropping/renaming a populated table or column, bulk-rewriting existing rows, anything touching `auth.users` identities, or anything not easily reversible. Stop and report the specific blocker instead.
- **No tool in this environment can execute raw DDL against production.** The only Supabase access available is the REST API (anon/service-role keys), which doesn't expose SQL execution, and there is no `DATABASE_URL`/Postgres connection string or `SUPABASE_ACCESS_TOKEN` configured. Until one of those is added, every migration needs a human to paste the SQL into the Supabase SQL Editor once. Code must always degrade gracefully (friendly empty/not-ready state, not a crash) when a migration hasn't been applied yet — see `isMissingTableError()` in `app/api/account-manager/route.ts` for the pattern.
- If a migration is prepared but not applied, the commit message and final report must say so explicitly — never claim a feature is "done" if its table doesn't exist yet in production.

## Recovering a bad deploy
- `vercel --prod` (direct CLI) deploys whatever is in the **local working directory**, not git state — this project has no Vercel↔GitHub integration for the CLI path, only the GitHub Actions workflow deploys from a known commit. Never run the direct CLI from a dirty working directory.
- To roll back: `git revert` the bad commit (or `git checkout <last-good-sha> -- <files>` for a partial revert) and push — the Actions workflow redeploys automatically. Vercel's own dashboard also keeps prior deployments one click away as an immediate rollback if Actions itself is unavailable.

## When to actually stop and ask
Missing credentials that can't be created from this environment (a new Vercel token requires the dashboard — CLI token creation is blocked, 403), destructive schema changes, anything touching customer financial records or auth identities, or a build/test failure that isn't a quick, obvious fix.
