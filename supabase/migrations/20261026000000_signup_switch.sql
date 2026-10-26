-- Admins can switch off the Create account form (Admin > Dashboard > Create account form).
-- While it is off:
--   * the login page hides the Create account form;
--   * new email + password accounts are refused here too, so the form cannot be used around the page.
-- Still allowed while off: Continue with Google, email login codes, shop owners registering at
-- /vendor/signup (their sign-up carries signup = 'vendor'), and accounts the Worker makes for admins
-- (vendor owners, branch logins). People who already have an account sign in as before.

create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  customer_signup boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

create trigger site_settings_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();
create trigger site_settings_audit after insert or update or delete on public.site_settings
  for each row execute function private.audit_change();

alter table public.site_settings enable row level security;
-- Guests read it too: the login page needs it before anyone signs in.
create policy "site_settings: everyone read" on public.site_settings
  for select to anon, authenticated using (true);
create policy "site_settings: admin update" on public.site_settings
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function private.check_signup_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select customer_signup from public.site_settings where id = 1), true)
     -- Google and email-code sign-ups have no password; only the Create account form sets one.
     or coalesce(new.encrypted_password, '') = ''
     or new.raw_user_meta_data ->> 'signup' = 'vendor'
     or new.raw_app_meta_data ->> 'created_by' = 'admin'
     or new.raw_app_meta_data ? 'branch_login' then
    return new;
  end if;
  raise exception 'Customer sign-up is closed' using errcode = 'P0001';
end;
$$;
revoke execute on function private.check_signup_open() from public, anon, authenticated;

drop trigger if exists check_signup_open on auth.users;
create trigger check_signup_open before insert on auth.users
  for each row execute function private.check_signup_open();
