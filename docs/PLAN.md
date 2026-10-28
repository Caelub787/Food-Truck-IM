# Truck Inventory App: Build Plan

Status: approved direction, building. Version 2 (updated with the owner's answers and the free hosting rule).

## 1. The idea

A phone friendly web app that any food truck business can sign up for. It's built with business owners in mind: easy to set up, easy for drivers, and it runs itself as much as possible.

People only type what the app can't know: what is physically on a truck, what got loaded or wasted, and (if the business wants) sales counts. Everything else happens on its own: reports, low stock alerts, order lists, par level suggestions, reminders, expiration alerts, and flags for anything that looks off.

Every business is different, so:
* Every list is named by the business (truck types, units, categories, waste reasons, free drink reasons, checklists).
* Optional features can be turned on or off per business (scheduling, manager count checks, expiration tracking, loading checklist, who reports sales).
* Every setting has a sensible default, so a new business works on day one.
* Setup can start from a starter kit ("Shaved ice truck", "Coffee truck", or blank) that fills in common supplies, units, and reasons, all editable.

## 2. Free hosting rule

Everything has to be free right now, with a paid upgrade available later. No paid services get added without the owner saying so.

| Piece | Pick (free) | Why | Upgrade later |
|---|---|---|---|
| Phone app | React + TypeScript, built with Vite, as an installable PWA | One link, "Add to Home Screen", works on iPhone and Android, works offline | Nothing needed |
| App hosting | Cloudflare Pages | Free with no traffic limit for the app files, business use allowed, deploys itself from GitHub | Stays free |
| Database | Supabase (PostgreSQL) | A normal Postgres database. Row level security keeps companies apart | Supabase Pro, $25 a month |
| Logins | Supabase Auth | Proven login system. Passwords stored as bcrypt hashes, never the real password. Invite and reset links built in | Included |
| Photos | Supabase Storage | Same place as the data, same company lock | Included in Pro |
| Live updates | Supabase Realtime | Lead and crew phones see each other's entries | Included in Pro |
| Scheduled jobs | Supabase Cron (`pg_cron`) | Runs inside the database on a timer, no extra service | Included |
| Server code | Supabase Edge Functions | Sending email and push, CSV parsing, and later Square | Included |
| Email | A Gmail account made for the app | Free, about 500 emails a day, works without owning a domain | Resend or Brevo once there's a domain |
| Phone notifications | Web Push | Free. iPhones need the app added to the home screen first (iOS 16.4 or newer) | Stays free |
| Tests and checks | GitHub Actions | Runs the tests on every push | Stays free at this size |

Railway was the first pick, but its free plan now only includes $1 of usage a month, which can't keep an app and a database running.

Free plan limits to know about:
1. Supabase pauses a free project after 7 days with no use. Data is kept and it comes back with one click. Daily use keeps it awake.
2. 500 MB of database space. That's plenty for testing and a few trucks for a long time. The App Owner page shows how full it is.
3. Photo storage is small, so photos get shrunk on the phone (about 100 KB each) and old photos can be cleared automatically after a set time (business setting, default 6 months).
4. No automatic backups on the free plan. The plan includes a free weekly backup using GitHub Actions and an "export all my data" button for each business.
5. Gmail allows about 500 emails a day. Fine for now.

## 3. Keeping companies separate and passwords safe

The phone talks to the database through Supabase, so the database itself is the lock:
1. Every table has a `company_id`, and links between tables include the company, so a row can never point at another company's row.
2. Row level security is on for every table. Each rule checks the logged in user's company (and role) before any row is returned or changed.
3. Anything that changes stock, closes a shift, or touches more than one table runs as one database function that checks the company and role first and does all its steps together or not at all.
4. The powerful server key never goes to the phone. Only Edge Functions use it, and they check who's asking first.
5. Record IDs are random (UUIDs), so nobody can guess them.
6. Photos live in a folder per company with the same lock, and are only shown through short lived links.
7. Automated tests create two companies and try to read, change, and delete each other's data for every table. They have to pass on every push.

Passwords and logins:
* Supabase Auth stores passwords as bcrypt hashes.
* Logins are rate limited. Emails must be confirmed.
* Invite and reset links are single use and expire. Invite links last up to 24 hours (Supabase's limit), and admins can resend them with one tap.

## 4. Roles

App Owner (you): a separate section of the app, only for the owner email (kept in a private setting, not in the code). Sees sign up requests and approves or declines them, sees every company's name, admin, size, status, and database use, and can suspend or reactivate a company. The App Owner does not see any company's inventory, sales, or people. That keeps each business's data private.

Inside a company:

| Can do | Admin | Manager | Driver |
|---|---|---|---|
| Company settings, features, locations | Yes | View only | No |
| Invite, edit, turn off admins and managers | Yes | No | No |
| Invite, edit, turn off drivers | Yes | Yes | No |
| Trucks, suppliers, supplies, products, recipes | Yes | Yes | No |
| Warehouse stock, deliveries, counts, transfers | Yes | Yes | No |
| Approve and send supplier orders | Yes | Yes | No |
| Manager count checks | Yes | Yes | No |
| Schedules (if turned on) | Yes | Yes | See their own |
| Reports, flags, all shifts | Yes | Yes | Only shifts they worked |
| Correct a closed shift | Yes | Yes | No |
| Shift work: counts, loading, returns, waste, sales (if allowed) | Yes | Yes | Yes, on shifts they're on |

On a shift, one person is the Lead and anyone else is Crew. Everyone on the shift can enter counts, waste, and sales. Only the Lead confirms the inventory at the start and end and finishes the shift.

## 5. New company sign up

1. Anyone can sign up: business name, their name, email, phone, number of trucks, and password. They confirm their email.
2. The company starts as Pending. The App Owner gets an email and sees it in the owner section.
3. While pending, the admin can start setting up (locations, trucks, supplies, products) but can't invite anyone or send emails.
4. The App Owner approves or declines (with an optional reason). The admin gets an email either way.
5. Approved companies get the full app. Declined or suspended companies can't get in.

## 6. How the data works

### 6.1 Units

Every supply has one base unit everything is stored in (oz, grams, each), plus other units the business defines:
* Whole milk: base oz. Half gallon = 64 oz. Case = 6 half gallons.
* Espresso beans: base grams. Bag = 2,268 g. Shot = 9 g.
* Large cups: base each. Sleeve = 50. Case = 1,000.

Each supply picks a count unit (what drivers count in), a purchase unit (what the supplier sells), and recipes can use any of its units. Counts can be partial (quick buttons for ¼, ½, ¾) unless the supply is set to whole numbers only.

### 6.2 Supplies, suppliers, truck types

* Supply: name, category, units, supplier, cost per unit, reorder level, "order up to" level, case size, tracks expiration (and usual shelf life), which truck types carry it, on or off.
* Supplier: name, contact, how they take orders (email, or "we order ourselves" which just keeps the list), order days, minimum order, notes.
* Truck types: named by the business (like "Shaved Ice" and "Coffee"). Supplies and products can be limited to certain types, so each driver only sees what their truck uses. If a business has one type, this stays hidden.

### 6.3 Products, sizes, modifiers, recipes

* Product (Latte) with sizes (Small, Medium, Large) or one size.
* Each size has a recipe: Large Latte = 2 shots espresso, 10 oz whole milk, 1 large cup, 1 large lid.
* Modifiers in groups. A modifier can add something (Extra shot: +1 shot, can differ by size) or swap something (Oat milk: replaces whole milk, same amount).
* Supply groups: when the sale can't say which supply was used (Kona Ice guests pick their own flavors), a recipe can say "3 oz from Syrups (any flavor)". Expected and actual are compared on the group total, while each flavor is still counted and reordered on its own.
* Recipe changes only apply going forward. Each edit makes a new version with a start date. Old sales use the version in effect when they happened, and each closed shift saves its own results, so old reports never change.

### 6.4 Stock: one log of every movement

One log (`stock_movements`) of every stock change: delivery, load (warehouse to truck), return (truck to warehouse), waste, usage, transfer, count adjustment, manager correction. Each row has supply, amount, from, to, who, when, why, cost at that moment, and shift if there is one.

Current stock is updated in the same step as the log row, so the warehouse updates itself whenever a truck is loaded, returned, or wasted.

### 6.5 Shifts

Start:
1. Tap Start Shift (or tap a scheduled shift if scheduling is on). Pick the truck and who's on the crew. The person starting is the Lead unless they pick someone else.
2. Starting counts are already filled in with what the app thinks is on the truck. The crew only fixes what's different. Differences are flagged as a starting count mismatch.
3. Suggested load list: par level minus what's on the truck, rounded up to whole count units, capped by what the warehouse has. Confirm or change.
4. Tap Loaded. Stock moves from the warehouse to the truck automatically.
5. Loading checklist (if turned on): generator fuel, cash bank, card reader charged, whatever the business lists.
6. The Lead confirms the starting inventory.

During: log waste, free drinks, sales tallies (if allowed), or a mid shift restock any time.

End:
1. Ending count of everything left, taken before unloading. Optional photo.
2. Waste with a reason (spilled, expired, dropped, melted, or the business's own) and optional photo. Waste can be a supply or a whole drink (the app takes out the recipe).
3. Sales and free drinks, if drivers report sales.
4. Returns to the warehouse (after the count).
5. The Lead reviews everything (shows who entered what) and taps Finish. Usage is calculated right away.

Offline: drivers often lose signal at events, so every entry is saved on the phone first and sent when signal comes back. Each entry gets its ID on the phone, so sending it twice never doubles it. The screen shows how many changes are waiting to send. If two crew members change the same line, the latest change wins and both are kept in the history the Lead sees.

### 6.6 Usage math

For each supply on a shift:
* Actual usage = starting count + added during shift − ending count − waste
* Expected usage = for every drink (paid or free), the recipe amount for its product and size plus modifier changes, times quantity
* Difference = actual − expected. Above zero means more was used than the drinks explain (over pouring, waste nobody logged, drinks not rung up). Below zero means less was used (under pouring, a count mistake, or a recipe set too high).

A difference is flagged when it's over the percent limit AND over a small minimum amount, so being off by one lid doesn't flag. Managers set a company default and can override it per supply. There's also an overall limit for the whole shift by dollar value.

Example, whole milk (half gallon = 64 oz): start 6 (384 oz) + loaded 4 (256 oz) − end 3.5 (224 oz) − spilled 0.25 (16 oz) = 400 oz used. Sales were 30 large lattes (5 with oat milk) and 12 medium. Expected = 25 × 10 + 12 × 8 = 346 oz. Difference +54 oz (15.6%), flagged at a 10% limit.

No sales for a shift: actual usage still shows, the comparison is skipped.

Every closed shift saves a results row per supply (start, added, end, waste, actual, expected, difference, cost, flagged) plus who worked it, the truck, the day, and its sales. Reports read from these saved results.

### 6.7 Sales

One `sales` table no matter where sales come from. Every row: company, truck, shift, time, product, size, quantity, modifiers, price, paid or free (with free reason), source (`driver`, `manager`, `csv`, `square`), and the source's own sale ID.

Business settings:
* Who reports sales: drivers, managers, or both.
* Which source wins when a shift has more than one. Default order: file (CSV or Square), then manager, then driver. The business can change the order.
* Every other source for that shift is kept and compared. If they don't match, it's flagged. That's the "make sure both line up" check, done automatically.

Free drinks: whoever reports sales can add free drinks with a reason. Built in reasons: drop replacement (a customer dropped theirs and got a new one), giveaway or promo, employee drink. Businesses can add their own. Free drinks use supplies like any drink, so they count in expected usage, but they bring in $0. Reports show how many of each and what they cost.

No double counting: a unique rule on (company, source, source sale ID) stops the same sale from being saved twice.

CSV upload: works with any POS export. The first time, the manager matches columns (which column is the item, size, quantity, time, and so on), and the app remembers it. A Square preset is built in. Item names are matched to products once ("Lg Latte" means Latte, Large) and remembered. Every upload is a batch that can be undone in one tap.

Sales are tied to the shift on that truck whose start and end time cover them (with a small grace window). Sales with no shift get flagged.

### 6.8 Manager count checks (optional)

Some businesses have drivers report sales and then a manager recounts certain items (like cups) to make sure everything lines up. The manager's count is the one that counts.

* The business picks which supplies get checked (for example every cup size).
* After a shift is finished, it shows as "Waiting for count check".
* The manager enters their count for those supplies. By default it's a blind count: they don't see the driver's numbers until they've entered theirs.
* The manager's count replaces the driver's ending count for those supplies (business setting, on by default). The shift is recalculated.
* The app shows, per shift: drinks reported (paid and free) by size, cups used by the manager's count, and the driver's count next to the manager's. Anything off by more than the limit is flagged.
* The check needs to happen before the truck goes out again. If a new shift already started, the old one is marked "check missed".
* Managers get a reminder if a shift waits too long for its check.

### 6.9 Flags ("Needs attention")

Flags land in a manager inbox and in the daily report, and can be marked reviewed with a note:
* Expected vs actual difference over the limit
* Starting count doesn't match last known stock
* Sales sources don't match each other
* Manager count check doesn't match the driver's count or the reported drinks
* Driver with a pattern of high waste (compared to the business's average over 30 days)
* Sales with no shift, or sales items that aren't matched to a product
* Shift left open too long, or count check missed
* Expired items still in stock

### 6.10 Expiration dates (optional)

Supplies marked "tracks expiration" ask for a date when a delivery comes in (filled in from usual shelf life). Stock is tracked by batch. Loading sends the oldest batch first, and usage and waste come out oldest first. Alerts go out a set number of days ahead (default 3), and expired batches get a "log as waste" button.

### 6.11 Par levels

A par level is how much of each supply a truck should have when it heads out. Example: Truck 1 should leave with 6 half gallons of milk. If it has 2, the load list says load 4.

Each truck has its own par levels. Supplies with no par level don't show on that truck's count screens, which keeps the list short. Every week the app suggests new par levels from the last 10 shifts' average usage plus a cushion (default 25%), rounded up to whole count units. A manager approves with one tap. A business can turn on auto updates instead.

### 6.12 Order lists

Every morning (and right after something goes low), the app builds draft orders by supplier: everything at or below its reorder level, ordered up to its "order up to" level, rounded to case size. A manager reviews and taps Approve and Send, which emails the supplier (or just marks it ordered for "we order ourselves" suppliers). Nothing leaves the company without that tap. Receive Delivery opens the order already filled in.

### 6.13 Scheduling (optional)

Businesses that already use a scheduling app can leave this off. When it's on:
* Managers build the schedule: truck, day, start and end time, event or spot name, Lead and Crew.
* Shifts can repeat weekly.
* Drivers see My Schedule and get a push and email when they're scheduled or something changes.
* Starting a shift from the schedule fills in the truck and crew.
* Reminders go out if a scheduled shift isn't started on time.

With scheduling off, reminders still go out for shifts left open too long.

### 6.14 Corrections and history

A manager can fix a count on a closed shift with a reason. The app saves who, when, old value, new value, and why, then recalculates. Truck stock only changes if that shift was the truck's latest count. Every edit to setup data (products, recipes, supplies, prices, people, settings) goes in an audit log.

### 6.15 Turning things off vs deleting

Turning something off hides it from drivers and new lists but keeps its history in reports. Deleting is only allowed for things that were never used.

## 7. Screens

Driver (phone first, big buttons, works one handed):
* Home: Start or Continue Shift, My Schedule (if on), reminders
* Start shift: truck and crew, starting counts, load list, checklist, Lead confirm
* During: waste, free drinks, sales tally, restock
* End: ending counts, waste, sales, returns, Lead review and Finish
* Shift summary, My Shifts

Manager:
* Needs Attention: flags, orders to approve, count checks waiting, open shifts
* Warehouse: stock, Receive Delivery, count, transfer, expiring soon
* Trucks: stock, par levels and suggestions, shift history
* Orders: drafts by supplier, approve and send, receive
* Sales: upload CSV, match columns and items, enter sales for a shift
* Count checks
* Schedule (if on)
* Reports: usage, waste, free drinks, count checks, driver comparison, profit, CSV export
* Shift detail with corrections

Admin (plus everything a manager has):
* Owner dashboard: today's trucks, sales, costs, flags at a glance
* Setup checklist and starter kits
* Locations, truck types, trucks, suppliers, supplies, products and recipes, modifiers
* CSV import for supplies and products with templates and a preview
* People and invites
* Settings: features on or off, who reports sales, limits, report times and recipients, time zone

App Owner:
* Sign up requests: approve or decline
* Companies: status, size, last active, suspend or reactivate
* Database and storage use

## 8. Automation

Happens instantly when something is saved:
* Stock updates on every load, return, waste, delivery, and count
* Shift finish: actual usage, expected usage, differences, flags
* Starting count mismatch flag
* Sales upload or entry: match to shifts, recalculate, compare sources
* Manager count check: recalculate, compare, flag
* Low stock check

Scheduled (each runs per company in that company's time zone, times are business settings):

| Job | Default time | What it does | Who hears about it |
|---|---|---|---|
| Daily inventory and usage reports | 8 pm | Stock, low items, each shift's usage, differences, waste, free drinks, cost | People the business picks |
| Low stock sweep | 6 am (and instantly) | Supplies at or below reorder level, warehouse and trucks | Managers, once per item until restocked |
| Order lists | 6 am (and after low stock) | Builds draft orders by supplier | Managers. Nothing sent until approved |
| Par level suggestions | Sunday night | New suggestions per truck | Managers approve (or auto) |
| Shift not started (scheduling on) | Every 15 min | Scheduled shift not started 30 min after start time | Lead, then managers |
| Shift not finished | Every 15 min | Shift still open past its end time or a set number of hours | Lead, then managers |
| Count check waiting | Every hour | Shift waiting for a manager count too long | Managers |
| Expiration check | 6 am | Items expiring soon, expired items | Managers and the truck's Lead |
| Pattern flags | Every night | High waste drivers, repeat differences, sales with no shift | Manager inbox |
| Weekly summary | Monday 7 am | Waste, free drinks, usage trends, cost per truck, profit, flags | People the business picks |
| Monthly summary | 1st, 7 am | Same, monthly | People the business picks |
| Photo cleanup | Every night | Removes photos older than the business setting | Nobody |
| Backup | Weekly | Database backup through GitHub Actions | App Owner on failure |
| Square sync (later) | Every night, plus a button | Pull yesterday's sales per linked truck | Only on errors |

How it runs: `pg_cron` runs small database jobs every few minutes. They write messages into an outbox table. An Edge Function sends what's in the outbox by email and push. Every job records that it ran for that company and period, so a retry never sends anything twice.

## 9. Square later

Built now:
* The `sales` table with `source`, the source's sale ID, and the unique rule against double counting
* The item mapping table (used by CSV now, Square later)
* One shared ingest function every source goes through: match items, skip duplicates, save, tie to shifts, recalculate
* A clearly marked spot for the Square source

Added later, when the owner says so: per truck "Connect Square" (OAuth), a `square_connections` table with tokens encrypted, a nightly sync through the same ingest function with `source = square`, and matching Square catalog items to products. Full notes in CLAUDE.md.

## 10. Code layout

```
src/                     the phone app (React + TypeScript)
  app/                   routes and layout
  features/              auth, owner, people, setup, inventory, shifts, waste, sales, schedule, reports
  components/            shared UI pieces
  lib/                   Supabase client, offline queue, formatting, units
supabase/
  migrations/            database tables, security rules, functions (SQL)
  functions/             Edge Functions (email, push, invites, CSV, jobs, later Square)
tests/
  db/                    database and company separation tests (run against real Postgres)
  unit/                  math and logic tests
docs/
CLAUDE.md
```

## 11. Build phases

Each phase ends with tested code pushed to the branch and a short note on how to try it.

0. Foundation: project setup, database test setup, CI, PWA shell, CLAUDE.md.
1. Accounts: company sign up, App Owner approvals, roles, invites, login, password reset, people management, basic company settings, audit log, email outbox.
2. Setup: starter kits, locations, truck types, trucks, suppliers, supplies with units and groups, products with sizes, modifiers, versioned recipes, CSV import, turning things on and off, feature settings, setup checklist.
3. Stock: warehouse and truck stock, movement log, Receive Delivery, counts, transfers, expiration batches.
4. Shifts: Lead and Crew, prefilled starting counts, load list from par levels, loading, end counts, returns, Lead confirm, usage math, summary, mismatch flag, offline saving, live crew updates.
5. Waste: supply or whole drink, reasons, photos, warehouse waste, waste report.
6. Sales: sales table, CSV upload with column and item matching, sales entry by drivers or managers with free drinks, source priority and comparison, manager count checks, expected vs actual, limits, flags.
7. Scheduling (optional feature).
8. Automation: all scheduled jobs, emails, push notifications, order lists with approve and send, par suggestions, reminders, backups.
9. Extras: loading checklist, driver comparison, photos on end counts, profit view, corrections with history, report polish and CSV export.
10. Square connection (when the owner says so).

## 12. Testing

* Unit tests: usage math, recipe and modifier math, unit conversions, CSV parsing, par and reorder math
* Database tests on real Postgres: every table's security rules with two companies and all roles
* Phone sized browser tests for sign up, invite, and a full shift
* Every job: "runs twice, sends once"

## 13. Decisions made (owner can change any of these)

1. Kona Ice and Toms Coffee: one company, two truck types.
2. Anyone can sign up, the App Owner approves. Pending companies can set up but can't invite or email.
3. App Owner sees company info and size, not their inventory or sales.
4. Scheduling is built in as an optional feature.
5. Reminders by push and email. No text messages (they cost money).
6. Offline saving on the phone.
7. Lead and Crew on shifts.
8. Supply groups for shared supplies like Kona syrup.
9. Who reports sales and which source wins are business settings. Manager count checks are an optional feature, blind by default, and the manager's count wins.
10. Par levels: suggest and approve, auto updates optional.
11. Managers handle drivers. Admins handle managers and admins.
12. Reorder amounts and supplier order methods are set by each business.
13. Free hosting only: Cloudflare Pages and Supabase. Gmail for email until there's a domain.
14. Any location can hold stock. Each truck has a home location it loads from.

## 14. What the owner needs to do (when we get there)

1. Make a free Supabase account and project (needed to try the app live after phase 1).
2. Make a free Cloudflare account and connect this GitHub repo to Cloudflare Pages.
3. Make a Gmail account just for the app, turn on 2 step verification, and create an app password.
4. Allow `supabase.co` in this cloud session's network settings so the app can be tested against the real project.

Step by step instructions will be in `docs/SETUP.md`.
