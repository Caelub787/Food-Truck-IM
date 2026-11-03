-- No bank links. The owner decided the app should never hold bank logins or
-- bank data, so nobody's account can be exposed through it. Money accounts
-- keep only balances people type in. This undoes the bank parts of the
-- budget migration.

drop function public.bank_connections();
drop function public.service_bank_save(uuid, uuid, text, text, text);
drop function public.service_bank_list(uuid, uuid);
drop function public.service_bank_update(uuid, jsonb, text, text);
drop function public.service_bank_remove(uuid, uuid);

delete from public.money_accounts where kind = 'bank';
drop policy money_accounts_manual_insert on public.money_accounts;
drop policy money_accounts_manual_update on public.money_accounts;
drop policy money_accounts_manual_delete on public.money_accounts;
alter table public.money_accounts
  drop column kind,
  drop column connection_id,
  drop column provider_account_id,
  drop column institution,
  drop column mask,
  drop column account_type,
  drop column available;

drop table app.bank_connections;
