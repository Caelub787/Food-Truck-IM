-- Run once in the Supabase SQL editor. Put your own email in place of the
-- example below. That email gets the App Owner section after you sign up and
-- confirm it. This file stays generic on purpose: never commit a real email.
insert into public.app_owners (email)
values (lower('you@example.com'))
on conflict do nothing;
