# Database tests

These run every migration against a real Postgres and test the security rules with two companies and every role.

They need a Postgres you can connect to as a superuser. By default they use `postgres://postgres:postgres@localhost:5432/postgres`. Set `TEST_DATABASE_URL` to use a different one.

The tests create (and replace) a database called `truckstock_test`. `supabase-shim.sql` stands in for the parts of Supabase the migrations use (the `anon`, `authenticated`, and `service_role` roles, `auth.users`, `auth.uid()`, `auth.jwt()`).

Helpers in `helpers.ts`:
* `as(user, q => ...)` runs queries as a logged in user, `'anon'`, or `'service'`, with the security rules on.
* `sql(...)` runs as the database owner, with no rules (for setting up test data).
* `createCompany(status)` and `addMember(companyId, role)` make test data.

Every new table needs tests here: another company can't read, add, change, or delete its rows, and each role only gets what it should.
