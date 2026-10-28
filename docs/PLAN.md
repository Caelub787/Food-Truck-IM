# Food Truck Inventory App: Build Plan

Status: draft. Waiting on answers to the open questions at the bottom. Nothing in here is final until those are answered.

## 1. The idea in a few lines

A phone friendly web app for food truck companies (starting with Kona Ice and Toms Coffee trucks). Drivers only type what the app can't know on its own: what is physically in the truck, what got loaded, what got wasted, and (optionally) how many drinks they sold. Everything else runs by itself on a schedule: reports, low stock alerts, order lists, par level suggestions, reminders, expiration alerts, and flags for anything that looks off.

Sales come into one table that doesn't care where they came from. Today that's a Square CSV upload or driver drink counts. Later it will be a direct Square connection per truck, added without redoing anything.

## 2. Tech picks and why

| Piece | Pick | Why |
|---|---|---|
| App | Next.js with TypeScript | One project for both the phone screens and the server. Very common, lots of help available, easy to host. |
| Phone app | PWA (installable web app) | Drivers open a link and tap "Add to Home Screen". No app store, works on iPhone and Android, one version to keep up. |
| Database | PostgreSQL | Normal, proven database. Great at reports. Has a built in lock (row level security) that helps keep each company's data separate. |
| Database code | Drizzle ORM | Typed queries and simple migration files. Stays close to plain SQL so nothing is hidden. |
| Logins | Better Auth (open source library) | Proven login code instead of writing our own: password hashing, sessions, email verification, password resets, rate limits on login. |
| Scheduled jobs | `pg-boss` job runner | Keeps its schedule and job queue inside the same Postgres database, so there's no extra service to run. Retries failed jobs. |
| Email | Resend, with React Email templates | Simple to send, good delivery, free tier covers early use. |
| Photos | S3 style storage (Cloudflare R2) | Cheap file storage. Photos get shrunk on the phone before upload so they're fast on cell data. |
| Phone notifications | Web Push | Free reminders straight to the driver's phone once the app is on their home screen. Email as a backup. |
| Look and feel | Tailwind CSS | Mobile first styling, big tap targets, number pads for counts. |
| Hosting | Railway (or Render) | One dashboard for the web app, the job worker, and the database. Roughly $20 to $40 a month to start. |
| Tests | Vitest and Playwright | Tests for the math and the data separation, plus phone sized browser tests for the driver flow. |

## 3. Keeping companies separate and passwords safe

Company separation (three layers, so one mistake can't leak data):
1. Every table has a `company_id`, and links between tables include the company, so a row can never point at another company's row.
2. All database access goes through one helper that is tied to the logged in user's company. Code can't "forget" to filter.
3. Postgres row level security is turned on for every company table. Even if a query forgot the filter, the database itself refuses to return another company's rows.

On top of that:
* Record IDs are random (UUIDs), not 1, 2, 3, so nobody can guess them.
* Photos are stored under a company folder and only served through short lived signed links.
* Automated tests create two companies and try to read, edit, and export each other's data. Those tests must pass before anything ships.

Passwords and logins:
* Passwords are run through a slow one way hash (scrypt or Argon2). The real password is never stored.
* Login cookies are secure and can't be read by page scripts.
* Login attempts are rate limited.
* Invite and reset links are long random tokens, stored hashed, single use, and expire (invites after 7 days, resets after 1 hour).

## 4. Roles

Proposed (see question 11):

| Can do | Admin | Manager | Driver |
|---|---|---|---|
| Company settings, locations | Yes | View only | No |
| Invite, edit, turn off admins | Yes | No | No |
| Invite, edit, turn off managers | Yes | Waiting on question 11 | No |
| Invite, edit, turn off drivers | Yes | Yes | No |
| Trucks, suppliers, supplies, products, recipes | Yes | Yes | No |
| Warehouse stock, deliveries, counts, transfers | Yes | Yes | No |
| Approve and send supplier orders | Yes | Yes | No |
| Reports, flags, all shifts | Yes | Yes | Own shifts only |
| Correct a closed shift's counts | Yes | Yes | No |
| Start and end shifts, counts, load and return, waste, drink counts | Yes | Yes | Yes (their truck, their shift) |

## 5. How the data works

### 5.1 Units

Every supply has one base unit that everything is stored in (oz, grams, each). You can add other units and how many base units they hold:

* Whole milk: base unit oz. Half gallon = 64 oz. Case = 6 half gallons.
* Espresso beans: base unit grams. Bag = 2,268 g (5 lb). Shot = 9 g.
* Large cups: base unit each. Sleeve = 50. Case = 1,000.

Each supply picks a count unit (what drivers count in, like half gallons or sleeves), a purchase unit (what the supplier sells, like cases), and recipes can use any of its units (like shots). Drivers never do math, the app converts. Counts can be partial (quick buttons for ¼, ½, ¾) unless the supply is set to whole numbers only.

### 5.2 Supplies and suppliers

Supply: name, category, units (above), supplier, cost per unit, reorder level, "order up to" level, whether it tracks expiration (and usual shelf life), active or turned off.

Supplier: name, email, phone, order notes (like "orders by Tuesday for Thursday delivery").

### 5.3 Products, sizes, modifiers, and recipes

* Product: Latte. Sizes: Small, Medium, Large (or just one size).
* Each size has a recipe: Large Latte = 2 shots espresso, 10 oz whole milk, 1 large cup, 1 large lid.
* Modifiers live in groups (Milk: Whole (default), Oat, Almond. Extras: Extra shot, Vanilla). A modifier can:
  * Add something (Extra shot: +1 shot espresso. Can differ by size.)
  * Swap something (Oat milk: replaces whole milk with oat milk, same amount for that size.)
* Supply groups (for Kona Ice): guests pick their own flavors at the Flavorwave, so the sale can't say which syrup was used. A recipe can say "3 oz from Syrups (any flavor)" and the comparison is done on the syrup group total. See question 7.

Recipe changes only apply going forward. Each edit makes a new recipe version with a start date. Old sales always use the version that was in effect when they happened, and each closed shift saves its own results, so old reports never change.

### 5.4 Stock: one log of every movement

There is one log (`stock_movements`) of every change to stock: delivery, warehouse to truck (load), truck to warehouse (return), waste, usage, transfer between locations, count adjustment, and manager correction. Each row has the supply, amount, from, to, who, when, why, the cost at that moment, and the shift if there is one.

Current stock for every warehouse and truck is updated in the same step as the log row, so the warehouse updates itself whenever a truck is loaded, returned, or wasted. Nobody adjusts the warehouse by hand unless they're doing a real count.

### 5.5 Shifts

Start of shift:
1. Driver taps Start Shift and picks the truck.
2. Starting counts are already filled in with what the app thinks is on the truck (last ending count, minus returns, plus anything loaded since). Driver only fixes what's different. Any difference is saved and flagged as a starting count mismatch.
3. App shows the suggested load list: par level minus what's on the truck, rounded up to whole count units, capped at what the warehouse has. Driver confirms or changes amounts.
4. Driver taps Loaded. Stock moves from the warehouse to the truck automatically.
5. Loading checklist (things like generator fuel, cash bank, card reader charged). Driver checks it off before heading out.

During shift: driver can log waste or a mid shift restock any time.

End of shift:
1. Ending count of everything left on the truck, taken before unloading. Optional photo.
2. Waste with a reason (spilled, expired, dropped, melted, other) and optional photo. Waste can be a supply (half a jug of milk) or a whole drink (dropped large latte, the app takes out the recipe).
3. Optional drink counts, if no Square file is coming.
4. Returns to the warehouse (after the count).
5. Finish. Usage is calculated right away and the driver sees a short summary.

### 5.6 Usage math

For each supply on a shift:

* Actual usage = starting count + added during shift − ending count − waste
* Expected usage = sum over every sale of (recipe amount for that product and size, plus modifier changes) × quantity
* Difference = actual − expected. More than zero means more was used than sales explain (over pouring, waste nobody logged, sales not rung up). Less than zero means less was used than expected (under pouring, a count mistake, or a recipe that's set too high).

A difference is flagged when it's bigger than the percent limit AND bigger than a small minimum amount (so being off by one lid doesn't flag). Managers set a company default and can override it per supply. There's also an overall limit for the whole shift, based on the dollar value of all differences.

Worked example, whole milk (count unit half gallon = 64 oz):

| | Half gallons | Oz |
|---|---|---|
| Starting count | 6 | 384 |
| Loaded | 4 | 256 |
| Ending count | 3.5 | 224 |
| Waste (spilled) | 0.25 | 16 |
| Actual usage | | 400 |

Sales: 30 large lattes (5 with oat milk) and 12 medium lattes. Expected whole milk = 25 × 10 oz + 12 × 8 oz = 346 oz. Difference = +54 oz (15.6%). With a 10% limit, this gets flagged.

If there are no sales for a shift, actual usage still shows and the comparison is simply skipped.

Each closed shift saves a results row per supply: start, added, end, waste, actual, expected, difference, cost, flagged or not. Plus who worked it, which truck, which day, and its sales. That's the permanent record reports read from.

### 5.7 Sales (works with any source)

One `sales` table. Every row has: company, truck, time sold, product, size, quantity, modifiers, price, source (`manual`, `csv`, or `square`), and the source's own ID for the sale.

* No double counting: a unique rule on (company, source, source sale ID) means the same sale can't be saved twice. Uploading the same file twice does nothing new.
* Matching items: a mapping table remembers that Square's "Lg Latte" means Latte, Large. The first upload asks a manager to match any unknown names once. After that it's automatic. The future Square sync uses this same table.
* Matching to shifts: a sale belongs to the shift on that truck whose start and end time cover it (with a small grace window). Sales with no shift get flagged ("Truck 2 had sales on Saturday but no shift was recorded").
* If a shift has both driver counts and Square or CSV sales, the Square or CSV numbers are used and the driver counts are kept for reference. See question 9.
* Every upload is saved as a batch, so a bad upload can be undone in one tap.

### 5.8 Flags ("Needs attention")

Flags land in a manager inbox and in the daily report. Each one can be marked reviewed with a note. Types:
* Expected vs actual difference over the limit
* Starting count doesn't match last known stock
* Driver with a pattern of high waste (compared to the company average over the last 30 days)
* Sales with no shift, or a shift with unmatched sales items
* Shift left open too long
* Expired items still in stock

### 5.9 Expiration dates

Supplies marked "tracks expiration" ask for a date when a delivery is received (filled in from the usual shelf life, editable). Stock is tracked by batch. Loading a truck sends the oldest batch first, and usage and waste come out of the oldest first too. A daily job warns a set number of days ahead, and expired batches get flagged with a "log as waste" button.

### 5.10 Par levels and restock

Each truck has a par level per supply (the amount it should leave with). Supplies with no par level don't show up on that truck's count screens, which keeps the driver's list short. Weekly, the app suggests new par levels from the average usage of the last 10 shifts plus a cushion (default 25%), rounded up to whole count units. See question 10.

### 5.11 Order lists

Every morning (and right after something goes low), the app builds draft orders grouped by supplier: everything at or below its reorder level, ordered up to its "order up to" level, rounded to the supplier's case size. A manager reviews, edits if needed, and taps Approve and Send, which emails the order to the supplier. Nothing goes outside the company without that tap. When the delivery shows up, Receive Delivery opens that order already filled in, so receiving is mostly tapping "all came in" and fixing what didn't.

### 5.12 Corrections and history

A manager can fix a count on a closed shift. They have to give a reason. The app saves who changed it, when, the old value, the new value, and why, then recalculates that shift. Truck stock only changes if that shift was the truck's latest count. Every edit to setup data (products, recipes, supplies, prices, accounts) also goes in an audit log.

### 5.13 Turning things off vs deleting

Turning something off hides it from drivers and from new lists, but keeps all its history and it still shows in old reports. Deleting is only allowed for things that were never used. Anything with history can only be turned off.

## 6. Screens

Driver (phone first, big buttons, one hand):
* Home: Start Shift or Continue Shift, plus any reminders
* Start shift: pick truck, confirm starting counts, load list, loading checklist
* During shift: log waste, mid shift restock
* End shift: ending counts (with photo), waste, drink counts, returns, finish
* Shift summary and My Shifts history

Manager:
* Needs Attention inbox (flags, approvals waiting, open shifts)
* Warehouse: stock, Receive Delivery, count, transfer, expiring soon
* Trucks: current stock, par levels and suggestions, shift history
* Orders: draft orders by supplier, approve and send, receive
* Sales: upload Square CSV, match items, view by truck and day
* Reports: usage, waste, driver comparison, profit, with date ranges and CSV export
* Shift detail with corrections

Admin (also gets everything a manager does):
* Setup checklist for new companies (locations, trucks, supplies, products, people)
* Locations, trucks, suppliers, supplies, products and recipes, modifiers
* CSV import for supplies and products, with downloadable templates and a preview before saving
* People and invites
* Notification settings (who gets which emails), company settings (time zone, report times, limits)

## 7. Automation

Things that happen instantly when something is saved:
* Warehouse and truck stock update on every load, return, waste, delivery, and count
* Shift close: actual usage, expected usage (if sales exist), differences, flags
* Starting count mismatch flag
* Sales upload: matches sales to shifts and recalculates those shifts
* Low stock check after any stock change

Scheduled jobs (each one runs per company in that company's time zone):

| Job | When (defaults, all changeable) | What it does | Who hears about it |
|---|---|---|---|
| Daily inventory and usage reports | Every evening, 8 pm | Warehouse and truck stock, low items, each shift's usage, differences, waste, cost | People you pick |
| Low stock sweep | Every morning, 6 am (plus instantly on change) | Warehouse and truck supplies at or below reorder level | Managers, once per item until it's restocked |
| Order lists | Every morning, 6 am (plus after low stock) | Builds or refreshes draft orders per supplier | Managers. Nothing is sent until approved |
| Par level suggestions | Sunday night | New par suggestions per truck | Managers approve (see question 10) |
| Shift not started | Every 15 minutes | Scheduled driver hasn't started 30 min after start time | Driver, then manager |
| Shift not finished | Every 15 minutes | Shift still open past its expected end | Driver reminder, then manager alert after a set number of hours |
| Expiration check | Every morning | Items expiring in the next 3 days, and expired items | Managers and the truck's driver |
| Pattern flags | Every night | High waste drivers, repeat differences, sales with no shift | Manager inbox |
| Weekly summary | Monday 7 am | Waste, usage trends, cost per truck, profit, open flags | People you pick |
| Monthly summary | 1st of the month, 7 am | Same, for the month | People you pick |
| Cleanup | Every night | Expired invites, old sessions | Nobody |
| Square sync (later) | Every night, plus a "sync now" button | Pull yesterday's sales for each linked truck | Only on errors |

Every job writes down that it ran for that company and period, so a retry never sends the same report twice.

## 8. Square later: where it plugs in

Built now:
* The `sales` table with `source`, the source's sale ID, and the unique rule that stops double counting
* The item mapping table (used by CSV uploads now, by Square later)
* One shared `ingestSales()` step that every source goes through: match items, skip duplicates, save, link to shifts, recalculate. CSV upload and driver counts both use it.
* A `sales/sources/` folder with the CSV and manual sources and a clearly marked spot for `square.ts`

Added later (when you say so):
* Square OAuth: each truck gets a "Connect Square" button that links that truck to its own Square account
* A `square_connections` table (truck, Square merchant and location IDs, access and refresh tokens encrypted with a key that lives only in the server settings, token expiry, last sync time)
* Nightly sync that pulls orders for the day and sends them through `ingestSales()` with `source = square` and Square's order and line item IDs, so nothing counts twice
* Matching Square catalog items and variations to products and sizes, using the same mapping table

The full notes will live in CLAUDE.md.

## 9. Database tables

All tables carry `company_id` (except `companies` itself).

* Companies and people: `companies`, `company_settings`, `users`, `sessions`, `invites`, `notification_settings`, `push_subscriptions`, `audit_log`
* Places: `locations`, `trucks`, `driver_schedules`, `checklist_items`
* Supplies: `suppliers`, `supplies`, `supply_units`, `supply_groups`
* Products: `products`, `product_sizes`, `modifier_groups`, `modifiers`, `recipe_versions`, `recipe_lines`, `modifier_effects`
* Stock: `stock_levels`, `stock_batches`, `stock_movements`, `stock_counts`
* Shifts: `shifts`, `shift_counts`, `shift_results`, `shift_checklist`, `count_corrections`
* Waste: `waste_logs`, `waste_reasons`
* Sales: `sales`, `sale_modifiers`, `sales_imports`, `item_mappings`
* Ordering: `purchase_orders`, `purchase_order_lines`, `deliveries`, `delivery_lines`
* Par levels: `truck_pars`, `par_suggestions`
* Alerts and jobs: `flags`, `notifications`, `job_runs`
* Files: `photos`
* Later: `square_connections`

## 10. Code layout

```
src/
  app/                 screens (driver, manage, admin, setup, auth)
  server/
    db/                schema, migrations, company scoped database helper
    auth/              login, sessions, invites, permissions
    setup/             locations, trucks, supplies, products, recipes, CSV import
    inventory/         stock movements, batches, deliveries, counts
    shifts/            shift flow and usage math
    waste/
    sales/
      ingest.ts        the one shared path every sale goes through
      sources/
        csv.ts         Square CSV export (now)
        manual.ts      driver drink counts (now)
        square.ts      Square sync (later)
    orders/            order lists, approve and send
    alerts/            flags and notifications (email, push)
    reports/
  jobs/                scheduled job definitions and the worker
tests/
docs/
CLAUDE.md
```

## 11. Build phases

Each phase ends with working, tested code pushed to the branch, and a short note on how to try it.

0. Foundation: project setup, database, CLAUDE.md, test setup, installable PWA shell.
1. Sign up, roles, invites, login. Done when: you can sign up a company, invite a manager and a driver, they set their own passwords, each only sees their screens, and the company separation tests pass.
2. Locations, trucks, suppliers, supplies with units, products, sizes, modifiers, versioned recipes, CSV import with templates and preview, turning things on and off, admin setup checklist.
3. Warehouse and truck stock, the movement log, Receive Delivery, counts, transfers, expiration batches.
4. Shift flow (start counts, load list from manual par levels, loading, end counts, returns), usage math, shift summary, starting count mismatch flag.
5. Waste (supply or whole drink), reasons, photos, warehouse waste, waste report.
6. Sales table, Square CSV upload with item matching, driver drink counts, expected vs actual, limits, flags.
7. Scheduled jobs: reports, alerts, reminders, order lists with approve and send, par suggestions, emails and push.
8. Extras: loading checklist, driver comparison, photos on end counts, profit view, manager corrections with history, report polish and CSV export.
9. Square connection (when you say so).

## 12. Testing

* Unit tests for usage math, recipe and modifier math, unit conversions, CSV parsing, par and reorder math
* Company separation tests on every data area
* Phone sized browser tests for sign up, invite, and a full driver shift
* Every job tested for "runs twice, sends once"

## 13. Open questions

See the chat for the full wording. Short list:
1. One company with two truck types (Kona Ice, Toms Coffee), or two separate companies?
2. Who can sign up, and do you need to approve new companies? Any billing?
3. Where do driver schedules come from (needed for "hasn't started" reminders)?
4. Driver reminders by push, email, or text?
5. Do drivers lose cell signal at events (offline counts)?
6. One driver per shift or crews?
7. Compare Kona syrup as one group total?
8. Sample files: a Square item sales export, plus your current supply and product lists
9. If both driver counts and a Square file exist, the file wins?
10. Par levels: auto update or suggest and approve?
11. What can managers do with other manager accounts?
12. Reorder amounts and how suppliers take orders
13. Domain for sending email, and hosting preference
14. More than one warehouse?
