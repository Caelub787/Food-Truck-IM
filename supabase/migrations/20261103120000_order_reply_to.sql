-- When a supplier replies to an order email, the reply goes to the manager
-- who approved the order, not to the app's own mailbox. Same function as
-- before, with the approver's email added as "reply_to".
create or replace function public.approve_purchase_order(p_order_id uuid) returns text
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
                               'approved_by', (select full_name from public.profiles where user_id = auth.uid()),
                               'reply_to', (select email from public.profiles where user_id = auth.uid())),
            'supplier_order:' || o.id);
    update public.purchase_orders set status = 'sent', approved_by = auth.uid(), approved_at = now(), sent_at = now() where id = o.id;
    return 'sent';
  end if;
  update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = o.id;
  return 'approved';
end $$;
