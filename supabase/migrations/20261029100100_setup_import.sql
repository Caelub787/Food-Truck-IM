-- Spreadsheet (CSV) import for supplies and products. The app reads the file,
-- checks it, shows a preview, then sends the rows here. Rows are matched by name,
-- so importing the same file twice updates instead of making copies. One bad row
-- never stops the others: each problem comes back with its row number.

create function app.num(p_value text) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return replace(replace(btrim(p_value), '$', ''), ',', '')::numeric;
exception when others then
  raise exception 'Not a number: %', p_value;
end $$;

create function app.yes(p_value text) returns boolean
language sql immutable set search_path = '' as $$
  select case when p_value is null or btrim(p_value) = '' then null
              else lower(btrim(p_value)) in ('yes', 'y', 'true', '1', 'x') end
$$;

-- Finds or makes a named row in a simple company list, returning its id.
create function app.named_id(p_table text, p_company uuid, p_name text, p_extra jsonb default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  execute format('select id from public.%I where company_id = $1 and lower(name) = lower($2)', p_table)
    into v_id using p_company, btrim(p_name);
  if v_id is null then
    if p_table = 'suppliers' then
      insert into public.suppliers (company_id, name, email) values (p_company, btrim(p_name), nullif(btrim(p_extra ->> 'email'), ''))
      returning id into v_id;
    elsif p_table = 'truck_types' then
      insert into public.truck_types (company_id, name) values (p_company, btrim(p_name)) returning id into v_id;
    elsif p_table = 'supply_groups' then
      insert into public.supply_groups (company_id, name, base_unit)
      values (p_company, btrim(p_name), coalesce(nullif(btrim(p_extra ->> 'base_unit'), ''), 'each'))
      returning id into v_id;
    else
      raise exception 'Unknown list %', p_table;
    end if;
  end if;
  return v_id;
end $$;

-- Finds or makes a unit for a supply, returning its id.
create function app.supply_unit(p_company uuid, p_supply uuid, p_name text, p_factor numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  if p_factor is null or p_factor <= 0 then
    raise exception 'The unit "%" needs a size bigger than 0.', p_name;
  end if;
  select id into v_id from public.supply_units where supply_id = p_supply and lower(name) = lower(btrim(p_name));
  if v_id is null then
    insert into public.supply_units (company_id, supply_id, name, factor)
    values (p_company, p_supply, btrim(p_name), p_factor) returning id into v_id;
  else
    update public.supply_units set factor = p_factor where id = v_id and factor <> p_factor;
  end if;
  return v_id;
end $$;

-- Rows: name, category, base_unit, count_unit, count_unit_size (base units in one),
-- purchase_unit, purchase_unit_size (count units in one, or base units if there's
-- no count unit), cost, cost_per (base | count | purchase), reorder_level and
-- order_up_to (in count units), supplier, supplier_email, truck_type, group,
-- tracks_expiration, shelf_life_days, whole_only, count_check. All values are text.
create function public.import_supplies(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  r jsonb;
  v_index integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_errors jsonb := '[]';
  v_id uuid;
  v_existing boolean;
  v_base text;
  v_count_factor numeric;
  v_purchase_factor numeric;
  v_count_unit uuid;
  v_purchase_unit uuid;
  v_cost numeric;
  v_cost_per text;
  v_cost_base numeric;
  v_group uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list.'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Please import 2,000 rows or fewer at a time.'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      if btrim(coalesce(r ->> 'name', '')) = '' then raise exception 'Name is missing.'; end if;
      select id into v_id from public.supplies where company_id = v_company and lower(name) = lower(btrim(r ->> 'name'));
      v_existing := v_id is not null;
      v_base := coalesce(nullif(btrim(r ->> 'base_unit'), ''),
                         (select base_unit from public.supplies where id = v_id), 'each');

      if v_existing then
        update public.supplies set
          category = coalesce(nullif(btrim(r ->> 'category'), ''), category),
          base_unit = v_base,
          tracks_expiration = coalesce(app.yes(r ->> 'tracks_expiration'), tracks_expiration),
          shelf_life_days = coalesce(app.num(r ->> 'shelf_life_days')::integer, shelf_life_days),
          whole_only = coalesce(app.yes(r ->> 'whole_only'), whole_only),
          count_check = coalesce(app.yes(r ->> 'count_check'), count_check),
          active = true
        where id = v_id;
      else
        insert into public.supplies (company_id, name, category, base_unit, tracks_expiration, shelf_life_days, whole_only, count_check)
        values (v_company, btrim(r ->> 'name'), nullif(btrim(r ->> 'category'), ''), v_base,
                coalesce(app.yes(r ->> 'tracks_expiration'), false), app.num(r ->> 'shelf_life_days')::integer,
                coalesce(app.yes(r ->> 'whole_only'), false), coalesce(app.yes(r ->> 'count_check'), false))
        returning id into v_id;
      end if;

      -- Units
      v_count_factor := app.num(r ->> 'count_unit_size');
      v_count_unit := app.supply_unit(v_company, v_id, r ->> 'count_unit', v_count_factor);
      v_count_factor := coalesce((select factor from public.supply_units where id = v_count_unit), 1);
      v_purchase_factor := app.num(r ->> 'purchase_unit_size');
      v_purchase_unit := app.supply_unit(v_company, v_id, r ->> 'purchase_unit', v_purchase_factor * v_count_factor);
      update public.supplies set
        count_unit_id = coalesce(v_count_unit, count_unit_id),
        purchase_unit_id = coalesce(v_purchase_unit, purchase_unit_id)
      where id = v_id;
      select coalesce(cu.factor, 1), coalesce(pu.factor, cu.factor, 1)
        into v_count_factor, v_purchase_factor
      from public.supplies s
      left join public.supply_units cu on cu.id = s.count_unit_id
      left join public.supply_units pu on pu.id = s.purchase_unit_id
      where s.id = v_id;

      -- Cost
      v_cost := app.num(r ->> 'cost');
      if v_cost is not null then
        v_cost_per := coalesce(nullif(lower(btrim(r ->> 'cost_per')), ''),
                               case when v_purchase_unit is not null then 'purchase'
                                    when v_count_unit is not null then 'count' else 'base' end);
        v_cost_base := v_cost / case v_cost_per when 'purchase' then v_purchase_factor
                                                when 'count' then v_count_factor else 1 end;
        update public.supplies set cost_per_base = v_cost_base where id = v_id;
      end if;

      -- Levels are given in count units
      update public.supplies set
        reorder_level = coalesce(app.num(r ->> 'reorder_level') * v_count_factor, reorder_level),
        order_up_to = coalesce(app.num(r ->> 'order_up_to') * v_count_factor, order_up_to),
        supplier_id = coalesce(app.named_id('suppliers', v_company, r ->> 'supplier',
                                            jsonb_build_object('email', r ->> 'supplier_email')), supplier_id),
        truck_type_id = coalesce(app.named_id('truck_types', v_company, r ->> 'truck_type'), truck_type_id)
      where id = v_id;

      v_group := app.named_id('supply_groups', v_company, r ->> 'group', jsonb_build_object('base_unit', v_base));
      if v_group is not null then
        update public.supplies set group_id = v_group where id = v_id;
      end if;

      if v_existing then v_updated := v_updated + 1; else v_created := v_created + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_index, 'name', r ->> 'name', 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'errors', v_errors);
end $$;

-- Rows (one per recipe line): product, category, truck_type, size, price, and
-- optionally supply (a supply or group name), amount, unit (one of that supply's
-- units, or its base unit). Rows for the same product and size make one recipe.
create function public.import_products(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_item record;
  r jsonb;
  v_product uuid;
  v_size uuid;
  v_created uuid[] := '{}';
  v_updated uuid[] := '{}';
  v_errors jsonb := '[]';
  v_lines jsonb;
  v_supply uuid;
  v_group uuid;
  v_factor numeric;
  v_unit uuid;
  v_base text;
  v_amount numeric;
  v_ok boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list.'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Please import 5,000 rows or fewer at a time.'; end if;

  for v_item in
    select lower(btrim(x.value ->> 'product')) as product_key,
           lower(coalesce(nullif(btrim(x.value ->> 'size'), ''), 'regular')) as size_key,
           jsonb_agg(x.value || jsonb_build_object('_row', x.ordinality) order by x.ordinality) as rows
    from jsonb_array_elements(p_rows) with ordinality x
    group by 1, 2
  loop
    begin
      r := v_item.rows -> 0;
      if coalesce(v_item.product_key, '') = '' then raise exception 'Product name is missing.'; end if;

      select id into v_product from public.products where company_id = v_company and lower(name) = v_item.product_key;
      if v_product is null then
        insert into public.products (company_id, name, category, truck_type_id)
        values (v_company, btrim(r ->> 'product'), nullif(btrim(r ->> 'category'), ''),
                app.named_id('truck_types', v_company, r ->> 'truck_type'))
        returning id into v_product;
        v_created := v_created || v_product;
      else
        update public.products set
          category = coalesce(nullif(btrim(r ->> 'category'), ''), category),
          truck_type_id = coalesce(app.named_id('truck_types', v_company, r ->> 'truck_type'), truck_type_id),
          active = true
        where id = v_product;
        if not (v_product = any (v_created || v_updated)) then v_updated := v_updated || v_product; end if;
      end if;

      select id into v_size from public.product_sizes where product_id = v_product and lower(name) = v_item.size_key;
      if v_size is null then
        insert into public.product_sizes (company_id, product_id, name, price, sort)
        values (v_company, v_product, coalesce(nullif(btrim(r ->> 'size'), ''), 'Regular'), app.num(r ->> 'price'),
                (select count(*) from public.product_sizes where product_id = v_product))
        returning id into v_size;
      elsif app.num(r ->> 'price') is not null then
        update public.product_sizes set price = app.num(r ->> 'price'), active = true where id = v_size;
      end if;

      -- Build the recipe from every row with a supply.
      v_lines := '[]';
      v_ok := true;
      for r in select * from jsonb_array_elements(v_item.rows) loop
        continue when btrim(coalesce(r ->> 'supply', '')) = '';
        begin
          v_supply := null; v_group := null; v_unit := null; v_factor := 1;
          select id, base_unit into v_supply, v_base from public.supplies
          where company_id = v_company and lower(name) = lower(btrim(r ->> 'supply'));
          if v_supply is null then
            select id, base_unit into v_group, v_base from public.supply_groups
            where company_id = v_company and lower(name) = lower(btrim(r ->> 'supply'));
          end if;
          if v_supply is null and v_group is null then
            raise exception 'No supply or group called "%". Import supplies first.', btrim(r ->> 'supply');
          end if;
          v_amount := app.num(r ->> 'amount');
          if v_amount is null or v_amount <= 0 then raise exception 'Amount must be more than 0.'; end if;
          if btrim(coalesce(r ->> 'unit', '')) <> '' and lower(btrim(r ->> 'unit')) <> lower(v_base) then
            if v_supply is null then
              raise exception 'Amounts for a group must be in its base unit (%).', v_base;
            end if;
            select id, factor into v_unit, v_factor from public.supply_units
            where supply_id = v_supply and lower(name) = lower(btrim(r ->> 'unit'));
            if v_unit is null then
              raise exception 'Supply "%" has no unit called "%".', btrim(r ->> 'supply'), btrim(r ->> 'unit');
            end if;
          end if;
          v_lines := v_lines || jsonb_build_object('supply_id', v_supply, 'group_id', v_group,
                                                   'quantity', v_amount * v_factor, 'unit_id', v_unit);
        exception when others then
          v_ok := false;
          v_errors := v_errors || jsonb_build_object('row', (r ->> '_row')::integer, 'name', r ->> 'product', 'message', sqlerrm);
        end;
      end loop;

      if v_ok and jsonb_array_length(v_lines) > 0 then
        perform public.save_recipe(v_size, v_lines, 'Imported');
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', ((v_item.rows -> 0) ->> '_row')::integer,
                                                 'name', (v_item.rows -> 0) ->> 'product', 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('created', cardinality(v_created), 'updated', cardinality(v_updated), 'errors', v_errors);
end $$;

-- Saves a supply and its units together. p has the supply's fields plus
-- units: [{id (for existing), name, factor}] and count_unit / purchase_unit
-- (unit names, or empty for the base unit). Returns the supply id.
create function public.save_supply(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  u jsonb;
begin
  if btrim(coalesce(p ->> 'name', '')) = '' then raise exception 'Please enter a name.'; end if;
  if v_id is null then
    insert into public.supplies (company_id, name, base_unit)
    values (v_company, btrim(p ->> 'name'), coalesce(nullif(btrim(p ->> 'base_unit'), ''), 'each'))
    returning id into v_id;
  elsif not exists (select 1 from public.supplies where id = v_id and company_id = v_company) then
    raise exception 'That supply was not found.';
  end if;

  update public.supplies set
    name = btrim(p ->> 'name'),
    category = nullif(btrim(p ->> 'category'), ''),
    base_unit = coalesce(nullif(btrim(p ->> 'base_unit'), ''), 'each'),
    supplier_id = nullif(p ->> 'supplier_id', '')::uuid,
    truck_type_id = nullif(p ->> 'truck_type_id', '')::uuid,
    group_id = nullif(p ->> 'group_id', '')::uuid,
    cost_per_base = coalesce(nullif(p ->> 'cost_per_base', '')::numeric, 0),
    reorder_level = nullif(p ->> 'reorder_level', '')::numeric,
    order_up_to = nullif(p ->> 'order_up_to', '')::numeric,
    whole_only = coalesce((p ->> 'whole_only')::boolean, false),
    tracks_expiration = coalesce((p ->> 'tracks_expiration')::boolean, false),
    shelf_life_days = nullif(p ->> 'shelf_life_days', '')::integer,
    count_check = coalesce((p ->> 'count_check')::boolean, false),
    diff_percent = nullif(p ->> 'diff_percent', '')::numeric,
    diff_min_qty = nullif(p ->> 'diff_min_qty', '')::numeric,
    notes = nullif(btrim(p ->> 'notes'), ''),
    active = coalesce((p ->> 'active')::boolean, true),
    count_unit_id = null,
    purchase_unit_id = null
  where id = v_id;

  -- Units that were removed, then changed ones, then new ones.
  delete from public.supply_units
  where supply_id = v_id
    and id <> all (array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p -> 'units', '[]')) x
                         where nullif(x ->> 'id', '') is not null));
  for u in select * from jsonb_array_elements(coalesce(p -> 'units', '[]')) loop
    if btrim(coalesce(u ->> 'name', '')) = '' then raise exception 'Every unit needs a name.'; end if;
    if coalesce((u ->> 'factor')::numeric, 0) <= 0 then
      raise exception 'The unit "%" needs a size bigger than 0.', u ->> 'name';
    end if;
    if nullif(u ->> 'id', '') is not null then
      update public.supply_units set name = btrim(u ->> 'name'), factor = (u ->> 'factor')::numeric
      where id = (u ->> 'id')::uuid and supply_id = v_id;
    else
      insert into public.supply_units (company_id, supply_id, name, factor)
      values (v_company, v_id, btrim(u ->> 'name'), (u ->> 'factor')::numeric);
    end if;
  end loop;

  update public.supplies set
    count_unit_id = (select id from public.supply_units where supply_id = v_id and lower(name) = lower(btrim(p ->> 'count_unit'))),
    purchase_unit_id = (select id from public.supply_units where supply_id = v_id and lower(name) = lower(btrim(p ->> 'purchase_unit')))
  where id = v_id;
  return v_id;
end $$;

revoke execute on function
  app.num(text), app.yes(text), app.named_id(text, uuid, text, jsonb), app.supply_unit(uuid, uuid, text, numeric)
from public, anon, authenticated;
revoke execute on function public.import_supplies(jsonb), public.import_products(jsonb), public.save_supply(jsonb) from public, anon, authenticated;
grant execute on function public.import_supplies(jsonb), public.import_products(jsonb), public.save_supply(jsonb) to authenticated;
