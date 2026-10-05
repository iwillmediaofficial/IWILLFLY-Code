-- IWILLFLY Phase 4: new inbox message kinds for billing, support replies and staff invitations.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('broadcast', 'offer_review', 'vendor_review', 'new_winner', 'festival_review',
                  'placement_review', 'billing', 'support_reply', 'staff'));
