-- Admins can switch off the email Sign in form on the customer login page
-- (Admin > Dashboard > Login page forms > Sign in form).
-- While it is off the customer login page (/login) shows Continue with Google instead of the
-- email + password form and the email login code. It only changes what the page shows:
-- vendors (/vendor/login), branch logins and admins (/admin/login) sign in as before.
alter table public.site_settings
  add column if not exists customer_signin boolean not null default true;
