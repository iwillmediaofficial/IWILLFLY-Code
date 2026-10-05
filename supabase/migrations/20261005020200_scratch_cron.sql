-- IWILLFLY Phase 2 (part 3): mark unclaimed prizes past their expiry as expired, every hour.
-- The app already shows such prizes as expired; this keeps the stored status in step.
-- Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-scratch-claims', '7 * * * *', 'select public.expire_scratch_claims()');
  end if;
end $$;
