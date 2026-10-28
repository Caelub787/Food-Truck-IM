-- Phase 7: optional scheduling. Managers plan who works which truck and when.
-- Drivers see the plans they're on. Starting a shift from a plan fills in the
-- truck, Lead, and crew.

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  truck_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  event_name text check (length(event_name) <= 120),
  place text check (length(place) <= 300),
  notes text check (length(notes) <= 2000),
  lead_id uuid,
  status text not null default 'planned' check (status in ('planned', 'cancelled')),
  -- Plans made together with "repeat every week" share a series.
  series_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  check (ends_at > starts_at),
  foreign key (company_id, truck_id) references public.trucks (company_id, id),
  foreign key (company_id, lead_id) references public.profiles (company_id, user_id)
);
create index schedules_company_idx on public.schedules (company_id, starts_at);

create table public.schedule_crew (
  company_id uuid not null references public.companies (id) on delete cascade,
  schedule_id uuid not null,
  user_id uuid not null,
  primary key (schedule_id, user_id),
  foreign key (company_id, schedule_id) references public.schedules (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.profiles (company_id, user_id)
);
create index schedule_crew_user_idx on public.schedule_crew (user_id);

-- Is the logged in person the Lead or crew on this plan?
create function app.on_schedule(p_schedule uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.schedules where id = p_schedule and lead_id = (select auth.uid()))
      or exists (select 1 from public.schedule_crew where schedule_id = p_schedule and user_id = (select auth.uid()))
$$;

alter table public.schedules enable row level security;
create policy schedules_select on public.schedules for select to authenticated
  using (company_id = (select app.company_id()) and ((select app.role()) in ('admin', 'manager') or app.on_schedule(id)));
alter table public.schedule_crew enable row level security;
create policy schedule_crew_select on public.schedule_crew for select to authenticated
  using (company_id = (select app.company_id()) and ((select app.role()) in ('admin', 'manager') or app.on_schedule(schedule_id)));
revoke all on public.schedules, public.schedule_crew from anon, authenticated;
grant select on public.schedules, public.schedule_crew to authenticated;
grant all on public.schedules, public.schedule_crew to service_role;
create trigger schedules_touch before update on public.schedules for each row execute function app.touch_updated_at();
create trigger schedules_audit after insert or update or delete on public.schedules for each row execute function app.audit();
select app.enable_live('public.schedules');
select app.enable_live('public.schedule_crew');

alter table public.shifts add foreign key (company_id, schedule_id) references public.schedules (company_id, id);
create index shifts_schedule_idx on public.shifts (schedule_id) where schedule_id is not null;

-- p: {id (to change one), truck_id, starts_at, ends_at, event_name, place, notes,
--     lead_id, crew_ids, repeat_weeks (new plans only: make this many more, a week apart)}
-- Returns the plan's id (the first one, when repeating).
create function public.save_schedule(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_first uuid;
  v_series uuid;
  v_start timestamptz := nullif(p ->> 'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p ->> 'ends_at', '')::timestamptz;
  v_lead uuid := nullif(p ->> 'lead_id', '')::uuid;
  v_truck uuid := nullif(p ->> 'truck_id', '')::uuid;
  v_repeat integer := least(greatest(coalesce(nullif(p ->> 'repeat_weeks', '')::integer, 0), 0), 26);
  v_crew uuid[] := coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p -> 'crew_ids', '[]')) x), '{}');
  v_member uuid;
  i integer;
begin
  if not exists (select 1 from public.trucks where id = v_truck and company_id = v_company) then raise exception 'Pick a truck.'; end if;
  if v_start is null or v_end is null then raise exception 'Pick a start and end time.'; end if;
  if v_end <= v_start then raise exception 'The end time has to be after the start time.'; end if;
  foreach v_member in array v_crew || v_lead loop
    continue when v_member is null;
    if not exists (select 1 from public.profiles where user_id = v_member and company_id = v_company and active) then
      raise exception 'Everyone on the plan must be someone in your business.';
    end if;
  end loop;

  if v_id is not null then
    update public.schedules
       set truck_id = v_truck, starts_at = v_start, ends_at = v_end, event_name = nullif(btrim(p ->> 'event_name'), ''),
           place = nullif(btrim(p ->> 'place'), ''), notes = nullif(btrim(p ->> 'notes'), ''), lead_id = v_lead
     where id = v_id and company_id = v_company;
    if not found then raise exception 'That plan was not found.'; end if;
    delete from public.schedule_crew where schedule_id = v_id and user_id <> all (v_crew);
    insert into public.schedule_crew (company_id, schedule_id, user_id)
    select v_company, v_id, x from unnest(v_crew) x where x is distinct from v_lead
    on conflict do nothing;
    return v_id;
  end if;

  v_series := case when v_repeat > 0 then gen_random_uuid() end;
  for i in 0 .. v_repeat loop
    insert into public.schedules (company_id, truck_id, starts_at, ends_at, event_name, place, notes, lead_id, series_id)
    values (v_company, v_truck, v_start + make_interval(weeks => i), v_end + make_interval(weeks => i),
            nullif(btrim(p ->> 'event_name'), ''), nullif(btrim(p ->> 'place'), ''), nullif(btrim(p ->> 'notes'), ''), v_lead, v_series)
    returning id into v_id;
    v_first := coalesce(v_first, v_id);
    insert into public.schedule_crew (company_id, schedule_id, user_id)
    select v_company, v_id, x from unnest(v_crew) x where x is distinct from v_lead;
  end loop;
  return v_first;
end $$;

-- Cancels a plan, or this one and the later ones in its series.
create function public.cancel_schedule(p_schedule_id uuid, p_and_later boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  s public.schedules;
  v_count integer;
begin
  select * into s from public.schedules where id = p_schedule_id and company_id = v_company;
  if not found then raise exception 'That plan was not found.'; end if;
  update public.schedules set status = 'cancelled'
   where company_id = v_company
     and (id = s.id or (p_and_later and s.series_id is not null and series_id = s.series_id and starts_at >= s.starts_at));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function app.on_schedule(uuid) from public, anon;
grant execute on function app.on_schedule(uuid) to authenticated, service_role;
revoke execute on function public.save_schedule(jsonb), public.cancel_schedule(uuid, boolean) from public, anon, authenticated;
grant execute on function public.save_schedule(jsonb), public.cancel_schedule(uuid, boolean) to authenticated;
