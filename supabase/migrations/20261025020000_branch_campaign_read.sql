-- Branch members see which campaigns their business joined (joining and leaving stay with brand editors),
-- so a branch manager can add prizes for their branch.
drop policy if exists "campaign_vendors: own or manager read" on public.campaign_vendors;
create policy "campaign_vendors: own or manager read" on public.campaign_vendors
  for select to authenticated
  using (vendor_id = (select private.my_member_vendor_id()) or (select private.can_manage_campaigns()));
