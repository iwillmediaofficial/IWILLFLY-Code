-- Only signed-in users can see the app. Guests (the anon role) lose read access to app content; what
-- signed-in users can see does not change. ALTER POLICY instead of DROP + CREATE keeps each policy's
-- rule as it is and only changes who it applies to.
--
-- Still open to guests, because the pages they can open need them:
--   locations        the area picker on the sign-up and /welcome forms
--   points_settings  the earn and cash-out rates shown on /points/terms
-- Helper functions in the private schema, which these policies call, keep their grants.

-- Tables --------------------------------------------------------------------------------------------

alter policy "categories: public read" on public.categories to authenticated;
alter policy "branches: public read live" on public.branches to authenticated;
alter policy "malls: public read" on public.malls to authenticated;
alter policy "mall_shops: public read" on public.mall_shops to authenticated;
alter policy "offers: public read live" on public.offers to authenticated;
alter policy "scratch_campaigns: public read active" on public.scratch_campaigns to authenticated;
alter policy "scratch_prizes: public read active" on public.scratch_prizes to authenticated;
alter policy "scratch_prize_locations: public read active" on public.scratch_prize_locations to authenticated;
alter policy "festivals: public read active" on public.festivals to authenticated;
alter policy "festival_offers: approved, own or manager read" on public.festival_offers to authenticated;
alter policy "ads: public read running" on public.ads to authenticated;
alter policy "holidays: public read" on public.holidays to authenticated;

-- This shops policy is for guests only; signed-in users already read live shops through
-- "shops: read live, own team or admin". Moving it to service_role (which skips RLS anyway) leaves it
-- with no effect, without a DROP.
alter policy "shops: public read live" on public.shops to service_role;

-- Functions ------------------------------------------------------------------------------------------

-- Content lists and the view counter. Signed-in users keep them.
revoke execute on function
  public.search_shops(double precision, double precision, text, text, bigint, int, int),
  public.search_offers(double precision, double precision, text, boolean, int, int),
  public.list_malls(double precision, double precision),
  public.scratch_today(),
  public.festival_offers_live(bigint),
  public.track_event(text, bigint, bigint)
  from public, anon;
grant execute on function
  public.search_shops(double precision, double precision, text, text, bigint, int, int),
  public.search_offers(double precision, double precision, text, boolean, int, int),
  public.list_malls(double precision, double precision),
  public.scratch_today(),
  public.festival_offers_live(bigint),
  public.track_event(text, bigint, bigint)
  to authenticated;
