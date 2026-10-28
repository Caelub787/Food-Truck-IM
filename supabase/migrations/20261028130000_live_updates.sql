-- Live updates.
--
-- Every change sends a tiny signal ("this table changed") to the company's
-- private Realtime channel, named company:<company id>. Open screens hear it and
-- reload just that data through the normal security rules, so nobody ever has
-- to refresh. Signals carry no row data, and only members of the company can
-- listen. Tables shown on the App Owner screen also signal the "owner" channel.
--
-- Every new company table must call app.enable_live() (see CLAUDE.md).

-- Sends one signal per company per statement, so a big import sends a handful
-- of messages instead of thousands.
create function app.broadcast_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := case when tg_table_name = 'companies' then 'id' else 'company_id' end;
  v_signal jsonb := jsonb_build_object('table', tg_table_name, 'op', lower(tg_op));
  v_company uuid;
  v_any boolean := false;
begin
  if tg_op = 'DELETE' then
    for v_company in select distinct (to_jsonb(o) ->> v_key)::uuid from old_rows o loop
      v_any := true;
      if v_company is not null then
        perform realtime.send(v_signal, 'change', 'company:' || v_company, true);
      end if;
    end loop;
  else
    for v_company in select distinct (to_jsonb(n) ->> v_key)::uuid from new_rows n loop
      v_any := true;
      if v_company is not null then
        perform realtime.send(v_signal, 'change', 'company:' || v_company, true);
      end if;
    end loop;
  end if;

  if v_any and tg_argv[0] = 'owner' then
    perform realtime.send(v_signal, 'change', 'owner', true);
  end if;
  return null;
end $$;

-- Turns on live updates for a table.
create function app.enable_live(p_table regclass, p_owner boolean default false) returns void
language plpgsql set search_path = '' as $$
declare
  v_name text := (select relname from pg_catalog.pg_class where oid = p_table);
  v_arg text := case when p_owner then '''owner''' else '' end;
begin
  execute format(
    'create trigger %I after insert on %s referencing new table as new_rows
     for each statement execute function app.broadcast_changes(%s)',
    v_name || '_live_insert', p_table, v_arg);
  execute format(
    'create trigger %I after update on %s referencing new table as new_rows
     for each statement execute function app.broadcast_changes(%s)',
    v_name || '_live_update', p_table, v_arg);
  execute format(
    'create trigger %I after delete on %s referencing old table as old_rows
     for each statement execute function app.broadcast_changes(%s)',
    v_name || '_live_delete', p_table, v_arg);
end $$;

select app.enable_live('public.companies', p_owner => true);
select app.enable_live('public.profiles', p_owner => true);

-- Who can listen. Realtime checks this when someone joins a private channel.
-- There is no insert rule, so nobody can send on these channels from the app.
create policy live_listen on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (select realtime.topic()) = 'company:' || (select app.company_id())::text
    or ((select realtime.topic()) = 'owner' and (select app.is_owner()))
  )
);

revoke execute on function app.broadcast_changes(), app.enable_live(regclass, boolean) from public, anon, authenticated;
