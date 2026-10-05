-- IWILLFLY Phase 1: area coordinates. Clients write lat/lng; branches and malls derive PostGIS points.

alter table public.locations
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180);
comment on column public.locations.center is 'Unused; distance queries use lat/lng.';

update public.locations set lat = v.lat, lng = v.lng
from (values
  ('kerala', 10.1632, 76.6413),
  ('ernakulam', 10.0159, 76.3419),
  ('kochi', 9.9312, 76.2673),
  ('aluva', 10.1076, 76.3516),
  ('edappally', 10.0261, 76.3083),
  ('kakkanad', 10.0159, 76.3419),
  ('vyttila', 9.9696, 76.3209)
) as v(slug, lat, lng)
where public.locations.slug = v.slug;
