# Food Truck IM

The all in one app for food truck businesses: inventory (counts, loading, waste, usage vs sales), scheduling, client bookings, budgeting with read only bank balances, and reports. A phone first web app (PWA) that any business can sign up for.

* Website: [foodtruckim.com](https://foodtruckim.com) (with a demo at /demo)
* App: [app.foodtruckim.com](https://app.foodtruckim.com)

* The plan: [docs/PLAN.md](docs/PLAN.md)
* Going live on free plans: [docs/SETUP.md](docs/SETUP.md)
* How to use it: [docs/GUIDE.md](docs/GUIDE.md)
* Project rules: [CLAUDE.md](CLAUDE.md)

## Running it on a computer

```
npm install
cp .env.example .env.local   # then fill in your Supabase URL and publishable key
npm run dev
```

## The demo

`npm run build:demo` builds the app with a pretend server and made up sample data inside the page (no Supabase needed). `node scripts/build-demo-page.mjs demo.html` turns it into one file you can share.

## The website

`site/` is the landing page at foodtruckim.com. `npm run build:site` builds it with the demo at /demo into `dist-site`. `node scripts/site-screens.cjs` checks it at phone and desktop sizes, and `node scripts/site-shots.cjs` retakes its pictures of the app from the demo.

## Checks

```
npm run lint        # code style
npm run typecheck   # types
npm test            # unit tests
npm run test:db     # database and security rule tests (needs a local Postgres, see tests/db/README.md)
```

Server function checks (needs Deno):

```
cd supabase/functions
deno check */index.ts
deno test --allow-env _shared/
```
