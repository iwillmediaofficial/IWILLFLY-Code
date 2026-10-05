-- IWILLFLY Phase 4 (part 3): daily billing job at 00:00 India time (featured flags, renewal reminders).
-- Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('billing-daily', '30 18 * * *', 'select public.billing_daily()');
  end if;
end $$;
