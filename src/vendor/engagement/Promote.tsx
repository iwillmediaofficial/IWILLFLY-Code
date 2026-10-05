import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import type { Festival, Offer, PlacementKind, PlacementRequest, Shop } from '../../lib/types';
import { useMyOffers } from '../api';
import { useReadOnly, useVendor } from '../context';
import { errorMessage, formatDate, offerPhase, orNull, todayIST } from '../format';
import { formatDateTime } from '../scratch/format';
import { BlockedNote, ErrorNote, Loading, PageHead } from '../ui';
import { useActiveFestivals, useCancelPlacement, useMyPlacementRequests, useRequestPlacement } from './api';
import { kindInfo, requestClass, requestLabel } from './format';

const kinds = Object.keys(kindInfo) as PlacementKind[];

export default function VendorPromote() {
  const vendor = useVendor();
  const readOnly = useReadOnly();
  const { offers, shops, isPending, error } = useMyOffers();
  const festivals = useActiveFestivals();
  const requests = useMyPlacementRequests();

  return (
    <>
      <PageHead title="Promote" />
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Request featured placement</h2>
        </div>
        {readOnly ? (
          <BlockedNote />
        ) : vendor.status !== 'approved' ? (
          <div className="notice warn">
            <b>Promotion needs an approved business.</b> You can ask for featured placement once the IWILLFLY
            team approves your account.
          </div>
        ) : isPending || festivals.isPending ? (
          <Loading />
        ) : error || festivals.error ? (
          <ErrorNote error={error ?? festivals.error} />
        ) : (
          <RequestForm offers={offers ?? []} shops={shops ?? []} festivals={festivals.data ?? []} />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Your requests</h2>
        </div>
        {requests.isPending ? (
          <Loading />
        ) : requests.error ? (
          <ErrorNote error={requests.error} />
        ) : (requests.data ?? []).length === 0 ? (
          <p className="meta" style={{ fontSize: 13 }}>
            You haven't asked for a placement yet. Requests you send show here with IWILLFLY's answer.
          </p>
        ) : (
          <div className="list">
            {(requests.data ?? []).map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                offers={offers ?? []}
                shops={shops ?? []}
                festivals={festivals.data ?? []}
                canCancel={!readOnly}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function RequestForm({
  offers,
  shops,
  festivals,
}: {
  offers: Offer[];
  shops: Shop[];
  festivals: Festival[];
}) {
  const toast = useToast();
  const send = useRequestPlacement();
  const today = todayIST();
  const usableOffers = offers.filter((o) => {
    const p = offerPhase(o, today);
    return p !== 'rejected' && p !== 'ended';
  });
  const runningFestivals = festivals.filter((f) => f.ends_on >= today);

  const [kind, setKind] = useState<PlacementKind>('featured_offer');
  const [offerId, setOfferId] = useState('');
  const [shopId, setShopId] = useState(shops.length === 1 ? String(shops[0].id) : '');
  const [festivalId, setFestivalId] = useState('');
  const [message, setMessage] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');

  const needsOffer = kind !== 'home_banner';
  const needsShop = kind === 'home_banner';
  const needsFestival = kind === 'festival_spotlight';

  if (shops.length === 0) {
    return (
      <div className="notice">
        Add your shop and an offer first, then come back to promote them.{' '}
        <Link to="/vendor/shops/new" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
          Add a shop
        </Link>
      </div>
    );
  }

  const validate = () => {
    if (needsOffer && !offerId) return 'Choose the offer to promote.';
    if (needsShop && !shopId) return 'Choose the shop for the banner.';
    if (needsFestival && !festivalId) return 'Choose the festival.';
    if (message.trim().length > 500) return 'Message is too long (500 characters max).';
    if (from && from < today) return "Start date can't be in the past.";
    if (from && to && to < from) return 'End date must be on or after the start date.';
    return null;
  };

  const reset = () => {
    setOfferId('');
    setFestivalId('');
    setMessage('');
    setFrom('');
    setTo('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem ?? '');
    if (problem) return;
    send.mutate(
      {
        kind,
        offer_id: needsOffer ? Number(offerId) : null,
        shop_id: needsShop ? Number(shopId) : null,
        festival_id: needsFestival ? Number(festivalId) : null,
        message: orNull(message),
        wanted_from: from || null,
        wanted_to: to || null,
      },
      {
        onSuccess: () => {
          toast('Request sent to IWILLFLY');
          reset();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <div className="notice">
        Requests are free and reviewed by the IWILLFLY team. You get an alert when we decide. For a guaranteed
        spot, buy a featured shop or promoted offer add-on in{' '}
        <Link to="/vendor/billing" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
          Plan & billing
        </Link>
        .
      </div>
      <div className="field">
        <label htmlFor="pr-kind">What would you like? *</label>
        <select
          id="pr-kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as PlacementKind);
            setError('');
          }}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindInfo[k].label}
            </option>
          ))}
        </select>
        <div className="hint">{kindInfo[kind].hint}</div>
      </div>

      {needsFestival && (
        <div className="field">
          <label htmlFor="pr-fest">Festival *</label>
          <select id="pr-fest" value={festivalId} onChange={(e) => setFestivalId(e.target.value)}>
            <option value="">Choose a festival</option>
            {runningFestivals.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({formatDate(f.starts_on)} – {formatDate(f.ends_on)})
              </option>
            ))}
          </select>
          {runningFestivals.length === 0 ? (
            <div className="hint">There are no festivals running right now.</div>
          ) : (
            <div className="hint">
              Works best with an offer already approved for the festival.{' '}
              <Link to="/vendor/festivals" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
                Festival submissions
              </Link>
            </div>
          )}
        </div>
      )}

      {needsOffer && (
        <div className="field">
          <label htmlFor="pr-offer">Offer *</label>
          <select id="pr-offer" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            <option value="">Choose an offer</option>
            {usableOffers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
                {o.is_featured ? ' (already featured)' : ''}
                {o.status === 'pending' ? ' (in review)' : ''}
              </option>
            ))}
          </select>
          {usableOffers.length === 0 && (
            <div className="hint">
              You have no current offers.{' '}
              <Link to="/vendor/offers/new" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
                Post an offer
              </Link>
            </div>
          )}
        </div>
      )}

      {needsShop && (
        <div className="field">
          <label htmlFor="pr-shop">Shop *</label>
          <select id="pr-shop" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">Choose a shop</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="pr-msg">Message</label>
        <textarea
          id="pr-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          placeholder="Anything we should know, e.g. a weekend sale you want to push"
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pr-from">Wanted from</label>
          <input
            id="pr-from"
            type="date"
            min={today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pr-to">Wanted until</label>
          <input
            id="pr-to"
            type="date"
            min={from || today}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <div className="hint" style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: -6 }}>
        Dates are optional. Leave them empty if any time works.
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn block" type="submit" disabled={send.isPending} style={{ marginTop: 12 }}>
        {send.isPending ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}

function RequestRow({
  request: r,
  offers,
  shops,
  festivals,
  canCancel,
}: {
  request: PlacementRequest;
  offers: Offer[];
  shops: Shop[];
  festivals: Festival[];
  canCancel: boolean;
}) {
  const toast = useToast();
  const cancel = useCancelPlacement();
  const offer = offers.find((o) => o.id === r.offer_id);
  const shop = shops.find((s) => s.id === r.shop_id);
  const festival = festivals.find((f) => f.id === r.festival_id);
  const target = [
    festival?.name ?? (r.festival_id != null ? 'A festival' : null),
    offer?.title ?? (r.offer_id != null ? 'An offer' : null),
    shop?.name ?? (r.shop_id != null ? 'A shop' : null),
  ]
    .filter(Boolean)
    .join(' · ');
  const wanted =
    r.wanted_from || r.wanted_to
      ? `${r.wanted_from ? formatDate(r.wanted_from) : 'Any time'} – ${r.wanted_to ? formatDate(r.wanted_to) : 'open-ended'}`
      : null;

  const onCancel = () => {
    if (!confirm(`Cancel this ${kindInfo[r.kind].label.toLowerCase()} request?`)) return;
    cancel.mutate(r.id, {
      onSuccess: () => toast('Request cancelled'),
      onError: (e) => toast(errorMessage(e)),
    });
  };

  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <h4>{kindInfo[r.kind].label}</h4>
          {target && <div className="meta">{target}</div>}
        </div>
        <span className={`pill-status ${requestClass[r.status]}`} style={{ flex: 'none' }}>
          {requestLabel[r.status]}
        </span>
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        Sent {formatDateTime(r.created_at)}
        {wanted && ` · Wanted ${wanted}`}
        {r.decided_at &&
          r.status !== 'pending' &&
          ` · ${requestLabel[r.status]} ${formatDateTime(r.decided_at)}`}
      </div>
      {r.message && <p style={{ fontSize: 13, margin: '6px 0 0', lineHeight: 1.5 }}>“{r.message}”</p>}
      {r.admin_note && (
        <p className={r.status === 'rejected' ? 'error-text' : 'meta'} style={{ marginTop: 6 }}>
          Note from IWILLFLY: {r.admin_note}
        </p>
      )}
      {r.status === 'pending' && canCancel && (
        <div className="btn-row">
          <button type="button" className="btn danger small" disabled={cancel.isPending} onClick={onCancel}>
            {cancel.isPending ? 'Cancelling…' : 'Cancel request'}
          </button>
        </div>
      )}
    </div>
  );
}
