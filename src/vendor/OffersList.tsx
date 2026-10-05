import { Link, useSearchParams } from 'react-router-dom';
import { formatPrice } from '../lib/hours';
import { mediaUrl } from '../lib/supabase';
import type { Offer, OfferStatus } from '../lib/types';
import { useMyOffers } from './api';
import { useReadOnly } from './context';
import { formatDate, offerPhase, phaseClass, phaseLabel } from './format';
import { ErrorNote, Loading, PageHead } from './ui';

const filters: { key: OfferStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Live' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
];

export default function OffersList() {
  const { offers, shops, isPending, error } = useMyOffers();
  const [params, setParams] = useSearchParams();
  const readOnly = useReadOnly();
  const status = filters.find((x) => x.key === params.get('status'))?.key ?? 'all';
  const shown = (offers ?? []).filter((o) => status === 'all' || o.status === status);
  const shopName = (id: number) => shops?.find((s) => s.id === id)?.name ?? '';
  const count = (key: OfferStatus | 'all') =>
    (offers ?? []).filter((o) => key === 'all' || o.status === key).length;

  return (
    <>
      <PageHead title="Your offers" action={!readOnly && <Link to="/vendor/offers/new">＋ New offer</Link>} />
      <div className="tabs" role="tablist">
        {filters.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={status === x.key}
            className={status === x.key ? 'active' : ''}
            onClick={() => setParams(x.key === 'all' ? {} : { status: x.key }, { replace: true })}
          >
            {x.label}
            {offers ? ` (${count(x.key)})` : ''}
          </button>
        ))}
      </div>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : shops?.length === 0 ? (
        <div className="saved-empty">
          <div className="emoji">🏪</div>
          <h3>Add a shop first</h3>
          <p>Offers belong to a shop. Create your shop, then post offers for it.</p>
          {!readOnly && (
            <Link className="btn" to="/vendor/shops/new" style={{ display: 'inline-block', marginTop: 8 }}>
              Add a shop
            </Link>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="saved-empty">
          <div className="emoji">🏷️</div>
          <h3>No offers here</h3>
          <p>
            {status === 'all'
              ? 'Post your first offer to reach shoppers nearby.'
              : 'Nothing in this list right now.'}
          </p>
        </div>
      ) : (
        <div className="list">
          {shown.map((o) => (
            <OfferRow key={o.id} offer={o} shopName={shopName(o.shop_id)} />
          ))}
        </div>
      )}
    </>
  );
}

function OfferRow({ offer: o, shopName }: { offer: Offer; shopName: string }) {
  const phase = offerPhase(o);
  const cover = o.image_keys[0];
  return (
    <Link className="shop-card" to={`/vendor/offers/${o.id}`} style={{ alignItems: 'start' }}>
      <div className="shop-thumb">{cover ? <img src={mediaUrl(cover)} alt="" /> : '🏷️'}</div>
      <div style={{ minWidth: 0 }}>
        <h4>{o.title}</h4>
        <div className="meta">
          {shopName}
          {o.offer_price != null && ` · ${formatPrice(o.offer_price)}`}
          {o.discount_label && ` · ${o.discount_label}`}
        </div>
        <div className="meta">
          {formatDate(o.starts_on)} – {o.ends_on ? formatDate(o.ends_on) : 'no end date'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span className={`pill-status ${phaseClass[phase]}`}>{phaseLabel[phase]}</span>
          {o.is_paused && phase !== 'paused' && <span className="pill-status">Paused</span>}
          {o.is_featured && <span className="pill-status featured">Featured</span>}
        </div>
        {o.status === 'rejected' && o.reject_reason && (
          <p className="error-text">Reason: {o.reject_reason}</p>
        )}
      </div>
      <div className="chev">›</div>
    </Link>
  );
}
