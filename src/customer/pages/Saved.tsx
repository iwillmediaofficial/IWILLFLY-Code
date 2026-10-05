import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, LogoHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { track } from '../../lib/engagement';
import { formatPrice } from '../../lib/hours';
import { db, must } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { ErrorNotice, Loading, NoBackend, Thumb } from '../ui';
import { useSaveToggle, validity } from '../util';

interface SavedOfferRow {
  offer_id: number;
  created_at: string;
  offer: {
    id: number;
    title: string;
    discount_label: string | null;
    offer_price: number | null;
    ends_on: string | null;
    image_keys: string[];
    shop: { id: number; name: string; category: { icon: string | null } | null } | null;
  } | null;
}

interface SavedShopRow {
  shop_id: number;
  created_at: string;
  shop: {
    id: number;
    name: string;
    logo_key: string | null;
    category: { name: string; icon: string | null } | null;
  } | null;
}

function useSavedOffers(userId: string | undefined) {
  return useQuery({
    queryKey: ['saved', 'offer', userId, 'list'],
    queryFn: async () => {
      const rows = must<SavedOfferRow[]>(
        await db()
          .from('saved_offers')
          .select(
            'offer_id, created_at, offer:offers(id, title, discount_label, offer_price, ends_on, image_keys, shop:shops(id, name, category:categories(icon)))',
          )
          .order('created_at', { ascending: false })
          .overrideTypes<SavedOfferRow[], { merge: false }>(),
      );
      // Owners and admins can read offers that are not live, so check liveness against the view.
      const ids = rows.map((r) => r.offer_id);
      const live = ids.length
        ? must<{ id: number }[]>(await db().from('live_offers').select('id').in('id', ids))
        : [];
      const liveIds = new Set(live.map((l) => l.id));
      return rows.map((r) => ({ ...r, live: liveIds.has(r.offer_id) }));
    },
    enabled: Boolean(userId),
  });
}

function useSavedShops(userId: string | undefined) {
  return useQuery({
    queryKey: ['saved', 'shop', userId, 'list'],
    queryFn: async () =>
      must<SavedShopRow[]>(
        await db()
          .from('saved_shops')
          .select('shop_id, created_at, shop:shops(id, name, logo_key, category:categories(name, icon))')
          .order('created_at', { ascending: false })
          .overrideTypes<SavedShopRow[], { merge: false }>(),
      ),
    enabled: Boolean(userId),
  });
}

export default function Saved() {
  const { session, loading } = useAuth();
  return (
    <AppShell
      header={
        <LogoHeader
          actions={
            <Link className="icon-btn" to="/explore" aria-label="Explore">
              ♡
            </Link>
          }
        />
      }
    >
      {!supabase ? (
        <NoBackend />
      ) : loading ? (
        <Loading />
      ) : !session ? (
        <EmptyState
          emoji="♡"
          title="Sign in to see your saves"
          text="Save offers and shops to find them here later."
        >
          <Link className="btn" to="/login" style={{ display: 'inline-block', marginTop: 12 }}>
            Sign in
          </Link>
        </EmptyState>
      ) : (
        <SavedLists userId={session.user.id} />
      )}
    </AppShell>
  );
}

function SavedLists({ userId }: { userId: string }) {
  const offers = useSavedOffers(userId);
  const shops = useSavedShops(userId);
  const removeOffer = useSaveToggle('offer');
  const removeShop = useSaveToggle('shop');

  if (offers.isLoading || shops.isLoading) return <Loading />;
  if (offers.error || shops.error) {
    return (
      <ErrorNotice
        error={offers.error ?? shops.error}
        onRetry={() => {
          offers.refetch();
          shops.refetch();
        }}
      />
    );
  }
  const offerRows = offers.data ?? [];
  const shopRows = shops.data ?? [];
  if (!offerRows.length && !shopRows.length) {
    return (
      <EmptyState
        emoji="♡"
        title="No saved offers yet"
        text="Tap the save button on an offer or shop to keep it here."
      >
        <Link className="btn" to="/explore" style={{ display: 'inline-block', marginTop: 12 }}>
          Explore offers
        </Link>
      </EmptyState>
    );
  }

  return (
    <>
      <div className="section-head">
        <h2>Saved offers</h2>
        <button>Latest first</button>
      </div>
      <div className="list">
        {offerRows.length ? (
          offerRows.map((r) => {
            const o = r.offer;
            const body = (
              <>
                <Thumb imageKey={o?.image_keys[0]} icon={o?.shop?.category?.icon ?? '🎁'} />
                <div>
                  <h4>{o?.title ?? 'Offer no longer available'}</h4>
                  <div className="meta">
                    {[o?.shop?.name, r.live ? validity(o?.ends_on) : null].filter(Boolean).join(' · ')}
                  </div>
                  {r.live ? (
                    <span className="offer">
                      {o?.discount_label ?? (formatPrice(o?.offer_price) || 'Live offer')}
                    </span>
                  ) : (
                    <span className="pill-status rejected" style={{ marginTop: 6 }}>
                      Expired
                    </span>
                  )}
                </div>
              </>
            );
            return (
              <div key={r.offer_id} className="shop-card" style={{ cursor: 'default' }}>
                {r.live && o?.shop ? (
                  <Link
                    to={`/shop/${o.shop.id}?offer=${o.id}`}
                    onClick={() => o.shop && track('click', o.shop.id, o.id)}
                    style={{ display: 'contents' }}
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
                <button
                  className="close"
                  aria-label="Remove"
                  disabled={removeOffer.pending}
                  onClick={() => removeOffer.run(r.offer_id, true)}
                >
                  ×
                </button>
              </div>
            );
          })
        ) : (
          <p className="meta">No saved offers yet.</p>
        )}
      </div>
      <section className="section">
        <div className="section-head">
          <h2>Saved shops</h2>
        </div>
        <div className="list">
          {shopRows.length ? (
            shopRows.map((r) => (
              <div key={r.shop_id} className="shop-card" style={{ cursor: 'default' }}>
                {r.shop ? (
                  <Link to={`/shop/${r.shop.id}`} style={{ display: 'contents' }}>
                    <Thumb imageKey={r.shop.logo_key} icon={r.shop.category?.icon} />
                    <div>
                      <h4>{r.shop.name}</h4>
                      <div className="meta">{r.shop.category?.name ?? 'Shop'}</div>
                    </div>
                  </Link>
                ) : (
                  <>
                    <Thumb icon="🏪" />
                    <div>
                      <h4>Shop no longer listed</h4>
                      <span className="pill-status">Unavailable</span>
                    </div>
                  </>
                )}
                <button
                  className="close"
                  aria-label="Remove"
                  disabled={removeShop.pending}
                  onClick={() => removeShop.run(r.shop_id, true)}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <p className="meta">No saved shops yet. Tap ♡ on a shop page to save it.</p>
          )}
        </div>
      </section>
    </>
  );
}
