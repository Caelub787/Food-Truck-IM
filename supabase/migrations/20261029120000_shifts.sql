-- Phases 4 and 5: par levels, shifts with a Lead and crew, counts, loading,
-- returns, the loading checklist, waste (supplies or whole drinks, with an
-- optional photo), finishing a shift with the usage math, saved results, and
-- flags for managers.
--
-- Usage math (see CLAUDE.md):
--   actual = starting count + added during the shift - ending count - waste
--   added  = loads - returns made before the end count was confirmed

-- Par levels: how much of each supply a truck should leave with -----------------

create table public.truck_pars (
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  truck_id uuid not null,
  supply_id uuid not null,
  par_quantity numeric not null check (par_quantity >= 0),
  low_quantity numeric check (low_quantity >= 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (truck_id, supply_id),
  foreign key (company_id, truck_id) references public.trucks (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id) on delete cascade
);
select app.setup_table('public.truck_pars');

-- Flags: things a manager should look at -----------------------------------------------

create table public.flags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'alert')),
  title text not null,
  details text,
  data jsonb not null default '{}',
  truck_id uuid,
  shift_id uuid,
  supply_id uuid,
  user_id uuid,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);
create index flags_open_idx on public.flags (company_id, created_at desc) where status = 'open';
select app.setup_table('public.flags', '{}', '{admin,manager}', p_audit => false);

-- Adds a flag, or refreshes it if the same thing was already flagged.
create function app.raise_flag(
  p_company uuid, p_kind text, p_title text, p_details text, p_dedupe text,
  p_extra jsonb default '{}', p_severity text default 'warning'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.flags (company_id, kind, severity, title, details, data, truck_id, shift_id, supply_id, user_id, dedupe_key)
  values (p_company, p_kind, p_severity, p_title, p_details, coalesce(p_extra -> 'data', '{}'),
          nullif(p_extra ->> 'truck_id', '')::uuid, nullif(p_extra ->> 'shift_id', '')::uuid,
          nullif(p_extra ->> 'supply_id', '')::uuid, nullif(p_extra ->> 'user_id', '')::uuid, p_dedupe)
  on conflict (company_id, dedupe_key) do update
    set title = excluded.title, details = excluded.details, data = excluded.data, severity = excluded.severity,
        status = 'open', reviewed_by = null, reviewed_at = null, review_note = null, created_at = now()
  returning id into v_id;
  return v_id;
end $$;

create function app.clear_flag(p_company uuid, p_dedupe text) returns void
language sql security definer set search_path = '' as $$
  delete from public.flags where company_id = p_company and dedupe_key = p_dedupe and status = 'open'
$$;

create function public.review_flag(p_flag_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
begin
  update public.flags
     set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
   where id = p_flag_id and company_id = v_company;
  if not found then raise exception 'That flag was not found.'; end if;
end $$;

-- Shifts ---------------------------------------------------------------------------------

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  truck_id uuid not null,
  lead_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  business_date date not null,
  event_name text check (length(event_name) <= 120),
  notes text check (length(notes) <= 2000),
  schedule_id uuid,
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  start_confirmed_at timestamptz,
  start_confirmed_by uuid,
  checklist_done_at timestamptz,
  end_confirmed_at timestamptz,
  end_confirmed_by uuid,
  ended_at timestamptz,
  closed_by uuid,
  count_check_status text not null default 'not_needed'
    check (count_check_status in ('not_needed', 'waiting', 'done', 'missed')),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, truck_id) references public.trucks (company_id, id),
  foreign key (company_id, lead_id) references public.profiles (company_id, user_id)
);
create unique index shifts_one_open_per_truck on public.shifts (truck_id) where status = 'open';
create index shifts_company_idx on public.shifts (company_id, started_at desc);

create table public.shift_crew (
  company_id uuid not null references public.companies (id) on delete cascade,
  shift_id uuid not null,
  user_id uuid not null,
  role text not null default 'crew' check (role in ('lead', 'crew')),
  added_at timestamptz not null default now(),
  primary key (shift_id, user_id),
  foreign key (company_id, shift_id) references public.shifts (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.profiles (company_id, user_id)
);
create index shift_crew_user_idx on public.shift_crew (user_id);

-- Is the logged in person on this shift's crew?
create function app.on_shift(p_shift uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shift_crew where shift_id = p_shift and user_id = (select auth.uid()))
$$;

-- Managers see every shift. Drivers only see shifts they worked on.
create function app.can_see_shift(p_company uuid, p_shift uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_company = (select app.company_id())
     and ((select app.role()) in ('admin', 'manager') or app.on_shift(p_shift))
$$;

alter table public.shifts enable row level security;
create policy shifts_select on public.shifts for select to authenticated using (app.can_see_shift(company_id, id));
alter table public.shift_crew enable row level security;
create policy shift_crew_select on public.shift_crew for select to authenticated using (app.can_see_shift(company_id, shift_id));
revoke all on public.shifts, public.shift_crew from anon, authenticated;
grant select on public.shifts, public.shift_crew to authenticated;
grant all on public.shifts, public.shift_crew to service_role;
create trigger shifts_touch before update on public.shifts for each row execute function app.touch_updated_at();
create trigger shifts_audit after insert or update or delete on public.shifts for each row execute function app.audit();
select app.enable_live('public.shifts');
select app.enable_live('public.shift_crew');

create table public.shift_counts (
  company_id uuid not null references public.companies (id) on delete cascade,
  shift_id uuid not null,
  supply_id uuid not null,
  kind text not null check (kind in ('start', 'end', 'check')),
  quantity numeric not null check (quantity >= 0),
  expected numeric,
  photo_path text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  client_ts timestamptz not null default now(),
  primary key (shift_id, supply_id, kind),
  foreign key (company_id, shift_id) references public.shifts (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);
alter table public.shift_counts enable row level security;
create policy shift_counts_select on public.shift_counts for select to authenticated using (app.can_see_shift(company_id, shift_id));

create table public.shift_checklist (
  company_id uuid not null references public.companies (id) on delete cascade,
  shift_id uuid not null,
  item_id uuid not null,
  checked_by uuid default auth.uid(),
  checked_at timestamptz not null default now(),
  primary key (shift_id, item_id),
  foreign key (company_id, shift_id) references public.shifts (company_id, id) on delete cascade,
  foreign key (company_id, item_id) references public.checklist_items (company_id, id) on delete cascade
);
alter table public.shift_checklist enable row level security;
create policy shift_checklist_select on public.shift_checklist for select to authenticated using (app.can_see_shift(company_id, shift_id));

-- Saved results for each supply (and supply group) on a finished shift.
create table public.shift_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  shift_id uuid not null,
  supply_id uuid,
  group_id uuid,
  start_qty numeric not null default 0,
  added_qty numeric not null default 0,
  end_qty numeric not null default 0,
  waste_qty numeric not null default 0,
  actual_qty numeric not null default 0,
  expected_qty numeric,
  diff_qty numeric,
  unit_cost numeric not null default 0,
  flagged boolean not null default false,
  flag_reason text,
  unique nulls not distinct (shift_id, supply_id, group_id),
  foreign key (company_id, shift_id) references public.shifts (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id),
  foreign key (company_id, group_id) references public.supply_groups (company_id, id),
  check ((supply_id is null) <> (group_id is null))
);
create index shift_results_shift_idx on public.shift_results (shift_id);
alter table public.shift_results enable row level security;
create policy shift_results_select on public.shift_results for select to authenticated using (app.can_see_shift(company_id, shift_id));

revoke all on public.shift_counts, public.shift_checklist, public.shift_results from anon, authenticated;
grant select on public.shift_counts, public.shift_checklist, public.shift_results to authenticated;
grant all on public.shift_counts, public.shift_checklist, public.shift_results to service_role;
select app.enable_live('public.shift_counts');
select app.enable_live('public.shift_checklist');
select app.enable_live('public.shift_results');

alter table public.stock_movements
  add foreign key (company_id, shift_id) references public.shifts (company_id, id);
create index stock_movements_shift_idx on public.stock_movements (shift_id) where shift_id is not null;
-- Drivers can see the stock moves of shifts they're on (what got loaded, wasted, used).
create policy stock_movements_shift_select on public.stock_movements for select to authenticated
  using (shift_id is not null and company_id = (select app.company_id()) and app.on_shift(shift_id));

-- Waste ------------------------------------------------------------------------------

create table public.waste_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  place_id uuid not null,
  shift_id uuid,
  supply_id uuid,
  product_size_id uuid,
  modifier_ids uuid[] not null default '{}',
  quantity numeric not null check (quantity > 0),
  reason_id uuid,
  note text check (length(note) <= 1000),
  photo_path text,
  cost numeric not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, place_id) references public.places (company_id, id),
  foreign key (company_id, shift_id) references public.shifts (company_id, id),
  foreign key (company_id, supply_id) references public.supplies (company_id, id),
  foreign key (company_id, product_size_id) references public.product_sizes (company_id, id),
  foreign key (company_id, reason_id) references public.waste_reasons (company_id, id),
  check ((supply_id is null) <> (product_size_id is null))
);
create index waste_logs_company_idx on public.waste_logs (company_id, created_at desc);
create index waste_logs_shift_idx on public.waste_logs (shift_id) where shift_id is not null;

-- What a waste log took out, one line per supply (or group, for drinks that use one).
create table public.waste_lines (
  company_id uuid not null references public.companies (id) on delete cascade,
  waste_log_id uuid not null,
  supply_id uuid,
  group_id uuid,
  quantity numeric not null,
  cost numeric not null default 0,
  foreign key (company_id, waste_log_id) references public.waste_logs (company_id, id) on delete cascade,
  check ((supply_id is null) <> (group_id is null))
);
create index waste_lines_log_idx on public.waste_lines (waste_log_id);

alter table public.waste_logs enable row level security;
create policy waste_logs_select on public.waste_logs for select to authenticated
  using (company_id = (select app.company_id())
         and ((select app.role()) in ('admin', 'manager') or (shift_id is not null and app.on_shift(shift_id))));
alter table public.waste_lines enable row level security;
create policy waste_lines_select on public.waste_lines for select to authenticated
  using (exists (select 1 from public.waste_logs w where w.id = waste_log_id));
revoke all on public.waste_logs, public.waste_lines from anon, authenticated;
grant select on public.waste_logs, public.waste_lines to authenticated;
grant all on public.waste_logs, public.waste_lines to service_role;
select app.enable_live('public.waste_logs');
select app.enable_live('public.waste_lines');

alter table public.stock_movements
  add foreign key (company_id, waste_log_id) references public.waste_logs (company_id, id);

-- Who may do what on a shift -------------------------------------------------------------------

-- Returns the shift if the caller may work on it. Managers always may. Drivers
-- must be on the crew. p_lead means only the Lead (or a manager) may do this.
create function app.shift_for(p_shift uuid, p_lead boolean default false, p_open boolean default true)
returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.company_id();
  v_role public.user_role := app.role();
  s public.shifts;
begin
  if v_company is null then raise exception 'You do not have access to do this.' using errcode = '42501'; end if;
  select * into s from public.shifts where id = p_shift and company_id = v_company;
  if not found then raise exception 'That shift was not found.'; end if;
  if v_role not in ('admin', 'manager') then
    if not app.on_shift(p_shift) then raise exception 'You''re not on this shift.' using errcode = '42501'; end if;
    if p_lead and s.lead_id <> auth.uid() then
      raise exception 'Only the Lead can do this.' using errcode = '42501';
    end if;
  end if;
  if p_open and s.status <> 'open' then raise exception 'This shift is already finished.'; end if;
  return s;
end $$;

-- Stock moves onto or off the truck while the shift was going (after the
-- starting count and up to the ending count). Waste and usage aren't included.
create function app.shift_moves(p_shift uuid)
returns table (supply_id uuid, kind text, quantity numeric)
language sql stable security definer set search_path = '' as $$
  select m.supply_id, m.kind, case when m.to_place_id = s.truck_id then m.quantity else -m.quantity end
  from public.shifts s
  join public.stock_movements m on m.company_id = s.company_id
   and (m.to_place_id = s.truck_id or m.from_place_id = s.truck_id)
  where s.id = p_shift
    and s.start_confirmed_at is not null
    and m.kind not in ('waste', 'usage')
    and m.created_at > s.start_confirmed_at
    and m.created_at <= coalesce(s.end_confirmed_at, 'infinity')
$$;

-- Supplies that matter on this shift: anything on the truck, counted, moved, or with a par level.
create function app.shift_supplies(p_shift uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.shifts where id = p_shift)
  select l.supply_id from public.stock_levels l, s where l.place_id = s.truck_id and l.quantity <> 0
  union select c.supply_id from public.shift_counts c where c.shift_id = p_shift
  union select m.supply_id from public.stock_movements m where m.shift_id = p_shift
  union select x.supply_id from app.shift_moves(p_shift) x
  union select p.supply_id from public.truck_pars p, s where p.truck_id = s.truck_id and p.par_quantity > 0
$$;

-- Trucks with a shift going, so anyone can see where to join.
create function public.open_shifts()
returns table (shift_id uuid, truck_id uuid, lead_id uuid, started_at timestamptz, start_confirmed boolean)
language sql stable security definer set search_path = '' as $$
  select id, truck_id, lead_id, started_at, start_confirmed_at is not null
  from public.shifts
  where company_id = app.require_role('admin', 'manager', 'driver') and status = 'open'
  order by started_at
$$;

-- Starting and joining ---------------------------------------------------------------------

-- p: {truck_id, lead_id (defaults to you), crew_ids, event_name, schedule_id, client_id}
create function public.start_shift(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager', 'driver');
  v_earlier jsonb := app.claim_request(v_company, nullif(p ->> 'client_id', '')::uuid);
  v_truck uuid := nullif(p ->> 'truck_id', '')::uuid;
  v_lead uuid := coalesce(nullif(p ->> 'lead_id', '')::uuid, auth.uid());
  v_tz text := (select timezone from public.companies where id = v_company);
  v_id uuid;
  v_open uuid;
  v_member uuid;
begin
  if v_earlier is not null then return (v_earlier ->> 'id')::uuid; end if;
  if not exists (select 1 from public.trucks where id = v_truck and company_id = v_company and active) then
    raise exception 'Pick a truck.';
  end if;
  select id into v_open from public.shifts where truck_id = v_truck and status = 'open';
  if v_open is not null then
    raise exception 'This truck already has a shift going. Join it instead.' using hint = v_open::text;
  end if;
  if not exists (select 1 from public.profiles where user_id = v_lead and company_id = v_company and active) then
    raise exception 'The Lead must be someone in your business.';
  end if;

  insert into public.shifts (company_id, truck_id, lead_id, business_date, event_name, schedule_id)
  values (v_company, v_truck, v_lead, (now() at time zone v_tz)::date, nullif(btrim(p ->> 'event_name'), ''),
          nullif(p ->> 'schedule_id', '')::uuid)
  returning id into v_id;

  insert into public.shift_crew (company_id, shift_id, user_id, role) values (v_company, v_id, v_lead, 'lead');
  -- A driver who starts a shift is always on it. A manager starting one for
  -- others isn't, unless they put themselves on it.
  for v_member in
    select distinct x::uuid from jsonb_array_elements_text(coalesce(p -> 'crew_ids', '[]')) x
    union select auth.uid() where app.role() = 'driver'
  loop
    continue when v_member = v_lead;
    if not exists (select 1 from public.profiles where user_id = v_member and company_id = v_company and active) then
      raise exception 'Everyone on the crew must be someone in your business.';
    end if;
    insert into public.shift_crew (company_id, shift_id, user_id, role) values (v_company, v_id, v_member, 'crew')
    on conflict do nothing;
  end loop;

  perform app.finish_request(v_company, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('id', v_id));
  return v_id;
end $$;

-- Adds yourself to a shift that's already going.
create function public.join_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager', 'driver');
begin
  if not exists (select 1 from public.shifts where id = p_shift_id and company_id = v_company and status = 'open') then
    raise exception 'That shift isn''t going anymore.';
  end if;
  insert into public.shift_crew (company_id, shift_id, user_id, role) values (v_company, p_shift_id, auth.uid(), 'crew')
  on conflict do nothing;
end $$;

-- Changes who's on the shift and who leads it. The Lead or a manager can do this.
create function public.set_shift_crew(p_shift_id uuid, p_lead_id uuid, p_crew_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id, true);
  v_member uuid;
begin
  if not exists (select 1 from public.profiles where user_id = p_lead_id and company_id = s.company_id and active) then
    raise exception 'The Lead must be someone in your business.';
  end if;
  delete from public.shift_crew where shift_id = s.id and user_id <> all (array_append(coalesce(p_crew_ids, '{}'), p_lead_id));
  update public.shift_crew set role = 'crew' where shift_id = s.id;
  insert into public.shift_crew (company_id, shift_id, user_id, role) values (s.company_id, s.id, p_lead_id, 'lead')
  on conflict (shift_id, user_id) do update set role = 'lead';
  foreach v_member in array coalesce(p_crew_ids, '{}') loop
    continue when v_member = p_lead_id;
    if not exists (select 1 from public.profiles where user_id = v_member and company_id = s.company_id and active) then
      raise exception 'Everyone on the crew must be someone in your business.';
    end if;
    insert into public.shift_crew (company_id, shift_id, user_id, role) values (s.company_id, s.id, v_member, 'crew')
    on conflict do nothing;
  end loop;
  update public.shifts set lead_id = p_lead_id where id = s.id;
end $$;

-- Cancels a shift that hasn't really started (nothing counted or moved yet).
create function public.cancel_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id, true);
begin
  if s.start_confirmed_at is not null then
    raise exception 'This shift already started. Finish it instead.';
  end if;
  update public.shifts set status = 'cancelled', ended_at = now(), closed_by = auth.uid() where id = s.id;
end $$;

-- Counts -----------------------------------------------------------------------------------

-- p: {shift_id, kind (start | end), lines: [{supply_id, quantity (base units, or null to clear), client_ts, photo_path}]}
-- Anyone on the shift can count. If two phones change the same line, the
-- latest change (by the phone's clock) wins.
create function public.save_shift_counts(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(nullif(p ->> 'shift_id', '')::uuid);
  v_kind text := p ->> 'kind';
  l jsonb;
  v_ts timestamptz;
begin
  if v_kind not in ('start', 'end') then raise exception 'Unknown count.'; end if;
  if v_kind = 'start' and s.start_confirmed_at is not null then
    raise exception 'The starting count is already confirmed.';
  end if;
  if v_kind = 'end' and s.start_confirmed_at is null then raise exception 'Confirm the starting count first.'; end if;
  if v_kind = 'end' and s.end_confirmed_at is not null then raise exception 'The ending count is already confirmed.'; end if;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    if not exists (select 1 from public.supplies where id = (l ->> 'supply_id')::uuid and company_id = s.company_id) then
      raise exception 'That supply was not found.';
    end if;
    if nullif(l ->> 'photo_path', '') is not null and split_part(l ->> 'photo_path', '/', 1) <> s.company_id::text then
      raise exception 'That photo was not found.';
    end if;
    v_ts := coalesce(nullif(l ->> 'client_ts', '')::timestamptz, now());
    if nullif(l ->> 'quantity', '') is null then
      delete from public.shift_counts
      where shift_id = s.id and supply_id = (l ->> 'supply_id')::uuid and kind = v_kind and client_ts <= v_ts;
    else
      insert into public.shift_counts (company_id, shift_id, supply_id, kind, quantity, photo_path, client_ts)
      values (s.company_id, s.id, (l ->> 'supply_id')::uuid, v_kind, (l ->> 'quantity')::numeric,
              nullif(l ->> 'photo_path', ''), v_ts)
      on conflict (shift_id, supply_id, kind) do update
        set quantity = excluded.quantity,
            photo_path = coalesce(excluded.photo_path, public.shift_counts.photo_path),
            entered_by = auth.uid(), entered_at = now(), client_ts = excluded.client_ts
        where public.shift_counts.client_ts <= excluded.client_ts;
    end if;
  end loop;
end $$;

-- The Lead confirms the starting count. Anything not counted is taken as what
-- the app expected. Differences fix the truck's stock and get flagged.
create function public.confirm_shift_start(p_shift_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id, true);
  v_supply uuid;
  v_expected numeric;
  v_counted numeric;
  v_off text[] := '{}';
  v_name text;
  v_truck text := (select name from public.trucks where id = s.truck_id);
begin
  if s.start_confirmed_at is not null then return; end if;
  for v_supply in select * from app.shift_supplies(s.id) loop
    v_expected := coalesce((select quantity from public.stock_levels where place_id = s.truck_id and supply_id = v_supply), 0);
    select quantity into v_counted from public.shift_counts where shift_id = s.id and supply_id = v_supply and kind = 'start';
    if not found then
      v_counted := greatest(v_expected, 0);
      insert into public.shift_counts (company_id, shift_id, supply_id, kind, quantity, expected)
      values (s.company_id, s.id, v_supply, 'start', v_counted, v_expected);
    else
      update public.shift_counts set expected = v_expected where shift_id = s.id and supply_id = v_supply and kind = 'start';
    end if;
    if abs(v_counted - v_expected) > 0.0001 then
      perform app.set_count(s.company_id, s.truck_id, v_supply, v_counted, 'adjustment',
        jsonb_build_object('shift_id', s.id, 'reason', 'Starting count'));
      select name into v_name from public.supplies where id = v_supply;
      v_off := v_off || v_name;
    end if;
  end loop;

  update public.shifts set start_confirmed_at = now(), start_confirmed_by = auth.uid() where id = s.id;

  if cardinality(v_off) > 0 then
    perform app.raise_flag(s.company_id, 'start_mismatch',
      format('Starting count on %s didn''t match', v_truck),
      format('These were different from what the app had on the truck: %s.', array_to_string(v_off, ', ')),
      'start_mismatch:' || s.id,
      jsonb_build_object('truck_id', s.truck_id, 'shift_id', s.id, 'user_id', s.lead_id,
                         'data', jsonb_build_object('supplies', to_jsonb(v_off))));
  end if;
end $$;

-- Loading and returns ------------------------------------------------------------------------

-- p: {shift_id, location_id (defaults to the truck's home), lines: [{supply_id, quantity}], client_id}
create function public.load_truck(p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(nullif(p ->> 'shift_id', '')::uuid);
  v_earlier jsonb := app.claim_request(s.company_id, nullif(p ->> 'client_id', '')::uuid);
  v_from uuid;
  v_count integer := 0;
  l jsonb;
begin
  if v_earlier is not null then return (v_earlier ->> 'count')::integer; end if;
  if s.start_confirmed_at is null then raise exception 'Confirm the starting count before loading.'; end if;
  if s.end_confirmed_at is not null then raise exception 'The ending count is done. Use Move stock to load for the next shift.'; end if;
  v_from := coalesce(nullif(p ->> 'location_id', '')::uuid, (select home_location_id from public.trucks where id = s.truck_id),
                     (select id from public.locations where company_id = s.company_id and active order by created_at limit 1));
  if app.place_kind(s.company_id, v_from) is distinct from 'location' then raise exception 'Pick where you''re loading from.'; end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce(nullif(l ->> 'quantity', '')::numeric, 0) <= 0;
    perform app.move_stock(s.company_id, (l ->> 'supply_id')::uuid, (l ->> 'quantity')::numeric, v_from, s.truck_id, 'load',
      jsonb_build_object('shift_id', s.id));
    v_count := v_count + 1;
  end loop;
  perform app.finish_request(s.company_id, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('count', v_count));
  return v_count;
end $$;

-- p: {shift_id, location_id (defaults to the truck's home), lines: [{supply_id, quantity}], client_id}
create function public.return_from_truck(p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(nullif(p ->> 'shift_id', '')::uuid);
  v_earlier jsonb := app.claim_request(s.company_id, nullif(p ->> 'client_id', '')::uuid);
  v_to uuid;
  v_count integer := 0;
  l jsonb;
begin
  if v_earlier is not null then return (v_earlier ->> 'count')::integer; end if;
  v_to := coalesce(nullif(p ->> 'location_id', '')::uuid, (select home_location_id from public.trucks where id = s.truck_id),
                   (select id from public.locations where company_id = s.company_id and active order by created_at limit 1));
  if app.place_kind(s.company_id, v_to) is distinct from 'location' then raise exception 'Pick where it''s going back to.'; end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce(nullif(l ->> 'quantity', '')::numeric, 0) <= 0;
    perform app.move_stock(s.company_id, (l ->> 'supply_id')::uuid, (l ->> 'quantity')::numeric, s.truck_id, v_to, 'return',
      jsonb_build_object('shift_id', s.id));
    v_count := v_count + 1;
  end loop;
  perform app.finish_request(s.company_id, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('count', v_count));
  return v_count;
end $$;

create function public.set_checklist_item(p_shift_id uuid, p_item_id uuid, p_checked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id);
begin
  if p_checked then
    insert into public.shift_checklist (company_id, shift_id, item_id) values (s.company_id, s.id, p_item_id) on conflict do nothing;
  else
    delete from public.shift_checklist where shift_id = s.id and item_id = p_item_id;
  end if;
end $$;

create function public.finish_checklist(p_shift_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id);
begin
  update public.shifts set checklist_done_at = coalesce(checklist_done_at, now()) where id = s.id;
end $$;

-- Waste ---------------------------------------------------------------------------------------

-- p: {place_id or shift_id, supply_id with quantity in base units, or
--     product_size_id + modifier_ids with quantity in drinks, reason_id, note, photo_path, client_id}
-- On a shift, waste comes off the truck. Drivers can only log waste on their own shift.
create function public.log_waste(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager', 'driver');
  v_earlier jsonb := app.claim_request(v_company, nullif(p ->> 'client_id', '')::uuid);
  v_shift uuid := nullif(p ->> 'shift_id', '')::uuid;
  v_place uuid := nullif(p ->> 'place_id', '')::uuid;
  v_supply uuid := nullif(p ->> 'supply_id', '')::uuid;
  v_size uuid := nullif(p ->> 'product_size_id', '')::uuid;
  v_mods uuid[] := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(p -> 'modifier_ids', '[]')) x), '{}');
  v_qty numeric := nullif(p ->> 'quantity', '')::numeric;
  v_id uuid;
  v_total numeric := 0;
  v_cost numeric;
  s public.shifts;
  u record;
begin
  if v_earlier is not null then return (v_earlier ->> 'id')::uuid; end if;
  if v_shift is not null then
    s := app.shift_for(v_shift);
    if s.start_confirmed_at is null then raise exception 'Confirm the starting count first.'; end if;
    if s.end_confirmed_at is not null then raise exception 'The ending count is done, so waste can''t be added now.'; end if;
    v_place := s.truck_id;
  elsif app.role() = 'driver' then
    raise exception 'Drivers log waste from their shift.' using errcode = '42501';
  else
    -- Waste a manager logs on a truck counts toward the shift going on it.
    select id into v_shift from public.shifts
    where truck_id = v_place and company_id = v_company and status = 'open'
      and start_confirmed_at is not null and end_confirmed_at is null;
  end if;
  if nullif(p ->> 'photo_path', '') is not null and split_part(p ->> 'photo_path', '/', 1) <> v_company::text then
    raise exception 'That photo was not found.';
  end if;
  if app.place_kind(v_company, v_place) is null then raise exception 'Pick where it was wasted.'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter how much was wasted.'; end if;
  if (v_supply is null) = (v_size is null) then raise exception 'Pick a supply or a drink.'; end if;
  if v_supply is not null and not exists (select 1 from public.supplies where id = v_supply and company_id = v_company) then
    raise exception 'That supply was not found.';
  end if;
  if v_size is not null and not exists (select 1 from public.product_sizes where id = v_size and company_id = v_company) then
    raise exception 'That drink was not found.';
  end if;

  insert into public.waste_logs (company_id, place_id, shift_id, supply_id, product_size_id, modifier_ids, quantity, reason_id, note, photo_path)
  values (v_company, v_place, v_shift, v_supply, v_size, v_mods, v_qty, nullif(p ->> 'reason_id', '')::uuid,
          nullif(btrim(p ->> 'note'), ''), nullif(p ->> 'photo_path', ''))
  returning id into v_id;

  for u in
    select v_supply as supply_id, null::uuid as group_id, v_qty as quantity where v_supply is not null
    union all
    select x.supply_id, x.group_id, x.quantity * v_qty from app.usage_for_sale(v_size, v_mods, now()) x where v_size is not null
  loop
    if u.supply_id is not null then
      v_cost := u.quantity * (select cost_per_base from public.supplies where id = u.supply_id);
      perform app.move_stock(v_company, u.supply_id, u.quantity, v_place, null, 'waste',
        jsonb_build_object('shift_id', v_shift, 'waste_log_id', v_id,
                           'reason', (select name from public.waste_reasons where id = nullif(p ->> 'reason_id', '')::uuid)));
    else
      -- Groups can't say which supply was used, so value them at the group's average cost.
      v_cost := u.quantity * coalesce((select avg(cost_per_base) from public.supplies where group_id = u.group_id and active), 0);
    end if;
    insert into public.waste_lines (company_id, waste_log_id, supply_id, group_id, quantity, cost)
    values (v_company, v_id, u.supply_id, u.group_id, u.quantity, v_cost);
    v_total := v_total + v_cost;
  end loop;
  update public.waste_logs set cost = v_total where id = v_id;

  perform app.finish_request(v_company, nullif(p ->> 'client_id', '')::uuid, jsonb_build_object('id', v_id));
  return v_id;
end $$;

-- Ending and finishing -------------------------------------------------------------------------

create function public.confirm_shift_end(p_shift_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id, true);
  v_missing text;
begin
  if s.start_confirmed_at is null then raise exception 'Confirm the starting count first.'; end if;
  if s.end_confirmed_at is not null then return; end if;
  select string_agg(sp.name, ', ' order by sp.name) into v_missing
  from app.shift_supplies(s.id) x(supply_id)
  join public.supplies sp on sp.id = x.supply_id
  where not exists (select 1 from public.shift_counts c where c.shift_id = s.id and c.supply_id = x.supply_id and c.kind = 'end');
  if v_missing is not null then
    raise exception 'Count everything that''s left first. Still need: %.', v_missing;
  end if;
  update public.shifts set end_confirmed_at = now(), end_confirmed_by = auth.uid() where id = s.id;
end $$;

-- Works out (or works out again) a finished shift's saved results. Later
-- phases add expected usage from sales; here expected stays empty.
create function app.compute_shift_results(p_shift uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts;
  v_manager_wins boolean;
begin
  select * into s from public.shifts where id = p_shift;
  select count_check_manager_wins into v_manager_wins from public.company_settings where company_id = s.company_id;
  delete from public.shift_results where shift_id = p_shift;

  insert into public.shift_results (company_id, shift_id, supply_id, start_qty, added_qty, end_qty, waste_qty, actual_qty, unit_cost)
  select s.company_id, s.id, x.supply_id, st.q, ad.q, en.q, ws.q, st.q + ad.q - en.q - ws.q, sp.cost_per_base
  from app.shift_supplies(s.id) x(supply_id)
  join public.supplies sp on sp.id = x.supply_id
  cross join lateral (select coalesce((select quantity from public.shift_counts where shift_id = s.id and supply_id = x.supply_id and kind = 'start'), 0) as q) st
  cross join lateral (
    select coalesce(sum(mv.quantity), 0) as q from app.shift_moves(s.id) mv where mv.supply_id = x.supply_id
  ) ad
  cross join lateral (
    select coalesce(
      case when v_manager_wins then (select quantity from public.shift_counts where shift_id = s.id and supply_id = x.supply_id and kind = 'check') end,
      (select quantity from public.shift_counts where shift_id = s.id and supply_id = x.supply_id and kind = 'end'), 0) as q
  ) en
  cross join lateral (
    select coalesce(sum(m.quantity), 0) as q from public.stock_movements m
    where m.shift_id = s.id and m.supply_id = x.supply_id and m.kind = 'waste' and m.from_place_id = s.truck_id
  ) ws;

  -- Group totals: what all members used, less waste of drinks that used the group.
  insert into public.shift_results (company_id, shift_id, group_id, start_qty, added_qty, end_qty, waste_qty, actual_qty, unit_cost)
  select s.company_id, s.id, sp.group_id, sum(r.start_qty), sum(r.added_qty), sum(r.end_qty),
         sum(r.waste_qty) + coalesce((select sum(wl.quantity) from public.waste_lines wl join public.waste_logs w on w.id = wl.waste_log_id
                                      where w.shift_id = s.id and wl.group_id = sp.group_id), 0),
         sum(r.actual_qty) - coalesce((select sum(wl.quantity) from public.waste_lines wl join public.waste_logs w on w.id = wl.waste_log_id
                                       where w.shift_id = s.id and wl.group_id = sp.group_id), 0),
         coalesce(avg(sp.cost_per_base), 0)
  from public.shift_results r
  join public.supplies sp on sp.id = r.supply_id
  where r.shift_id = s.id and sp.group_id is not null
  group by sp.group_id;
end $$;

-- The Lead finishes the shift: the truck's stock becomes the ending count, what
-- was used is logged as usage, and the results are saved.
create function public.finish_shift(p_shift_id uuid, p_client_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts := app.shift_for(p_shift_id, true);
  v_earlier jsonb := app.claim_request(s.company_id, p_client_id);
  res record;
  v_checks boolean;
  v_needs_check boolean;
begin
  if v_earlier is not null then return; end if;
  if s.end_confirmed_at is null then raise exception 'Confirm the ending count first.'; end if;

  perform app.compute_shift_results(s.id);

  -- Log what was used so the truck's stock lands on the ending count.
  for res in select * from public.shift_results where shift_id = s.id and supply_id is not null loop
    if res.actual_qty > 0 then
      perform app.move_stock(s.company_id, res.supply_id, res.actual_qty, s.truck_id, null, 'usage', jsonb_build_object('shift_id', s.id));
    elsif res.actual_qty < 0 then
      perform app.move_stock(s.company_id, res.supply_id, -res.actual_qty, null, s.truck_id, 'adjustment',
        jsonb_build_object('shift_id', s.id, 'reason', 'More left than started with'));
    end if;
  end loop;

  select count_checks_enabled into v_checks from public.company_settings where company_id = s.company_id;
  select exists (select 1 from public.shift_results r join public.supplies sp on sp.id = r.supply_id
                 where r.shift_id = s.id and sp.count_check) into v_needs_check;

  update public.shifts
     set status = 'closed', ended_at = now(), closed_by = auth.uid(),
         count_check_status = case when v_checks and v_needs_check then 'waiting' else 'not_needed' end
   where id = s.id;

  -- A count check that was waiting on this truck's last shift can't happen anymore.
  update public.shifts set count_check_status = 'missed'
   where truck_id = s.truck_id and count_check_status = 'waiting' and id <> s.id and ended_at < s.started_at;

  perform app.after_shift_closed(s.id);
  perform app.finish_request(s.company_id, p_client_id, '{"done": true}');
end $$;

-- Hook for later phases (expected usage, comparisons, flags). Does nothing yet.
create function app.after_shift_closed(p_shift uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

-- Grants -------------------------------------------------------------------------------------

revoke execute on function
  app.raise_flag(uuid, text, text, text, text, jsonb, text), app.clear_flag(uuid, text),
  app.shift_for(uuid, boolean, boolean), app.shift_moves(uuid), app.shift_supplies(uuid),
  app.compute_shift_results(uuid), app.after_shift_closed(uuid)
from public, anon, authenticated;
revoke execute on function app.on_shift(uuid), app.can_see_shift(uuid, uuid) from public, anon;
grant execute on function app.on_shift(uuid), app.can_see_shift(uuid, uuid) to authenticated, service_role;

revoke execute on function
  public.review_flag(uuid, text), public.open_shifts(),
  public.start_shift(jsonb), public.join_shift(uuid), public.set_shift_crew(uuid, uuid, uuid[]), public.cancel_shift(uuid),
  public.save_shift_counts(jsonb), public.confirm_shift_start(uuid), public.load_truck(jsonb), public.return_from_truck(jsonb),
  public.set_checklist_item(uuid, uuid, boolean), public.finish_checklist(uuid), public.log_waste(jsonb),
  public.confirm_shift_end(uuid), public.finish_shift(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.review_flag(uuid, text), public.open_shifts(),
  public.start_shift(jsonb), public.join_shift(uuid), public.set_shift_crew(uuid, uuid, uuid[]), public.cancel_shift(uuid),
  public.save_shift_counts(jsonb), public.confirm_shift_start(uuid), public.load_truck(jsonb), public.return_from_truck(jsonb),
  public.set_checklist_item(uuid, uuid, boolean), public.finish_checklist(uuid), public.log_waste(jsonb),
  public.confirm_shift_end(uuid), public.finish_shift(uuid, uuid)
to authenticated;

-- Photos ---------------------------------------------------------------------------------------

-- Photos are kept in a private bucket, in a folder named after the business:
-- <company id>/<what it's for>/<file>. People only see their own business's photos.
-- Phones shrink photos to about 100 KB before sending, so 2 MB is plenty.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select app.company_id())::text);
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select app.company_id())::text);
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select app.company_id())::text
         and (select app.role()) in ('admin', 'manager'));
