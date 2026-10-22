-- Parking at each branch, picked by the vendor on the branch form and shown on the shop page.
-- Both are optional: a branch without a choice shows no parking info.
alter table public.branches
  add column if not exists parking text
    constraint branches_parking_check check (parking in ('free', 'free_bike', 'paid', 'street', 'none')),
  add column if not exists parking_note text
    constraint branches_parking_note_check check (char_length(parking_note) <= 100);
