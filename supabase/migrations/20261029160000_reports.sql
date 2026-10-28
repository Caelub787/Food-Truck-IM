-- Phase 9: reports (usage vs sales, waste, free drinks, count checks, drivers,
-- and sales minus costs) and manager corrections to finished shifts, with history.

-- Everything the reports screen shows for a stretch of time, read from the
-- saved shift results. Sales count only the winning source on each shift,
-- same as the comparison.
create function public.report(p_from timestamptz, p_to timestamptz, p_truck uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  v_out jsonb;
begin
  with st as (select * from public.company_settings where company_id = v_company),
  sh as (
    select s.* from public.shifts s
    where s.company_id = v_company and s.status = 'closed' and s.ended_at >= p_from and s.ended_at < p_to
      and (p_truck is null or s.truck_id = p_truck)
  ),
  win as (
    select sh.id, (select o.g from st, unnest(st.sales_source_order) with ordinality as o(g, n)
                   where exists (select 1 from public.sales sa where sa.shift_id = sh.id and app.sale_group(sa.source) = o.g)
                   order by o.n limit 1) as g
    from sh
  ),
  sold as (select sa.* from public.sales sa join win on win.id = sa.shift_id and app.sale_group(sa.source) = win.g),
  res as (select r.* from public.shift_results r join sh on sh.id = r.shift_id),
  waste as (
    select w.* from public.waste_logs w
    where w.company_id = v_company and w.created_at >= p_from and w.created_at < p_to and (p_truck is null or w.place_id = p_truck)
  ),
  per_shift as (
    select sh.id, sh.truck_id, sh.lead_id, sh.business_date, sh.event_name, sh.count_check_status,
           coalesce((select sum(quantity) from sold where shift_id = sh.id), 0) as drinks,
           coalesce((select sum(quantity) from sold where shift_id = sh.id and is_free), 0) as free,
           coalesce((select sum(price) from sold where shift_id = sh.id), 0) as revenue,
           coalesce((select sum(greatest(actual_qty, 0) * unit_cost) from res where shift_id = sh.id and supply_id is not null), 0) as used,
           coalesce((select sum(cost) from public.waste_logs where shift_id = sh.id), 0) as waste,
           coalesce((select sum(abs(diff_qty) * unit_cost) from res where shift_id = sh.id and diff_qty is not null), 0) as off_cost,
           (select count(*) from res where shift_id = sh.id and flagged) as flagged,
           (select w.g from win w where w.id = sh.id) as source
    from sh
  ),
  -- What free drinks used, at today's costs (groups at their members' average cost).
  free_cost as (
    select f.free_reason_id, sum(f.quantity) as drinks,
           sum(f.quantity * coalesce((
             select sum(x.quantity * coalesce(sp.cost_per_base,
                    (select avg(m.cost_per_base) from public.supplies m where m.group_id = x.group_id and m.active), 0))
             from app.usage_for_sale(f.product_size_id, f.modifier_ids, f.sold_at) x
             left join public.supplies sp on sp.id = x.supply_id), 0)) as cost
    from sold f where f.is_free
    group by f.free_reason_id
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'shifts', count(*), 'drinks', coalesce(sum(drinks), 0), 'free', coalesce(sum(free), 0),
        'revenue', round(coalesce(sum(revenue), 0), 2), 'used', round(coalesce(sum(used), 0), 2),
        'shift_waste', round(coalesce(sum(waste), 0), 2), 'off_cost', round(coalesce(sum(off_cost), 0), 2),
        'flagged_shifts', count(*) filter (where flagged > 0),
        'all_waste', round((select coalesce(sum(cost), 0) from waste), 2))
      from per_shift),
    'shifts', coalesce((select jsonb_agg(to_jsonb(p) order by p.business_date desc, p.truck_id) from per_shift p), '[]'),
    'supplies', coalesce((
      select jsonb_agg(jsonb_build_object('supply_id', r.supply_id, 'group_id', r.group_id,
               'actual', r.actual, 'expected', r.expected, 'diff', r.diff, 'cost', round(r.cost, 2), 'shifts', r.n))
      from (select supply_id, group_id, sum(actual_qty) as actual, sum(expected_qty) as expected, sum(diff_qty) as diff,
                   sum(greatest(actual_qty, 0) * unit_cost) filter (where supply_id is not null) as cost, count(*) as n
            from res group by supply_id, group_id) r), '[]'),
    'waste_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason_id', reason_id, 'count', n, 'cost', round(c, 2)) order by c desc)
      from (select reason_id, count(*) as n, sum(cost) as c from waste group by reason_id) x), '[]'),
    'waste_supplies', coalesce((
      select jsonb_agg(jsonb_build_object('supply_id', supply_id, 'quantity', q, 'cost', round(c, 2)) order by c desc)
      from (select m.supply_id, sum(m.quantity) as q, sum(m.quantity * m.unit_cost) as c
            from public.stock_movements m join waste w on w.id = m.waste_log_id
            where m.kind = 'waste' group by m.supply_id) x), '[]'),
    'free_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason_id', free_reason_id, 'drinks', drinks, 'cost', round(cost, 2)) order by drinks desc)
      from free_cost), '[]'),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', lead_id, 'shifts', n, 'drinks', d, 'revenue', round(rv, 2), 'used', round(u, 2),
                                          'waste', round(w, 2), 'off_cost', round(oc, 2), 'flagged_shifts', f) order by n desc)
      from (select lead_id, count(*) as n, sum(drinks) as d, sum(revenue) as rv, sum(used) as u, sum(waste) as w,
                   sum(off_cost) as oc, count(*) filter (where flagged > 0) as f
            from per_shift group by lead_id) x), '[]'),
    'count_checks', (select jsonb_build_object(
        'done', count(*) filter (where count_check_status = 'done'),
        'missed', count(*) filter (where count_check_status = 'missed'),
        'waiting', count(*) filter (where count_check_status = 'waiting'),
        'different', (select count(*) from public.shift_counts c join public.shift_counts e
                        on e.shift_id = c.shift_id and e.supply_id = c.supply_id and e.kind = 'end'
                      where c.kind = 'check' and c.shift_id in (select id from sh) and c.quantity <> e.quantity))
      from per_shift),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', business_date, 'shifts', n, 'drinks', d, 'revenue', round(rv, 2), 'used', round(u, 2),
                                          'waste', round(w, 2)) order by business_date)
      from (select business_date, count(*) as n, sum(drinks) as d, sum(revenue) as rv, sum(used) as u, sum(waste) as w
            from per_shift group by business_date) x), '[]')
  ) into v_out;
  return v_out;
end $$;

-- p: {shift_id, supply_id, kind ('start' or 'end'), quantity (base units), reason}
-- A manager fixes a count on a finished shift. The shift is worked out again,
-- the change is kept in the history with the reason, and if it's the truck's
-- latest shift its stock is corrected too.
create function public.correct_shift_count(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_role('admin', 'manager');
  s public.shifts;
  v_supply uuid := nullif(p ->> 'supply_id', '')::uuid;
  v_kind text := p ->> 'kind';
  v_qty numeric := nullif(p ->> 'quantity', '')::numeric;
  v_reason text := nullif(btrim(p ->> 'reason'), '');
  v_old numeric;
  v_old_end numeric;
  v_new_end numeric;
  v_delta numeric;
begin
  select * into s from public.shifts where id = nullif(p ->> 'shift_id', '')::uuid and company_id = v_company;
  if not found then raise exception 'That shift was not found.'; end if;
  if s.status <> 'closed' then raise exception 'Fix counts after the shift is finished. Until then, change them on the shift.'; end if;
  if v_kind not in ('start', 'end') then raise exception 'Pick the starting or ending count.'; end if;
  if v_qty is null or v_qty < 0 then raise exception 'Enter the right amount.'; end if;
  if v_reason is null then raise exception 'Say why it''s being changed, for the history.'; end if;
  if not exists (select 1 from public.supplies where id = v_supply and company_id = v_company) then
    raise exception 'That supply was not found.';
  end if;

  select quantity into v_old from public.shift_counts where shift_id = s.id and supply_id = v_supply and kind = v_kind;
  select end_qty into v_old_end from public.shift_results where shift_id = s.id and supply_id = v_supply;

  insert into public.shift_counts (company_id, shift_id, supply_id, kind, quantity)
  values (v_company, s.id, v_supply, v_kind, v_qty)
  on conflict (shift_id, supply_id, kind) do update set quantity = excluded.quantity, entered_by = auth.uid(), entered_at = now();

  insert into public.audit_log (company_id, actor_id, action, table_name, row_id, old_data, new_data, reason)
  values (v_company, auth.uid(), 'correct', 'shift_counts', s.id::text,
          jsonb_build_object('supply_id', v_supply, 'kind', v_kind, 'quantity', v_old),
          jsonb_build_object('supply_id', v_supply, 'kind', v_kind, 'quantity', v_qty), v_reason);

  perform app.compute_shift_results(s.id);
  perform app.compare_shift(s.id);

  -- The truck's stock follows the ending count, but only if nothing has happened on it since.
  select end_qty into v_new_end from public.shift_results where shift_id = s.id and supply_id = v_supply;
  v_delta := coalesce(v_new_end, 0) - coalesce(v_old_end, 0);
  if v_delta <> 0 and not exists (
    select 1 from public.shifts x where x.truck_id = s.truck_id and x.started_at > s.started_at and x.status <> 'cancelled'
  ) then
    if v_delta > 0 then
      perform app.move_stock(v_company, v_supply, v_delta, null, s.truck_id, 'correction', jsonb_build_object('shift_id', s.id, 'reason', v_reason));
    else
      perform app.move_stock(v_company, v_supply, -v_delta, s.truck_id, null, 'correction', jsonb_build_object('shift_id', s.id, 'reason', v_reason));
    end if;
  end if;
end $$;

revoke execute on function public.report(timestamptz, timestamptz, uuid), public.correct_shift_count(jsonb) from public, anon, authenticated;
grant execute on function public.report(timestamptz, timestamptz, uuid), public.correct_shift_count(jsonb) to authenticated;
