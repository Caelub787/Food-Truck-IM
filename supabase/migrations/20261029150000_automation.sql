-- Phase 8: the app runs itself. One timer (pg_cron, every 15 minutes) runs
-- app.run_due_jobs(), which does whatever is due for each business in its own
-- time zone. Every job records (business, job, period) in job_runs first, so it
-- never runs twice. Jobs write emails and push notifications to the outbox, and
-- the send-outbox Edge Function delivers them.

-- Bookkeeping and who wants what -------------------------------------------------------------

create table public.job_runs (
  company_id uuid not null references public.companies (id) on delete cascade,
  job text not null,
  period text not null,
  ran_at timestamptz not null default now(),
  primary key (company_id, job, period)
);
select app.setup_table('public.job_runs', '{}', '{admin}', p_audit => false);

-- Each person's choices. Empty means the default for their role.
create table public.notification_settings (
  user_id uuid primary key,
  company_id uuid not null default app.company_id() references public.companies (id) on delete cascade,
  daily_email boolean,
  weekly_email boolean,
  monthly_email boolean,
  morning_email boolean,
  alert_email boolean,
  alert_push boolean,
  reminder_push boolean,
  updated_at timestamptz not null default now(),
  foreign key (company_id, user_id) references public.profiles (company_id, user_id) on delete cascade
);
alter table public.notification_settings enable row level security;
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid()) and company_id = (select app.company_id()))
  with check (user_id = (select auth.uid()) and company_id = (select app.company_id()));
revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;
create trigger notification_settings_touch before update on public.notification_settings for each row execute function app.touch_updated_at();
select app.enable_live('public.notification_settings');

-- Phones and computers that said yes to push notifications.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  foreign key (company_id, user_id) references public.profiles (company_id, user_id) on delete cascade
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and company_id = (select app.company_id()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()) and company_id = (select app.company_id()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
select app.enable_live('public.push_subscriptions');

create function public.save_push_subscription(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager', 'driver');
begin
  insert into public.push_subscriptions (company_id, user_id, endpoint, p256dh, auth, user_agent)
  values (v_company, auth.uid(), p ->> 'endpoint', p ->> 'p256dh', p ->> 'auth', left(p ->> 'user_agent', 300))
  on conflict (endpoint) do update set company_id = excluded.company_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;

create function public.service_push_targets(p_user uuid) returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select endpoint, p256dh, auth from public.push_subscriptions where user_id = p_user
$$;

create function public.service_drop_push(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint
$$;

-- People in a business who want a kind of message (their choice, else their role's default).
create function app.recipients(p_company uuid, p_pref text) returns setof uuid
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
          else false
        end
$$;

-- Puts a message in the outbox, once per dedupe key.
create function app.notify(p_company uuid, p_user uuid, p_channel text, p_template text, p_payload jsonb, p_dedupe text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.outbox (company_id, channel, to_user, template, payload, dedupe_key)
  values (p_company, p_channel, p_user, p_template, p_payload, p_dedupe)
  on conflict (dedupe_key) do nothing
$$;

-- Tells managers about something: push, and email for those who asked for it.
create function app.alert(p_company uuid, p_title text, p_body text, p_url text, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  for v_user in select app.recipients(p_company, 'alert_push') loop
    perform app.notify(p_company, v_user, 'push', 'push', jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url),
                       p_dedupe || ':push:' || v_user);
  end loop;
  for v_user in select app.recipients(p_company, 'alert_email') loop
    perform app.notify(p_company, v_user, 'email', 'alert', jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url),
                       p_dedupe || ':email:' || v_user);
  end loop;
end $$;

create function app.claim_job(p_company uuid, p_job text, p_period text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_runs (company_id, job, period) values (p_company, p_job, p_period) on conflict do nothing;
  return found;
end $$;

-- Flags about something that's true right now (low stock, a shift open too long).
-- Raised once while it stays true, and removed when it isn't anymore. Returns
-- true when it's new, so the caller knows to tell people.
create function app.raise_flag_once(
  p_company uuid, p_kind text, p_title text, p_details text, p_dedupe text,
  p_extra jsonb default '{}', p_severity text default 'warning'
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.flags where company_id = p_company and dedupe_key = p_dedupe) then
    update public.flags set title = p_title, details = p_details
    where company_id = p_company and dedupe_key = p_dedupe and (title, coalesce(details, '')) is distinct from (p_title, coalesce(p_details, ''));
    return false;
  end if;
  perform app.raise_flag(p_company, p_kind, p_title, p_details, p_dedupe, p_extra, p_severity);
  return true;
end $$;

create function app.resolve_flags(p_company uuid, p_kind text, p_keep text[]) returns void
language sql security definer set search_path = '' as $$
  delete from public.flags where company_id = p_company and kind = p_kind and dedupe_key <> all (p_keep)
$$;

-- Supplier orders ------------------------------------------------------------------------------

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  supplier_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'received', 'cancelled')),
  -- A manager changed the lines, so the morning job leaves them alone.
  edited boolean not null default false,
  note text check (length(note) <= 1000),
  estimated_total numeric not null default 0,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id)
);
create unique index purchase_orders_one_draft on public.purchase_orders (supplier_id) where status = 'draft';
select app.setup_table('public.purchase_orders', '{}', '{admin,manager}');

create table public.purchase_order_lines (
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null,
  supply_id uuid not null,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  primary key (order_id, supply_id),
  foreign key (company_id, order_id) references public.purchase_orders (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id)
);
select app.setup_table('public.purchase_order_lines', '{}', '{admin,manager}', p_audit => false);

alter table public.deliveries add foreign key (company_id, purchase_order_id) references public.purchase_orders (company_id, id);

-- Receiving a delivery against an order closes the order.
create function app.close_received_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.purchase_orders set status = 'received', received_at = now()
  where id = new.purchase_order_id and company_id = new.company_id and status in ('approved', 'sent', 'draft');
  return new;
end $$;
create trigger deliveries_close_order after insert on public.deliveries
  for each row when (new.purchase_order_id is not null) execute function app.close_received_order();

-- p: {order_id, note, lines: [{supply_id, quantity (base units)}]} — a manager's edits to a draft.
create function public.save_purchase_order(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_order uuid := nullif(p ->> 'order_id', '')::uuid;
  l jsonb;
begin
  if not exists (select 1 from public.purchase_orders where id = v_order and company_id = v_company and status = 'draft') then
    raise exception 'That order list was not found, or it was already approved.';
  end if;
  delete from public.purchase_order_lines where order_id = v_order;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce(nullif(l ->> 'quantity', '')::numeric, 0) <= 0;
    insert into public.purchase_order_lines (company_id, order_id, supply_id, quantity, unit_cost)
    select v_company, v_order, s.id, (l ->> 'quantity')::numeric, s.cost_per_base
    from public.supplies s where s.id = (l ->> 'supply_id')::uuid and s.company_id = v_company;
    if not found then raise exception 'That supply was not found.'; end if;
  end loop;
  update public.purchase_orders
     set edited = true, note = nullif(btrim(p ->> 'note'), ''),
         estimated_total = (select coalesce(sum(quantity * unit_cost), 0) from public.purchase_order_lines where order_id = v_order)
   where id = v_order;
end $$;

-- A manager approves an order list. Suppliers who take orders by email get it
-- right away. For the rest, the app marks it approved and someone orders it.
create function public.approve_purchase_order(p_order_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  o public.purchase_orders;
  sup public.suppliers;
  c public.companies;
  v_lines jsonb;
begin
  select * into o from public.purchase_orders where id = p_order_id and company_id = v_company;
  if not found or o.status <> 'draft' then raise exception 'That order list was not found, or it was already approved.'; end if;
  select * into sup from public.suppliers where id = o.supplier_id;
  select * into c from public.companies where id = v_company;
  select jsonb_agg(jsonb_build_object('name', s.name, 'amount',
           app.amount_text(l.quantity / coalesce(pu.factor, 1), coalesce(pu.name, s.base_unit))) order by s.name)
    into v_lines
  from public.purchase_order_lines l
  join public.supplies s on s.id = l.supply_id
  left join public.supply_units pu on pu.id = s.purchase_unit_id
  where l.order_id = o.id;
  if v_lines is null then raise exception 'This order list is empty.'; end if;

  if c.status <> 'active' then raise exception 'Your business needs to be approved before the app can send emails.'; end if;
  if sup.order_method = 'email' and sup.email is not null then
    insert into public.outbox (company_id, channel, to_email, template, payload, dedupe_key)
    values (v_company, 'email', sup.email, 'supplier_order',
            jsonb_build_object('company_name', c.name, 'company_phone', c.phone, 'supplier_name', sup.name,
                               'contact_name', sup.contact_name, 'lines', v_lines, 'note', o.note,
                               'approved_by', (select full_name from public.profiles where user_id = auth.uid())),
            'supplier_order:' || o.id);
    update public.purchase_orders set status = 'sent', approved_by = auth.uid(), approved_at = now(), sent_at = now() where id = o.id;
    return 'sent';
  end if;
  update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = o.id;
  return 'approved';
end $$;

-- Someone ordered it by phone or online, or it's not needed after all.
create function public.set_purchase_order_status(p_order_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
begin
  if p_status not in ('sent', 'cancelled') then raise exception 'Unknown status.'; end if;
  update public.purchase_orders
     set status = p_status, sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_order_id and company_id = v_company and status in ('draft', 'approved', 'sent');
  if not found then raise exception 'That order list was not found.'; end if;
end $$;

-- Par level suggestions ---------------------------------------------------------------------------

create table public.par_suggestions (
  company_id uuid not null references public.companies (id) on delete cascade,
  truck_id uuid not null,
  supply_id uuid not null,
  suggested_qty numeric not null,
  avg_used numeric not null,
  shifts_counted integer not null,
  updated_at timestamptz not null default now(),
  primary key (truck_id, supply_id),
  foreign key (company_id, truck_id) references public.trucks (company_id, id) on delete cascade,
  foreign key (company_id, supply_id) references public.supplies (company_id, id) on delete cascade
);
select app.setup_table('public.par_suggestions', '{}', '{admin,manager}', p_audit => false);

-- Uses the suggestions as par levels (one truck, or all of them).
create function public.apply_par_suggestions(p_truck_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_count integer;
begin
  insert into public.truck_pars (company_id, truck_id, supply_id, par_quantity)
  select company_id, truck_id, supply_id, suggested_qty from public.par_suggestions
  where company_id = v_company and (p_truck_id is null or truck_id = p_truck_id) and suggested_qty > 0
  on conflict (truck_id, supply_id) do update set par_quantity = excluded.par_quantity, updated_by = auth.uid(), updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The jobs ------------------------------------------------------------------------------------------

-- Stock at all locations, per supply, compared with its reorder level.
create function app.low_supplies(p_company uuid)
returns table (supply_id uuid, name text, on_hand numeric, reorder_level numeric, order_up_to numeric, supplier_id uuid, unit_name text, unit_factor numeric)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, coalesce(sum(l.quantity), 0), s.reorder_level, s.order_up_to, s.supplier_id,
         coalesce(cu.name, s.base_unit), coalesce(cu.factor, 1)
  from public.supplies s
  left join public.stock_levels l on l.supply_id = s.id and l.place_id in (select id from public.locations where company_id = p_company)
  left join public.supply_units cu on cu.id = s.count_unit_id
  where s.company_id = p_company and s.active and s.reorder_level is not null
  group by s.id, cu.name, cu.factor
  having coalesce(sum(l.quantity), 0) <= s.reorder_level
$$;

-- Every run: low stock flags (and a push when something newly runs low).
create function app.job_low_stock(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_keep text[] := '{}';
  v_key text;
begin
  for r in select * from app.low_supplies(p_company) loop
    v_key := 'low_stock:' || r.supply_id;
    v_keep := v_keep || v_key;
    if app.raise_flag_once(p_company, 'low_stock', format('Low on %s', r.name),
         format('%s left. Reorder at %s.', app.amount_text(r.on_hand / r.unit_factor, r.unit_name),
                app.amount_text(r.reorder_level / r.unit_factor, r.unit_name)),
         v_key, jsonb_build_object('supply_id', r.supply_id)) then
      perform app.alert(p_company, format('Low on %s', r.name),
        format('%s left at your locations.', app.amount_text(r.on_hand / r.unit_factor, r.unit_name)), '/inventory',
        'low_stock:' || r.supply_id || ':' || now()::date);
    end if;
  end loop;
  perform app.resolve_flags(p_company, 'low_stock', v_keep);
end $$;

-- Every run: reminders for plans that didn't start, shifts left open, and count checks waiting.
create function app.job_reminders(p_company uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.company_settings;
  r record;
  v_user uuid;
  v_keep text[];
begin
  select * into st from public.company_settings where company_id = p_company;

  -- Planned shifts that should have started by now.
  v_keep := '{}';
  if st.scheduling_enabled then
    for r in
      select sc.*, t.name as truck from public.schedules sc join public.trucks t on t.id = sc.truck_id
      where sc.company_id = p_company and sc.status = 'planned'
        and sc.starts_at + make_interval(mins => st.start_reminder_minutes) <= p_now
        and sc.ends_at > p_now
        and not exists (select 1 from public.shifts x where x.schedule_id = sc.id or
                        (x.truck_id = sc.truck_id and x.status <> 'cancelled' and x.started_at >= sc.starts_at - interval '2 hours'))
    loop
      v_keep := v_keep || ('not_started:' || r.id);
      for v_user in
        select u from (select r.lead_id as u union select user_id from public.schedule_crew where schedule_id = r.id) x
        where u is not null and u in (select app.recipients(p_company, 'reminder_push'))
      loop
        perform app.notify(p_company, v_user, 'push', 'push',
          jsonb_build_object('title', format('Time to start %s', r.truck), 'body', 'Your shift was planned to start. Tap to start it.', 'url', '/shifts?start=1'),
          'start_reminder:' || r.id || ':' || v_user);
      end loop;
      if app.raise_flag_once(p_company, 'not_started', format('%s hasn''t started', r.truck),
           format('A shift was planned for %s and nobody has started it.', to_char(r.starts_at at time zone (select timezone from public.companies where id = p_company), 'FMHH12:MI AM')),
           'not_started:' || r.id, jsonb_build_object('truck_id', r.truck_id, 'user_id', r.lead_id)) then
        perform app.alert(p_company, format('%s hasn''t started', r.truck), 'A planned shift hasn''t been started yet.', '/shifts', 'not_started:' || r.id);
      end if;
    end loop;
  end if;
  perform app.resolve_flags(p_company, 'not_started', v_keep);

  -- Shifts left open.
  v_keep := '{}';
  for r in
    select s.*, t.name as truck from public.shifts s join public.trucks t on t.id = s.truck_id
    where s.company_id = p_company and s.status = 'open' and s.started_at < p_now - make_interval(hours => st.shift_reminder_hours)
  loop
    if r.lead_id in (select app.recipients(p_company, 'reminder_push')) then
      perform app.notify(p_company, r.lead_id, 'push', 'push',
        jsonb_build_object('title', format('%s is still open', r.truck), 'body', 'Finish the shift when you''re done for the day.', 'url', '/shifts/' || r.id),
        'open_reminder:' || r.id);
    end if;
    if r.started_at < p_now - make_interval(hours => st.shift_alert_hours) then
      v_keep := v_keep || ('open_too_long:' || r.id);
      if app.raise_flag_once(p_company, 'open_too_long', format('%s has been open a long time', r.truck),
           format('Started %s hours ago and not finished.', floor(extract(epoch from p_now - r.started_at) / 3600)),
           'open_too_long:' || r.id, jsonb_build_object('truck_id', r.truck_id, 'shift_id', r.id, 'user_id', r.lead_id)) then
        perform app.alert(p_company, format('%s has been open a long time', r.truck), 'The shift was never finished.', '/shifts/' || r.id, 'open_too_long:' || r.id);
      end if;
    end if;
  end loop;
  perform app.resolve_flags(p_company, 'open_too_long', v_keep);

  -- Count checks waiting too long.
  v_keep := '{}';
  if st.count_checks_enabled then
    for r in
      select s.*, t.name as truck from public.shifts s join public.trucks t on t.id = s.truck_id
      where s.company_id = p_company and s.count_check_status = 'waiting'
        and s.ended_at < p_now - make_interval(hours => st.count_check_reminder_hours)
    loop
      v_keep := v_keep || ('count_check_waiting:' || r.id);
      if app.raise_flag_once(p_company, 'count_check_waiting', format('%s is waiting for a count check', r.truck),
           'Count it before the truck goes out again.', 'count_check_waiting:' || r.id,
           jsonb_build_object('truck_id', r.truck_id, 'shift_id', r.id)) then
        perform app.alert(p_company, format('%s needs a count check', r.truck), 'Count it before the truck goes out again.',
          '/shifts/' || r.id || '?step=check', 'count_check_waiting:' || r.id);
      end if;
    end loop;
  end if;
  perform app.resolve_flags(p_company, 'count_check_waiting', v_keep);
end $$;

-- Morning: things about to expire, or already expired and still in stock.
create function app.job_expiration(p_company uuid, p_today date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.company_settings;
  r record;
  v_keep_soon text[] := '{}';
  v_keep_gone text[] := '{}';
begin
  select * into st from public.company_settings where company_id = p_company;
  if st.expiration_tracking then
    for r in
      select b.*, s.name, coalesce(l.name, t.name) as place
      from public.stock_batches b
      join public.supplies s on s.id = b.supply_id
      left join public.locations l on l.id = b.place_id
      left join public.trucks t on t.id = b.place_id
      where b.company_id = p_company and b.quantity > 0 and b.expires_on is not null
        and b.expires_on <= p_today + st.expiration_warning_days
    loop
      if r.expires_on < p_today then
        v_keep_gone := v_keep_gone || ('expired:' || r.id);
        perform app.raise_flag_once(p_company, 'expired', format('%s expired at %s', r.name, r.place),
          format('Expired %s and some is still in stock. Use the waste screen if it was thrown out.', to_char(r.expires_on, 'Mon FMDD')),
          'expired:' || r.id, jsonb_build_object('supply_id', r.supply_id), 'alert');
      else
        v_keep_soon := v_keep_soon || ('expiring:' || r.id);
        perform app.raise_flag_once(p_company, 'expiring', format('%s expires soon at %s', r.name, r.place),
          format('Expires %s. Use it first.', to_char(r.expires_on, 'Mon FMDD')),
          'expiring:' || r.id, jsonb_build_object('supply_id', r.supply_id), 'info');
      end if;
    end loop;
  end if;
  perform app.resolve_flags(p_company, 'expired', v_keep_gone);
  perform app.resolve_flags(p_company, 'expiring', v_keep_soon);
end $$;

-- Morning: order lists for each supplier with things running low. Drafts the
-- manager hasn't touched are rebuilt. Nothing goes to a supplier until a
-- manager approves it.
create function app.job_orders(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sup record;
  v_order uuid;
  v_new boolean;
begin
  for sup in
    select distinct x.supplier_id, s.name from app.low_supplies(p_company) x
    join public.suppliers s on s.id = x.supplier_id
    where x.supplier_id is not null and s.active
  loop
    select id into v_order from public.purchase_orders where supplier_id = sup.supplier_id and status = 'draft';
    v_new := v_order is null;
    if v_new then
      insert into public.purchase_orders (company_id, supplier_id) values (p_company, sup.supplier_id) returning id into v_order;
    elsif (select edited from public.purchase_orders where id = v_order) then
      continue;
    end if;
    delete from public.purchase_order_lines where order_id = v_order;
    -- Order up to the "order up to" amount (or twice the reorder level), in whole purchase units,
    -- skipping anything already on an order that hasn't arrived.
    insert into public.purchase_order_lines (company_id, order_id, supply_id, quantity, unit_cost)
    select p_company, v_order, x.supply_id,
           ceil((coalesce(x.order_up_to, x.reorder_level * 2) - x.on_hand) / coalesce(pu.factor, 1) - 0.0001) * coalesce(pu.factor, 1),
           s.cost_per_base
    from app.low_supplies(p_company) x
    join public.supplies s on s.id = x.supply_id
    left join public.supply_units pu on pu.id = s.purchase_unit_id
    where x.supplier_id = sup.supplier_id
      and coalesce(x.order_up_to, x.reorder_level * 2) > x.on_hand
      and not exists (select 1 from public.purchase_order_lines ol join public.purchase_orders o on o.id = ol.order_id
                      where ol.supply_id = x.supply_id and o.status in ('approved', 'sent'));
    if not exists (select 1 from public.purchase_order_lines where order_id = v_order) then
      delete from public.purchase_orders where id = v_order;
      continue;
    end if;
    update public.purchase_orders
       set estimated_total = (select coalesce(sum(quantity * unit_cost), 0) from public.purchase_order_lines where order_id = v_order)
     where id = v_order;
    if v_new then
      perform app.alert(p_company, format('Order list ready for %s', sup.name), 'Check it and approve it to send.', '/orders',
        'order_ready:' || v_order);
    end if;
  end loop;
end $$;

-- The "Check now" button: builds order lists right away instead of waiting for the morning.
create function public.build_order_lists() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
begin
  perform app.job_orders(v_company);
  return (select count(*)::integer from public.purchase_orders where company_id = v_company and status = 'draft');
end $$;

-- Weekly: suggested par levels from what each truck really used on its last shifts.
create function app.job_par_suggestions(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.company_settings;
begin
  select * into st from public.company_settings where company_id = p_company;
  delete from public.par_suggestions where company_id = p_company;
  insert into public.par_suggestions (company_id, truck_id, supply_id, suggested_qty, avg_used, shifts_counted)
  select p_company, x.truck_id, x.supply_id,
         ceil(x.avg_used * (1 + st.par_cushion_percent / 100) / coalesce(cu.factor, 1) - 0.0001) * coalesce(cu.factor, 1),
         x.avg_used, x.n
  from (
    select t.truck_id, r.supply_id, avg(greatest(r.actual_qty, 0)) as avg_used, count(*)::integer as n
    from (
      select s.id, s.truck_id, row_number() over (partition by s.truck_id order by s.ended_at desc) as rn
      from public.shifts s where s.company_id = p_company and s.status = 'closed'
    ) t
    join public.shift_results r on r.shift_id = t.id and r.supply_id is not null
    where t.rn <= st.par_lookback_shifts
    group by t.truck_id, r.supply_id
  ) x
  join public.supplies sp on sp.id = x.supply_id and sp.active
  left join public.supply_units cu on cu.id = sp.count_unit_id
  where x.avg_used > 0;

  if st.par_auto_update then
    insert into public.truck_pars (company_id, truck_id, supply_id, par_quantity)
    select company_id, truck_id, supply_id, suggested_qty from public.par_suggestions where company_id = p_company and suggested_qty > 0
    on conflict (truck_id, supply_id) do update set par_quantity = excluded.par_quantity, updated_by = null, updated_at = now();
  end if;
end $$;

-- Weekly: patterns a person would only notice over time.
create function app.job_patterns(p_company uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.company_settings;
  v_avg numeric;
  r record;
  v_week text := to_char(p_now, 'IYYY-IW');
begin
  select * into st from public.company_settings where company_id = p_company;

  -- Leads whose waste per shift is well above the business's average (last 30 days).
  select avg(w) into v_avg from (
    select coalesce((select sum(cost) from public.waste_logs where shift_id = s.id), 0) as w
    from public.shifts s where s.company_id = p_company and s.status = 'closed' and s.ended_at > p_now - interval '30 days'
  ) a;
  if coalesce(v_avg, 0) > 0 then
    for r in
      select s.lead_id, p.full_name, count(*) as n, avg(coalesce((select sum(cost) from public.waste_logs where shift_id = s.id), 0)) as w
      from public.shifts s join public.profiles p on p.user_id = s.lead_id
      where s.company_id = p_company and s.status = 'closed' and s.ended_at > p_now - interval '30 days'
      group by s.lead_id, p.full_name
      having count(*) >= 3
    loop
      if r.w > v_avg * st.waste_pattern_factor then
        perform app.raise_flag(p_company, 'waste_pattern', format('%s has more waste than usual', r.full_name),
          format('$%s of waste per shift over the last 30 days. The business average is $%s.',
                 to_char(r.w, 'FM999990.00'), to_char(v_avg, 'FM999990.00')),
          'waste_pattern:' || r.lead_id || ':' || v_week, jsonb_build_object('user_id', r.lead_id));
      end if;
    end loop;
  end if;

  -- The same supply off on a truck again and again (3 of its last 5 shifts).
  for r in
    select x.truck_id, x.supply_id, t.name as truck, sp.name as supply, count(*) filter (where x.flagged) as n
    from (
      select s.truck_id, r.supply_id, r.flagged,
             dense_rank() over (partition by s.truck_id order by s.ended_at desc) as rn
      from public.shifts s join public.shift_results r on r.shift_id = s.id and r.supply_id is not null
      where s.company_id = p_company and s.status = 'closed'
    ) x
    join public.trucks t on t.id = x.truck_id
    join public.supplies sp on sp.id = x.supply_id
    where x.rn <= 5
    group by x.truck_id, x.supply_id, t.name, sp.name
    having count(*) filter (where x.flagged) >= 3
  loop
    perform app.raise_flag(p_company, 'repeat_diff', format('%s keeps coming up off on %s', r.supply, r.truck),
      format('%s was off by more than your limits on %s of the last 5 shifts.', r.supply, r.n),
      'repeat_diff:' || r.truck_id || ':' || r.supply_id || ':' || v_week,
      jsonb_build_object('truck_id', r.truck_id, 'supply_id', r.supply_id));
  end loop;
end $$;

-- Numbers for a report over a stretch of time. Sales count only the winning
-- source on each shift, same as the comparison.
create function app.report_data(p_company uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  with st as (select * from public.company_settings where company_id = p_company),
  sh as (
    select s.* from public.shifts s
    where s.company_id = p_company and s.status = 'closed' and s.ended_at >= p_from and s.ended_at < p_to
  ),
  win as (
    select sh.id, (select o.g from st, unnest(st.sales_source_order) with ordinality as o(g, n)
                   where exists (select 1 from public.sales sa where sa.shift_id = sh.id and app.sale_group(sa.source) = o.g)
                   order by o.n limit 1) as g
    from sh
  ),
  sold as (
    select sa.shift_id, sum(sa.quantity) as drinks, sum(sa.quantity) filter (where sa.is_free) as free, sum(sa.price) as revenue
    from public.sales sa join win on win.id = sa.shift_id and app.sale_group(sa.source) = win.g
    group by sa.shift_id
  ),
  per_shift as (
    select sh.id, sh.truck_id,
           coalesce((select sum(greatest(r.actual_qty, 0) * r.unit_cost) from public.shift_results r where r.shift_id = sh.id and r.supply_id is not null), 0) as used,
           coalesce((select sum(w.cost) from public.waste_logs w where w.shift_id = sh.id), 0) as waste,
           coalesce(sold.drinks, 0) as drinks, coalesce(sold.free, 0) as free, coalesce(sold.revenue, 0) as revenue,
           (select count(*) from public.shift_results r where r.shift_id = sh.id and r.flagged) as flagged
    from sh left join sold on sold.shift_id = sh.id
  )
  select jsonb_build_object(
    'shifts', (select count(*) from per_shift),
    'used', round((select coalesce(sum(used), 0) from per_shift), 2),
    'waste', round((select coalesce(sum(waste), 0) from per_shift)
                   + coalesce((select sum(cost) from public.waste_logs w where w.company_id = p_company and w.shift_id is null
                               and w.created_at >= p_from and w.created_at < p_to), 0), 2),
    'drinks', (select coalesce(sum(drinks), 0) from per_shift),
    'free', (select coalesce(sum(free), 0) from per_shift),
    'revenue', round((select coalesce(sum(revenue), 0) from per_shift), 2),
    'flagged_shifts', (select count(*) from per_shift where flagged > 0),
    'open_flags', (select count(*) from public.flags where company_id = p_company and status = 'open'),
    'trucks', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'shifts', x.n, 'used', round(x.used, 2), 'waste', round(x.waste, 2),
                                          'drinks', x.drinks, 'revenue', round(x.revenue, 2)) order by t.name)
      from (select truck_id, count(*) as n, sum(used) as used, sum(waste) as waste, sum(drinks) as drinks, sum(revenue) as revenue
            from per_shift group by truck_id) x
      join public.trucks t on t.id = x.truck_id), '[]'),
    'top_flags', coalesce((
      select jsonb_agg(f.title order by f.created_at desc) from (
        select title, created_at from public.flags
        where company_id = p_company and status = 'open' and created_at >= p_from
        order by created_at desc limit 5) f), '[]'),
    'waste_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', x.reason, 'cost', round(x.cost, 2)) order by x.cost desc)
      from (select coalesce(wr.name, 'No reason') as reason, sum(w.cost) as cost
            from public.waste_logs w left join public.waste_reasons wr on wr.id = w.reason_id
            where w.company_id = p_company and w.created_at >= p_from and w.created_at < p_to
            group by 1) x), '[]')
  )
$$;

create function app.send_report(p_company uuid, p_pref text, p_kind text, p_label text, p_from timestamptz, p_to timestamptz, p_period text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_data jsonb := app.report_data(p_company, p_from, p_to);
  v_user uuid;
begin
  -- A quiet day doesn't need an email. Weekly and monthly ones always go out.
  if p_kind = 'daily' and (v_data ->> 'shifts')::integer = 0 and (v_data ->> 'open_flags')::integer = 0 then return; end if;
  for v_user in select app.recipients(p_company, p_pref) loop
    perform app.notify(p_company, v_user, 'email', 'report',
      v_data || jsonb_build_object('kind', p_kind, 'label', p_label,
                                   'company_name', (select name from public.companies where id = p_company)),
      'report:' || p_kind || ':' || p_company || ':' || p_period || ':' || v_user);
  end loop;
end $$;

-- Morning email: what's low, what's expiring, order lists to approve, checks waiting, and today's plan.
create function app.job_morning_summary(p_company uuid, p_today date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := (select timezone from public.companies where id = p_company);
  v_data jsonb;
  v_user uuid;
begin
  select jsonb_build_object(
    'company_name', (select name from public.companies where id = p_company),
    'date', to_char(p_today, 'FMDay, Mon FMDD'),
    'low', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'left', app.amount_text(on_hand / unit_factor, unit_name)) order by name)
                     from app.low_supplies(p_company)), '[]'),
    'expiring', coalesce((select jsonb_agg(title order by created_at) from public.flags
                          where company_id = p_company and kind in ('expiring', 'expired') and status = 'open'), '[]'),
    'orders', coalesce((select jsonb_agg(s.name order by s.name) from public.purchase_orders o join public.suppliers s on s.id = o.supplier_id
                        where o.company_id = p_company and o.status = 'draft'), '[]'),
    'count_checks', (select count(*) from public.shifts where company_id = p_company and count_check_status = 'waiting'),
    'planned', coalesce((select jsonb_agg(jsonb_build_object('truck', t.name, 'time', to_char(sc.starts_at at time zone v_tz, 'FMHH12:MI AM'),
                                                            'lead', p.full_name, 'event', sc.event_name) order by sc.starts_at)
                         from public.schedules sc join public.trucks t on t.id = sc.truck_id left join public.profiles p on p.user_id = sc.lead_id
                         where sc.company_id = p_company and sc.status = 'planned' and (sc.starts_at at time zone v_tz)::date = p_today), '[]')
  ) into v_data;
  if jsonb_array_length(v_data -> 'low') = 0 and jsonb_array_length(v_data -> 'expiring') = 0 and jsonb_array_length(v_data -> 'orders') = 0
     and (v_data ->> 'count_checks')::integer = 0 and jsonb_array_length(v_data -> 'planned') = 0 then
    return;
  end if;
  for v_user in select app.recipients(p_company, 'morning_email') loop
    perform app.notify(p_company, v_user, 'email', 'morning_summary', v_data, 'morning:' || p_company || ':' || p_today || ':' || v_user);
  end loop;
end $$;

-- The one timer calls this every 15 minutes. p_now is only set by tests.
create function app.run_due_jobs(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  st public.company_settings;
  v_local timestamp;
  v_today date;
  v_report_at timestamptz;
  v_month_start date;
  v_count integer := 0;
begin
  for c in select * from public.companies where status = 'active' loop
    begin
      select * into st from public.company_settings where company_id = c.id;
      v_local := p_now at time zone c.timezone;
      v_today := v_local::date;

      perform app.job_low_stock(c.id);
      perform app.job_reminders(c.id, p_now);

      if extract(hour from v_local) >= st.morning_hour and app.claim_job(c.id, 'morning', v_today::text) then
        perform app.job_expiration(c.id, v_today);
        perform app.job_orders(c.id);
        perform app.job_morning_summary(c.id, v_today);
      end if;

      if extract(hour from v_local) >= st.daily_report_hour and app.claim_job(c.id, 'daily', v_today::text) then
        v_report_at := (v_today + make_interval(hours => st.daily_report_hour)) at time zone c.timezone;
        perform app.send_report(c.id, 'daily_email', 'daily', to_char(v_today, 'FMDay, Mon FMDD'),
                                v_report_at - interval '1 day', v_report_at, v_today::text);
      end if;

      if extract(dow from v_local) = st.weekly_report_day and extract(hour from v_local) >= st.summary_hour
         and app.claim_job(c.id, 'weekly', to_char(v_today, 'IYYY-IW')) then
        v_report_at := (v_today + make_interval(hours => st.summary_hour)) at time zone c.timezone;
        perform app.send_report(c.id, 'weekly_email', 'weekly', 'the week up to ' || to_char(v_today, 'Mon FMDD'),
                                v_report_at - interval '7 days', v_report_at, to_char(v_today, 'IYYY-IW'));
        perform app.job_par_suggestions(c.id);
        perform app.job_patterns(c.id, p_now);
      end if;

      if extract(day from v_local) = 1 and extract(hour from v_local) >= st.summary_hour
         and app.claim_job(c.id, 'monthly', to_char(v_today, 'YYYY-MM')) then
        v_month_start := (v_today - interval '1 month')::date;
        perform app.send_report(c.id, 'monthly_email', 'monthly', to_char(v_month_start, 'FMMonth YYYY'),
                                v_month_start::timestamp at time zone c.timezone, v_today::timestamp at time zone c.timezone,
                                to_char(v_month_start, 'YYYY-MM'));
      end if;
      v_count := v_count + 1;
    exception when others then
      -- One business's problem never stops the others.
      raise warning 'Jobs failed for company %: %', c.id, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;

-- Photo cleanup (run by the cleanup-photos Edge Function, which deletes the files) -----------------

create function public.service_old_photos(p_limit integer default 200) returns table (path text)
language sql stable security definer set search_path = '' as $$
  select x.path from (
    select w.photo_path as path, w.created_at, w.company_id from public.waste_logs w where w.photo_path is not null
    union all
    select c.photo_path, c.entered_at, c.company_id from public.shift_counts c where c.photo_path is not null
  ) x
  join public.company_settings st on st.company_id = x.company_id
  where x.created_at < now() - make_interval(days => st.photo_retention_days)
  limit p_limit
$$;

create function public.service_forget_photos(p_paths text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.waste_logs set photo_path = null where photo_path = any (p_paths);
  update public.shift_counts set photo_path = null where photo_path = any (p_paths);
end $$;

-- Grants -----------------------------------------------------------------------------------------

revoke execute on function
  app.recipients(uuid, text), app.notify(uuid, uuid, text, text, jsonb, text), app.alert(uuid, text, text, text, text),
  app.claim_job(uuid, text, text), app.raise_flag_once(uuid, text, text, text, text, jsonb, text), app.resolve_flags(uuid, text, text[]),
  app.close_received_order(), app.low_supplies(uuid), app.job_low_stock(uuid), app.job_reminders(uuid, timestamptz),
  app.job_expiration(uuid, date), app.job_orders(uuid), app.job_par_suggestions(uuid), app.job_patterns(uuid, timestamptz),
  app.report_data(uuid, timestamptz, timestamptz), app.send_report(uuid, text, text, text, timestamptz, timestamptz, text),
  app.job_morning_summary(uuid, date), app.run_due_jobs(timestamptz)
from public, anon, authenticated;

revoke execute on function
  public.save_push_subscription(jsonb), public.service_push_targets(uuid), public.service_drop_push(text),
  public.save_purchase_order(jsonb), public.approve_purchase_order(uuid), public.set_purchase_order_status(uuid, text),
  public.apply_par_suggestions(uuid), public.service_old_photos(integer), public.service_forget_photos(text[]),
  public.build_order_lists()
from public, anon, authenticated;
grant execute on function
  public.save_push_subscription(jsonb), public.save_purchase_order(jsonb), public.approve_purchase_order(uuid),
  public.set_purchase_order_status(uuid, text), public.apply_par_suggestions(uuid), public.build_order_lists()
to authenticated;
grant execute on function
  public.service_push_targets(uuid), public.service_drop_push(text), public.service_old_photos(integer), public.service_forget_photos(text[])
to service_role;
