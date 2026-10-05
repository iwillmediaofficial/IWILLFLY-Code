import { Link } from 'react-router-dom';
import { AppShell, BackHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { formatKm } from '../../lib/hours';
import { usePlace } from '../../lib/location';
import { useMalls } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import type { MallResult } from '../../lib/types';
import { ErrorNotice, Loading, NoBackend, Thumb } from '../ui';

export default function Malls() {
  const { place } = usePlace();
  const malls = useMalls();
  const total = malls.data?.reduce((n, m) => n + m.offer_count, 0) ?? 0;
  return (
    <AppShell
      header={
        <BackHeader
          back="/explore"
          title="Malls & Shopping Centres"
          subtitle="Shops grouped inside each mall"
          actions={
            <Link className="icon-btn" to="/explore" aria-label="Search">
              ⌕
            </Link>
          }
        />
      }
    >
      <section className="hero">
        <h1>Shopping destinations</h1>
        <p>
          Fashion, electronics, home appliances, food and more — all offers from shops inside each mall in one
          place.
        </p>
        <span className="hero-pill">{total ? `${total} live offers` : 'Malls near you'}</span>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>All malls</h2>
          {place && <button>Nearest first</button>}
        </div>
        {!supabase ? (
          <NoBackend />
        ) : malls.isLoading ? (
          <Loading />
        ) : malls.error ? (
          <ErrorNotice error={malls.error} onRetry={() => malls.refetch()} />
        ) : malls.data?.length ? (
          <div className="list">
            {malls.data.map((m) => (
              <MallCard key={m.mall_id} mall={m} />
            ))}
          </div>
        ) : (
          <EmptyState
            emoji="🏬"
            title="No malls yet"
            text="Shopping destinations near you will appear here soon."
          />
        )}
      </section>
    </AppShell>
  );
}

export function MallCard({ mall: m }: { mall: MallResult }) {
  return (
    <Link className="shop-card" to={`/mall/${m.mall_id}`}>
      <Thumb imageKey={m.cover_key} icon="🏬" />
      <div>
        <h4>{m.name}</h4>
        <div className="meta">
          {[formatKm(m.distance_km), `${m.shop_count} ${m.shop_count === 1 ? 'shop' : 'shops'}`]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <span className="offer">
          {m.offer_count} live {m.offer_count === 1 ? 'offer' : 'offers'}
        </span>
      </div>
      <div className="chev">›</div>
    </Link>
  );
}
