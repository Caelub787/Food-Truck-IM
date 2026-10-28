-- Run once in the Supabase SQL editor, after 2-email-timer.sql.
-- It turns on the automatic jobs: low stock alerts, reminders, the morning
-- email, order lists, daily, weekly, and monthly reports, par level
-- suggestions, and pattern flags. Each business gets them at the hours set in
-- Business settings, in its own time zone. It also cleans up old photos once a day.

select cron.schedule('run-jobs', '*/15 * * * *', $$ select app.run_due_jobs() $$);

select cron.schedule(
  'cleanup-photos',
  '17 9 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cleanup-photos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
