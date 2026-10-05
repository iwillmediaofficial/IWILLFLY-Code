import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { formatPrice } from '../lib/hours';
import { db, must } from '../lib/queries';
import { mediaUrl } from '../lib/supabase';
import type { Offer } from '../lib/types';
import { Empty, ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, formatDate, friendlyError, one, useInvalidate } from './util';

type Tab = 'pending' | 'approved' | 'rejected' | 'featured';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'featured', label: 'Featured' },
];

type ShopRef = { id: number; name: string };
type OfferRow = Offer & { shop: ShopRef | ShopRef[] | null };

export function Offers() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'pending') as Tab;

  const offers = useQuery({
    queryKey: ['admin', 'offers', tab],
    queryFn: async () => {
      // The review queue is oldest first; edits send an offer back to pending, so use updated_at.
      let q = db()
        .from('offers')
        .select('*, shop:shops(id, name)')
        .order('updated_at', { ascending: tab === 'pending' })
        .limit(200);
      q = tab === 'featured' ? q.eq('is_featured', true) : q.eq('status', tab);
      return must<OfferRow[]>(await q);
    },
  });

  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {offers.isPending && <Loading />}
      {offers.error && <ErrorNotice error={offers.error} />}
      {offers.data?.length === 0 && (
        <Empty emoji="🏷️" title={tab === 'pending' ? 'Nothing to review' : 'No offers here'}>
          {tab === 'pending' ? 'New and edited offers will show up here.' : undefined}
        </Empty>
      )}
      {offers.data?.map((o) => (
        <OfferCard key={o.id} offer={o} />
      ))}
    </>
  );
}

function OfferCard({ offer: o }: { offer: OfferRow }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const shop = one(o.shop);
  const cover = o.image_keys[0];

  const update = useMutation({
    mutationFn: async (patch: Partial<Offer>) => {
      must(await db().from('offers').update(patch).eq('id', o.id));
    },
    onSuccess: () => invalidate(['admin', 'offers'], ['admin_stats'], ...PUBLIC_KEYS),
    onError: (e) => toast(friendlyError(e)),
  });
  const run = (patch: Partial<Offer>, done: string) => update.mutate(patch, { onSuccess: () => toast(done) });

  const reject = () => {
    let reason = window.prompt(
      'Why is this offer rejected? The vendor will see this.',
      o.reject_reason ?? '',
    );
    while (reason !== null && !reason.trim()) {
      reason = window.prompt('A reason is required so the vendor can fix the offer.', '');
    }
    if (reason === null) return;
    run(
      { status: 'rejected', reject_reason: reason.trim().slice(0, 300), is_featured: false },
      'Offer rejected',
    );
  };

  return (
    <div className="manage-card">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: 12, cursor: 'pointer' }}
      >
        <div className="shop-thumb">{cover ? <img src={mediaUrl(cover)} alt="" /> : '🏷️'}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            <span className={`pill-status ${o.status}`}>{o.status}</span>
            {o.is_featured && <span className="pill-status featured">★ Featured</span>}
            {o.is_paused && <span className="pill-status">Paused</span>}
          </div>
          <h4>{o.title}</h4>
          <div className="meta">
            {shop?.name ?? 'Unknown shop'}
            {o.product_name ? ` · ${o.product_name}` : ''}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {o.offer_price != null && <b>{formatPrice(o.offer_price)} </b>}
            {o.original_price != null && (
              <s className="meta" style={{ fontSize: 12 }}>
                {formatPrice(o.original_price)}
              </s>
            )}
            {o.discount_label && (
              <span className="pill-status featured" style={{ marginLeft: 6 }}>
                {o.discount_label}
              </span>
            )}
          </div>
          <div className="meta" style={{ marginTop: 4 }}>
            {formatDate(o.starts_on)} – {o.ends_on ? formatDate(o.ends_on) : 'no end date'} · updated{' '}
            {formatDate(o.updated_at)}
          </div>
        </div>
      </div>

      {o.status === 'rejected' && o.reject_reason && (
        <div className="notice bad" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Rejected:</b> {o.reject_reason}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10 }}>
          {o.image_keys.length > 0 && (
            <div className="image-strip" style={{ marginBottom: 8 }}>
              {o.image_keys.map((k) => (
                <a key={k} href={mediaUrl(k)} target="_blank" rel="noreferrer" className="image-pick small">
                  <img src={mediaUrl(k)} alt="" />
                </a>
              ))}
            </div>
          )}
          <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>
            {o.description || <span className="meta">No description.</span>}
          </p>
        </div>
      )}

      <div className="btn-row">
        {o.status !== 'approved' && (
          <button
            className="btn small"
            disabled={update.isPending}
            onClick={() => run({ status: 'approved', reject_reason: null }, 'Offer approved')}
          >
            Approve
          </button>
        )}
        {o.status !== 'rejected' && (
          <button className="btn small danger" disabled={update.isPending} onClick={reject}>
            Reject
          </button>
        )}
        {o.status === 'approved' && (
          <button
            className="btn small yellow"
            disabled={update.isPending}
            onClick={() =>
              run({ is_featured: !o.is_featured }, o.is_featured ? 'Removed from featured' : 'Offer featured')
            }
          >
            {o.is_featured ? 'Unfeature' : '★ Feature'}
          </button>
        )}
        <button className="link-btn" onClick={() => setOpen(!open)}>
          {open ? 'Hide details' : 'Show images & description'}
        </button>
      </div>
    </div>
  );
}
