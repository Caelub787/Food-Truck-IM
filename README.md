# TruckStock

Inventory, shifts, and usage tracking for food truck businesses. A phone first web app (PWA) that any business can sign up for.

* The plan: [docs/PLAN.md](docs/PLAN.md)
* Going live on free plans: [docs/SETUP.md](docs/SETUP.md)
* Project rules: [CLAUDE.md](CLAUDE.md)

## Running it on a computer

```
npm install
cp .env.example .env.local   # then fill in your Supabase URL and publishable key
npm run dev
```

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
