-- Phase 6: sales from every source (driver and manager tallies, spreadsheet
-- files, and later Square), free drinks, item matching that's remembered,
-- file uploads that can be undone, manager count checks, and comparing the
-- usage sales say there should be (expected) with what was really used (actual).

-- Matching outside names (from a file, later Square) to the business's own things.
-- Keys are lowercased and trimmed, so "LG LATTE " and "lg latte" are the same.
create table public.item_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  source text not null check (source in ('csv', 'square')),
  kind text not null check (kind in ('item', 'modifier', 'truck')),
  outside_key text not null check (length(outside_key) between 1 and 300),
  outside_name text check (length(outside_name) <= 300),
  product_size_id uuid,
  modifier_id uuid,
  truck_id uuid,
  ignore boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (company_id, source, kind, outside_key),
  foreign key (company_id, product_size_id) references public.product_sizes (company_id, id) on delete cascade,
  foreign key (company_id, modifier_id) references public.modifiers (company_id, id) on delete cascade,
  foreign key (company_id, truck_id) references public.trucks (company_id, id) on delete cascade,
  check (
    ignore
    or (kind = 'item' and product_size_id is not null)
    or (kind = 'modifier' and modifier_id is not null)
    or (kind = 'truck' and truck_id is not null)
  )
);
select app.setup_table('public.item_mappings', '{admin,manager}', '{admin,manager}');

-- Which column is which, remembered for each kind of file (known by its column names).
create table public.sales_file_formats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  headers_key text not null check (length(headers_key) <= 4000),
  columns jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (company_id, headers_key)
);
select app.setup_table('public.sales_file_formats', '{admin,manager}', '{admin,manager}', p_audit => false);

-- Each uploaded file. Its sales can be undone together.
create table public.sales_imports (
  id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('csv', 'square')),
  file_name text check (length(file_name) <= 200),
  rows_added integer not null default 0,
  rows_duplicate integer not null default 0,
  rows_ignored integer not null default 0,
  rows_unmatched integer not null default 0,
  rows_no_shift integer not null default 0,
  unmatched_names text[] not null default '{}',
  undone_at timestamptz,
  undone_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index sales_imports_company_idx on public.sales_imports (company_id, created_at desc);
select app.setup_table('public.sales_imports', '{}', '{admin,manager}', p_audit => false);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  truck_id uuid not null,
  shift_id uuid,
  sold_at timestamptz not null,
  product_size_id uuid not null,
  modifier_ids uuid[] not null default '{}',
  quantity numeric not null check (quantity > 0),
  -- What the whole line brought in, after discounts. Free drinks are 0.
  price numeric not null default 0,
  is_free boolean not null default false,
  free_reason_id uuid,
  source text not null check (source in ('driver', 'manager', 'csv', 'square')),
  -- The source's own id for this sale, so the same sale is never counted twice.
  source_ref text not null check (length(source_ref) <= 300),
  outside_name text check (length(outside_name) <= 300),
  import_id uuid,
  client_ts timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, source, source_ref),
  foreign key (company_id, truck_id) references public.trucks (company_id, id),
  foreign key (company_id, shift_id) references public.shifts (company_id, id),
  foreign key (company_id, product_size_id) references public.product_sizes (company_id, id),
  foreign key (company_id, free_reason_id) references public.free_reasons (company_id, id),
  foreign key (company_id, import_id) references public.sales_imports (company_id, id)
);
create index sales_shift_idx on public.sales (shift_id) where shift_id is not null;
create index sales_company_idx on public.sales (company_id, sold_at desc);
create index sales_import_idx on public.sales (import_id) where import_id is not null;
alter table public.sales enable row level security;
create policy sales_select on public.sales for select to authenticated
  using (company_id = (select app.company_id())
         and ((select app.role()) in ('admin', 'manager') or (shift_id is not null and app.on_shift(shift_id))));
revoke all on public.sales from anon, authenticated;
grant select on public.sales to authenticated;
grant all on public.sales to service_role;
select app.enable_live('public.sales');

-- Helpers ----------------------------------------------------------------------------------

-- Files and Square both count as "file" when picking which source wins.
create function app.sale_group(p_source text) returns text
language sql immutable set search_path = '' as $$
  select case when p_source in ('csv', 'square') then 'file' else p_source end
$$;

-- "12 oz", or just "12" for things counted one by one.
create function app.amount_text(p_qty numeric, p_unit text) returns text
language sql immutable set search_path = '' as $$
  select case when lower(p_unit) in ('each', 'ea', 'pcs') then trim_scale(round(p_qty, 2))::text
              else trim_scale(round(p_qty, 2))::text || ' ' || p_unit end
$$;

-- The shift on a truck whose time covers a sale (with 30 minutes either side).
create function app.shift_at(p_company uuid, p_truck uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.shifts
  where company_id = p_company and truck_id = p_truck and status <> 'cancelled'
    and started_at - interval '30 minutes' <= p_at
    and p_at <= coalesce(ended_at, now()) + interval '30 minutes'
  order by started_at desc
  limit 1
$$;

-- Comparing expected and actual ---------------------------------------------------------------

-- Fills in expected usage from the winning sales source, the difference, and
-- flags for a finished shift. Safe to run again any time (new sales, a count
-- check, a recipe fix for future shifts never changes old ones).
create function app.compare_shift(p_shift uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts;
  st public.company_settings;
  v_truck text;
  v_win text;
  v_usage jsonb;
  v_diff numeric;
  v_pct numeric;
  v_dollars numeric := 0;
  v_flagged text[] := '{}';
  v_mismatch text[] := '{}';
  v_reason text;
  v_over boolean;
  res record;
  src record;
begin
  select * into s from public.shifts where id = p_shift;
  if s.status <> 'closed' then return; end if;
  select * into st from public.company_settings where company_id = s.company_id;
  v_truck := (select name from public.trucks where id = s.truck_id);

  update public.shift_results set expected_qty = null, diff_qty = null, flagged = false, flag_reason = null
  where shift_id = p_shift;

  -- The first source in the business's order that has sales for this shift.
  select o.g into v_win
  from unnest(st.sales_source_order) with ordinality as o(g, n)
  where exists (select 1 from public.sales sa where sa.shift_id = p_shift and app.sale_group(sa.source) = o.g)
  order by o.n
  limit 1;

  if v_win is null then
    -- No sales: show actual usage only and skip the comparison.
    perform app.clear_flag(s.company_id, 'usage_diff:' || p_shift);
    perform app.clear_flag(s.company_id, 'shift_cost:' || p_shift);
    perform app.clear_flag(s.company_id, 'sales_mismatch:' || p_shift);
    return;
  end if;

  -- Expected usage, keyed 's:<supply>' or 'g:<group>', in base units.
  select coalesce(jsonb_object_agg(k, q), '{}') into v_usage
  from (
    select case when x.supply_id is not null then 's:' || x.supply_id else 'g:' || x.group_id end as k,
           sum(x.quantity * sa.quantity) as q
    from public.sales sa
    cross join lateral app.usage_for_sale(sa.product_size_id, sa.modifier_ids, sa.sold_at) x
    where sa.shift_id = p_shift and app.sale_group(sa.source) = v_win
    group by 1
  ) u;

  -- Groups that recipes use as a whole are compared on the group total. Their
  -- members aren't compared one by one (sales can't say which flavor was used).
  update public.shift_results r
     set expected_qty = coalesce((v_usage ->> ('g:' || r.group_id))::numeric, 0)
       + coalesce((select sum((v_usage ->> ('s:' || sp.id))::numeric) from public.supplies sp where sp.group_id = r.group_id), 0)
   where r.shift_id = p_shift and r.group_id is not null
     and (exists (select 1 from public.recipe_lines l where l.group_id = r.group_id)
          or exists (select 1 from public.modifier_effects e where e.group_id = r.group_id));

  -- Supplies that recipes or add ons use, and that aren't compared as part of a group.
  update public.shift_results r
     set expected_qty = coalesce((v_usage ->> ('s:' || r.supply_id))::numeric, 0)
    from public.supplies sp
   where r.shift_id = p_shift and r.supply_id = sp.id
     and (exists (select 1 from public.recipe_lines l where l.supply_id = r.supply_id)
          or exists (select 1 from public.modifier_effects e where e.supply_id = r.supply_id or e.to_supply_id = r.supply_id))
     and not (sp.group_id is not null
              and (exists (select 1 from public.recipe_lines l where l.group_id = sp.group_id)
                   or exists (select 1 from public.modifier_effects e where e.group_id = sp.group_id)));

  for res in
    select r.*, coalesce(sp.name, gr.name) as name, coalesce(sp.base_unit, gr.base_unit) as unit,
           sp.diff_percent as own_pct, sp.diff_min_qty as own_min
    from public.shift_results r
    left join public.supplies sp on sp.id = r.supply_id
    left join public.supply_groups gr on gr.id = r.group_id
    where r.shift_id = p_shift and r.expected_qty is not null
  loop
    v_diff := res.actual_qty - res.expected_qty;
    v_pct := case when res.expected_qty = 0 then null else abs(v_diff) / res.expected_qty * 100 end;
    -- Over the percent limit AND over the minimum (an amount for the supply, or dollars).
    v_over := abs(v_diff) > 0.0001
      and (v_pct is null or v_pct >= coalesce(res.own_pct, st.diff_percent))
      and (case when res.own_min is not null then abs(v_diff) >= res.own_min
                else abs(v_diff) * res.unit_cost >= st.diff_min_dollars end);
    v_reason := null;
    if v_over then
      v_reason := format('%s: used %s %s than sales show%s', res.name, app.amount_text(abs(v_diff), res.unit),
                         case when v_diff > 0 then 'more' else 'less' end,
                         case when v_pct is null then '' else format(' (%s%%)', round(v_pct)) end);
      v_flagged := v_flagged || v_reason;
    end if;
    update public.shift_results set diff_qty = v_diff, flagged = v_over, flag_reason = v_reason where id = res.id;
    v_dollars := v_dollars + abs(v_diff) * res.unit_cost;
  end loop;

  if cardinality(v_flagged) > 0 then
    perform app.raise_flag(s.company_id, 'usage_diff', format('%s used different amounts than sales show', v_truck),
      array_to_string(v_flagged, '. ') || '.', 'usage_diff:' || p_shift,
      jsonb_build_object('truck_id', s.truck_id, 'shift_id', s.id, 'user_id', s.lead_id));
  else
    perform app.clear_flag(s.company_id, 'usage_diff:' || p_shift);
  end if;

  if v_dollars > st.shift_dollar_limit then
    perform app.raise_flag(s.company_id, 'shift_cost', format('%s is off by $%s in supplies', v_truck, to_char(v_dollars, 'FM999990.00')),
      format('Supplies used and sales are $%s apart on this shift. The limit is $%s.',
             to_char(v_dollars, 'FM999990.00'), to_char(st.shift_dollar_limit, 'FM999990.00')),
      'shift_cost:' || p_shift, jsonb_build_object('truck_id', s.truck_id, 'shift_id', s.id, 'user_id', s.lead_id), 'alert');
  else
    perform app.clear_flag(s.company_id, 'shift_cost:' || p_shift);
  end if;

  -- Every other source is compared with the winner, drink by drink.
  for src in
    select distinct app.sale_group(sa.source) as grp from public.sales sa
    where sa.shift_id = p_shift and app.sale_group(sa.source) <> v_win
  loop
    if exists (
      select 1 from (
        select sa.product_size_id, sa.is_free,
               sum(case when app.sale_group(sa.source) = v_win then sa.quantity else 0 end) as a,
               sum(case when app.sale_group(sa.source) = src.grp then sa.quantity else 0 end) as b
        from public.sales sa
        where sa.shift_id = p_shift and app.sale_group(sa.source) in (v_win, src.grp)
        group by 1, 2
      ) t where t.a <> t.b
    ) then
      v_mismatch := v_mismatch || format('%s: %s drinks (%s free). %s: %s drinks (%s free)',
        case v_win when 'file' then 'Sales file' else initcap(v_win) end,
        trim_scale((select sum(quantity) from public.sales where shift_id = p_shift and app.sale_group(source) = v_win)),
        trim_scale((select coalesce(sum(quantity), 0) from public.sales where shift_id = p_shift and app.sale_group(source) = v_win and is_free)),
        case src.grp when 'file' then 'Sales file' else initcap(src.grp) end,
        trim_scale((select sum(quantity) from public.sales where shift_id = p_shift and app.sale_group(source) = src.grp)),
        trim_scale((select coalesce(sum(quantity), 0) from public.sales where shift_id = p_shift and app.sale_group(source) = src.grp and is_free)));
    end if;
  end loop;
  if cardinality(v_mismatch) > 0 then
    perform app.raise_flag(s.company_id, 'sales_mismatch', format('Sales on %s don''t match', v_truck),
      array_to_string(v_mismatch, '. ') || '.', 'sales_mismatch:' || p_shift,
      jsonb_build_object('truck_id', s.truck_id, 'shift_id', s.id, 'user_id', s.lead_id));
  else
    perform app.clear_flag(s.company_id, 'sales_mismatch:' || p_shift);
  end if;
end $$;

-- Closing a shift now compares it with its sales.
create or replace function app.after_shift_closed(p_shift uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.compare_shift(p_shift);
end $$;

-- Tallies: drivers and managers counting drinks on a shift ------------------------------------

-- p: {shift_id, lines: [{key, product_size_id, modifier_ids, quantity, is_free, free_reason_id, client_ts}]}
-- Each line is one kind of drink (size, add ons, paid or free). A quantity of
-- 0 or null removes the line. The latest change wins, like counts.
create function public.save_sales_tally(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(nullif(p ->> 'shift_id', '')::uuid, false, false);
  v_role public.user_role := app.role();
  v_reporters text := (select sales_reporters from public.company_settings where company_id = s.company_id);
  v_source text := case when v_role = 'driver' then 'driver' else 'manager' end;
  l jsonb;
  v_ts timestamptz;
  v_size uuid;
  v_mods uuid[];
  v_free boolean;
  v_qty numeric;
  v_unit_price numeric;
begin
  if s.status = 'cancelled' then raise exception 'This shift was cancelled.'; end if;
  if v_role = 'driver' then
    if v_reporters not in ('drivers', 'both') then
      raise exception 'Your business has managers report sales.' using errcode = '42501';
    end if;
    if s.status <> 'open' then raise exception 'This shift is already finished.'; end if;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    if btrim(coalesce(l ->> 'key', '')) = '' or length(l ->> 'key') > 200 then raise exception 'Each drink needs a key.'; end if;
    v_ts := coalesce(nullif(l ->> 'client_ts', '')::timestamptz, now());
    v_qty := nullif(l ->> 'quantity', '')::numeric;
    if coalesce(v_qty, 0) <= 0 then
      delete from public.sales
      where company_id = s.company_id and source = v_source and source_ref = s.id || ':' || (l ->> 'key') and client_ts <= v_ts;
      continue;
    end if;
    v_size := nullif(l ->> 'product_size_id', '')::uuid;
    v_mods := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(l -> 'modifier_ids', '[]')) x), '{}');
    v_free := coalesce((l ->> 'is_free')::boolean, false);
    select ps.price into v_unit_price from public.product_sizes ps where ps.id = v_size and ps.company_id = s.company_id;
    if not found then raise exception 'That drink was not found.'; end if;
    if exists (select 1 from unnest(v_mods) m where not exists (select 1 from public.modifiers x where x.id = m and x.company_id = s.company_id)) then
      raise exception 'That add on was not found.';
    end if;
    v_unit_price := coalesce(v_unit_price, 0) + coalesce((select sum(price) from public.modifiers where id = any (v_mods)), 0);

    insert into public.sales (company_id, truck_id, shift_id, sold_at, product_size_id, modifier_ids, quantity, price,
                              is_free, free_reason_id, source, source_ref, client_ts)
    values (s.company_id, s.truck_id, s.id, s.started_at, v_size, v_mods, v_qty,
            case when v_free then 0 else v_qty * v_unit_price end,
            v_free, case when v_free then nullif(l ->> 'free_reason_id', '')::uuid end,
            v_source, s.id || ':' || (l ->> 'key'), v_ts)
    on conflict (company_id, source, source_ref) do update
      set quantity = excluded.quantity, price = excluded.price, product_size_id = excluded.product_size_id,
          modifier_ids = excluded.modifier_ids, is_free = excluded.is_free, free_reason_id = excluded.free_reason_id,
          client_ts = excluded.client_ts, created_by = auth.uid()
      where public.sales.client_ts <= excluded.client_ts;
  end loop;

  if s.status = 'closed' then perform app.compare_shift(s.id); end if;
end $$;

-- Files (and later Square) --------------------------------------------------------------------

-- Saves sales from outside the app. Used by the upload screen now, and by the
-- Square sync later (with source 'square'). Rows carry the outside names, and
-- remembered matches turn them into the business's drinks, add ons, and trucks.
-- p: {import_id, file_name, truck_id (for rows without one),
--     rows: [{ref, sold_at or sold_local ('2026-10-28 14:05'), truck_id or truck_key,
--             item_key, item_name, modifier_keys: [], quantity, price, is_free}]}
create function app.ingest_sales(p_company uuid, p_source text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_import uuid := coalesce(nullif(p ->> 'import_id', '')::uuid, gen_random_uuid());
  v_tz text := (select timezone from public.companies where id = p_company);
  v_added integer := 0;
  v_dupes integer := 0;
  v_ignored integer := 0;
  v_unmatched integer := 0;
  v_no_shift integer := 0;
  v_names text[] := '{}';
  v_shifts uuid[] := '{}';
  v_truck uuid;
  v_size uuid;
  v_mods uuid[];
  v_mod uuid;
  v_at timestamptz;
  v_shift uuid;
  v_key text;
  m public.item_mappings;
  row_ jsonb;
begin
  insert into public.sales_imports (id, company_id, source, file_name)
  values (v_import, p_company, p_source, nullif(btrim(p ->> 'file_name'), ''))
  on conflict (id) do nothing;
  if not exists (select 1 from public.sales_imports where id = v_import and company_id = p_company and undone_at is null) then
    raise exception 'That upload was not found.';
  end if;

  for row_ in select * from jsonb_array_elements(coalesce(p -> 'rows', '[]')) loop
    if btrim(coalesce(row_ ->> 'ref', '')) = '' then raise exception 'Every sale needs an id.'; end if;

    -- Which truck.
    v_truck := nullif(row_ ->> 'truck_id', '')::uuid;
    if v_truck is null and nullif(btrim(row_ ->> 'truck_key'), '') is not null then
      select truck_id into v_truck from public.item_mappings
      where company_id = p_company and source = p_source and kind = 'truck' and outside_key = lower(btrim(row_ ->> 'truck_key'));
    end if;
    v_truck := coalesce(v_truck, nullif(p ->> 'truck_id', '')::uuid);
    if v_truck is null or not exists (select 1 from public.trucks where id = v_truck and company_id = p_company) then
      v_unmatched := v_unmatched + 1;
      v_names := v_names || coalesce('Truck: ' || nullif(btrim(row_ ->> 'truck_key'), ''), 'No truck');
      continue;
    end if;

    -- Which drink.
    v_size := null;
    v_key := lower(btrim(coalesce(row_ ->> 'item_key', '')));
    select * into m from public.item_mappings
    where company_id = p_company and source = p_source and kind = 'item' and outside_key = v_key;
    if found and m.ignore then
      v_ignored := v_ignored + 1;
      continue;
    end if;
    v_size := m.product_size_id;
    if v_size is null then
      v_unmatched := v_unmatched + 1;
      v_names := v_names || coalesce(nullif(btrim(row_ ->> 'item_name'), ''), v_key);
      continue;
    end if;

    -- Add ons. Ones that aren't matched yet are left off and reported.
    v_mods := '{}';
    for v_key in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(row_ -> 'modifier_keys', '[]')) x loop
      continue when v_key = '';
      select * into m from public.item_mappings
      where company_id = p_company and source = p_source and kind = 'modifier' and outside_key = v_key;
      if not found then
        v_names := v_names || ('Add on: ' || v_key);
      elsif not m.ignore then
        v_mods := v_mods || m.modifier_id;
      end if;
    end loop;

    v_at := coalesce(nullif(row_ ->> 'sold_at', '')::timestamptz, (nullif(row_ ->> 'sold_local', '')::timestamp at time zone v_tz));
    if v_at is null then raise exception 'Every sale needs a date and time.'; end if;
    v_shift := app.shift_at(p_company, v_truck, v_at);
    if v_shift is null then v_no_shift := v_no_shift + 1; end if;

    insert into public.sales (company_id, truck_id, shift_id, sold_at, product_size_id, modifier_ids, quantity, price,
                              is_free, source, source_ref, outside_name, import_id)
    values (p_company, v_truck, v_shift, v_at, v_size, v_mods, greatest(coalesce(nullif(row_ ->> 'quantity', '')::numeric, 1), 0.001),
            coalesce(nullif(row_ ->> 'price', '')::numeric, 0), coalesce((row_ ->> 'is_free')::boolean, false),
            p_source, btrim(row_ ->> 'ref'), left(row_ ->> 'item_name', 300), v_import)
    on conflict (company_id, source, source_ref) do nothing;
    if found then
      v_added := v_added + 1;
      if v_shift is not null and not v_shift = any (v_shifts) then v_shifts := v_shifts || v_shift; end if;
    else
      v_dupes := v_dupes + 1;
    end if;
  end loop;

  v_names := array(select distinct x from unnest(v_names) x order by 1);
  update public.sales_imports
     set rows_added = rows_added + v_added, rows_duplicate = rows_duplicate + v_dupes, rows_ignored = rows_ignored + v_ignored,
         rows_unmatched = rows_unmatched + v_unmatched, rows_no_shift = rows_no_shift + v_no_shift,
         unmatched_names = array(select distinct x from unnest(unmatched_names || v_names) x order by 1)
   where id = v_import;

  for v_shift in select unnest(v_shifts) loop
    perform app.compare_shift(v_shift);
  end loop;

  if v_no_shift > 0 then
    perform app.raise_flag(p_company, 'sales_no_shift', 'Some sales aren''t on any shift',
      format('%s sales from %s didn''t match a shift on that truck. Check the truck and times, or start shifts for those days.',
             v_no_shift, coalesce(nullif(btrim(p ->> 'file_name'), ''), 'an upload')),
      'sales_no_shift:' || v_import, jsonb_build_object('data', jsonb_build_object('import_id', v_import)));
  end if;

  return jsonb_build_object('import_id', v_import, 'added', v_added, 'duplicates', v_dupes, 'ignored', v_ignored,
                            'unmatched', v_unmatched, 'no_shift', v_no_shift, 'unmatched_names', to_jsonb(v_names));
end $$;

-- p: the same as app.ingest_sales, plus mappings: [{kind, outside_key, outside_name,
-- product_size_id, modifier_id, truck_id, ignore}] to remember first.
create function public.ingest_sales(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  m jsonb;
begin
  for m in select * from jsonb_array_elements(coalesce(p -> 'mappings', '[]')) loop
    if btrim(coalesce(m ->> 'outside_key', '')) = '' then continue; end if;
    insert into public.item_mappings (company_id, source, kind, outside_key, outside_name, product_size_id, modifier_id, truck_id, ignore)
    values (v_company, 'csv', m ->> 'kind', lower(btrim(m ->> 'outside_key')), left(m ->> 'outside_name', 300),
            nullif(m ->> 'product_size_id', '')::uuid, nullif(m ->> 'modifier_id', '')::uuid, nullif(m ->> 'truck_id', '')::uuid,
            coalesce((m ->> 'ignore')::boolean, false))
    on conflict (company_id, source, kind, outside_key) do update
      set outside_name = excluded.outside_name, product_size_id = excluded.product_size_id, modifier_id = excluded.modifier_id,
          truck_id = excluded.truck_id, ignore = excluded.ignore, updated_at = now();
  end loop;
  return app.ingest_sales(v_company, 'csv', p);
end $$;

-- Undo a whole upload: its sales are removed and its shifts compared again.
create function public.undo_sales_import(p_import_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_shifts uuid[];
  v_count integer;
  v_shift uuid;
begin
  if not exists (select 1 from public.sales_imports where id = p_import_id and company_id = v_company and undone_at is null) then
    raise exception 'That upload was not found, or it was already undone.';
  end if;
  select array_agg(distinct shift_id) filter (where shift_id is not null) into v_shifts from public.sales where import_id = p_import_id;
  delete from public.sales where import_id = p_import_id and company_id = v_company;
  get diagnostics v_count = row_count;
  update public.sales_imports set undone_at = now(), undone_by = auth.uid() where id = p_import_id;
  perform app.clear_flag(v_company, 'sales_no_shift:' || p_import_id);
  for v_shift in select unnest(coalesce(v_shifts, '{}')) loop
    perform app.compare_shift(v_shift);
  end loop;
  return v_count;
end $$;

-- Manager count checks --------------------------------------------------------------------------

-- p: {shift_id, lines: [{supply_id, quantity (base units)}]}
-- A manager counts certain supplies (like cups) after a shift. Their count is
-- compared with the driver's, and (by default) replaces it. The truck's stock
-- is corrected to match.
create function public.record_count_check(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  s public.shifts;
  st public.company_settings;
  l jsonb;
  v_supply uuid;
  v_qty numeric;
  v_driver numeric;
  v_off text[] := '{}';
  v_old jsonb;
  v_delta numeric;
  r record;
begin
  select * into s from public.shifts where id = nullif(p ->> 'shift_id', '')::uuid and company_id = v_company;
  if not found then raise exception 'That shift was not found.'; end if;
  select * into st from public.company_settings where company_id = v_company;
  if s.status <> 'closed' then raise exception 'Count checks happen after the shift is finished.'; end if;
  if s.count_check_status = 'missed'
     or exists (select 1 from public.shifts x where x.truck_id = s.truck_id and x.started_at > s.ended_at and x.status <> 'cancelled') then
    raise exception 'A new shift already started on this truck, so it''s too late to check this one.';
  end if;

  -- What the results said before, to correct the truck's stock by the difference.
  select coalesce(jsonb_object_agg(supply_id, end_qty), '{}') into v_old
  from public.shift_results where shift_id = s.id and supply_id is not null;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    v_supply := nullif(l ->> 'supply_id', '')::uuid;
    v_qty := nullif(l ->> 'quantity', '')::numeric;
    if v_qty is null then continue; end if;
    if v_qty < 0 then raise exception 'Counts can''t be below zero.'; end if;
    if not exists (select 1 from public.supplies where id = v_supply and company_id = v_company) then
      raise exception 'That supply was not found.';
    end if;
    insert into public.shift_counts (company_id, shift_id, supply_id, kind, quantity)
    values (v_company, s.id, v_supply, 'check', v_qty)
    on conflict (shift_id, supply_id, kind) do update
      set quantity = excluded.quantity, entered_by = auth.uid(), entered_at = now(), client_ts = now();
    v_driver := (select quantity from public.shift_counts where shift_id = s.id and supply_id = v_supply and kind = 'end');
    if v_driver is distinct from v_qty then
      v_off := v_off || format('%s: driver counted %s, manager counted %s',
        (select name from public.supplies where id = v_supply),
        coalesce(app.amount_text(v_driver, (select base_unit from public.supplies where id = v_supply)), 'nothing'),
        app.amount_text(v_qty, (select base_unit from public.supplies where id = v_supply)));
    end if;
  end loop;

  update public.shifts set count_check_status = 'done' where id = s.id;

  if st.count_check_manager_wins then
    perform app.compute_shift_results(s.id);
    for r in select supply_id, end_qty from public.shift_results where shift_id = s.id and supply_id is not null loop
      v_delta := r.end_qty - coalesce((v_old ->> r.supply_id::text)::numeric, r.end_qty);
      if v_delta > 0 then
        perform app.move_stock(v_company, r.supply_id, v_delta, null, s.truck_id, 'correction',
          jsonb_build_object('shift_id', s.id, 'reason', 'Manager count check'));
      elsif v_delta < 0 then
        perform app.move_stock(v_company, r.supply_id, -v_delta, s.truck_id, null, 'correction',
          jsonb_build_object('shift_id', s.id, 'reason', 'Manager count check'));
      end if;
    end loop;
  end if;
  perform app.compare_shift(s.id);

  if cardinality(v_off) > 0 then
    perform app.raise_flag(v_company, 'count_check', format('Count check on %s didn''t match', (select name from public.trucks where id = s.truck_id)),
      array_to_string(v_off, '. ') || '.', 'count_check:' || s.id,
      jsonb_build_object('truck_id', s.truck_id, 'shift_id', s.id, 'user_id', s.lead_id));
  else
    perform app.clear_flag(v_company, 'count_check:' || s.id);
  end if;
end $$;

-- When a truck goes out again, a count check still waiting on its last shift is missed.
create function app.mark_missed_checks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    update public.shifts set count_check_status = 'missed'
    where truck_id = new.truck_id and count_check_status = 'waiting' and id <> new.id
    returning id, company_id, truck_id, lead_id
  loop
    perform app.raise_flag(r.company_id, 'count_check_missed',
      format('Count check missed on %s', (select name from public.trucks where id = r.truck_id)),
      'The truck went out again before a manager counted it.', 'count_check_missed:' || r.id,
      jsonb_build_object('truck_id', r.truck_id, 'shift_id', r.id, 'user_id', r.lead_id));
  end loop;
  return new;
end $$;
create trigger shifts_missed_checks after insert on public.shifts for each row execute function app.mark_missed_checks();

-- Grants --------------------------------------------------------------------------------------

revoke execute on function
  app.sale_group(text), app.amount_text(numeric, text), app.shift_at(uuid, uuid, timestamptz),
  app.compare_shift(uuid), app.ingest_sales(uuid, text, jsonb), app.mark_missed_checks()
from public, anon, authenticated;
revoke execute on function
  public.save_sales_tally(jsonb), public.ingest_sales(jsonb), public.undo_sales_import(uuid), public.record_count_check(jsonb)
from public, anon, authenticated;
grant execute on function
  public.save_sales_tally(jsonb), public.ingest_sales(jsonb), public.undo_sales_import(uuid), public.record_count_check(jsonb)
to authenticated;
