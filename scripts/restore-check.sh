#!/usr/bin/env bash
# Proves a backup restores: loads a pg_dump file into an EMPTY Postgres (with PostGIS) and checks that
# every table has the same number of rows, and the same security policies, functions and triggers, as
# when the backup was taken.
# Never point this at the live Supabase database.
# Usage: scripts/restore-check.sh <backup.dump> <backup.counts.txt> "<empty postgres url>"
set -euo pipefail
dump="$1"
counts="$2"
url="$3"
here="$(cd "$(dirname "$0")" && pwd)"

# The roles and extensions a Supabase dump expects to exist already.
psql "$url" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin',
    'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user', 'supabase_realtime_admin',
    'supabase_replication_admin', 'supabase_read_only_user', 'pgbouncer'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
SQL

# Supabase-internal objects (grants to roles, event triggers, publications) can fail on plain Postgres;
# those are listed but don't fail the check. Missing or short tables do.
pg_restore --no-owner --dbname="$url" "$dump" 2> restore-errors.txt || true
echo "pg_restore reported $(grep -c '^pg_restore: error' restore-errors.txt || true) error(s):"
grep '^pg_restore: error' restore-errors.txt | sed 's/^/  /' | head -40 || true

"$here/db-counts.sh" "$url" > restored-counts.txt
if diff -u "$counts" restored-counts.txt; then
  echo "Restore check passed: every table's row count and every policy, function and trigger count matches the backup."
else
  echo "Restore check FAILED: the restored database differs from the backup (see diff above)." >&2
  exit 1
fi
