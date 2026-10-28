-- Phase 1: companies, people, roles, App Owner, audit log, and the email outbox.
--
-- Security model (see CLAUDE.md):
--   * Every company table has row level security. Policies use the app.* helpers.
--   * Anything that writes more than one row, or needs checks the policies can't
--     express, is a security definer function with an empty search_path.
--   * anon gets nothing. authenticated only gets what is granted below.

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- New objects should not be open to everyone by default.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema app revoke execute on functions from public;

create type public.company_status as enum ('pending', 'active', 'declined', 'suspended');
create type public.user_role as enum ('admin', 'manager', 'driver');

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Companies -----------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  status public.company_status not null default 'pending',
  timezone text not null default 'America/Chicago',
  phone text check (length(phone) <= 40),
  truck_count_estimate integer check (truck_count_estimate between 0 and 10000),
  signup_note text check (length(signup_note) <= 1000),
  status_reason text check (length(status_reason) <= 1000),
  status_changed_at timestamptz,
  status_changed_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_status_idx on public.companies (status);
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

-- Scheduled reports run in each company's time zone, so it has to be a real one.
create function app.check_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Please pick a valid time zone.';
  end if;
  return new;
end $$;
create trigger companies_timezone before insert or update of timezone on public.companies
  for each row execute function app.check_timezone();

-- People --------------------------------------------------------------------
-- One row per person. A person belongs to exactly one company.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text not null check (email = lower(email)),
  phone text check (length(phone) <= 40),
  role public.user_role not null,
  active boolean not null default true,
  invited_by uuid,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index profiles_company_idx on public.profiles (company_id);
create unique index profiles_email_idx on public.profiles (email);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- App Owner -----------------------------------------------------------------
-- Emails listed here get the owner section. Filled in at deploy time, never in git.

create table public.app_owners (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- Audit log -----------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_id uuid,
  action text not null,
  table_name text,
  row_id text,
  old_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_log_company_idx on public.audit_log (company_id, created_at desc);

-- Outbox --------------------------------------------------------------------
-- Every email and push goes here first. The send-outbox Edge Function delivers it.

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  to_user uuid references auth.users (id) on delete cascade,
  to_email text,
  template text not null,
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_user is not null or to_email is not null)
);
create index outbox_pending_idx on public.outbox (send_after) where status = 'pending';

-- Helpers used by the security rules ----------------------------------------

-- The logged in person's company, only if they are turned on and the company
-- is pending or active. Declined and suspended companies get nothing.
create function app.company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.company_id
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.user_id = (select auth.uid())
    and p.active
    and c.status in ('pending', 'active')
$$;

create function app.role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.user_id = (select auth.uid())
    and p.active
    and c.status in ('pending', 'active')
$$;

create function app.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.app_owners o on o.email = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  )
$$;

create function app.assert_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner() then
    raise exception 'Only the app owner can do this.' using errcode = '42501';
  end if;
end $$;

-- Checks that p_actor may add or change someone with p_target_role, and returns
-- the actor's company. Admins manage everyone. Managers manage drivers only.
create function app.assert_can_manage(p_actor uuid, p_target_role public.user_role, p_need_active boolean)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role public.user_role;
  v_status public.company_status;
begin
  select p.company_id, p.role, c.status
    into v_company, v_role, v_status
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.user_id = p_actor and p.active;

  if v_company is null or v_status not in ('pending', 'active') then
    raise exception 'You do not have access to do this.' using errcode = '42501';
  end if;
  if p_need_active and v_status <> 'active' then
    raise exception 'Your business is waiting for approval. You can invite people once it is approved.'
      using errcode = '42501';
  end if;
  if v_role = 'driver' or (v_role = 'manager' and p_target_role <> 'driver') then
    raise exception 'You do not have permission to manage this person.' using errcode = '42501';
  end if;
  return v_company;
end $$;

-- Audit trigger: records who changed what. A reason can be passed with
-- set_config('app.reason', '...', true) before the change.
create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_company uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  if tg_table_name = 'companies' then
    v_company := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_company := coalesce(v_new ->> 'company_id', v_old ->> 'company_id')::uuid;
  end if;

  insert into public.audit_log (company_id, actor_id, action, table_name, row_id, old_data, new_data, reason)
  values (
    v_company,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id'),
    v_old,
    v_new,
    nullif(current_setting('app.reason', true), '')
  );
  return coalesce(new, old);
end $$;

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function app.audit();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function app.audit();

-- Security rules --------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.app_owners enable row level security;
alter table public.audit_log enable row level security;
alter table public.outbox enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (id = (select app.company_id()));
create policy companies_update on public.companies for update to authenticated
  using (id = (select app.company_id()) and (select app.role()) = 'admin')
  with check (id = (select app.company_id()));

create policy profiles_select on public.profiles for select to authenticated
  using (company_id = (select app.company_id()));

create policy audit_log_select on public.audit_log for select to authenticated
  using (company_id = (select app.company_id()) and (select app.role()) in ('admin', 'manager'));

-- app_owners and outbox have no policies: only definer functions and the server key use them.

revoke all on public.companies, public.profiles, public.app_owners, public.audit_log, public.outbox
  from anon, authenticated;
grant select on public.companies to authenticated;
grant update (name, timezone, phone) on public.companies to authenticated;
grant select on public.profiles to authenticated;
grant select on public.audit_log to authenticated;
-- The server key (Edge Functions) gets full access. Don't rely on Supabase defaults.
grant all on public.companies, public.profiles, public.app_owners, public.audit_log, public.outbox to service_role;

-- Functions the app calls ----------------------------------------------------

-- Everything the app needs to know about the logged in person on start up.
create function public.my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'is_owner', app.is_owner(),
    'profile', (
      select jsonb_build_object(
        'full_name', p.full_name, 'role', p.role, 'active', p.active,
        'phone', p.phone, 'joined_at', p.joined_at)
      from public.profiles p where p.user_id = u.id),
    'company', (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'status', c.status, 'phone', c.phone,
        'timezone', c.timezone, 'status_reason', c.status_reason)
      from public.profiles p join public.companies c on c.id = p.company_id
      where p.user_id = u.id)
  )
  from auth.users u
  where u.id = auth.uid()
$$;

-- Sign up step two: after confirming their email, a new person creates their
-- business and becomes its admin. The business starts as pending unless the
-- person is an App Owner.
create function public.create_company(
  p_company_name text,
  p_full_name text,
  p_phone text default null,
  p_truck_count integer default null,
  p_timezone text default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_company uuid;
  v_is_owner boolean;
  v_timezone text := 'America/Chicago';
begin
  if v_user is null then
    raise exception 'Please log in first.' using errcode = '42501';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = v_user;
  if v_confirmed is null then
    raise exception 'Please confirm your email first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = v_user) then
    raise exception 'Your account already belongs to a business.';
  end if;

  p_company_name := btrim(coalesce(p_company_name, ''));
  p_full_name := btrim(coalesce(p_full_name, ''));
  if p_company_name = '' then raise exception 'Please enter your business name.'; end if;
  if p_full_name = '' then raise exception 'Please enter your name.'; end if;
  if p_timezone is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    v_timezone := p_timezone;
  end if;

  v_is_owner := exists (select 1 from public.app_owners where email = v_email);

  insert into public.companies (name, status, timezone, phone, truck_count_estimate, signup_note, created_by, status_changed_at)
  values (
    p_company_name,
    case when v_is_owner then 'active' else 'pending' end::public.company_status,
    v_timezone,
    nullif(btrim(p_phone), ''),
    p_truck_count,
    nullif(btrim(p_note), ''),
    v_user,
    now()
  )
  returning id into v_company;

  insert into public.profiles (user_id, company_id, full_name, email, phone, role, joined_at)
  values (v_user, v_company, p_full_name, v_email, nullif(btrim(p_phone), ''), 'admin', now());

  if not v_is_owner then
    insert into public.outbox (company_id, channel, to_email, template, payload, dedupe_key)
    select v_company, 'email', o.email, 'owner_new_signup',
      jsonb_build_object(
        'company_name', p_company_name, 'admin_name', p_full_name, 'admin_email', v_email,
        'phone', p_phone, 'truck_count', p_truck_count, 'note', p_note),
      'owner_new_signup:' || v_company || ':' || o.email
    from public.app_owners o;
  end if;

  return v_company;
end $$;

-- Called after someone sets their password from an invite.
create function public.mark_joined() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set joined_at = coalesce(joined_at, now()) where user_id = auth.uid()
$$;

create function public.update_my_profile(p_full_name text, p_phone text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'Please enter your name.'; end if;
  update public.profiles
     set full_name = btrim(p_full_name), phone = nullif(btrim(p_phone), '')
   where user_id = auth.uid();
end $$;

-- Invites ---------------------------------------------------------------------
-- The manage-invite Edge Function calls can_invite() as the person sending the
-- invite, sends the Supabase invite email, then calls service_add_member()
-- with the server key. Both check permissions, so neither can be skipped.

create function public.can_invite(p_email text, p_role public.user_role) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_existing public.profiles;
  v_user_id uuid;
begin
  v_company := app.assert_can_manage(auth.uid(), p_role, true);

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;

  select * into v_existing from public.profiles where email = v_email;
  if found then
    if v_existing.company_id <> v_company then
      raise exception 'This email is already used by another business. Each person can only belong to one business.';
    end if;
    if v_existing.joined_at is not null then
      raise exception 'This person already has an account in your business.';
    end if;
    -- Resending an invite still has to follow the permission rules for their current role.
    perform app.assert_can_manage(auth.uid(), v_existing.role, true);
    return jsonb_build_object('action', 'resend', 'user_id', v_existing.user_id);
  end if;

  select u.id into v_user_id from auth.users u
  where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user_id is not null then
    -- They have a confirmed login but no business yet (they signed up and never finished).
    return jsonb_build_object('action', 'attach', 'user_id', v_user_id);
  end if;

  -- No login, or one that was never confirmed: a Supabase invite covers both.
  return jsonb_build_object('action', 'invite');
end $$;

create function public.service_add_member(
  p_actor uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role public.user_role,
  p_joined boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_existing public.profiles;
begin
  v_company := app.assert_can_manage(p_actor, p_role, true);
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'Please enter their name.'; end if;

  select * into v_existing from public.profiles where user_id = p_user_id or email = lower(p_email);
  if found then
    if v_existing.company_id <> v_company or v_existing.joined_at is not null then
      raise exception 'This person already belongs to a business.';
    end if;
    perform app.assert_can_manage(p_actor, v_existing.role, true);
    update public.profiles
       set full_name = btrim(p_full_name), role = p_role, invited_by = p_actor, invited_at = now()
     where user_id = v_existing.user_id;
    return;
  end if;

  insert into public.profiles (user_id, company_id, full_name, email, role, invited_by, invited_at, joined_at)
  values (p_user_id, v_company, btrim(p_full_name), lower(p_email), p_role, p_actor, now(),
          case when p_joined then now() end);
end $$;

-- Cancels an invite that hasn't been accepted. The Edge Function then deletes the login.
create function public.service_cancel_invite(p_actor uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
  v_company uuid;
begin
  select * into v_target from public.profiles where user_id = p_user_id;
  if not found then raise exception 'That person was not found.'; end if;
  v_company := app.assert_can_manage(p_actor, v_target.role, false);
  if v_target.company_id <> v_company then raise exception 'That person was not found.'; end if;
  if v_target.joined_at is not null then
    raise exception 'This person already joined. Turn them off instead.';
  end if;
  delete from public.profiles where user_id = p_user_id;
end $$;

-- People management -------------------------------------------------------------

create function public.update_member(
  p_user_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_phone text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_target public.profiles;
  v_company uuid;
begin
  select * into v_target from public.profiles where user_id = p_user_id;
  if not found then raise exception 'That person was not found.'; end if;

  -- Must be allowed to manage them in their current role and in the new one.
  v_company := app.assert_can_manage(v_actor, v_target.role, false);
  perform app.assert_can_manage(v_actor, p_role, false);
  if v_target.company_id <> v_company then raise exception 'That person was not found.'; end if;
  if p_user_id = v_actor and p_role <> v_target.role then
    raise exception 'You can''t change your own role. Ask another admin.';
  end if;
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'Please enter their name.'; end if;

  update public.profiles
     set full_name = btrim(p_full_name), role = p_role, phone = nullif(btrim(p_phone), '')
   where user_id = p_user_id;
end $$;

create function public.set_member_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_target public.profiles;
  v_company uuid;
begin
  select * into v_target from public.profiles where user_id = p_user_id;
  if not found then raise exception 'That person was not found.'; end if;
  v_company := app.assert_can_manage(v_actor, v_target.role, false);
  if v_target.company_id <> v_company then raise exception 'That person was not found.'; end if;
  if p_user_id = v_actor then raise exception 'You can''t turn yourself off.'; end if;

  update public.profiles set active = p_active where user_id = p_user_id;
end $$;

-- App Owner functions ------------------------------------------------------------

create function public.owner_list_companies()
returns table (
  id uuid,
  name text,
  status public.company_status,
  created_at timestamptz,
  status_changed_at timestamptz,
  status_reason text,
  phone text,
  truck_count_estimate integer,
  signup_note text,
  timezone text,
  admin_name text,
  admin_email text,
  member_count bigint,
  last_active_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_owner();
  return query
    select c.id, c.name, c.status, c.created_at, c.status_changed_at, c.status_reason,
           c.phone, c.truck_count_estimate, c.signup_note, c.timezone,
           a.full_name, a.email, coalesce(m.member_count, 0), m.last_active_at
    from public.companies c
    left join lateral (
      select p.full_name, p.email from public.profiles p
      where p.company_id = c.id and p.role = 'admin'
      order by p.created_at limit 1
    ) a on true
    left join lateral (
      select count(*) as member_count, max(u.last_sign_in_at) as last_active_at
      from public.profiles p join auth.users u on u.id = p.user_id
      where p.company_id = c.id
    ) m on true
    order by (c.status = 'pending') desc, c.created_at desc;
end $$;

create function public.owner_set_company_status(
  p_company_id uuid,
  p_status public.company_status,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.company_status;
  v_name text;
begin
  perform app.assert_owner();
  if p_status = 'pending' then raise exception 'A business can''t be set back to pending.'; end if;

  select c.status, c.name into v_old, v_name from public.companies c where c.id = p_company_id for update;
  if not found then raise exception 'That business was not found.'; end if;
  if v_old = p_status then return; end if;

  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update public.companies
     set status = p_status,
         status_reason = nullif(btrim(p_reason), ''),
         status_changed_at = now(),
         status_changed_by = auth.uid()
   where id = p_company_id;

  insert into public.outbox (company_id, channel, to_user, to_email, template, payload)
  select p_company_id, 'email', p.user_id, p.email, 'company_status_changed',
         jsonb_build_object('company_name', v_name, 'status', p_status, 'old_status', v_old,
                            'reason', nullif(btrim(p_reason), ''), 'admin_name', p.full_name)
  from public.profiles p
  where p.company_id = p_company_id and p.role = 'admin' and p.active;
end $$;

create function public.owner_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_owner();
  return jsonb_build_object(
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'database_limit_bytes', 500 * 1024 * 1024,
    'companies', (select coalesce(jsonb_object_agg(s.status, s.n), '{}') from
                   (select status, count(*) as n from public.companies group by status) s),
    'people', (select count(*) from public.profiles)
  );
end $$;

-- Who can call what ---------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;

-- Used inside security rules, so logged in people need them.
grant execute on function app.company_id(), app.role(), app.is_owner() to authenticated, service_role;

grant execute on function
  public.my_context(),
  public.create_company(text, text, text, integer, text, text),
  public.mark_joined(),
  public.update_my_profile(text, text),
  public.can_invite(text, public.user_role),
  public.update_member(uuid, text, public.user_role, text),
  public.set_member_active(uuid, boolean),
  public.owner_list_companies(),
  public.owner_set_company_status(uuid, public.company_status, text),
  public.owner_stats()
to authenticated;

grant execute on function
  public.service_add_member(uuid, uuid, text, text, public.user_role, boolean),
  public.service_cancel_invite(uuid, uuid)
to service_role;
