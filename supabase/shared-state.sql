-- Server authority for online clients. Existing cards/pool are not deleted by this migration.
alter table public.settings add column if not exists content_source_deck_id uuid;

create or replace function public.introduce_shared_card(card_data jsonb, pool_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare incoming public.cards; existing public.cards;
begin
  incoming := jsonb_populate_record(null::public.cards, card_data);
  if auth.uid() is null or incoming.user_id <> auth.uid() or incoming.id <> pool_id then
    raise exception 'Invalid card owner or pool id';
  end if;
  -- Serialize introduction of the same pool item, without overwriting an already reviewed card.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || pool_id, 0));
  select * into existing from public.cards where id = incoming.id and user_id = auth.uid();
  if found then return to_jsonb(existing); end if;
  perform 1 from public.new_pool where id = pool_id and user_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'Pool changed. Sync and retry.'; end if;
  insert into public.cards select incoming.*;
  delete from public.new_pool where id = pool_id and user_id = auth.uid();
  return to_jsonb(incoming);
end $$;

create or replace function public.save_shared_review(card_data jsonb, log_data jsonb, expected_updated_at timestamptz)
returns void language plpgsql security invoker set search_path = public as $$
declare incoming public.cards; entry public.review_log; existing public.cards;
begin
  incoming := jsonb_populate_record(null::public.cards, card_data);
  entry := jsonb_populate_record(null::public.review_log, log_data);
  if auth.uid() is null or incoming.user_id <> auth.uid() or entry.user_id <> auth.uid() or entry.card_id <> incoming.id then
    raise exception 'Invalid review owner or card';
  end if;
  select * into existing from public.cards where id = incoming.id and user_id = auth.uid() for update;
  if not found then raise exception 'Card removed. Sync and retry.'; end if;
  if exists(select 1 from public.review_log where id = entry.id and user_id = auth.uid()) then return; end if;
  if existing.updated_at is distinct from expected_updated_at or existing.box <> entry.box_before then
    raise exception 'Card changed on another device. Sync and retry.';
  end if;
  update public.cards set box = incoming.box, next_review_date = incoming.next_review_date,
    last_reviewed_at = incoming.last_reviewed_at, correct_streak = incoming.correct_streak,
    lapse_count = incoming.lapse_count, updated_at = incoming.updated_at
    where id = incoming.id and user_id = auth.uid();
  insert into public.review_log (id, user_id, card_id, date, result, box_before, box_after, hint_level, input_method)
    values (entry.id, entry.user_id, entry.card_id, entry.date, entry.result, entry.box_before, entry.box_after, entry.hint_level, entry.input_method);
end $$;
revoke all on function public.introduce_shared_card(jsonb, text) from public, anon;
revoke all on function public.save_shared_review(jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.introduce_shared_card(jsonb, text) to authenticated;
grant execute on function public.save_shared_review(jsonb, jsonb, timestamptz) to authenticated;
