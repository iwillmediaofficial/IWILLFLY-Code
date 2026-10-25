-- A picture per district (admins upload it in Admin > Locations). Shown on a shop's "Branches by
-- District" list; without one, a district icon is shown. Readable by everyone like the rest of the row.
alter table public.locations
  add column if not exists image_key text constraint locations_image_key_check check (char_length(image_key) <= 300);
