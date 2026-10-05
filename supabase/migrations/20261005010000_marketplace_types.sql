-- IWILLFLY Phase 1: marketplace status types.

create type public.vendor_status as enum ('pending', 'approved', 'blocked');
create type public.offer_status as enum ('pending', 'approved', 'rejected');
