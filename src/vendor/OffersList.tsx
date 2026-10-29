import { Link, useSearchParams } from 'react-router-dom';
import { formatPrice } from '../lib/hours';
import { mediaUrl } from '../lib/supabase';
import type { Offer, OfferStatus } from '../lib/types';
import { useMyBranches, useMyOffers } from './api';
import { useApproved, useBranchScope, useCanEditOffers, useReadOnly } from './context';
import { formatDate, offerPhase, phaseClass, phaseLabel } from './format';
import { ErrorNote, Loading, PageHead } from './ui';
import { MapPin, Store, Tag } from 'lucide-react';
import { Icon, IconBubble } from '../components/Icon';

const filters: { key: OfferStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Live' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
];

export default function OffersList() {
  const { offers: all, shops, branchesOf, isPending, error } = useMyOffers();
  const { data: branches } = useMyBranches();
  const [params, setParams] = useSearchParams();
  const readOnly = useReadOnly();
  const canPost = useCanEditOffers();
  const approved = useApproved();
  const { branchId, branchName } = useBranchScope();
  // Branch members see the offers shown at their branch: brand-wide ones and their branch's own.
  const offers = (all ?? []).filter(
    (o) => branchId == null || o.all_branches || (branchesOf?.get(o.id) ?? []).includes(branchId),
  );
  const status = filters.find((x) => x.key === params.get('status'))?.key ?? 'all';
  const shown = offers.filter((o) => status === 'all' || o.status === status);
  const shopName = (id: number) => shops?.find((s) => s.id === id)?.name ?? '';
  const many = (branches ?? []).length > 1;
  /** "All branches", "Kakkanad", "Kakkanad, Edappally +2" */
  const scope = (o: Offer) => {
    if (!many) return '';
    if (o.all_branches) return 'All branches';
    const names = (branchesOf?.get(o.id) ?? []).map((b) => branches?.find((x) => x.id === b)?.name ?? '');
    if (names.length === 0) return 'No branch chosen';
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  };
  const count = (key: OfferStatus | 'all') => offers.filter((o) => key === 'all' || o.status === key).length;

  return (
    <>
      <PageHead
        title={branchName ? `Offers at ${branchName}` : 'Your offers'}
        action={canPost && approved && <Link to="/vendor/offers/new">＋ New offer</Link>}
      />
      {branchId != null && (
        <p className="meta" style={{ marginTop: 0 }}>
          You can change your branch's own offers. Offers for all branches are set by the business owner.
        </p>
      )}
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
            {all ? ` (${count(x.key)})` : ''}
          </button>
        ))}
      </div>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : shops?.length === 0 ? (
        <div className="saved-empty">
          <IconBubble icon={Store} />
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
          <IconBubble icon={Tag} />
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
            <OfferRow key={o.id} offer={o} shopName={shopName(o.shop_id)} scope={scope(o)} />
          ))}
        </div>
      )}
    </>
  );
}

function OfferRow({ offer: o, shopName, scope }: { offer: Offer; shopName: string; scope: string }) {
  const phase = offerPhase(o);
  const cover = o.image_keys[0];
  return (
    <Link className="shop-card" to={`/vendor/offers/${o.id}`} style={{ alignItems: 'start' }}>
      <div className="shop-thumb poster">
        {cover ? <img src={mediaUrl(cover)} alt="" loading="lazy" decoding="async" /> : <Icon icon={Tag} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <h4>{o.title}</h4>
        <div className="meta">
          {shopName}
          {scope && (
            <>
              {' · '}
              <Icon icon={MapPin} /> {scope}
            </>
          )}
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
