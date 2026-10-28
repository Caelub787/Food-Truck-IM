-- Functions the send-outbox Edge Function uses to deliver email and push.
-- Only the server key can call them.

-- Claims a batch of messages that are due, so two senders never send the same one.
create function public.service_claim_outbox(p_limit integer default 25)
returns setof public.outbox
language sql security definer set search_path = '' as $$
  update public.outbox o
     set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
   where o.id in (
     select id from public.outbox
      where status = 'pending' and send_after <= now()
      order by send_after
      limit p_limit
      for update skip locked
   )
  returning o.*
$$;

-- Marks a message sent, or puts it back to try again later. Gives up after 5 tries.
create function public.service_finish_outbox(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.outbox
     set status = case
                    when p_ok then 'sent'
                    when attempts >= 5 then 'failed'
                    else 'pending'
                  end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(p_error, 1000) end,
         send_after = case when p_ok then send_after else now() + make_interval(mins => power(2, attempts)::integer) end
   where id = p_id
$$;

-- Messages stuck in "sending" (the function crashed) go back in line after 10 minutes.
create function public.service_requeue_stuck_outbox() returns integer
language sql security definer set search_path = '' as $$
  with stuck as (
    update public.outbox set status = 'pending'
     where status = 'sending' and claimed_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::integer from stuck
$$;

revoke execute on function
  public.service_claim_outbox(integer),
  public.service_finish_outbox(uuid, boolean, text),
  public.service_requeue_stuck_outbox()
from public, anon, authenticated;

grant execute on function
  public.service_claim_outbox(integer),
  public.service_finish_outbox(uuid, boolean, text),
  public.service_requeue_stuck_outbox()
to service_role;
