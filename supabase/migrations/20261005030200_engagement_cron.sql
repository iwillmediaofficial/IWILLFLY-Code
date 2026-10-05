-- IWILLFLY Phase 3 (part 3): daily clean-up of old inbox messages and viewing history (02:45 India time).
-- Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-engagement', '15 21 * * *', 'select public.cleanup_engagement()');
  end if;
end $$;
