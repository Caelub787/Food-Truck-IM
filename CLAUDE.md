# CLAUDE.md

Project rules for the truck inventory app. Read this first, every session. The full plan is in `docs/PLAN.md`.

## Talking to the owner

* Never use "-" (or any dash) to separate words in anything written to the owner: chat, docs, commit messages. Write "sign up", not "sign-up". Use commas or new sentences instead of dashes.
* Write plainly, like a normal person. No fancy or scholarly wording. The owner is not a professional developer.
* Use numbered lists or `*` bullets in docs.
* App text shown to users follows the same rule: short, plain words.

## What this app is

A phone first PWA for food truck businesses (any business can sign up, not just Kona Ice and Toms Coffee). Owners, managers, and drivers track warehouse and truck inventory, shifts, waste, and sales. It should run itself: people only enter what the app can't know (physical counts, loads, waste, optional sales counts). Reports, alerts, reminders, order lists, par suggestions, and flags happen automatically.

Build it for any business:
* Every list is named by the business (truck types, units, categories, waste reasons, free drink reasons, checklists).
* Optional features are per business toggles with sensible defaults (scheduling, manager count checks, expiration tracking, loading checklist, who reports sales).
* Never hard code anything specific to Kona Ice or Toms Coffee. Starter kits can suggest common items, but everything is editable.

## Two rules for every screen

1. Live updates everywhere. Nobody should ever have to refresh to see a change someone else made (stock, counts, shifts, people, anything).
   * Every company table calls `select app.enable_live('public.<table>')` in its migration (add `p_owner => true` if the App Owner screen shows it). That sends a tiny "this table changed" signal to the private channel `company:<id>`. No row data goes in the signal.
   * Every query that shows data uses `useLiveQuery` from `src/lib/live.ts` and lists every table it reads in `tables`. Never use plain `useQuery` for data on screen.
   * Panels that edit a record read it from the live list, so they show changes others make while open.
   * `LiveUpdates` (mounted for every logged in screen) listens and reloads the matching queries. If the connection drops, queries check every 15 seconds, and everything reloads once on reconnect.
   * Database tests check that changes signal the right channel and that only members can listen. The screen script checks that changes appear without a reload.
2. Full phone and desktop support. Design every screen for both. Phones: one column, big buttons (at least 48px tall), bottom tab bar, panels slide up from the bottom. Desktop (the `md` size and up): side menu, wide tables instead of card lists where it helps, several columns, hover effects, centered dialogs. Check screenshots at 390px and 1366px wide before pushing.

## Free only

Everything must run on free plans until the owner says otherwise. Don't add paid services or anything that needs a credit card.
* App hosting: Cloudflare Pages (static build of the Vite app).
* Backend: Supabase free plan (Postgres, Auth, Storage, Realtime, Edge Functions, `pg_cron`).
* Email: Gmail account with an app password for now (Supabase Auth custom SMTP for login emails). Edge Functions can't use SMTP ports 25 or 587, so app emails use port 465 or an HTTPS email API. When the owner gets a domain, switch to Resend or Brevo through config only.
* Push: Web Push with VAPID keys.
* CI and weekly backup: GitHub Actions.
* Keep the free limits in mind: 500 MB database, small file storage (shrink photos to about 100 KB on the phone), project pauses after 7 days idle.

## Tech stack

* Front end: React + TypeScript + Vite, React Router, TanStack Query (through `useLiveQuery`), Tailwind CSS, `vite-plugin-pwa`, `@supabase/supabase-js`.
* Live updates: Supabase Realtime, private broadcast channels (see "Two rules for every screen").
* Database: Postgres via Supabase. All schema, security rules, and functions live in `supabase/migrations/*.sql`.
* Server code: Supabase Edge Functions (Deno, TypeScript) in `supabase/functions/`.
* Tests: Vitest. Database tests run against a real local Postgres with a small Supabase shim (`tests/db/`).

## Commands

* `npm run dev`: run the app locally
* `npm run build`: typecheck and build
* `npm run lint`: lint
* `npm test`: unit tests
* `npm run test:db`: database tests (needs local Postgres, see `tests/db/README.md`)
* `npm run build:demo`: the demo (the app with a pretend server and sample data in `src/demo/`). Screens that call a new database function need a matching handler in `src/demo/server.ts`, or the demo shows nothing for it.

Run lint, typecheck, unit tests, and database tests before every push.

## Weak signal

Drivers work with bad signal. Anything done on a shift (counts, loads, waste, returns, confirms, finishing) goes through `sendOrQueue` in `src/lib/offline.ts`. If there's no signal it waits on the phone and sends later, in order. So every one of those database functions must be safe to run twice: take a `client_id` (checked with `app.claim_request`) or a `client_ts` (latest wins).

## Company data separation (most important rule)

1. Every table except `companies` has `company_id uuid not null`.
2. Foreign keys between company tables include `company_id` (composite keys), so a row can never point at another company's row.
3. Row level security is enabled on every table in `public`. No table ships without policies.
4. Policies use the helper functions in the `app` schema (`app.company_id()`, `app.role()`, `app.is_owner()`), wrapped as `(select app.company_id())` so they run once per query.
5. Grants are explicit in migrations. `anon` gets nothing on company tables.
6. Anything that changes stock, closes a shift, or writes to more than one table is a `security definer` Postgres function with `set search_path = ''`, which checks company and role at the top, and does everything in one transaction.
7. The Supabase service role key is only used inside Edge Functions, never in the browser. Edge Functions check the caller's company and role before acting.
8. Every new table gets database tests with two companies and every role: can't read, insert, update, or delete the other company's rows.
9. The App Owner can see company info (name, admin, status, size, usage) through owner only functions, but never a company's inventory, sales, or people.
10. Never trust anything the user can set (like Auth user metadata) for company or role. Company and role come only from the `profiles` table.

## Writing migrations

* New migration files go in `supabase/migrations/` named `YYYYMMDDHHMMSS_what_it_does.sql`. Never edit a migration that has been pushed: the owner may have deployed it already. Make a new migration instead.
* For every new company table, call `select app.setup_table('public.<table>', <writer roles>, <reader roles>)`. It turns on row level security with the standard policies, sets grants, adds change history (audit) and live updates. Tables only changed through functions pass `'{}'` as writers.
* For every new function: `revoke execute ... from public, anon, authenticated` naming the function, then grant to the roles that need it. Don't use `revoke ... on all functions` after the first migration, it would undo earlier grants.
* Error messages raised in functions are shown to users as is, so write them in plain words.
* Add tests in `tests/db/` and run `npm run test:db`.

## Checking screens

`tests/db/rules.test.ts` checks every table follows the rules above (row level security with policies, a company id, live updates, nothing for logged out visitors, pinned search paths). A new internal table that only server functions touch goes in its `internal` list, with a reason.

`scripts/phone-screens.cjs` clicks through the built app at phone and desktop sizes with a fake Supabase (including a fake live connection) and saves screenshots (how to run it is at the top of the file). It also checks that changes from "someone else" appear without a reload, and that the app reconnects by itself. Run it after UI changes and look at the screenshots. Add new screens and live checks to it as they're built. Use `.filter({ visible: true })` in its text checks, since phone and desktop versions of a screen can both be on the page.

## Roles

* App Owner: emails listed in the `app_owners` table (filled in at deploy time, never committed). Must have a confirmed email.
* Company roles in `profiles.role`: `admin`, `manager`, `driver`.
* Admins do everything. Managers do everything except company settings, locations, and admin or manager accounts. Drivers only work shifts they are on and only see those shifts.
* On a shift: one Lead and any number of Crew. Everyone on the shift can enter counts, waste, and sales. Only the Lead confirms inventory and finishes the shift.

## Company status

`pending` (just signed up, can do setup, can't invite or send email), `active`, `declined`, `suspended`. Declined and suspended companies get no data access. Only the App Owner changes status.

## Inventory rules

* All quantities are stored in the supply's base unit (`numeric`). Other units are conversions defined per supply.
* Never update stock levels directly. Every change goes through the stock movement function, which writes a `stock_movements` row and updates the current level in the same transaction, with the unit cost at that moment.
* Movement types: delivery, load, return, waste, usage, transfer, adjustment, correction.
* Turning something off (`active = false`) hides it but keeps history. Delete is only allowed when nothing references the row.
* Every edit to setup data and every count correction is recorded in `audit_log` (who, when, old, new, why).

## Usage math

* Actual usage = starting count + added during shift − ending count − waste.
* Added during shift = every move onto or off the truck after the starting count is confirmed and up to the ending count (loads, early returns, and moves a manager makes). Waste and usage don't count as added.
* Ending count is taken before returns. Returns happen after and move stock back to the warehouse.
* Finishing a shift logs the usage, so the truck's stock lands on the ending count (less anything returned after it).
* Expected usage = for every drink (paid and free), recipe amount for its product and size plus modifier effects, times quantity, using the recipe version in effect at the time of the sale.
* Difference = actual − expected. Flag when over the percent limit AND over the minimum amount (per supply override, else company default), plus a whole shift dollar limit.
* Supply groups: expected and actual are compared on the group total when a recipe uses a group.
* With manager count checks on, the manager's count replaces the driver's ending count for the checked supplies.
* A closed shift saves its results per supply in `shift_results`. Reports read from saved results. Recipe edits never change past results.
* If a shift has no sales, show actual usage and skip the comparison.

## Sales rules

* One `sales` table for every source. Columns include truck, shift, sold time, product, size, quantity, modifiers, price, `is_free` with `free_reason`, `source` (`driver`, `manager`, `csv`, `square`), and `source_ref`.
* Unique key on (`company_id`, `source`, `source_ref`) so the same sale is never counted twice.
* Every source goes through one ingest function: map items, skip duplicates, save, tie to the shift by truck and time, recalculate the shift.
* `item_mappings` remembers outside item names (CSV, later Square) to product, size, and modifier.
* Which source wins per shift is a company setting (default: file, then manager, then driver). Other sources are kept and compared, and mismatches are flagged.
* Sales are optional. Everything must work with no sales at all.

## Automation rules

* Scheduled jobs run with `pg_cron`, per company in the company's time zone.
* Jobs write to an outbox table. An Edge Function sends the outbox (email and push).
* Every job is idempotent: it records (company, job, period) in `job_runs` and skips if already done.
* Anything sent outside the company (supplier orders) needs a manager to approve it first.
* `app.run_due_jobs()` is the only timer entry point (see `supabase/setup/3-jobs-timer.sql`). New jobs go in it, use `app.claim_job`, and send through `app.notify` or `app.alert` (which respect each person's choices in `notification_settings`).
* Flags about something true right now (low stock, open too long) use `app.raise_flag_once` and `app.resolve_flags`, so they don't nag and go away by themselves.

## Square (later, only when the owner says so)

Do not build the Square connection until the owner asks. How it will be added:
1. Each truck links to its own Square account through Square OAuth (one Square account per truck). A "Connect Square" button on the truck page starts it. The OAuth callback is an Edge Function.
2. Scopes needed: `ORDERS_READ`, `ITEMS_READ`, `MERCHANT_PROFILE_READ` (and `PAYMENTS_READ` if needed).
3. New table `square_connections`: `company_id`, `truck_id`, Square merchant ID, Square location ID, access token and refresh token (encrypted, using Supabase Vault or AES GCM with a key stored only as an Edge Function secret), token expiry, last synced at, status. Row level security like every other table, and tokens are never readable from the browser.
4. Square access tokens expire (about 30 days), so the sync refreshes them with the refresh token before they run out.
5. A nightly job (plus a "Sync now" button) calls the Square Orders API (search orders by location and date range) and sends each line item through the shared sales ingest function with `source = 'square'` and `source_ref = '<order id>:<line item uid>'`, so nothing is counted twice.
6. Square catalog items and variations (sizes) and modifiers are matched to products, sizes, and modifiers through `item_mappings` (by Square catalog object ID, falling back to name).
7. Square comps and 100% discounts map to free drinks.
8. The code spot for it is `supabase/functions/_shared/sales/sources/square.ts` (to be created), next to the CSV and manual sources.

## Git

* Work on the branch you were given. Commit in small, clear steps. Push when a piece is done and tests pass.
* Never put personal emails, keys, or passwords in the repo. Secrets go in Supabase and Cloudflare settings or `.env.local` (git ignored).

## Build status

Phases from `docs/PLAN.md`:
0. Foundation: done
1. Accounts: built and tested locally (sign up, App Owner approvals, roles, invites, login, password reset, people, business settings, audit log, email outbox). Not deployed yet: waiting on the owner to finish docs/SETUP.md.
2. Setup: built and tested locally (settings and feature switches, lists, locations, trucks, suppliers, supplies with units and groups, products, sizes, add ons, versioned recipes, spreadsheet import, starter kits).
3. Stock: built and tested locally (stock levels, one log of every move, deliveries, counts, moves between places, adjustments, expiration batches used oldest first, history with CSV export).
4. Shifts: built and tested locally (start or join a shift, Lead and crew, starting count filled in with what the app expects, loading list from par levels, loading checklist, ending count, returns, finish with saved results, start count mismatch flags, offline queue).
5. Waste: built and tested locally (supplies or whole drinks with add ons, reasons, photos shrunk on the phone, warehouse waste for managers, waste page with CSV).
6. Sales: built and tested locally (driver and manager drink counts with free drinks, sales file upload with column guessing, item matching that's remembered, undo, source priority and mismatch flags, manager count checks, expected vs actual with limits and flags).
7. Scheduling: built and tested locally (optional per business: weekly plans with Lead and crew, repeat weekly, clashes warned, drivers see their own, start a shift from a plan).
8. Automation: built and tested locally (one 15 minute timer runs every job per business time zone: low stock, reminders, expiration, order lists with approval, morning email, daily, weekly, and monthly reports, par suggestions, pattern flags. Web Push with VAPID, photo cleanup, weekly encrypted backup).
9. Extras: built and tested locally (reports with CSV: usage vs sales, waste, free drinks, drivers, count checks, sales minus costs; manager fixes to finished shifts with history; demo mode; user guide in docs/GUIDE.md).
10. Square: waiting on the owner
