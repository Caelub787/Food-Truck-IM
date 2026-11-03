-- Client bookings. Each business can turn on a public booking page where its
-- clients ask for a truck on a day and time. Admins and managers accept or
-- decline. Accepting puts it on the schedule with a truck, a Lead and crew, a
-- manager, the on site contact, and the supplies the event needs, and tells
-- everyone involved. Clients get an email either way. No money changes hands
-- in the app.

-- Settings ---------------------------------------------------------------------------------------

alter table public.company_settings
  add column bookings_enabled boolean not null default false,
  add column booking_slug text check (booking_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(booking_slug) between 3 and 60),
  add column booking_intro text check (length(booking_intro) <= 1000),
  add column booking_days integer[] not null default '{0,1,2,3,4,5,6}' check (booking_days <@ '{0,1,2,3,4,5,6}' and cardinality(booking_days) > 0),
  add column booking_open time not null default '08:00',
  add column booking_close time not null default '22:00',
  add column booking_notice_days integer not null default 3 check (booking_notice_days between 0 and 365),
  add column booking_ahead_days integer not null default 180 check (booking_ahead_days between 1 and 730),
  -- How many events can happen at the same time. Empty means one per active truck.
  add column booking_capacity integer check (booking_capacity between 1 and 100),
  add constraint booking_hours check (booking_close > booking_open);
create unique index company_settings_booking_slug_idx on public.company_settings (booking_slug);

-- Turning bookings on also turns on scheduling (accepted bookings go on the
-- schedule) and makes a page name from the business name if there isn't one.
-- A page name someone else has gets a plain error instead of a database one.
create function app.check_booking_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_try text;
  i integer := 1;
begin
  new.booking_slug := nullif(lower(btrim(new.booking_slug)), '');
  if new.bookings_enabled then
    new.scheduling_enabled := true;
    if new.booking_slug is null then
      v_base := trim(both '-' from regexp_replace(lower((select name from public.companies where id = new.company_id)), '[^a-z0-9]+', '-', 'g'));
      v_base := left(case when length(v_base) < 3 then 'trucks' else v_base end, 50);
      v_try := v_base;
      while exists (select 1 from public.company_settings where booking_slug = v_try and company_id <> new.company_id) loop
        i := i + 1;
        v_try := v_base || '-' || i;
      end loop;
      new.booking_slug := v_try;
    end if;
  end if;
  if new.booking_slug is not null and exists (
    select 1 from public.company_settings where booking_slug = new.booking_slug and company_id <> new.company_id
  ) then
    raise exception 'That page name is taken. Try another one.';
  end if;
  return new;
end $$;
create trigger company_settings_booking before insert or update on public.company_settings
  for each row execute function app.check_booking_settings();

-- Who hears about being put on an event by email (everyone, unless they turn it off).
alter table public.notification_settings add column assignment_email boolean;

create or replace function app.recipients(p_company uuid, p_pref text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.user_id
  from public.profiles p
  left join public.notification_settings n on n.user_id = p.user_id
  where p.company_id = p_company and p.active and p.joined_at is not null
    and case p_pref
          when 'daily_email' then coalesce(n.daily_email, p.role in ('admin', 'manager'))
          when 'weekly_email' then coalesce(n.weekly_email, p.role in ('admin', 'manager'))
          when 'monthly_email' then coalesce(n.monthly_email, p.role = 'admin')
          when 'morning_email' then coalesce(n.morning_email, p.role in ('admin', 'manager'))
          when 'alert_email' then coalesce(n.alert_email, false)
          when 'alert_push' then coalesce(n.alert_push, p.role in ('admin', 'manager'))
          when 'reminder_push' then coalesce(n.reminder_push, true)
          when 'assignment_email' then coalesce(n.assignment_email, true)
          else false
        end
$$;

-- Tables -----------------------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- From the client
  client_name text not null check (length(btrim(client_name)) between 1 and 120),
  client_email text not null check (length(client_email) between 3 and 200),
  client_phone text check (length(client_phone) <= 40),
  organization text check (length(organization) <= 120),
  event_name text check (length(event_name) <= 120),
  place text not null check (length(btrim(place)) between 1 and 300),
  guests integer check (guests between 0 and 100000),
  client_notes text check (length(client_notes) <= 2000),
  -- Filled in when it's accepted. The Lead and crew live on the schedule.
  truck_id uuid,
  manager_id uuid,
  schedule_id uuid,
  contact_name text check (length(contact_name) <= 120),
  contact_phone text check (length(contact_phone) <= 40),
  crew_notes text check (length(crew_notes) <= 2000),
  price numeric check (price >= 0),
  decision_message text check (length(decision_message) <= 2000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  check (ends_at > starts_at),
  foreign key (company_id, truck_id) references public.trucks (company_id, id),
  foreign key (company_id, manager_id) references public.profiles (company_id, user_id),
  foreign key (company_id, schedule_id) references public.schedules (company_id, id)
);
create index bookings_company_idx on public.bookings (company_id, starts_at);
create index bookings_schedule_idx on public.bookings (schedule_id) where schedule_id is not null;
create index bookings_waiting_idx on public.bookings (company_id, lower(client_email)) where status = 'pending';

-- What an event needs, in base units. It shows on the shift's loading list.
create table public.booking_supplies (
  company_id uuid not null references public.companies (id) on delete cascade,
  booking_id uuid not null,
  supply_id uuid not null,
  quantity numeric not null check (quantity > 0),
  primary key (booking_id, supply_id),
  foreign key (company_id, booking_id) references public.bookings (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);

-- Is the logged in person on this booking's plan (as Lead or crew)?
create function app.on_booking(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.id = p_booking and b.schedule_id is not null and app.on_schedule(b.schedule_id))
$$;

-- Admins and managers see every booking. Drivers see the ones they're working.
-- Everything is changed through the functions below.
alter table public.bookings enable row level security;
create policy bookings_select on public.bookings for select to authenticated
  using (company_id = (select app.company_id())
         and ((select app.role()) in ('admin', 'manager') or (schedule_id is not null and app.on_schedule(schedule_id))));
alter table public.booking_supplies enable row level security;
create policy booking_supplies_select on public.booking_supplies for select to authenticated
  using (company_id = (select app.company_id()) and ((select app.role()) in ('admin', 'manager') or app.on_booking(booking_id)));
revoke all on public.bookings, public.booking_supplies from anon, authenticated;
grant select on public.bookings, public.booking_supplies to authenticated;
grant all on public.bookings, public.booking_supplies to service_role;
create trigger bookings_touch before update on public.bookings for each row execute function app.touch_updated_at();
create trigger bookings_audit after insert or update or delete on public.bookings for each row execute function app.audit();
create trigger booking_supplies_audit after insert or update or delete on public.booking_supplies for each row execute function app.audit();
select app.enable_live('public.bookings');
select app.enable_live('public.booking_supplies');

-- Helpers ----------------------------------------------------------------------------------------

-- How many events can run at once.
create function app.booking_capacity(p_company uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select booking_capacity from public.company_settings where company_id = p_company),
    nullif((select count(*) from public.trucks where company_id = p_company and active), 0)::integer,
    1)
$$;

-- Times the business is already busy (planned shifts, which include accepted bookings).
create function app.booking_busy(p_company uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.starts_at, s.ends_at from public.schedules s
  where s.company_id = p_company and s.status = 'planned' and s.starts_at < p_to and s.ends_at > p_from
$$;

-- Everything an email or push about a booking needs.
create function app.booking_details(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'booking_id', b.id, 'company_name', c.name, 'company_phone', c.phone, 'timezone', c.timezone,
    'booking_slug', (select booking_slug from public.company_settings where company_id = b.company_id),
    'client_name', b.client_name, 'organization', b.organization,
    'event_name', coalesce(b.event_name, b.organization, b.client_name),
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'place', b.place,
    'contact_name', b.contact_name, 'contact_phone', b.contact_phone, 'notes', b.crew_notes,
    'truck', (select name from public.trucks where id = b.truck_id),
    'lead', (select p.full_name from public.schedules s join public.profiles p on p.user_id = s.lead_id where s.id = b.schedule_id),
    'crew', (select jsonb_agg(p.full_name order by p.full_name) from public.schedule_crew sc join public.profiles p on p.user_id = sc.user_id
             where sc.schedule_id = b.schedule_id),
    'manager', (select full_name from public.profiles where user_id = b.manager_id),
    'manager_phone', (select phone from public.profiles where user_id = b.manager_id),
    'supplies', (select jsonb_agg(jsonb_build_object('name', s.name,
                   'amount', app.amount_text(bs.quantity / coalesce(u.factor, 1), coalesce(u.name, s.base_unit))) order by s.name)
                 from public.booking_supplies bs join public.supplies s on s.id = bs.supply_id
                 left join public.supply_units u on u.id = s.count_unit_id
                 where bs.booking_id = b.id))
  from public.bookings b join public.companies c on c.id = b.company_id
  where b.id = p_booking
$$;

-- Tells everyone working a booking (Lead, crew, and the manager in charge) by push and email.
create function app.tell_booking_staff(p_booking uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_payload jsonb;
  v_user uuid;
  v_title text;
  v_stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
begin
  select * into b from public.bookings where id = p_booking;
  v_payload := app.booking_details(b.id) || jsonb_build_object('kind', p_kind, 'url', '/schedule');
  v_title := case p_kind when 'new' then 'You''re on an event' when 'updated' then 'Event changed' else 'Event cancelled' end;
  for v_user in
    select distinct x from (
      select s.lead_id as x from public.schedules s where s.id = b.schedule_id
      union all select sc.user_id from public.schedule_crew sc where sc.schedule_id = b.schedule_id
      union all select b.manager_id
    ) people where x is not null
  loop
    if v_user in (select app.recipients(b.company_id, 'reminder_push')) then
      perform app.notify(b.company_id, v_user, 'push', 'push',
        jsonb_build_object('title', v_title, 'body', (v_payload ->> 'event_name') || ', ' ||
                           to_char(b.starts_at at time zone (v_payload ->> 'timezone'), 'FMDy FMMon FMDD, FMHH12:MI AM'), 'url', '/schedule'),
        'booking:' || b.id || ':' || p_kind || ':push:' || v_user || ':' || v_stamp);
    end if;
    if v_user in (select app.recipients(b.company_id, 'assignment_email')) then
      perform app.notify(b.company_id, v_user, 'email', 'booking_staff', v_payload,
        'booking:' || b.id || ':' || p_kind || ':email:' || v_user || ':' || v_stamp);
    end if;
  end loop;
end $$;

-- An email to the client, with replies going to the person who decided.
create function app.tell_booking_client(p_booking uuid, p_template text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  insert into public.outbox (company_id, channel, to_email, template, payload, dedupe_key)
  values (b.company_id, 'email', b.client_email, p_template,
          app.booking_details(b.id) || jsonb_build_object('message', nullif(btrim(p_message), ''),
            'reply_to', (select email from public.profiles where user_id = auth.uid())),
          p_template || ':' || b.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end $$;

-- The public booking page ------------------------------------------------------------------------

-- What a client sees: the business, when it takes bookings, and the times it's
-- already busy (just the times, nothing about who or where). Empty when the
-- business isn't taking bookings.
create function public.booking_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.company_settings;
  c public.companies;
  v_today date;
begin
  select * into st from public.company_settings where booking_slug = lower(btrim(p_slug)) and bookings_enabled;
  if not found then return null; end if;
  select * into c from public.companies where id = st.company_id and status = 'active';
  if not found then return null; end if;
  v_today := (now() at time zone c.timezone)::date;
  return jsonb_build_object(
    'name', c.name, 'phone', c.phone, 'timezone', c.timezone, 'intro', st.booking_intro,
    'days', to_jsonb(st.booking_days),
    'open', to_char(date '2000-01-01' + st.booking_open, 'HH24:MI'), 'close', to_char(date '2000-01-01' + st.booking_close, 'HH24:MI'),
    'first_day', v_today + st.booking_notice_days, 'last_day', v_today + st.booking_ahead_days,
    'capacity', app.booking_capacity(c.id),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', x.starts_at, 'ends_at', x.ends_at) order by x.starts_at)
      from app.booking_busy(c.id, ((v_today + st.booking_notice_days)::timestamp at time zone c.timezone),
                            ((v_today + st.booking_ahead_days + 1)::timestamp at time zone c.timezone)) x), '[]'));
end $$;

-- p: {date 'YYYY-MM-DD', start 'HH:MM', end 'HH:MM' (in the business's time zone),
--     name, email, phone, organization, event_name, place, guests, notes, website (left empty by people)}
-- Anyone can ask, so it checks everything and limits how many requests come in.
create function public.request_booking(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st public.company_settings;
  c public.companies;
  v_date date;
  v_start time;
  v_end time;
  v_starts timestamptz;
  v_ends timestamptz;
  v_today date;
  v_id uuid;
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  v_place text := nullif(btrim(p ->> 'place'), '');
begin
  -- A hidden box only robots fill in. Act like it worked.
  if coalesce(btrim(p ->> 'website'), '') <> '' then return jsonb_build_object('ok', true); end if;

  select * into st from public.company_settings where booking_slug = lower(btrim(p_slug)) and bookings_enabled;
  if found then select * into c from public.companies where id = st.company_id and status = 'active'; end if;
  if c.id is null then raise exception 'This business isn''t taking bookings online right now.'; end if;

  begin
    v_date := nullif(p ->> 'date', '')::date;
    v_start := nullif(p ->> 'start', '')::time;
    v_end := nullif(p ->> 'end', '')::time;
  exception when others then
    raise exception 'Pick a day and a start and end time.';
  end;
  if v_date is null or v_start is null or v_end is null then raise exception 'Pick a day and a start and end time.'; end if;
  if v_end <= v_start then raise exception 'The end time has to be after the start time.'; end if;
  v_today := (now() at time zone c.timezone)::date;
  if v_date < v_today + st.booking_notice_days then
    raise exception 'Please pick a day at least % % from today.', st.booking_notice_days,
      case st.booking_notice_days when 1 then 'day' else 'days' end;
  end if;
  if v_date > v_today + st.booking_ahead_days then raise exception 'That day is too far ahead. Please pick an earlier day.'; end if;
  if not (extract(dow from v_date)::integer = any (st.booking_days)) then
    raise exception 'That day isn''t open for bookings. Please pick another day.';
  end if;
  if v_start < st.booking_open or v_end > st.booking_close then
    raise exception 'Please pick a time between % and %.',
      to_char(date '2000-01-01' + st.booking_open, 'FMHH12:MI AM'), to_char(date '2000-01-01' + st.booking_close, 'FMHH12:MI AM');
  end if;
  v_starts := (v_date + v_start) at time zone c.timezone;
  v_ends := (v_date + v_end) at time zone c.timezone;
  if (select count(*) from app.booking_busy(c.id, v_starts, v_ends)) >= app.booking_capacity(c.id) then
    raise exception 'That time is already booked. Please pick another time or day.';
  end if;

  if v_name is null or length(v_name) > 120 then raise exception 'Please enter your name.'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
    raise exception 'Please enter a real email address, so they can get back to you.';
  end if;
  if v_place is null or length(v_place) > 300 then raise exception 'Please enter where the event is.'; end if;
  if length(p ->> 'notes') > 2000 then raise exception 'Please keep the notes shorter.'; end if;

  if (select count(*) from public.bookings where company_id = c.id and status = 'pending' and lower(client_email) = v_email) >= 3 then
    raise exception 'You already have requests waiting with this business. They''ll get back to you soon.';
  end if;
  if (select count(*) from public.bookings where company_id = c.id and created_at > now() - interval '1 day') >= 50 then
    raise exception 'This business can''t take more requests today. Please try again tomorrow.';
  end if;

  insert into public.bookings (company_id, starts_at, ends_at, client_name, client_email, client_phone, organization, event_name,
                               place, guests, client_notes)
  values (c.id, v_starts, v_ends, v_name, v_email, left(nullif(btrim(p ->> 'phone'), ''), 40),
          left(nullif(btrim(p ->> 'organization'), ''), 120), left(nullif(btrim(p ->> 'event_name'), ''), 120), v_place,
          case when (p ->> 'guests') ~ '^\d{1,6}$' then (p ->> 'guests')::integer end, nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;

  perform app.alert(c.id, 'New booking request',
    v_name || ' asked for ' || to_char(v_starts at time zone c.timezone, 'FMDy FMMon FMDD, FMHH12:MI AM'),
    '/bookings?open=' || v_id, 'booking-request:' || v_id);
  return jsonb_build_object('ok', true);
end $$;

-- Deciding and changing bookings -----------------------------------------------------------------

-- Saves the plan, people, and supplies for an accepted booking.
-- p: {booking_id, truck_id, lead_id, crew_ids, manager_id, date, start, end (or starts_at, ends_at),
--     event_name, place, contact_name, contact_phone, crew_notes, price, supplies [{supply_id, quantity}]}
create function app.save_booking_details(b public.bookings, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_starts timestamptz := coalesce(nullif(p ->> 'starts_at', '')::timestamptz, b.starts_at);
  v_ends timestamptz := coalesce(nullif(p ->> 'ends_at', '')::timestamptz, b.ends_at);
  v_manager uuid := nullif(p ->> 'manager_id', '')::uuid;
  v_schedule uuid;
  v_line jsonb;
begin
  if nullif(p ->> 'lead_id', '') is null then raise exception 'Pick a Lead for the event.'; end if;
  if v_manager is not null and not exists (
    select 1 from public.profiles where user_id = v_manager and company_id = b.company_id and active and role in ('admin', 'manager')
  ) then
    raise exception 'The manager in charge has to be a manager or admin in your business.';
  end if;
  v_schedule := public.save_schedule(jsonb_build_object(
    'id', b.schedule_id, 'truck_id', p ->> 'truck_id', 'starts_at', v_starts, 'ends_at', v_ends,
    'event_name', coalesce(nullif(btrim(p ->> 'event_name'), ''), b.event_name, b.organization, b.client_name),
    'place', coalesce(nullif(btrim(p ->> 'place'), ''), b.place),
    'notes', nullif(btrim(p ->> 'crew_notes'), ''),
    'lead_id', p ->> 'lead_id', 'crew_ids', coalesce(p -> 'crew_ids', '[]')));

  update public.bookings
     set starts_at = v_starts, ends_at = v_ends, schedule_id = v_schedule,
         truck_id = (p ->> 'truck_id')::uuid, manager_id = v_manager,
         event_name = coalesce(left(nullif(btrim(p ->> 'event_name'), ''), 120), event_name),
         place = coalesce(left(nullif(btrim(p ->> 'place'), ''), 300), place),
         contact_name = left(nullif(btrim(p ->> 'contact_name'), ''), 120),
         contact_phone = left(nullif(btrim(p ->> 'contact_phone'), ''), 40),
         crew_notes = left(nullif(btrim(p ->> 'crew_notes'), ''), 2000),
         price = nullif(p ->> 'price', '')::numeric
   where id = b.id;

  delete from public.booking_supplies where booking_id = b.id;
  for v_line in select * from jsonb_array_elements(coalesce(p -> 'supplies', '[]')) loop
    continue when coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0) <= 0;
    if not exists (select 1 from public.supplies where id = (v_line ->> 'supply_id')::uuid and company_id = b.company_id) then
      raise exception 'That supply was not found.';
    end if;
    insert into public.booking_supplies (company_id, booking_id, supply_id, quantity)
    values (b.company_id, b.id, (v_line ->> 'supply_id')::uuid, (v_line ->> 'quantity')::numeric)
    on conflict (booking_id, supply_id) do update set quantity = excluded.quantity;
  end loop;
end $$;

-- p: {booking_id, action ('accept' or 'decline'), message (to the client), ...details for accept}
create function public.decide_booking(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  b public.bookings;
begin
  select * into b from public.bookings where id = nullif(p ->> 'booking_id', '')::uuid and company_id = v_company for update;
  if not found then raise exception 'That booking was not found.'; end if;
  if b.status <> 'pending' then raise exception 'This booking was already answered.'; end if;
  if (select status from public.companies where id = v_company) <> 'active' then
    raise exception 'Your business needs to be approved before the app can send emails.';
  end if;

  if p ->> 'action' = 'decline' then
    update public.bookings set status = 'declined', decision_message = left(nullif(btrim(p ->> 'message'), ''), 2000),
                               decided_by = auth.uid(), decided_at = now()
     where id = b.id;
    perform app.tell_booking_client(b.id, 'booking_declined', p ->> 'message');
    return;
  end if;
  if p ->> 'action' <> 'accept' then raise exception 'Pick accept or decline.'; end if;

  perform app.save_booking_details(b, p);
  update public.bookings set status = 'accepted', decision_message = left(nullif(btrim(p ->> 'message'), ''), 2000),
                             decided_by = auth.uid(), decided_at = now()
   where id = b.id;
  perform app.tell_booking_staff(b.id, 'new');
  perform app.tell_booking_client(b.id, 'booking_accepted', p ->> 'message');
end $$;

-- Changes an accepted booking (time, place, truck, people, supplies) and tells the people on it.
create function public.update_booking(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  b public.bookings;
begin
  select * into b from public.bookings where id = nullif(p ->> 'booking_id', '')::uuid and company_id = v_company for update;
  if not found then raise exception 'That booking was not found.'; end if;
  if b.status <> 'accepted' then raise exception 'Only accepted bookings can be changed.'; end if;
  perform app.save_booking_details(b, p);
  perform app.tell_booking_staff(b.id, 'updated');
end $$;

-- Cancels a booking that's waiting or accepted. Takes it off the schedule and
-- tells the people on it, and the client if asked.
create function public.cancel_booking(p_booking_id uuid, p_message text default null, p_tell_client boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id and company_id = v_company for update;
  if not found then raise exception 'That booking was not found.'; end if;
  if b.status not in ('pending', 'accepted') then raise exception 'This booking is already closed.'; end if;
  if b.status = 'accepted' then perform app.tell_booking_staff(b.id, 'cancelled'); end if;
  update public.bookings set status = 'cancelled', decision_message = coalesce(left(nullif(btrim(p_message), ''), 2000), decision_message),
                             decided_by = auth.uid(), decided_at = now()
   where id = b.id;
  if b.schedule_id is not null then
    update public.schedules set status = 'cancelled' where id = b.schedule_id;
  end if;
  if p_tell_client then perform app.tell_booking_client(b.id, 'booking_cancelled', p_message); end if;
end $$;

-- Grants -----------------------------------------------------------------------------------------

revoke execute on function app.check_booking_settings(), app.on_booking(uuid), app.booking_capacity(uuid),
  app.booking_busy(uuid, timestamptz, timestamptz), app.booking_details(uuid), app.tell_booking_staff(uuid, text),
  app.tell_booking_client(uuid, text, text), app.save_booking_details(public.bookings, jsonb)
  from public, anon, authenticated;
grant execute on function app.on_booking(uuid) to authenticated, service_role;

-- The booking page is the one place logged out visitors can use, on purpose.
revoke execute on function public.booking_page(text), public.request_booking(text, jsonb) from public;
grant execute on function public.booking_page(text), public.request_booking(text, jsonb) to anon, authenticated;

revoke execute on function public.decide_booking(jsonb), public.update_booking(jsonb), public.cancel_booking(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.decide_booking(jsonb), public.update_booking(jsonb), public.cancel_booking(uuid, text, boolean)
  to authenticated;
