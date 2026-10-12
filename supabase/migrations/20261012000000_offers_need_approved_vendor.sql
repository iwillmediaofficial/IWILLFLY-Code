-- Only vendors the IWILLFLY team has approved can add offers. A business under review can set up its
-- shops, but offers wait until approval. Admins can still add offers for any shop.
alter policy "offers: vendor or admin insert" on public.offers
  with check (
    (private.owns_shop(shop_id)
      and private.vendor_is_live((select s.vendor_id from public.shops s where s.id = shop_id)))
    or (select private.is_admin())
  );
