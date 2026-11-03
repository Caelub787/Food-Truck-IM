-- Budget. Categories the business names, a budget for each one per month,
-- and what was really spent or earned: inventory (from deliveries), sales,
-- and booked events fill in by themselves, and anything else is typed in.
-- Money accounts show balances: typed in, or read from a linked bank. Bank
-- links can only read balances. No money ever moves through the app.
-- Admins see the budget. Managers only if the business turns that on.

alter table public.company_settings add column budget_managers boolean not null default false;

create function app.can_budget() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() = 'admin'
    or (app.role() = 'manager' and (select budget_managers from public.company_settings where company_id = app.company_id())), false)
$$;

-- Returns the caller's company if they can see the budget, else stops.
create function app.require_budget() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_budget() then
    raise exception 'Only admins can see the budget, unless they let managers see it too.' using errcode = '42501';
  end if;
  return app.company_id();
end $$;

-- Tables -----------------------------------------------------------------------------------------

create table public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('expense', 'income')),
  -- Filled in by the app: inventory from deliveries, sales, and booked events' prices.
  auto text check (auto in ('inventory', 'sales', 'events')),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index budget_categories_name_idx on public.budget_categories (company_id, lower(name));
create unique index budget_categories_auto_idx on public.budget_categories (company_id, auto) where auto is not null;

create table public.budget_amounts (
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount numeric not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (category_id, month),
  foreign key (company_id, category_id) references public.budget_categories (company_id, id) on delete cascade
);

create table public.budget_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  category_id uuid not null,
  entry_date date not null,
  amount numeric not null check (amount > 0),
  note text check (length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, category_id) references public.budget_categories (company_id, id) on delete cascade
);
create index budget_entries_company_idx on public.budget_entries (company_id, entry_date);

-- A linked bank login. The access token is locked (encrypted by the server with
-- a key only it has) and this table is out of reach of the app entirely.
create table app.bank_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null default 'plaid' check (provider in ('plaid')),
  item_id text not null,
  access_token text not null,
  institution text check (length(institution) <= 120),
  status text not null default 'ok' check (status in ('ok', 'needs_login', 'error')),
  error text check (length(error) <= 500),
  last_synced_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (provider, item_id)
);
alter table app.bank_connections enable row level security;
revoke all on app.bank_connections from public, anon, authenticated;
select app.enable_live('app.bank_connections');

create table public.money_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- 'manual' balances are typed in. 'bank' ones come from a linked bank and can't be changed here.
  kind text not null default 'manual' check (kind in ('manual', 'bank')),
  institution text check (length(institution) <= 120),
  mask text check (length(mask) <= 8),
  account_type text check (length(account_type) <= 40),
  balance numeric,
  available numeric,
  balance_at timestamptz,
  connection_id uuid,
  provider_account_id text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (connection_id, provider_account_id),
  check ((kind = 'bank') = (connection_id is not null)),
  foreign key (company_id, connection_id) references app.bank_connections (company_id, id) on delete cascade
);

-- Admins and managers by role, and on top of that only people allowed to see
-- the budget. Bank accounts can't be added, changed, or removed from the app.
select app.setup_table('public.budget_categories', '{admin,manager}', '{admin,manager}');
select app.setup_table('public.budget_amounts', '{admin,manager}', '{admin,manager}');
select app.setup_table('public.budget_entries', '{admin,manager}', '{admin,manager}');
select app.setup_table('public.money_accounts', '{admin,manager}', '{admin,manager}');
create policy budget_categories_allowed on public.budget_categories as restrictive for all to authenticated
  using ((select app.can_budget())) with check ((select app.can_budget()));
create policy budget_amounts_allowed on public.budget_amounts as restrictive for all to authenticated
  using ((select app.can_budget())) with check ((select app.can_budget()));
create policy budget_entries_allowed on public.budget_entries as restrictive for all to authenticated
  using ((select app.can_budget())) with check ((select app.can_budget()));
create policy money_accounts_allowed on public.money_accounts as restrictive for all to authenticated
  using ((select app.can_budget())) with check ((select app.can_budget()));
create policy money_accounts_manual_insert on public.money_accounts as restrictive for insert to authenticated
  with check (kind = 'manual');
create policy money_accounts_manual_update on public.money_accounts as restrictive for update to authenticated
  using (kind = 'manual') with check (kind = 'manual');
create policy money_accounts_manual_delete on public.money_accounts as restrictive for delete to authenticated
  using (kind = 'manual');

-- Starting categories for every business (they can rename, add, or turn off any of them).
create function app.add_budget_defaults(p_company uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.budget_categories (company_id, name, kind, auto, sort)
  values (p_company, 'Sales', 'income', 'sales', 1), (p_company, 'Events', 'income', 'events', 2),
         (p_company, 'Other income', 'income', null, 3),
         (p_company, 'Inventory', 'expense', 'inventory', 10), (p_company, 'Fuel', 'expense', null, 11),
         (p_company, 'Payroll', 'expense', null, 12), (p_company, 'Truck repairs', 'expense', null, 13),
         (p_company, 'Insurance', 'expense', null, 14), (p_company, 'Permits and fees', 'expense', null, 15),
         (p_company, 'Commissary or rent', 'expense', null, 16), (p_company, 'Marketing', 'expense', null, 17),
         (p_company, 'Other', 'expense', null, 18)
  on conflict do nothing
$$;

create function app.companies_budget_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.add_budget_defaults(new.id);
  return new;
end $$;
create trigger companies_budget_defaults after insert on public.companies
  for each row execute function app.companies_budget_defaults();
select app.add_budget_defaults(id) from public.companies;

-- The budget sheet ---------------------------------------------------------------------------------

-- A year at a glance: every category, its budget for each month, and what
-- really happened each month (filled in plus typed in). Months are 1 to 12, in
-- the business's time zone.
create function public.budget_year(p_year integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.require_budget();
  v_tz text := (select timezone from public.companies where id = v_company);
  v_from timestamptz := make_date(p_year, 1, 1)::timestamp at time zone v_tz;
  v_to timestamptz := make_date(p_year + 1, 1, 1)::timestamp at time zone v_tz;
  v_order text[] := (select sales_source_order from public.company_settings where company_id = v_company);
begin
  return jsonb_build_object(
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', a.category_id, 'month', extract(month from a.month)::integer, 'amount', a.amount))
      from public.budget_amounts a
      where a.company_id = v_company and a.month >= make_date(p_year, 1, 1) and a.month < make_date(p_year + 1, 1, 1)), '[]'),
    'actuals', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', x.category_id, 'month', x.month, 'amount', round(x.amount, 2)))
      from (
        select category_id, month, sum(amount) as amount from (
          -- Typed in
          select e.category_id, extract(month from e.entry_date)::integer as month, e.amount
          from public.budget_entries e
          where e.company_id = v_company and e.entry_date >= make_date(p_year, 1, 1) and e.entry_date < make_date(p_year + 1, 1, 1)
          -- Inventory: what deliveries cost
          union all
          select c.id, extract(month from m.created_at at time zone v_tz)::integer, m.quantity * m.unit_cost
          from public.stock_movements m
          join public.budget_categories c on c.company_id = v_company and c.auto = 'inventory'
          where m.company_id = v_company and m.kind = 'delivery' and m.created_at >= v_from and m.created_at < v_to
          -- Sales: each shift's winning source, same as the reports, plus sales not tied to a shift
          union all
          select c.id, extract(month from sa.sold_at at time zone v_tz)::integer, sa.price
          from public.sales sa
          join public.budget_categories c on c.company_id = v_company and c.auto = 'sales'
          where sa.company_id = v_company and sa.sold_at >= v_from and sa.sold_at < v_to
            and (sa.shift_id is null or app.sale_group(sa.source) = (
              select o.g from unnest(v_order) with ordinality as o(g, n)
              where exists (select 1 from public.sales s2 where s2.shift_id = sa.shift_id and app.sale_group(s2.source) = o.g)
              order by o.n limit 1))
          -- Events: the price agreed on accepted bookings
          union all
          select c.id, extract(month from b.starts_at at time zone v_tz)::integer, b.price
          from public.bookings b
          join public.budget_categories c on c.company_id = v_company and c.auto = 'events'
          where b.company_id = v_company and b.status = 'accepted' and b.price is not null and b.starts_at >= v_from and b.starts_at < v_to
        ) lines
        group by category_id, month
      ) x), '[]'));
end $$;

-- Sets the same budget for a category for several months at once (like "the rest of the year").
create function public.set_budget(p_category_id uuid, p_months date[], p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_budget();
begin
  if not exists (select 1 from public.budget_categories where id = p_category_id and company_id = v_company) then
    raise exception 'That category was not found.';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter an amount of zero or more.'; end if;
  insert into public.budget_amounts (company_id, category_id, month, amount)
  select v_company, p_category_id, date_trunc('month', m)::date, p_amount from unnest(p_months) m
  on conflict (category_id, month) do update set amount = excluded.amount;
end $$;

-- Linked banks ---------------------------------------------------------------------------------------

-- The bank links the app can show (never their tokens).
create function public.bank_connections() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'institution', institution, 'status', status, 'error', error,
                                               'last_synced_at', last_synced_at) order by created_at), '[]')
  from app.bank_connections where company_id = app.require_budget()
$$;

-- For the bank server function only. It checks the caller first.
create function public.service_bank_save(p_company uuid, p_user uuid, p_item_id text, p_token text, p_institution text) returns uuid
language sql security definer set search_path = '' as $$
  insert into app.bank_connections (company_id, item_id, access_token, institution, created_by)
  values (p_company, p_item_id, p_token, left(p_institution, 120), p_user)
  on conflict (provider, item_id) do update set access_token = excluded.access_token, institution = excluded.institution,
    status = 'ok', error = null
  returning id
$$;

create function public.service_bank_list(p_company uuid, p_connection uuid default null)
returns table (id uuid, item_id text, access_token text, institution text)
language sql stable security definer set search_path = '' as $$
  select id, item_id, access_token, institution from app.bank_connections
  where company_id = p_company and (p_connection is null or id = p_connection)
$$;

-- p_accounts: [{account_id, name, mask, type, current, available}]
create function public.service_bank_update(p_connection uuid, p_accounts jsonb, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c app.bank_connections;
  a jsonb;
begin
  select * into c from app.bank_connections where id = p_connection;
  if not found then return; end if;
  update app.bank_connections set status = p_status, error = left(p_error, 500),
         last_synced_at = case when p_status = 'ok' then now() else last_synced_at end
   where id = c.id;
  for a in select * from jsonb_array_elements(coalesce(p_accounts, '[]')) loop
    insert into public.money_accounts (company_id, name, kind, institution, mask, account_type, balance, available, balance_at,
                                       connection_id, provider_account_id)
    values (c.company_id, left(coalesce(nullif(a ->> 'name', ''), 'Account'), 80), 'bank', c.institution, left(a ->> 'mask', 8),
            left(a ->> 'type', 40), (a ->> 'current')::numeric, (a ->> 'available')::numeric, now(), c.id, a ->> 'account_id')
    on conflict (connection_id, provider_account_id) do update
      set balance = excluded.balance, available = excluded.available, balance_at = excluded.balance_at, mask = excluded.mask;
  end loop;
end $$;

create function public.service_bank_remove(p_company uuid, p_connection uuid) returns void
language sql security definer set search_path = '' as $$
  delete from app.bank_connections where company_id = p_company and id = p_connection
$$;

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function app.can_budget(), app.require_budget(), app.add_budget_defaults(uuid), app.companies_budget_defaults()
  from public, anon;
grant execute on function app.can_budget() to authenticated;
revoke execute on function public.budget_year(integer), public.set_budget(uuid, date[], numeric), public.bank_connections()
  from public, anon, authenticated;
grant execute on function public.budget_year(integer), public.set_budget(uuid, date[], numeric), public.bank_connections() to authenticated;
revoke execute on function public.service_bank_save(uuid, uuid, text, text, text), public.service_bank_list(uuid, uuid),
  public.service_bank_update(uuid, jsonb, text, text), public.service_bank_remove(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_bank_save(uuid, uuid, text, text, text), public.service_bank_list(uuid, uuid),
  public.service_bank_update(uuid, jsonb, text, text), public.service_bank_remove(uuid, uuid)
  to service_role;
