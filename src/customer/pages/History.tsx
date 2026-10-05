import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, BackHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { track } from '../../lib/engagement';
import { formatPrice } from '../../lib/hours';
import { supabase } from '../../lib/supabase';
import type { HistoryOffer } from '../../lib/types';
import { useOfferHistory } from '../engagement';
import { ErrorNotice, Loading, NoBackend, Thumb } from '../ui';

function viewedAt(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'Viewed today';
  if (days < 2) return 'Viewed yesterday';
  return `Viewed ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export default function History() {
  const { session, loading } = useAuth();
  return (
    <AppShell header={<BackHeader back="/profile" title="Recently viewed" subtitle="Offers you looked at" />}>
      {!supabase ? (
        <NoBackend />
      ) : loading ? (
        <Loading />
      ) : !session ? (
        <EmptyState
          emoji="🕘"
          title="Sign in to see recently viewed offers"
          text="Offers you open will be kept here so you can find them again."
        >
          <Link className="btn" to="/login" style={{ display: 'inline-block', marginTop: 12 }}>
            Sign in
          </Link>
        </EmptyState>
      ) : (
        <HistoryList />
      )}
    </AppShell>
  );
}

function HistoryList() {
  const { data, isLoading, error, refetch } = useOfferHistory();
  if (isLoading) return <Loading text="Loading your history…" />;
  if (error) return <ErrorNotice error={error} onRetry={() => refetch()} />;
  if (!data?.length) {
    return (
      <EmptyState emoji="🕘" title="Nothing here yet" text="Offers you open will show up here.">
        <Link className="btn" to="/explore" style={{ display: 'inline-block', marginTop: 12 }}>
          Explore offers
        </Link>
      </EmptyState>
    );
  }
  return (
    <div className="list">
      {data.map((o) => (
        <HistoryRow key={`${o.offer_id}-${o.viewed_at}`} offer={o} />
      ))}
    </div>
  );
}

function HistoryRow({ offer: o }: { offer: HistoryOffer }) {
  return (
    <Link
      className="shop-card"
      to={`/shop/${o.shop_id}?offer=${o.offer_id}`}
      onClick={() => track('click', o.shop_id, o.offer_id)}
    >
      <Thumb imageKey={o.image_key ?? o.shop_logo_key} icon="🎁" />
      <div>
        <h4>{o.title}</h4>
        <div className="meta">{[o.shop_name, viewedAt(o.viewed_at)].join(' · ')}</div>
        <span className="offer">{o.discount_label ?? (formatPrice(o.offer_price) || 'View offer')}</span>
      </div>
      <div className="chev">›</div>
    </Link>
  );
}
