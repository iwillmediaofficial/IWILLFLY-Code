-- A prize's daily limit can't be more than its quantity. This also stops the quantity being lowered below
-- an existing daily limit; lower or clear the limit first.
alter table public.scratch_prizes
  add constraint scratch_prizes_daily_limit_within_quantity
  check (daily_limit is null or daily_limit <= quantity);
