-- Run once in the Supabase SQL editor, after the Edge Functions are deployed.
-- It makes Supabase check the outbox every minute and send waiting emails.
--
-- Replace the two values below first:
--   1. Your project URL (Project Settings, Data API), like https://abcd1234.supabase.co
--   2. The same CRON_SECRET you saved in the Edge Function secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'project_url');
select vault.create_secret('PASTE-YOUR-CRON-SECRET', 'cron_secret');

select cron.schedule(
  'send-outbox',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.outbox where status in ('pending', 'sending'));
  $$
);
