-- Phase 2: everything a business sets up once. Settings and feature switches,
-- named lists, locations, truck types, trucks, suppliers, supplies with units
-- and groups, products with sizes, add ons (modifiers), and recipes.

-- One call gives a company table the standard security rules, grants, change
-- history, and live updates. p_writers can add, change, and delete rows
-- directly. Tables only changed through functions pass an empty list.
create function app.setup_table(
  p_table regclass,
  p_writers public.user_role[] default '{admin,manager}',
  p_readers public.user_role[] default '{admin,manager,driver}',
  p_audit boolean default true,
  p_owner boolean default false
) returns void
language plpgsql set search_path = '' as $$
declare
  v_name text := (select relname from pg_catalog.pg_class where oid = p_table);
  v_readers text := (select string_agg(quote_literal(r), ',') from unnest(p_readers) r);
  v_writers text := (select string_agg(quote_literal(r), ',') from unnest(p_writers) r);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated
     using (company_id = (select app.company_id()) and (select app.role()) in (%s))',
    v_name || '_select', p_table, v_readers);
  if cardinality(p_writers) > 0 then
    execute format(
      'create policy %I on %s for insert to authenticated
       with check (company_id = (select app.company_id()) and (select app.role()) in (%s))',
      v_name || '_insert', p_table, v_writers);
    execute format(
      'create policy %I on %s for update to authenticated
       using (company_id = (select app.company_id()) and (select app.role()) in (%s))
       with check (company_id = (select app.company_id()))',
      v_name || '_update', p_table, v_writers);
    execute format(
      'create policy %I on %s for delete to authenticated
       using (company_id = (select app.company_id()) and (select app.role()) in (%s))',
      v_name || '_delete', p_table, v_writers);
  end if;

  execute format('revoke all on %s from anon, authenticated', p_table);
  execute format('grant select on %s to authenticated', p_table);
  if cardinality(p_writers) > 0 then
    execute format('grant insert, update, delete on %s to authenticated', p_table);
  end if;
  execute format('grant all on %s to service_role', p_table);

  if exists (select 1 from pg_catalog.pg_attribute where attrelid = p_table and attname = 'updated_at' and not attisdropped) then
    execute format('create trigger %I before update on %s for each row execute function app.touch_updated_at()',
      v_name || '_touch', p_table);
  end if;
  if p_audit then
    execute format('create trigger %I after insert or update or delete on %s for each row execute function app.audit()',
      v_name || '_audit', p_table);
  end if;
  perform app.enable_live(p_table, p_owner);
end $$;

-- Returns the caller's company if their role is one of p_roles, else stops.
create function app.require_role(variadic p_roles public.user_role[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.company_id();
  v_role public.user_role := app.role();
begin
  if v_company is null then
    raise exception 'You do not have access to do this.' using errcode = '42501';
  end if;
  if not (v_role = any (p_roles)) then
    raise exception 'You do not have permission to do this.' using errcode = '42501';
  end if;
  return v_company;
end $$;

-- Settings and feature switches --------------------------------------------------

create table public.company_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- Optional features
  scheduling_enabled boolean not null default false,
  count_checks_enabled boolean not null default false,
  count_check_blind boolean not null default true,
  count_check_manager_wins boolean not null default true,
  expiration_tracking boolean not null default true,
  loading_checklist_enabled boolean not null default true,
  -- Sales: who reports them, and which source wins when there's more than one
  sales_reporters text not null default 'drivers' check (sales_reporters in ('drivers', 'managers', 'both', 'none')),
  sales_source_order text[] not null default array['file', 'manager', 'driver']
    check (sales_source_order <@ array['file', 'manager', 'driver'] and cardinality(sales_source_order) = 3),
  -- When a difference between expected and actual usage gets flagged
  diff_percent numeric not null default 10 check (diff_percent >= 0),
  diff_min_dollars numeric not null default 2 check (diff_min_dollars >= 0),
  shift_dollar_limit numeric not null default 25 check (shift_dollar_limit >= 0),
  -- Par level suggestions
  par_cushion_percent numeric not null default 25 check (par_cushion_percent >= 0),
  par_lookback_shifts integer not null default 10 check (par_lookback_shifts between 1 and 100),
  par_auto_update boolean not null default false,
  -- Timing for automatic jobs (hours are local to the company's time zone)
  expiration_warning_days integer not null default 3 check (expiration_warning_days between 0 and 60),
  morning_hour integer not null default 6 check (morning_hour between 0 and 23),
  daily_report_hour integer not null default 20 check (daily_report_hour between 0 and 23),
  weekly_report_day integer not null default 1 check (weekly_report_day between 0 and 6),
  summary_hour integer not null default 7 check (summary_hour between 0 and 23),
  start_reminder_minutes integer not null default 30 check (start_reminder_minutes between 5 and 600),
  shift_reminder_hours integer not null default 12 check (shift_reminder_hours between 1 and 72),
  shift_alert_hours integer not null default 16 check (shift_alert_hours between 1 and 96),
  count_check_reminder_hours integer not null default 18 check (count_check_reminder_hours between 1 and 168),
  waste_pattern_factor numeric not null default 1.5 check (waste_pattern_factor >= 1),
  photo_retention_days integer not null default 180 check (photo_retention_days between 7 and 3650),
  updated_at timestamptz not null default now()
);
select app.setup_table('public.company_settings', '{admin}');
-- Rows are made by the database, never added or removed from the app.
revoke insert, delete on public.company_settings from authenticated;

-- Named lists --------------------------------------------------------------------

create table public.waste_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index waste_reasons_name_idx on public.waste_reasons (company_id, lower(name));
select app.setup_table('public.waste_reasons');

create table public.free_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index free_reasons_name_idx on public.free_reasons (company_id, lower(name));
select app.setup_table('public.free_reasons');

-- Places: every location and truck is a place that can hold stock --------------

create table public.places (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('location', 'truck')),
  unique (company_id, id)
);
select app.setup_table('public.places', '{}', p_audit => false);

create function app.make_place() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.places (id, company_id, kind)
  values (new.id, new.company_id, case when tg_table_name = 'trucks' then 'truck' else 'location' end);
  return new;
end $$;

-- Deleting a location or truck also deletes its place. If anything has ever
-- moved through it, that fails, so things with history can only be turned off.
create function app.remove_place() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.places where id = old.id;
  return old;
end $$;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null default 'warehouse' check (kind in ('warehouse', 'storage', 'commissary', 'other')),
  address text check (length(address) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, id) references public.places (company_id, id)
);
create unique index locations_name_idx on public.locations (company_id, lower(name));
create trigger locations_place before insert on public.locations for each row execute function app.make_place();
create trigger locations_unplace after delete on public.locations for each row execute function app.remove_place();
select app.setup_table('public.locations', '{admin}');

create table public.truck_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index truck_types_name_idx on public.truck_types (company_id, lower(name));
select app.setup_table('public.truck_types');

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  truck_type_id uuid,
  home_location_id uuid,
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, id) references public.places (company_id, id),
  foreign key (company_id, truck_type_id) references public.truck_types (company_id, id),
  foreign key (company_id, home_location_id) references public.locations (company_id, id)
);
create unique index trucks_name_idx on public.trucks (company_id, lower(name));
create trigger trucks_place before insert on public.trucks for each row execute function app.make_place();
create trigger trucks_unplace after delete on public.trucks for each row execute function app.remove_place();
select app.setup_table('public.trucks');

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  truck_type_id uuid,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, truck_type_id) references public.truck_types (company_id, id)
);
select app.setup_table('public.checklist_items');

-- Suppliers (drivers don't need to see them) ----------------------------------------

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  contact_name text check (length(contact_name) <= 120),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (length(phone) <= 40),
  order_method text not null default 'email' check (order_method in ('email', 'self')),
  order_days text check (length(order_days) <= 200),
  minimum_order numeric check (minimum_order >= 0),
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index suppliers_name_idx on public.suppliers (company_id, lower(name));
select app.setup_table('public.suppliers', p_readers => '{admin,manager}');

-- Supplies ---------------------------------------------------------------------------
-- Every amount is stored in the supply's base unit (oz, g, each). Other units
-- (half gallon, case, shot) say how many base units they hold.

create table public.supply_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  base_unit text not null check (length(btrim(base_unit)) between 1 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index supply_groups_name_idx on public.supply_groups (company_id, lower(name));
select app.setup_table('public.supply_groups');

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  category text check (length(category) <= 60),
  base_unit text not null default 'each' check (length(btrim(base_unit)) between 1 and 20),
  count_unit_id uuid,
  purchase_unit_id uuid,
  supplier_id uuid,
  truck_type_id uuid,
  group_id uuid,
  cost_per_base numeric not null default 0 check (cost_per_base >= 0),
  reorder_level numeric check (reorder_level >= 0),
  order_up_to numeric check (order_up_to >= 0),
  whole_only boolean not null default false,
  tracks_expiration boolean not null default false,
  shelf_life_days integer check (shelf_life_days between 1 and 3650),
  count_check boolean not null default false,
  diff_percent numeric check (diff_percent >= 0),
  diff_min_qty numeric check (diff_min_qty >= 0),
  notes text check (length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id),
  foreign key (company_id, truck_type_id) references public.truck_types (company_id, id),
  foreign key (company_id, group_id) references public.supply_groups (company_id, id)
);
create unique index supplies_name_idx on public.supplies (company_id, lower(name));
create index supplies_group_idx on public.supplies (group_id);

create table public.supply_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  supply_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  factor numeric not null check (factor > 0),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (id, supply_id),
  foreign key (company_id, supply_id) references public.supplies (company_id, id) on delete cascade
);
create unique index supply_units_name_idx on public.supply_units (supply_id, lower(name));

-- The count and purchase units must belong to the same supply.
alter table public.supplies
  add foreign key (count_unit_id, id) references public.supply_units (id, supply_id) on delete set null (count_unit_id),
  add foreign key (purchase_unit_id, id) references public.supply_units (id, supply_id) on delete set null (purchase_unit_id);

select app.setup_table('public.supplies');
select app.setup_table('public.supply_units');

-- A supply in a group must use the group's base unit, so totals add up.
create function app.check_supply_group() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_unit text;
begin
  if new.group_id is null then return new; end if;
  select base_unit into v_unit from public.supply_groups where id = new.group_id;
  if lower(v_unit) <> lower(new.base_unit) then
    raise exception 'Supplies in a group must use the group''s base unit (%).', v_unit;
  end if;
  return new;
end $$;
create trigger supplies_group_unit before insert or update of group_id, base_unit on public.supplies
  for each row execute function app.check_supply_group();

-- Products, sizes, add ons ----------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  category text check (length(category) <= 60),
  truck_type_id uuid,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, truck_type_id) references public.truck_types (company_id, id)
);
create unique index products_name_idx on public.products (company_id, lower(name));
select app.setup_table('public.products');

create table public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  price numeric check (price >= 0),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade
);
create unique index product_sizes_name_idx on public.product_sizes (product_id, lower(name));
select app.setup_table('public.product_sizes');

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index modifier_groups_name_idx on public.modifier_groups (company_id, lower(name));
select app.setup_table('public.modifier_groups');

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  group_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  price numeric not null default 0 check (price >= 0),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, group_id) references public.modifier_groups (company_id, id) on delete cascade
);
create unique index modifiers_name_idx on public.modifiers (group_id, lower(name));
select app.setup_table('public.modifiers');

create table public.product_modifier_groups (
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  product_id uuid not null,
  group_id uuid not null,
  primary key (product_id, group_id),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade,
  foreign key (company_id, group_id) references public.modifier_groups (company_id, id) on delete cascade
);
select app.setup_table('public.product_modifier_groups');

-- Recipes -------------------------------------------------------------------------------
-- Saving a recipe makes a new version. Sales always use the version that was in
-- effect when they happened, so changing a recipe never changes old reports.

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_size_id uuid not null,
  effective_from timestamptz not null default now(),
  note text check (length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, product_size_id) references public.product_sizes (company_id, id) on delete cascade
);
create index recipe_versions_size_idx on public.recipe_versions (product_size_id, effective_from desc);
select app.setup_table('public.recipe_versions', '{}', p_audit => false);

create table public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  recipe_version_id uuid not null,
  supply_id uuid,
  group_id uuid,
  quantity numeric not null check (quantity > 0),
  unit_id uuid,
  foreign key (company_id, recipe_version_id) references public.recipe_versions (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id),
  foreign key (company_id, group_id) references public.supply_groups (company_id, id),
  foreign key (company_id, unit_id) references public.supply_units (company_id, id) on delete set null (unit_id),
  check ((supply_id is null) <> (group_id is null))
);
create index recipe_lines_version_idx on public.recipe_lines (recipe_version_id);
select app.setup_table('public.recipe_lines', '{}', p_audit => false);

-- Add on effects, versioned the same way.
--   add:  adds (or with a negative amount, takes away) an amount of a supply or group
--   swap: moves whatever the recipe uses of one supply or group to another supply
create table public.modifier_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  modifier_id uuid not null,
  effective_from timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, modifier_id) references public.modifiers (company_id, id) on delete cascade
);
create index modifier_versions_idx on public.modifier_versions (modifier_id, effective_from desc);
select app.setup_table('public.modifier_versions', '{}', p_audit => false);

create table public.modifier_effects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  modifier_version_id uuid not null,
  kind text not null check (kind in ('add', 'swap')),
  size_name text check (length(size_name) <= 60),
  supply_id uuid,
  group_id uuid,
  quantity numeric,
  unit_id uuid,
  to_supply_id uuid,
  foreign key (company_id, modifier_version_id) references public.modifier_versions (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id),
  foreign key (company_id, group_id) references public.supply_groups (company_id, id),
  foreign key (company_id, to_supply_id) references public.supplies (company_id, id),
  foreign key (company_id, unit_id) references public.supply_units (company_id, id) on delete set null (unit_id),
  check ((supply_id is null) <> (group_id is null)),
  check (kind <> 'add' or (quantity is not null and quantity <> 0)),
  check (kind <> 'swap' or to_supply_id is not null)
);
create index modifier_effects_version_idx on public.modifier_effects (modifier_version_id);
select app.setup_table('public.modifier_effects', '{}', p_audit => false);

-- The recipe version in effect at a moment. Sales from before the first recipe
-- use the first one, so setting up recipes after the fact still works.
create function app.recipe_version_at(p_product_size uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.recipe_versions
      where product_size_id = p_product_size and effective_from <= p_at
      order by effective_from desc limit 1),
    (select id from public.recipe_versions
      where product_size_id = p_product_size
      order by effective_from asc limit 1)
  )
$$;

create function app.modifier_version_at(p_modifier uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.modifier_versions
      where modifier_id = p_modifier and effective_from <= p_at
      order by effective_from desc limit 1),
    (select id from public.modifier_versions
      where modifier_id = p_modifier
      order by effective_from asc limit 1)
  )
$$;

-- Saves a recipe for one product size. p_lines is a list of
-- {supply_id or group_id, quantity (in base units), unit_id (optional, for display)}.
-- Makes a new version only if something changed. Returns the version in effect.
create function public.save_recipe(p_product_size_id uuid, p_lines jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_current uuid;
  v_new uuid;
  v_same boolean;
begin
  if not exists (select 1 from public.product_sizes where id = p_product_size_id and company_id = v_company) then
    raise exception 'That product size was not found.';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' then raise exception 'Recipe lines must be a list.'; end if;

  v_current := app.recipe_version_at(p_product_size_id, now());

  -- Compare with the current version, line by line, in a fixed order.
  select coalesce(
    (select string_agg(k, ',' order by k) from (
       select coalesce(supply_id::text, '') || '|' || coalesce(group_id::text, '') || '|' || trim_scale(quantity)::text as k
       from public.recipe_lines where recipe_version_id = v_current) a), '')
    = coalesce(
    (select string_agg(k, ',' order by k) from (
       select coalesce(l ->> 'supply_id', '') || '|' || coalesce(l ->> 'group_id', '') || '|' || trim_scale((l ->> 'quantity')::numeric)::text as k
       from jsonb_array_elements(p_lines) l) b), '')
  into v_same;
  if v_current is not null and v_same then return v_current; end if;

  insert into public.recipe_versions (company_id, product_size_id, note)
  values (v_company, p_product_size_id, nullif(btrim(p_note), ''))
  returning id into v_new;

  insert into public.recipe_lines (company_id, recipe_version_id, supply_id, group_id, quantity, unit_id)
  select v_company, v_new, nullif(l ->> 'supply_id', '')::uuid, nullif(l ->> 'group_id', '')::uuid,
         (l ->> 'quantity')::numeric, nullif(l ->> 'unit_id', '')::uuid
  from jsonb_array_elements(p_lines) l;

  insert into public.audit_log (company_id, actor_id, action, table_name, row_id, new_data, reason)
  values (v_company, auth.uid(), 'recipe_saved', 'recipe_versions', v_new::text, p_lines, nullif(btrim(p_note), ''));
  return v_new;
end $$;

-- Saves what an add on does. p_effects is a list of {kind, size_name, supply_id or
-- group_id, quantity, unit_id, to_supply_id}. New version only if something changed.
create function public.save_modifier_effects(p_modifier_id uuid, p_effects jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_current uuid;
  v_new uuid;
  v_same boolean;
begin
  if not exists (select 1 from public.modifiers where id = p_modifier_id and company_id = v_company) then
    raise exception 'That add on was not found.';
  end if;
  v_current := app.modifier_version_at(p_modifier_id, now());

  select coalesce(
    (select string_agg(k, ',' order by k) from (
       select kind || '|' || coalesce(lower(size_name), '') || '|' || coalesce(supply_id::text, '') || '|'
              || coalesce(group_id::text, '') || '|' || trim_scale(coalesce(quantity, 0))::text || '|'
              || coalesce(to_supply_id::text, '') as k
       from public.modifier_effects where modifier_version_id = v_current) a), '')
    = coalesce(
    (select string_agg(k, ',' order by k) from (
       select (e ->> 'kind') || '|' || coalesce(lower(nullif(btrim(e ->> 'size_name'), '')), '') || '|'
              || coalesce(e ->> 'supply_id', '') || '|' || coalesce(e ->> 'group_id', '') || '|'
              || trim_scale(coalesce(nullif(e ->> 'quantity', '')::numeric, 0))::text || '|'
              || coalesce(e ->> 'to_supply_id', '') as k
       from jsonb_array_elements(coalesce(p_effects, '[]')) e) b), '')
  into v_same;
  if v_current is not null and v_same then return v_current; end if;

  insert into public.modifier_versions (company_id, modifier_id) values (v_company, p_modifier_id) returning id into v_new;
  insert into public.modifier_effects (company_id, modifier_version_id, kind, size_name, supply_id, group_id, quantity, unit_id, to_supply_id)
  select v_company, v_new, e ->> 'kind', nullif(btrim(e ->> 'size_name'), ''),
         nullif(e ->> 'supply_id', '')::uuid, nullif(e ->> 'group_id', '')::uuid,
         nullif(e ->> 'quantity', '')::numeric, nullif(e ->> 'unit_id', '')::uuid, nullif(e ->> 'to_supply_id', '')::uuid
  from jsonb_array_elements(coalesce(p_effects, '[]')) e;
  return v_new;
end $$;

-- What one sale of a product size (with add ons) uses, in base units, as of a moment.
-- Returns one row per supply or group.
create function app.usage_for_sale(p_product_size uuid, p_modifiers uuid[], p_at timestamptz)
returns table (supply_id uuid, group_id uuid, quantity numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_size_name text := (select lower(ps.name) from public.product_sizes ps where ps.id = p_product_size);
  -- Keys are 's:<supply id>' or 'g:<group id>', values are amounts in base units.
  v_usage jsonb;
  v_modifier uuid;
  v_key text;
  v_to text;
  v_moved numeric;
  e record;
begin
  select coalesce(jsonb_object_agg(k, q), '{}') into v_usage
  from (
    select case when l.supply_id is not null then 's:' || l.supply_id else 'g:' || l.group_id end as k,
           sum(l.quantity) as q
    from public.recipe_lines l
    where l.recipe_version_id = app.recipe_version_at(p_product_size, p_at)
    group by 1
  ) r;

  foreach v_modifier in array coalesce(p_modifiers, '{}') loop
    for e in
      select me.* from public.modifier_effects me
      where me.modifier_version_id = app.modifier_version_at(v_modifier, p_at)
        and (me.size_name is null or lower(me.size_name) = v_size_name)
      order by me.kind -- adds first, then swaps
    loop
      v_key := case when e.supply_id is not null then 's:' || e.supply_id else 'g:' || e.group_id end;
      if e.kind = 'add' then
        v_usage := jsonb_set(v_usage, array[v_key], to_jsonb(coalesce((v_usage ->> v_key)::numeric, 0) + e.quantity));
      else
        v_moved := coalesce((v_usage ->> v_key)::numeric, 0);
        if v_moved <> 0 then
          v_to := 's:' || e.to_supply_id;
          v_usage := v_usage - v_key;
          v_usage := jsonb_set(v_usage, array[v_to], to_jsonb(coalesce((v_usage ->> v_to)::numeric, 0) + v_moved));
        end if;
      end if;
    end loop;
  end loop;

  return query
    select case when left(t.k, 2) = 's:' then substr(t.k, 3)::uuid end,
           case when left(t.k, 2) = 'g:' then substr(t.k, 3)::uuid end,
           t.v::numeric
    from jsonb_each_text(v_usage) as t(k, v)
    where t.v::numeric <> 0;
end $$;

-- Defaults every new business starts with --------------------------------------------------

create function app.seed_company(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_settings (company_id) values (p_company) on conflict do nothing;

  if not exists (select 1 from public.waste_reasons where company_id = p_company) then
    insert into public.waste_reasons (company_id, name, sort)
    select p_company, r, i from unnest(array['Spilled', 'Dropped', 'Expired', 'Melted', 'Damaged', 'Made wrong', 'Other'])
      with ordinality as t(r, i);
  end if;
  if not exists (select 1 from public.free_reasons where company_id = p_company) then
    insert into public.free_reasons (company_id, name, sort)
    select p_company, r, i from unnest(array['Drop replacement', 'Giveaway or promo', 'Employee drink', 'Other'])
      with ordinality as t(r, i);
  end if;
  if not exists (select 1 from public.checklist_items where company_id = p_company) then
    insert into public.checklist_items (company_id, name, sort)
    select p_company, r, i from unnest(array['Generator fueled', 'Cash bank counted', 'Card reader charged',
                                             'Napkins and straws stocked', 'Trash bags on board'])
      with ordinality as t(r, i);
  end if;
  if not exists (select 1 from public.locations where company_id = p_company) then
    insert into public.locations (company_id, name, kind) values (p_company, 'Warehouse', 'warehouse');
  end if;
end $$;

create function app.seed_new_company() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_company(new.id);
  return null;
end $$;
create trigger companies_seed after insert on public.companies for each row execute function app.seed_new_company();

-- Businesses that signed up before this update get the same defaults.
select app.seed_company(id) from public.companies;

-- How far along setup is, for the admin's checklist.
create function public.setup_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'locations', (select count(*) from public.locations where company_id = c and active),
    'trucks', (select count(*) from public.trucks where company_id = c and active),
    'suppliers', (select count(*) from public.suppliers where company_id = c and active),
    'supplies', (select count(*) from public.supplies where company_id = c and active),
    'products', (select count(*) from public.products where company_id = c and active),
    'recipes', (select count(distinct v.product_size_id) from public.recipe_versions v where v.company_id = c),
    'people', (select count(*) from public.profiles where company_id = c)
  )
  from (select app.company_id() as c) x
  where c is not null
$$;

revoke execute on function
  app.setup_table(regclass, public.user_role[], public.user_role[], boolean, boolean),
  app.make_place(), app.remove_place(), app.check_supply_group(),
  app.seed_company(uuid), app.seed_new_company(),
  app.recipe_version_at(uuid, timestamptz), app.modifier_version_at(uuid, timestamptz),
  app.usage_for_sale(uuid, uuid[], timestamptz)
from public, anon, authenticated;
revoke execute on function app.require_role(public.user_role[]) from public, anon;
grant execute on function app.require_role(public.user_role[]) to authenticated, service_role;

revoke execute on function
  public.save_recipe(uuid, jsonb, text),
  public.save_modifier_effects(uuid, jsonb),
  public.setup_progress()
from public, anon, authenticated;
grant execute on function
  public.save_recipe(uuid, jsonb, text),
  public.save_modifier_effects(uuid, jsonb),
  public.setup_progress()
to authenticated;
