-- Categories can have a square picture (R2 object key, 512 x 512 WebP uploaded to the "categories" folder).
-- The emoji icon stays as the fallback when there is no picture.
alter table public.categories add column image_key text;

comment on column public.categories.image_key is 'R2 key of a 512x512 WebP; the emoji icon is shown when null';
