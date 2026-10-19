import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppShell, BackHeader } from '../../components/AppShell';
import { CategoryIcon } from '../../components/CategoryIcon';
import { OfferGallery } from '../../components/OfferGallery';
import { EmptyState } from '../../components/ShopCard';
import { useToast } from '../../components/Toast';
import { track } from '../../lib/engagement';
import { DAYS, formatKm, formatPrice, formatTime, haversineKm, nowIST, openState } from '../../lib/hours';
import { isApprox, usePlace } from '../../lib/location';
import { usePageMeta } from '../../lib/pageMeta';
import { db, must, useSavedIds } from '../../lib/queries';
import { mediaUrl, supabase } from '../../lib/supabase';
import type { Branch, Category, Offer, Shop as ShopRow } from '../../lib/types';
import { ErrorNotice, Loading, NoBackend, OfferImage, Sheet } from '../ui';
import { directionsLink, formatDate, toneFor, useSaveToggle, validity, whatsappLink } from '../util';

type ShopWithCategory = ShopRow & { category: Pick<Category, 'name' | 'icon' | 'slug'> | null };
type MallLink = { branch_id: number; floor: string | null; mall: { id: number; name: string } | null };

const SHOP_SELECT = '*, category:categories(name, icon, slug)';

/**
 * The link is /shop/<slug>. Old links use the shop's number (/shop/2) or a link an admin has since
 * changed (shop_old_slugs); the page then switches to the current link.
 */
async function loadShop(key: string): Promise<ShopWithCategory | null> {
  const byId = (id: number) =>
    db().from('shops').select(SHOP_SELECT).eq('id', id).maybeSingle<ShopWithCategory>();
  if (/^\d+$/.test(key)) return must<ShopWithCategory | null>(await byId(Number(key)));
  const shop = must<ShopWithCategory | null>(
    await db().from('shops').select(SHOP_SELECT).eq('slug', key).maybeSingle<ShopWithCategory>(),
  );
  if (shop) return shop;
  const old = must<{ shop_id: number } | null>(
    await db().from('shop_old_slugs').select('shop_id').eq('slug', key).maybeSingle(),
  );
  return old ? must<ShopWithCategory | null>(await byId(old.shop_id)) : null;
}

function useShopData(key: string, valid: boolean) {
  const shop = useQuery({
    queryKey: ['shop', key],
    queryFn: () => loadShop(key),
    enabled: Boolean(supabase) && valid,
  });
  const id = shop.data?.id ?? 0;
  const enabled = id > 0;
  const branches = useQuery({
    queryKey: ['shop-branches', id],
    queryFn: async () =>
      must<Branch[]>(await db().from('branches').select('*').eq('shop_id', id).order('id')),
    enabled,
  });
  const branchIds = branches.data?.map((b) => b.id) ?? [];
  const malls = useQuery({
    queryKey: ['shop-malls', id, branchIds],
    queryFn: async () =>
      must<MallLink[]>(
        await db()
          .from('mall_shops')
          .select('branch_id, floor, mall:malls(id, name)')
          .in('branch_id', branchIds)
          .overrideTypes<MallLink[], { merge: false }>(),
      ),
    enabled: enabled && branchIds.length > 0,
  });
  const offers = useQuery({
    queryKey: ['shop-offers', id],
    queryFn: async () =>
      must<Offer[]>(
        await db()
          .from('live_offers')
          .select('*')
          .eq('shop_id', id)
          .order('is_featured', { ascending: false })
          .order('created_at', { ascending: false }),
      ),
    enabled,
  });
  return { shop, branches, malls, offers };
}

export default function Shop() {
  const key = useParams().id ?? '';
  const valid = /^[1-9]\d{0,14}$/.test(key) || /^[a-z0-9-]{1,80}$/.test(key);
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const { place } = usePlace();
  const approx = isApprox(place);
  const [params, setParams] = useSearchParams();
  const { shop, branches, malls, offers } = useShopData(key, valid);
  const savedShops = useSavedIds('shop');
  const savedOffers = useSavedIds('offer');
  const saveShop = useSaveToggle('shop');
  const saveOffer = useSaveToggle('offer');
  const [branchId, setBranchId] = useState<number | null>(null);

  const withKm = useMemo(
    () =>
      (branches.data ?? [])
        .map((b) => ({
          ...b,
          km: place && b.lat != null && b.lng != null ? haversineKm(place, { lat: b.lat, lng: b.lng }) : null,
        }))
        .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.id - b.id),
    [branches.data, place],
  );
  const branch = withKm.find((b) => b.id === branchId) ?? withKm[0];
  const mallOf = (bid: number) => malls.data?.find((m) => m.branch_id === bid);

  const offerParam = Number(params.get('offer'));
  const openOffer = offers.data?.find((o) => o.id === offerParam) ?? null;
  const showOffer = (oid: number | null) => {
    const p = new URLSearchParams(params);
    if (oid) p.set('offer', String(oid));
    else p.delete('offer');
    setParams(p, { replace: true });
  };
  const closeOffer = useCallback(
    () =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete('offer');
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  const s = shop.data;
  const shopId = s?.id;
  const toast = useToast();
  /** Phone share menu (WhatsApp etc.) with a link that opens this offer; copies the link where sharing isn't offered. */
  const shareOffer = (o: Offer) => {
    const url = `${window.location.origin}/shop/${s?.slug ?? key}?offer=${o.id}`;
    const text = s ? `${o.title} at ${s.name} on IWILLFLY` : o.title;
    if (navigator.share) {
      navigator.share({ title: o.title, text, url }).catch(() => undefined);
      return;
    }
    const copy = navigator.clipboard?.writeText(`${text}\n${url}`);
    if (!copy) return toast(url);
    copy.then(
      () => toast('Offer link copied. Paste it to share.'),
      () => toast(url),
    );
  };
  // Old number links (and in-app links that only know the number) switch to the name link.
  const slug = s?.slug;
  useEffect(() => {
    if (slug && key !== slug) navigate(`/shop/${slug}${search}${hash}`, { replace: true });
  }, [slug, key, search, hash, navigate]);
  const openOfferId = openOffer?.id;
  useEffect(() => {
    if (shopId) track('view', shopId);
  }, [shopId]);
  useEffect(() => {
    if (shopId && openOfferId) track('view', shopId, openOfferId);
  }, [shopId, openOfferId]);
  const shopSaved = s ? Boolean(savedShops.data?.has(s.id)) : false;
  usePageMeta(
    s?.name,
    s && (s.description || `${s.name}: live offers, opening hours and directions on IWILLFLY.`),
  );
  const header = (
    <BackHeader
      back="/explore"
      title="Shop details"
      subtitle="Live offers & timings"
      actions={
        s && (
          <button
            className="icon-btn"
            aria-label={shopSaved ? 'Remove saved shop' : 'Save shop'}
            disabled={saveShop.pending}
            onClick={() => saveShop.run(s.id, shopSaved)}
          >
            {shopSaved ? '♥' : '♡'}
          </button>
        )
      }
    />
  );

  if (!supabase) {
    return (
      <AppShell header={header}>
        <NoBackend />
      </AppShell>
    );
  }
  if (valid && shop.isLoading) {
    return (
      <AppShell header={header}>
        <Loading />
      </AppShell>
    );
  }
  if (shop.error) {
    return (
      <AppShell header={header}>
        <ErrorNotice error={shop.error} onRetry={() => shop.refetch()} />
      </AppShell>
    );
  }
  if (!s) {
    return (
      <AppShell header={header}>
        <EmptyState emoji="🏪" title="Shop not found" text="This shop may no longer be listed on IWILLFLY.">
          <Link className="btn" to="/explore" style={{ display: 'inline-block', marginTop: 12 }}>
            Explore shops
          </Link>
        </EmptyState>
      </AppShell>
    );
  }

  const state = branch ? openState(branch) : null;
  const mall = branch ? mallOf(branch.id) : undefined;
  const phone = branch?.phone || s.phone;
  const today = nowIST().day;
  const live = offers.data ?? [];

  return (
    <AppShell header={header}>
      <section
        className="hero"
        style={
          s.cover_key
            ? {
                backgroundImage: `linear-gradient(135deg, rgba(20, 102, 221, 0.88), rgba(14, 70, 170, 0.7)), url(${mediaUrl(s.cover_key)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {s.logo_key ? (
          <img
            src={mediaUrl(s.logo_key)}
            alt=""
            width={64}
            height={64}
            decoding="async"
            style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'cover', background: '#fff' }}
          />
        ) : (
          <div style={{ fontSize: 52 }}>
            <CategoryIcon category={s.category} fallback="🏪" size={64} style={{ background: '#fff' }} />
          </div>
        )}
        <h1>{s.name}</h1>
        <p>
          {[s.category?.name, mall?.mall?.name, formatKm(branch?.km, approx)].filter(Boolean).join(' · ')}
          {state && (
            <>
              {' · '}
              <b style={{ color: state.open ? '#16a85a' : '#e53a42' }}>{state.label}</b>
            </>
          )}
        </p>
        <span className="hero-pill">
          {live.length
            ? (live[0].discount_label ?? `${live.length} live ${live.length === 1 ? 'offer' : 'offers'}`)
            : 'No live offers right now'}
        </span>
      </section>
      <section className="section">
        <div className="info-grid">
          <div className="info-card">
            <span>Today’s hours</span>
            <strong style={{ fontSize: 16 }}>{state ? state.today : '—'}</strong>
          </div>
          <div className="info-card">
            <span>Distance</span>
            <strong style={{ fontSize: 16 }}>
              {branch?.km != null ? formatKm(branch.km, approx) : place ? '—' : 'Set location'}
            </strong>
          </div>
        </div>
      </section>
      <section className="section">
        <Link className="shop-card" to={`/points/add?shop=${s.id}`}>
          <div className="shop-thumb">💰</div>
          <div>
            <h4>Bought something here?</h4>
            <div className="meta">Add your bill and earn 1 point for every ₹50 (1 point = ₹1)</div>
          </div>
          <div className="chev">›</div>
        </Link>
      </section>
      {s.description && (
        <section className="section">
          <p className="meta" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            {s.description}
          </p>
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2>Live offers</h2>
          {live.length > 0 && <button>{live.length} live</button>}
        </div>
        {offers.isLoading ? (
          <Loading />
        ) : offers.error ? (
          <ErrorNotice error={offers.error} onRetry={() => offers.refetch()} />
        ) : live.length ? (
          <div className="offer-row">
            {live.map((o, i) => {
              const saved = Boolean(savedOffers.data?.has(o.id));
              return (
                <article key={o.id} className="offer-card" onClick={() => showOffer(o.id)}>
                  <OfferImage
                    imageKey={o.image_keys[0]}
                    icon={<CategoryIcon category={s.category} fallback="🎁" size={56} />}
                    badge={o.discount_label ?? (o.is_featured ? 'FEATURED' : 'OFFER')}
                    tone={toneFor(i)}
                  />
                  <div className="offer-body">
                    <h4>{o.title}</h4>
                    <div className="meta">
                      {o.offer_price != null ? formatPrice(o.offer_price) : validity(o.ends_on)}
                    </div>
                    <div className="offer-cta">
                      <strong
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveOffer.run(o.id, saved);
                        }}
                      >
                        {saved ? '♥ Saved' : '♡ Save'}
                      </strong>
                      <span>→</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            emoji="🎁"
            title="No live offers right now"
            text="Save this shop to find its next offer fast."
          />
        )}
      </section>
      {withKm.length > 1 && (
        <section className="section">
          <div className="section-head">
            <h2>Branches</h2>
            <button>{withKm.length} locations</button>
          </div>
          <div className="list">
            {withKm.map((b) => {
              const st = openState(b);
              const active = b.id === branch?.id;
              return (
                <div
                  key={b.id}
                  className="shop-card"
                  role="button"
                  aria-pressed={active}
                  onClick={() => setBranchId(b.id)}
                  style={{
                    gridTemplateColumns: '1fr auto',
                    borderColor: active ? 'var(--color-blue)' : undefined,
                  }}
                >
                  <div>
                    <h4>{b.name}</h4>
                    <div className="meta">
                      {[mallOf(b.id)?.mall?.name, b.address, formatKm(b.km, approx)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="meta" style={{ marginTop: 3, color: st.open ? '#16a85a' : '#e53a42' }}>
                      {st.label}
                    </div>
                  </div>
                  <div className="chev">{active ? '✓' : '›'}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="section form-card">
        <h3 style={{ marginTop: 0 }}>Visit this shop</h3>
        {branches.isLoading ? (
          <Loading />
        ) : branches.error ? (
          <ErrorNotice error={branches.error} onRetry={() => branches.refetch()} />
        ) : branch ? (
          <>
            {branch.temp_closed && (
              <div className="notice warn">
                Temporarily closed{branch.temp_closed_note ? ` — ${branch.temp_closed_note}` : ''}
              </div>
            )}
            <p className="meta" style={{ lineHeight: 1.6, marginTop: 0 }}>
              <b>{branch.name}</b>
              {mall?.mall ? ` · ${mall.mall.name}${mall.floor ? `, ${mall.floor}` : ''}` : ''}
              {branch.address ? (
                <>
                  <br />
                  {branch.address}
                </>
              ) : null}
            </p>
            <div style={{ margin: '10px 0' }}>
              {DAYS.map((d) => {
                const h = branch.hours?.[d.key];
                return (
                  <div
                    key={d.key}
                    className="meta"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '4px 0',
                      fontSize: 12,
                      fontWeight: d.key === today ? 800 : 500,
                      color: d.key === today ? 'var(--color-ink)' : undefined,
                    }}
                  >
                    <span>{d.label}</span>
                    <span>{h ? `${formatTime(h.open)} – ${formatTime(h.close)}` : 'Closed'}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="meta" style={{ lineHeight: 1.6 }}>
            Location details for this shop will be added soon.
          </p>
        )}
        <div className="btn-row">
          {branch?.lat != null && branch.lng != null && (
            <a
              className="btn yellow"
              href={directionsLink(branch.lat, branch.lng)}
              onClick={() => track('directions', s.id)}
              target="_blank"
              rel="noreferrer"
            >
              📍 Get directions
            </a>
          )}
          {phone && (
            <a
              className="btn secondary"
              href={`tel:${phone.replace(/\s/g, '')}`}
              onClick={() => track('call', s.id)}
            >
              📞 Call
            </a>
          )}
          {s.whatsapp && (
            <a
              className="btn secondary"
              href={whatsappLink(s.whatsapp)}
              onClick={() => track('whatsapp', s.id)}
              target="_blank"
              rel="noreferrer"
            >
              💬 WhatsApp
            </a>
          )}
        </div>
      </section>
      <Sheet
        open={Boolean(openOffer)}
        onClose={closeOffer}
        title={openOffer?.title ?? 'Offer'}
        subtitle={s.name}
      >
        {openOffer && (
          <OfferDetails
            offer={openOffer}
            icon={<CategoryIcon category={s.category} fallback="🎁" size={56} />}
            saved={Boolean(savedOffers.data?.has(openOffer.id))}
            saving={saveOffer.pending}
            onSave={(saved) => saveOffer.run(openOffer.id, saved)}
            onShare={() => shareOffer(openOffer)}
          />
        )}
      </Sheet>
    </AppShell>
  );
}

function OfferDetails({
  offer: o,
  icon,
  saved,
  saving,
  onSave,
  onShare,
}: {
  offer: Offer;
  icon?: ReactNode;
  saved: boolean;
  saving: boolean;
  onSave: (saved: boolean) => void;
  onShare: () => void;
}) {
  return (
    <div>
      {o.image_keys.length ? (
        <OfferGallery imageKeys={o.image_keys} />
      ) : (
        <OfferImage
          icon={icon}
          badge={o.discount_label}
          style={{ borderRadius: 18, height: 140, marginBottom: 12 }}
        />
      )}
      {o.image_keys.length > 0 && o.discount_label && <span className="badge">{o.discount_label}</span>}
      {o.product_name && <h3 style={{ margin: '8px 0 4px' }}>{o.product_name}</h3>}
      {(o.offer_price != null || o.original_price != null) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0' }}>
          {o.offer_price != null && (
            <strong style={{ fontSize: 22, color: 'var(--color-blue)' }}>{formatPrice(o.offer_price)}</strong>
          )}
          {o.original_price != null && o.original_price !== o.offer_price && (
            <s className="meta" style={{ fontSize: 14 }}>
              {formatPrice(o.original_price)}
            </s>
          )}
        </div>
      )}
      <div className="meta">
        From {formatDate(o.starts_on)}
        {o.ends_on ? ` · till ${formatDate(o.ends_on)}` : ' · no end date'}
      </div>
      {o.description && (
        <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{o.description}</p>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          className={`btn${saved ? ' secondary' : ''}`}
          style={{ flex: 1 }}
          disabled={saving}
          onClick={() => onSave(saved)}
        >
          {saved ? '♥ Saved — tap to remove' : '♡ Save offer'}
        </button>
        <button className="btn secondary" onClick={() => onShare()} aria-label="Share offer">
          ↗ Share
        </button>
      </div>
      <p className="meta" style={{ textAlign: 'center' }}>
        Show this offer at the shop to claim it.
      </p>
    </div>
  );
}
