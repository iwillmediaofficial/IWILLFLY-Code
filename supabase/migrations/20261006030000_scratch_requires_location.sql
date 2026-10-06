-- Scratch & Win needs the player's area. play_scratch refuses to play (with hint 'location_required') until the
-- customer has set it from their location or by picking it. A play already made today is still returned.

create or replace function public.play_scratch(p_campaign_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  c public.scratch_campaigns;
  existing public.scratch_plays;
  roll numeric := random();
  cum numeric := 0;
  pr record;
  won_prize public.scratch_prizes;
  play public.scratch_plays;
  attempt int := 0;
  today date := private.today_ist();
  locked public.scratch_prizes;
begin
  if uid is null then
    raise exception 'Sign in to scratch' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.scratch_campaigns where id = p_campaign_id for share;
  if not found or not c.is_active then
    raise exception 'This campaign is not running' using errcode = 'P0001';
  end if;

  select * into existing from public.scratch_plays
    where campaign_id = c.id and customer_id = uid and play_date = today;
  if found then
    return private.play_json(existing) || jsonb_build_object('status', 'already_played');
  end if;

  -- Players must have set their area (from their location or by picking it) before scratching: campaigns and
  -- prizes are matched to it.
  if (select location_id from public.profiles where id = uid) is null then
    raise exception 'Set your location to play Scratch & Win' using errcode = 'P0001', hint = 'location_required';
  end if;

  if not private.campaign_open_now(c) then
    raise exception 'Scratch is open % to % today', to_char(c.active_from, 'HH12:MI AM'), to_char(c.active_to, 'HH12:MI AM')
      using errcode = 'P0001';
  end if;
  if not private.customer_eligible(c, uid) then
    raise exception 'This campaign is not available in your area' using errcode = 'P0001';
  end if;

  -- Walk the prizes in a fixed order; a roll inside a prize's slice wins it. Prizes that ran out, hit their
  -- daily limit or aren't available in the player's area keep their slice, so none of that ever raises
  -- anyone else's odds. Customers past the win cap, and sponsors playing for their own prizes, always lose.
  if c.max_wins_per_customer is null
     or (select count(*) from public.scratch_plays
         where campaign_id = c.id and customer_id = uid and won) < c.max_wins_per_customer then
    for pr in
      select sp.id, sp.probability, sp.remaining, sp.sponsor_vendor_id from public.scratch_prizes sp
      where sp.campaign_id = c.id and sp.is_active and sp.probability > 0
      order by sp.id
    loop
      cum := cum + pr.probability;
      if roll < cum then
        if pr.remaining > 0
           and (pr.sponsor_vendor_id is null or private.vendor_is_live(pr.sponsor_vendor_id))
           and not exists (select 1 from public.vendors where id = pr.sponsor_vendor_id and owner_id = uid)
           and private.prize_available_for(pr.id, uid) then
          -- Lock the prize row, the same row the stock update below locks. A concurrent winner holds this lock
          -- until it commits, so the count that follows already includes its win.
          select * into locked from public.scratch_prizes where id = pr.id for update;
          if locked.daily_limit is null
             or (select count(*) from public.scratch_plays
                 where prize_id = pr.id and play_date = today and won) < locked.daily_limit then
            update public.scratch_prizes set remaining = remaining - 1
              where id = pr.id and remaining > 0
              returning * into won_prize;
          end if;
        end if;
        exit;
      end if;
    end loop;
  end if;

  loop
    begin
      insert into public.scratch_plays (campaign_id, customer_id, play_date, prize_id, vendor_id, won,
                                        claim_code, claim_status, expires_at)
      values (c.id, uid, today, won_prize.id, won_prize.sponsor_vendor_id, won_prize.id is not null,
              case when won_prize.id is not null then private.new_claim_code() end,
              case when won_prize.id is not null then 'unclaimed'::public.claim_status end,
              case when won_prize.id is not null then now() + make_interval(days => c.claim_valid_days) end)
      returning * into play;
      exit;
    exception when unique_violation then
      -- a second tap in the same instant: hand back the first result (this block's stock change is undone)
      select * into existing from public.scratch_plays
        where campaign_id = c.id and customer_id = uid and play_date = today;
      if found then
        return private.play_json(existing) || jsonb_build_object('status', 'already_played');
      end if;
      -- otherwise the claim code collided; try another
      attempt := attempt + 1;
      if attempt > 5 then raise; end if;
    end;
  end loop;

  return private.play_json(play) || jsonb_build_object('status', case when play.won then 'won' else 'lost' end);
end;
$$;
