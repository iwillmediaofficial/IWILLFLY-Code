-- Date of birth for customers, asked at sign-up, on the one-time Almost done page and in Settings.
-- The app checks the minimum age (13); the database only rules out impossible dates.
alter table public.profiles
  add column if not exists date_of_birth date
  constraint profiles_date_of_birth_check check (date_of_birth >= date '1900-01-01');
