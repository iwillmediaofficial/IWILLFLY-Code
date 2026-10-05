-- Security advisor fixes: keep SECURITY DEFINER helpers out of the public REST API.
-- Policies reference functions by OID, so moving the schema keeps them working.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

alter function public.has_role(public.app_role) set schema private;
alter function public.is_admin() set schema private;

-- Trigger function only; nobody calls it directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
