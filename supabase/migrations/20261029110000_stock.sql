-- Phase 3: stock. One log of every stock change, current levels per place,
-- expiration batches, deliveries, counts, moves, and adjustments.
--
-- Rule: stock levels are never changed directly. Everything goes through
-- app.move_stock(), which writes the log row and updates the levels (and
-- batches) in the same step.

-- Requests from phones carry an id made on the phone. If the same request
-- arrives twice (bad signal, a retry), the second one gets the first one's
-- result instead of doing the work again.
create table public.client_requests (
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (company_id, client_id)
);
alter table public.client_requests enable row level security;
revoke all on public.client_requests from anon, authenticated;
grant all on public.client_requests to service_role;

-- Returns the earlier result if this request was already done, else marks it
-- as started and returns null.
create function app.claim_request(p_company uuid, p_client_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if p_client_id is null then return null; end if;
  insert into public.client_requests (company_id, client_id) values (p_company, p_client_id) on conflict do nothing;
  if found then return null; end if;
  select coalesce(result, '{"done": true}') into v_result from public.client_requests where company_id = p_company and client_id = p_client_id;
  return v_result;
end $$;

create function app.finish_request(p_company uuid, p_client_id uuid, p_result jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  update public.client_requests set result = p_result where company_id = p_company and client_id = p_client_id;
  select p_result;
$$;

-- Current stock --------------------------------------------------------------------

create table public.stock_levels (
  company_id uuid not null references public.companies (id) on delete cascade,
  place_id uuid not null,
  supply_id uuid not null,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (place_id, supply_id),
  foreign key (company_id, place_id) references public.places (company_id, id),
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);
create index stock_levels_company_idx on public.stock_levels (company_id);
select app.setup_table('public.stock_levels', '{}', p_audit => false);

create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  place_id uuid not null,
  supply_id uuid not null,
  expires_on date,
  received_on date not null default current_date,
  quantity numeric not null check (quantity >= 0),
  created_at timestamptz not null default now(),
  unique nulls not distinct (place_id, supply_id, expires_on, received_on),
  foreign key (company_id, place_id) references public.places (company_id, id),
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);
create index stock_batches_expiry_idx on public.stock_batches (company_id, expires_on) where quantity > 0;
select app.setup_table('public.stock_batches', '{}', p_audit => false);

-- The log --------------------------------------------------------------------------

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  location_id uuid not null,
  supplier_id uuid,
  purchase_order_id uuid,
  note text check (length(note) <= 1000),
  total_cost numeric not null default 0,
  received_by uuid default auth.uid(),
  received_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, location_id) references public.locations (company_id, id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id)
);
create index deliveries_company_idx on public.deliveries (company_id, received_at desc);
select app.setup_table('public.deliveries', '{}', '{admin,manager}', p_audit => false);

create table public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  delivery_id uuid not null,
  supply_id uuid not null,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric,
  unit_id uuid,
  expires_on date,
  foreign key (company_id, delivery_id) references public.deliveries (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);
create index delivery_lines_delivery_idx on public.delivery_lines (delivery_id);
select app.setup_table('public.delivery_lines', '{}', '{admin,manager}', p_audit => false);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  place_id uuid not null,
  note text check (length(note) <= 1000),
  counted_by uuid default auth.uid(),
  counted_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, place_id) references public.places (company_id, id)
);
create index stock_counts_company_idx on public.stock_counts (company_id, counted_at desc);
select app.setup_table('public.stock_counts', '{}', '{admin,manager}', p_audit => false);

create table public.stock_count_lines (
  company_id uuid not null references public.companies (id) on delete cascade,
  count_id uuid not null,
  supply_id uuid not null,
  expected numeric not null,
  counted numeric not null check (counted >= 0),
  primary key (count_id, supply_id),
  foreign key (company_id, count_id) references public.stock_counts (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);
select app.setup_table('public.stock_count_lines', '{}', '{admin,manager}', p_audit => false);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  supply_id uuid not null,
  quantity numeric not null check (quantity > 0),
  kind text not null check (kind in ('delivery', 'load', 'return', 'waste', 'usage', 'transfer', 'adjustment', 'correction')),
  from_place_id uuid,
  to_place_id uuid,
  unit_cost numeric not null default 0,
  shift_id uuid,
  delivery_id uuid,
  count_id uuid,
  waste_log_id uuid,
  reason text check (length(reason) <= 200),
  note text check (length(note) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (from_place_id is not null or to_place_id is not null),
  check (from_place_id is distinct from to_place_id),
  foreign key (company_id, supply_id) references public.supplies (company_id, id),
  foreign key (company_id, from_place_id) references public.places (company_id, id),
  foreign key (company_id, to_place_id) references public.places (company_id, id),
  foreign key (company_id, delivery_id) references public.deliveries (company_id, id),
  foreign key (company_id, count_id) references public.stock_counts (company_id, id)
);
create index stock_movements_company_idx on public.stock_movements (company_id, created_at desc);
create index stock_movements_supply_idx on public.stock_movements (supply_id, created_at desc);
create index stock_movements_from_idx on public.stock_movements (from_place_id, created_at desc);
create index stock_movements_to_idx on public.stock_movements (to_place_id, created_at desc);
select app.setup_table('public.stock_movements', '{}', '{admin,manager}', p_audit => false);

-- Moving stock ---------------------------------------------------------------------

-- Moves an amount (in base units) of a supply. p_from null means it came in from
-- outside (a delivery, a count that found more). p_to null means it left (usage,
-- waste, a count that found less). p_extra can hold shift_id, delivery_id,
-- count_id, waste_log_id, reason, note, expires_on, and unit_cost.
create function app.move_stock(
  p_company uuid,
  p_supply uuid,
  p_quantity numeric,
  p_from uuid,
  p_to uuid,
  p_kind text,
  p_extra jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_cost numeric;
  v_tracks boolean;
  v_left numeric;
  v_take numeric;
  b record;
begin
  if p_quantity is null or p_quantity = 0 then return null; end if;
  if p_quantity < 0 then raise exception 'Amounts must be more than 0.'; end if;
  select cost_per_base, tracks_expiration into v_cost, v_tracks
  from public.supplies where id = p_supply and company_id = p_company;
  if not found then raise exception 'That supply was not found.'; end if;

  insert into public.stock_movements (
    company_id, supply_id, quantity, kind, from_place_id, to_place_id, unit_cost,
    shift_id, delivery_id, count_id, waste_log_id, reason, note)
  values (
    p_company, p_supply, p_quantity, p_kind, p_from, p_to,
    coalesce(nullif(p_extra ->> 'unit_cost', '')::numeric, v_cost),
    nullif(p_extra ->> 'shift_id', '')::uuid, nullif(p_extra ->> 'delivery_id', '')::uuid,
    nullif(p_extra ->> 'count_id', '')::uuid, nullif(p_extra ->> 'waste_log_id', '')::uuid,
    nullif(btrim(p_extra ->> 'reason'), ''), nullif(btrim(p_extra ->> 'note'), ''))
  returning id into v_id;

  if p_from is not null then
    insert into public.stock_levels (company_id, place_id, supply_id, quantity)
    values (p_company, p_from, p_supply, -p_quantity)
    on conflict (place_id, supply_id) do update
      set quantity = public.stock_levels.quantity - p_quantity, updated_at = now();
  end if;
  if p_to is not null then
    insert into public.stock_levels (company_id, place_id, supply_id, quantity)
    values (p_company, p_to, p_supply, p_quantity)
    on conflict (place_id, supply_id) do update
      set quantity = public.stock_levels.quantity + p_quantity, updated_at = now();
  end if;

  -- Expiration batches: things coming in start a batch, things moving out
  -- come from the oldest batches first.
  if v_tracks then
    if p_from is null then
      insert into public.stock_batches (company_id, place_id, supply_id, expires_on, quantity)
      values (p_company, p_to, p_supply, nullif(p_extra ->> 'expires_on', '')::date, p_quantity)
      on conflict (place_id, supply_id, expires_on, received_on) do update
        set quantity = public.stock_batches.quantity + excluded.quantity;
    else
      v_left := p_quantity;
      for b in
        select * from public.stock_batches
        where place_id = p_from and supply_id = p_supply and quantity > 0
        order by expires_on nulls last, received_on, created_at
        for update
      loop
        exit when v_left <= 0;
        v_take := least(b.quantity, v_left);
        update public.stock_batches set quantity = quantity - v_take where id = b.id;
        if p_to is not null then
          insert into public.stock_batches (company_id, place_id, supply_id, expires_on, received_on, quantity)
          values (p_company, p_to, p_supply, b.expires_on, b.received_on, v_take)
          on conflict (place_id, supply_id, expires_on, received_on) do update
            set quantity = public.stock_batches.quantity + excluded.quantity;
        end if;
        v_left := v_left - v_take;
      end loop;
      -- If the batches ran out (counts were off), the rest moves without a date.
      if v_left > 0 and p_to is not null then
        insert into public.stock_batches (company_id, place_id, supply_id, expires_on, quantity)
        values (p_company, p_to, p_supply, null, v_left)
        on conflict (place_id, supply_id, expires_on, received_on) do update
          set quantity = public.stock_batches.quantity + excluded.quantity;
      end if;
      delete from public.stock_batches where place_id = p_from and supply_id = p_supply and quantity <= 0;
    end if;
  end if;

  return v_id;
end $$;

-- Sets a place's stock of a supply to a counted amount by logging the difference.
create function app.set_count(p_company uuid, p_place uuid, p_supply uuid, p_counted numeric, p_kind text, p_extra jsonb default '{}')
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_current numeric;
  v_diff numeric;
begin
  if p_counted is null or p_counted < 0 then raise exception 'Counts can''t be below zero.'; end if;
  select coalesce((select quantity from public.stock_levels where place_id = p_place and supply_id = p_supply), 0) into v_current;
  v_diff := p_counted - v_current;
  if v_diff > 0 then
    perform app.move_stock(p_company, p_supply, v_diff, null, p_place, p_kind, p_extra);
  elsif v_diff < 0 then
    perform app.move_stock(p_company, p_supply, -v_diff, p_place, null, p_kind, p_extra);
  end if;
  return v_current;
end $$;

create function app.place_kind(p_company uuid, p_place uuid) returns text
language sql stable security definer set search_path = '' as $$
  select kind from public.places where id = p_place and company_id = p_company
$$;

-- Things people do ------------------------------------------------------------------

-- p: {location_id, supplier_id, purchase_order_id, note, client_id,
--     lines: [{supply_id, quantity (base units), unit_id, unit_cost (per base, optional), expires_on}]}
-- A cost on a line also becomes the supply's current cost.
create function public.receive_delivery(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_earlier jsonb := app.claim_request(v_company, nullif(p ->> 'client_id', '')::uuid);
  v_id uuid;
  v_location uuid := nullif(p ->> 'location_id', '')::uuid;
  l jsonb;
  v_cost numeric;
  v_total numeric := 0;
begin
  if v_earlier is not null then return (v_earlier ->> 'id')::uuid; end if;
  if app.place_kind(v_company, v_location) is distinct from 'location' then
    raise exception 'Pick where the delivery came in.';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'Add at least one thing that came in.'; end if;

  insert into public.deliveries (company_id, location_id, supplier_id, purchase_order_id, note)
  values (v_company, v_location, nullif(p ->> 'supplier_id', '')::uuid, nullif(p ->> 'purchase_order_id', '')::uuid,
          nullif(btrim(p ->> 'note'), ''))
  returning id into v_id;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    continue when coalesce((l ->> 'quantity')::numeric, 0) <= 0;
    if not exists (select 1 from public.supplies where id = (l ->> 'supply_id')::uuid and company_id = v_company) then
      raise exception 'That supply was not found.';
    end if;
    v_cost := nullif(l ->> 'unit_cost', '')::numeric;
    insert into public.delivery_lines (company_id, delivery_id, supply_id, quantity, unit_cost, unit_id, expires_on)
    values (v_company, v_id, (l ->> 'supply_id')::uuid, (l ->> 'quantity')::numeric, v_cost,
            nullif(l ->> 'unit_id', '')::uuid, nullif(l ->> 'expires_on', '')::date);
    if v_cost is not null then
      update public.supplies set cost_per_base = v_cost where id = (l ->> 'supply_id')::uuid and company_id = v_company;
    end if;
    perform app.move_stock(v_company, (l ->> 'supply_id')::uuid, (l ->> 'quantity')::numeric, null, v_location, 'delivery',
      jsonb_build_object('delivery_id', v_id, 'expires_on', l ->> 'expires_on', 'unit_cost', v_cost));
    v_total := v_total + (l ->> 'quantity')::numeric
      * coalesce(v_cost, (select cost_per_base from public.supplies where id = (l ->> 'supply_id')::uuid));
  end loop;
  update public.deliveries set total_cost = v_total where id = v_id;

  perform app.finish_request(v_company, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('id', v_id));
  return v_id;
end $$;

-- p: {place_id, note, client_id, lines: [{supply_id, counted (base units)}]}
-- Sets stock to what was counted and logs every difference as an adjustment.
create function public.record_count(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_earlier jsonb := app.claim_request(v_company, nullif(p ->> 'client_id', '')::uuid);
  v_place uuid := nullif(p ->> 'place_id', '')::uuid;
  v_id uuid;
  l jsonb;
  v_expected numeric;
begin
  if v_earlier is not null then return (v_earlier ->> 'id')::uuid; end if;
  if app.place_kind(v_company, v_place) is null then raise exception 'Pick where you counted.'; end if;
  insert into public.stock_counts (company_id, place_id, note) values (v_company, v_place, nullif(btrim(p ->> 'note'), ''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when nullif(l ->> 'counted', '') is null;
    v_expected := app.set_count(v_company, v_place, (l ->> 'supply_id')::uuid, (l ->> 'counted')::numeric, 'adjustment',
      jsonb_build_object('count_id', v_id, 'reason', 'Count'));
    insert into public.stock_count_lines (company_id, count_id, supply_id, expected, counted)
    values (v_company, v_id, (l ->> 'supply_id')::uuid, v_expected, (l ->> 'counted')::numeric);
  end loop;
  perform app.finish_request(v_company, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('id', v_id));
  return v_id;
end $$;

-- p: {from_place_id, to_place_id, note, client_id, lines: [{supply_id, quantity (base units)}]}
create function public.transfer_stock(p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_earlier jsonb := app.claim_request(v_company, nullif(p ->> 'client_id', '')::uuid);
  v_from uuid := nullif(p ->> 'from_place_id', '')::uuid;
  v_to uuid := nullif(p ->> 'to_place_id', '')::uuid;
  v_from_kind text := app.place_kind(v_company, v_from);
  v_to_kind text := app.place_kind(v_company, v_to);
  v_kind text;
  v_count integer := 0;
  l jsonb;
begin
  if v_earlier is not null then return (v_earlier ->> 'count')::integer; end if;
  if v_from_kind is null or v_to_kind is null then raise exception 'Pick where it''s moving from and to.'; end if;
  if v_from = v_to then raise exception 'Pick two different places.'; end if;
  v_kind := case when v_to_kind = 'truck' and v_from_kind = 'location' then 'load'
                 when v_from_kind = 'truck' and v_to_kind = 'location' then 'return'
                 else 'transfer' end;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce(nullif(l ->> 'quantity', '')::numeric, 0) <= 0;
    perform app.move_stock(v_company, (l ->> 'supply_id')::uuid, (l ->> 'quantity')::numeric, v_from, v_to, v_kind,
      jsonb_build_object('note', p ->> 'note'));
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'Add at least one amount to move.'; end if;
  perform app.finish_request(v_company, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('count', v_count));
  return v_count;
end $$;

-- Adds (positive) or takes away (negative) stock at a place, with a reason.
create function public.adjust_stock(p_place_id uuid, p_supply_id uuid, p_quantity numeric, p_reason text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
begin
  if app.place_kind(v_company, p_place_id) is null then raise exception 'That place was not found.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Please give a reason.'; end if;
  if p_quantity > 0 then
    return app.move_stock(v_company, p_supply_id, p_quantity, null, p_place_id, 'adjustment',
      jsonb_build_object('reason', p_reason, 'note', p_note));
  elsif p_quantity < 0 then
    return app.move_stock(v_company, p_supply_id, -p_quantity, p_place_id, null, 'adjustment',
      jsonb_build_object('reason', p_reason, 'note', p_note));
  end if;
  return null;
end $$;

-- Fixes the expiration date on a batch.
create function public.set_batch_expiration(p_batch_id uuid, p_expires_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  b public.stock_batches;
begin
  select * into b from public.stock_batches where id = p_batch_id and company_id = v_company;
  if not found then raise exception 'That batch was not found.'; end if;
  if b.expires_on is not distinct from p_expires_on then return; end if;
  -- Merge into a matching batch if there is one.
  if exists (select 1 from public.stock_batches where place_id = b.place_id and supply_id = b.supply_id
               and expires_on is not distinct from p_expires_on and received_on = b.received_on) then
    update public.stock_batches set quantity = quantity + b.quantity
    where place_id = b.place_id and supply_id = b.supply_id and expires_on is not distinct from p_expires_on and received_on = b.received_on;
    delete from public.stock_batches where id = b.id;
  else
    update public.stock_batches set expires_on = p_expires_on where id = b.id;
  end if;
end $$;

revoke execute on function
  app.claim_request(uuid, uuid), app.finish_request(uuid, uuid, jsonb),
  app.move_stock(uuid, uuid, numeric, uuid, uuid, text, jsonb),
  app.set_count(uuid, uuid, uuid, numeric, text, jsonb),
  app.place_kind(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.receive_delivery(jsonb), public.record_count(jsonb), public.transfer_stock(jsonb),
  public.adjust_stock(uuid, uuid, numeric, text, text), public.set_batch_expiration(uuid, date)
from public, anon, authenticated;
grant execute on function
  public.receive_delivery(jsonb), public.record_count(jsonb), public.transfer_stock(jsonb),
  public.adjust_stock(uuid, uuid, numeric, text, text), public.set_batch_expiration(uuid, date)
to authenticated;
