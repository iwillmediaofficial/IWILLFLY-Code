-- One shop per business: a brand has one shop and adds its other locations as branches.
-- Applies to everyone (admins too). Businesses that already have more than one shop keep them.

create or replace function public.one_shop_per_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.shops where vendor_id = new.vendor_id) then
    raise exception 'A business has one shop. Add your other locations as branches of it.'
      using errcode = 'P0001', hint = 'one_shop';
  end if;
  return new;
end;
$$;
drop trigger if exists shops_one_per_business on public.shops;
create trigger shops_one_per_business before insert on public.shops
  for each row execute function public.one_shop_per_business();
revoke execute on function public.one_shop_per_business() from public, anon, authenticated;
