#!/usr/bin/env bash
# Prints "table|rows" for every table in the public schema plus auth.users, and how many security
# policies, functions and triggers exist, sorted.
# Used by the nightly backup (saved next to each dump) and by the restore check (compared after restore).
# Usage: scripts/db-counts.sh "<postgres connection url>"
set -euo pipefail
url="$1"
sql=$(psql "$url" -tA -v ON_ERROR_STOP=1 -c "
  select string_agg(format('select %L, count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' union all ')
  from pg_tables
  where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')")
{
  psql "$url" -tA -v ON_ERROR_STOP=1 -c "$sql"
  psql "$url" -tA -v ON_ERROR_STOP=1 -c "
    select '~policies', count(*) from pg_policies where schemaname = 'public'
    union all select '~functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
    union all select '~triggers', count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal"
} | sort
