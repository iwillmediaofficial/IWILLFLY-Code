import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AppShell, BackHeader } from '../../components/AppShell';
import { EmptyState, ShopCard } from '../../components/ShopCard';
import { formatKm, haversineKm } from '../../lib/hours';
import { isApprox, usePlace } from '../../lib/location';
import { usePageMeta } from '../../lib/pageMeta';
import { db, must, useShopSearch } from '../../lib/queries';
import { mediaUrl, supabase } from '../../lib/supabase';
import type { Mall as MallRow } from '../../lib/types';
import { ErrorNotice, Loading, NoBackend } from '../ui';
import { directionsLink } from '../util';

export default function Mall() {
  // The link is /mall/<slug>; old links use the mall's number (/mall/2).
  const key = useParams().id ?? '';
  const byId = /^\d+$/.test(key);
  const valid = /^[1-9]\d{0,14}$/.test(key) || /^[a-z0-9-]{1,80}$/.test(key);
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const { place } = usePlace();
  const mall = useQuery({
    queryKey: ['mall', key],
    queryFn: async () =>
      must<MallRow | null>(
        await db()
          .from('malls')
          .select('*')
          .eq(byId ? 'id' : 'slug', byId ? Number(key) : key)
          .maybeSingle(),
      ),
    enabled: Boolean(supabase) && valid,
  });
  const m = mall.data;
  const id = m?.id ?? null;
  const shops = useShopSearch({ mallId: id, limit: 100, enabled: id != null });
  const slug = m?.slug;
  useEffect(() => {
    if (slug && key !== slug) navigate(`/mall/${slug}${search}${hash}`, { replace: true });
  }, [slug, key, search, hash, navigate]);
  usePageMeta(m?.name, m && (m.description || `Shops and live offers inside ${m.name} on IWILLFLY.`));
  const km = m?.lat != null && m.lng != null && place ? haversineKm(place, { lat: m.lat, lng: m.lng }) : null;

  const header = <BackHeader back="/malls" title={m?.name ?? 'Mall'} subtitle="Shops & live offers inside" />;

  if (!supabase) {
    return (
      <AppShell header={header}>
        <NoBackend />
      </AppShell>
    );
  }
  if (valid && mall.isLoading) {
    return (
      <AppShell header={header}>
        <Loading />
      </AppShell>
    );
  }
  if (mall.error) {
    return (
      <AppShell header={header}>
        <ErrorNotice error={mall.error} onRetry={() => mall.refetch()} />
      </AppShell>
    );
  }
  if (!m || !valid) {
    return (
      <AppShell header={header}>
        <EmptyState
          emoji="🏬"
          title="Mall not found"
          text="It may have been removed. Browse other malls instead."
        />
      </AppShell>
    );
  }

  const offers = shops.data?.reduce((n, s) => n + s.offer_count, 0) ?? 0;
  return (
    <AppShell header={header}>
      <section
        className="hero"
        style={
          m.cover_key
            ? {
                backgroundImage: `linear-gradient(135deg, rgba(20, 102, 221, 0.88), rgba(14, 70, 170, 0.7)), url(${mediaUrl(m.cover_key)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        <h1>{m.name}</h1>
        {m.description && <p>{m.description}</p>}
        {(m.address || km != null) && (
          <p style={{ marginTop: 6 }}>
            {[formatKm(km, isApprox(place)), m.address].filter(Boolean).join(' · ')}
          </p>
        )}
        <span className="hero-pill">
          {offers} live {offers === 1 ? 'offer' : 'offers'}
        </span>
      </section>
      {m.lat != null && m.lng != null && (
        <section className="section">
          <a
            className="btn yellow block"
            style={{ display: 'block', textAlign: 'center' }}
            href={directionsLink(m.lat, m.lng)}
            target="_blank"
            rel="noreferrer"
          >
            📍 Get directions
          </a>
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2>Shops inside</h2>
          {shops.data && <button>{shops.data.length} shops</button>}
        </div>
        {shops.isLoading ? (
          <Loading text="Loading shops…" />
        ) : shops.error ? (
          <ErrorNotice error={shops.error} onRetry={() => shops.refetch()} />
        ) : shops.data?.length ? (
          <div className="list">
            {shops.data.map((s) => (
              <ShopCard key={s.shop_id} shop={s} />
            ))}
          </div>
        ) : (
          <EmptyState
            emoji="🛍️"
            title="No shops listed yet"
            text="Shops in this mall will appear here soon."
          />
        )}
      </section>
    </AppShell>
  );
}
