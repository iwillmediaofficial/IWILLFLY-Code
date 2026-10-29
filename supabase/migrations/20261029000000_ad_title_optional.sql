-- Home ads: the title is optional now, like the pill text and subtitle (an ad can be just a picture).
-- The length check (2 to 80 characters) still applies when a title is given.

alter table public.ads alter column title drop not null;
