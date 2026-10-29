import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { mediaUrl } from '../../lib/supabase';
import { daysUntil, money } from '../billing/format';
import { useVendor } from '../context';
import { errorMessage, formatDate, todayIST } from '../format';
import { BlockedNote, ErrorNote, Loading, PageHead } from '../ui';
import {
  useBuyTopPick,
  useMyTopPicks,
  useRenewTopPick,
  useSetManagersCanSponsor,
  useSwapTopPickOffer,
  type MyTopPick,
  type TopPickLength,
  type TopPickOffer,
  type TopPicksInfo,
} from './api';
import { Tag } from 'lucide-react';
import { Icon } from '../../components/Icon';

const linkStyle = { color: 'var(--color-blue)', fontWeight: 800 } as const;

const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export default function VendorTopPicks() {
  const vendor = useVendor();
  const { data, isPending, error } = useMyTopPicks();

  return (
    <>
      <PageHead title="Top Picks" />
      {vendor.status === 'blocked' ? (
        <BlockedNote />
      ) : isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <Body info={data} />
      )}
    </>
  );
}

function Body({ info }: { info: TopPicksInfo }) {
  const vendor = useVendor();
  const running = info.picks.filter((p) => ['live', 'waiting', 'awaiting_payment'].includes(p.status));
  const past = info.picks.filter((p) => !running.includes(p));

  return (
    <>
      <div className="notice">
        Show one of your approved offers at the top of the Home page, in the <b>Top Picks</b> row, for
        customers in a district. Each district has {info.places} places, <b>first come, first shown</b>. Renew
        before the last day to keep your place. If it runs out, the place goes to the next shop.
      </div>

      {!info.enabled ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          <b>Top Picks is not open yet.</b> We will let you know when you can start.
        </div>
      ) : vendor.status !== 'approved' ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          Top Picks opens once the IWILLFLY team approves your business.
        </div>
      ) : !info.allowed ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          The business owner has switched off Top Picks for branch managers.
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>Your Top Picks</h2>
        </div>
        {running.length === 0 ? (
          <p className="meta" style={{ fontSize: 13 }}>
            You have no Top Picks running. Start one below.
          </p>
        ) : (
          <div className="list">
            {running.map((p) => (
              <PickCard key={p.id} pick={p} info={info} />
            ))}
          </div>
        )}
      </section>

      {info.enabled && info.allowed && vendor.status === 'approved' && (
        <section className="section">
          <div className="section-head">
            <h2>Start a Top Pick</h2>
          </div>
          <BuyForm info={info} />
        </section>
      )}

      {info.is_owner && <ManagersSwitch allowed={info.managers_can_sponsor} />}

      {past.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Ended</h2>
          </div>
          <div className="list">
            {past.map((p) => (
              <PickCard key={p.id} pick={p} info={info} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function statusOf(p: MyTopPick): { label: string; cls: string } {
  switch (p.status) {
    case 'live':
      return { label: `#${p.position} in ${p.district_name}`, cls: 'live' };
    case 'waiting':
      return { label: `Waiting list #${p.waiting_position}`, cls: 'pending' };
    case 'awaiting_payment':
      return { label: 'Waiting for payment', cls: 'pending' };
    case 'removed':
      return { label: 'Removed', cls: 'rejected' };
    default:
      return { label: 'Ended', cls: '' };
  }
}

function PickCard({ pick: p, info }: { pick: MyTopPick; info: TopPicksInfo }) {
  const today = todayIST();
  const st = statusOf(p);
  const left = p.ends_on ? daysUntil(p.ends_on, today) : null;
  const canAct = info.enabled && info.allowed && (p.status === 'live' || p.status === 'waiting');
  const inv = p.open_invoice;

  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
        <div className="tp-thumb">
          {p.offer_image_key ? (
            <img src={mediaUrl(p.offer_image_key)} alt="" loading="lazy" />
          ) : (
            <Icon icon={Tag} />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
            <h4 style={{ margin: 0 }}>{p.offer_title}</h4>
            <span className={`pill-status ${st.cls}`} style={{ flex: 'none' }}>
              {st.label}
            </span>
          </div>
          <div className="meta">
            {p.district_name}
            {p.branch_name ? ` · ${p.branch_name} branch` : ''}
          </div>
          <div className="meta" style={{ marginTop: 2 }}>
            {p.status === 'live' && p.ends_on && left != null
              ? left < 0
                ? `Ended ${formatDate(p.ends_on)} · renewal payment being checked, your place is kept`
                : `Until ${formatDate(p.ends_on)} · ${left === 0 ? 'last day today' : `${daysText(left)} left after today`}`
              : p.status === 'waiting'
                ? `${daysText(p.waiting_days)} paid. They start the day a place opens.`
                : p.status === 'awaiting_payment'
                  ? 'Starts when the invoice is paid.'
                  : p.ends_on
                    ? `Ran ${formatDate(p.starts_on)} – ${formatDate(p.ends_on)}`
                    : null}
          </div>
          {(p.status === 'live' || p.views > 0) && (
            <div className="meta" style={{ marginTop: 2 }}>
              {p.views} {p.views === 1 ? 'view' : 'views'} · {p.taps} {p.taps === 1 ? 'tap' : 'taps'} from Top
              Picks
            </div>
          )}
        </div>
      </div>

      {p.status === 'live' && !p.offer_live && (
        <div className="notice warn" style={{ marginTop: 8 }}>
          Customers can't see this right now: the offer is paused, in review or has ended. Your days keep
          counting and your place is kept. You can switch to another approved offer below.
        </div>
      )}
      {p.status === 'live' && left != null && left >= 0 && left <= 2 && !inv && (
        <div className="notice warn" style={{ marginTop: 8 }}>
          Renew before {formatDate(p.ends_on)} ends to keep your place.
        </div>
      )}
      {p.status === 'removed' && p.removed_reason && (
        <p className="error-text" style={{ marginTop: 6 }}>
          Removed by IWILLFLY: {p.removed_reason}
        </p>
      )}

      {inv && (
        <div className="notice" style={{ marginTop: 8 }}>
          {inv.status === 'submitted' ? (
            <>
              Payment for invoice {inv.number} is being checked.{' '}
              <Link to={`/vendor/billing/invoices/${inv.id}`} style={linkStyle}>
                View
              </Link>
            </>
          ) : (
            <>
              Invoice {inv.number} ({money(inv.total)}) is waiting for payment.{' '}
              <Link to={`/vendor/billing/invoices/${inv.id}`} style={linkStyle}>
                Pay now
              </Link>
            </>
          )}
        </div>
      )}

      {canAct && !inv && <RenewRow pick={p} lengths={info.lengths} />}
      {info.enabled && info.allowed && ['live', 'waiting', 'awaiting_payment'].includes(p.status) && (
        <SwapRow pick={p} offers={info.offers} />
      )}
    </div>
  );
}

function LengthSelect({
  id,
  lengths,
  value,
  onChange,
}: {
  id: string;
  lengths: TopPickLength[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose how long</option>
      {lengths.map((l) => (
        <option key={l.id} value={l.id}>
          {daysText(l.days)} · {Number(l.price) === 0 ? 'Free' : money(l.price)}
        </option>
      ))}
    </select>
  );
}

function RenewRow({ pick: p, lengths }: { pick: MyTopPick; lengths: TopPickLength[] }) {
  const toast = useToast();
  const navigate = useNavigate();
  const renew = useRenewTopPick();
  const [lengthId, setLengthId] = useState('');
  const [error, setError] = useState('');
  if (lengths.length === 0) return null;
  const submit = () => {
    if (!lengthId) return setError('Choose how many days to add.');
    setError('');
    renew.mutate(
      { id: p.id, lengthId: Number(lengthId) },
      {
        onSuccess: (invoiceId) => {
          const len = lengths.find((l) => l.id === Number(lengthId));
          if (len && Number(len.price) === 0) toast('Days added');
          else navigate(`/vendor/billing/invoices/${invoiceId}`);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="field" style={{ marginBottom: 6 }}>
        <label htmlFor={`renew-${p.id}`}>Renew (days are added after the current end date)</label>
        <LengthSelect id={`renew-${p.id}`} lengths={lengths} value={lengthId} onChange={setLengthId} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn small" disabled={renew.isPending} onClick={submit}>
        {renew.isPending ? 'Please wait…' : 'Renew'}
      </button>
    </div>
  );
}

/** Another approved offer of the same shop that can show in this district. */
function SwapRow({ pick: p, offers }: { pick: MyTopPick; offers: TopPickOffer[] }) {
  const toast = useToast();
  const swap = useSwapTopPickOffer();
  const [open, setOpen] = useState(false);
  const [offerId, setOfferId] = useState('');
  const [error, setError] = useState('');
  const choices = offers.filter(
    (o) =>
      o.id !== p.offer_id &&
      o.shop_id === p.shop_id &&
      o.districts.some((d) => d.id === p.district_id && !d.taken),
  );
  if (choices.length === 0) return null;
  if (!open)
    return (
      <button
        type="button"
        className="btn secondary small"
        style={{ marginTop: 8 }}
        onClick={() => setOpen(true)}
      >
        Show a different offer here
      </button>
    );
  const submit = () => {
    if (!offerId) return setError('Choose the offer to show instead.');
    setError('');
    swap.mutate(
      { id: p.id, offerId: Number(offerId) },
      {
        onSuccess: () => {
          toast('Offer changed. Your place is kept.');
          setOpen(false);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="field" style={{ marginBottom: 6 }}>
        <label htmlFor={`swap-${p.id}`}>Show this offer instead (same place, same end date)</label>
        <select id={`swap-${p.id}`} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
          <option value="">Choose an offer</option>
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
              {o.ends_on ? ` (until ${formatDate(o.ends_on)})` : ''}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn small" disabled={swap.isPending} onClick={submit}>
          {swap.isPending ? 'Saving…' : 'Change offer'}
        </button>
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BuyForm({ info }: { info: TopPicksInfo }) {
  const toast = useToast();
  const navigate = useNavigate();
  const buy = useBuyTopPick();
  const [offerId, setOfferId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [lengthId, setLengthId] = useState('');
  const [error, setError] = useState('');
  const today = todayIST();

  if (info.offers.length === 0)
    return (
      <div className="notice">
        You need an approved, running offer first.{' '}
        <Link to="/vendor/offers" style={linkStyle}>
          Your offers
        </Link>
      </div>
    );
  if (info.lengths.length === 0)
    return <div className="notice">Prices are not set yet. Please check back soon.</div>;

  const offer = info.offers.find((o) => o.id === Number(offerId));
  const districts = offer?.districts ?? [];
  const district = districts.find((d) => d.id === Number(districtId));
  const length = info.lengths.find((l) => l.id === Number(lengthId));
  const full = district ? district.live >= info.places || district.waiting > 0 : false;
  // A sponsorship can't run past the offer's own end date.
  const tooLong = offer?.ends_on && length ? daysUntil(offer.ends_on, today) + 1 < length.days : false;

  const submit = () => {
    if (!offer) return setError('Choose the offer.');
    if (!district) return setError('Choose the district.');
    if (district.taken) return setError('This offer is already a Top Pick there. Renew it above instead.');
    if (!length) return setError('Choose how long.');
    if (tooLong)
      return setError(
        `The offer ends on ${formatDate(offer.ends_on)}. Choose a shorter length, or extend the offer.`,
      );
    setError('');
    buy.mutate(
      { offerId: offer.id, districtId: district.id, lengthId: length.id },
      {
        onSuccess: (invoiceId) => {
          if (Number(length.price) === 0) {
            toast(full ? 'Added to the waiting list' : 'Your Top Pick is live');
            setOfferId('');
            setDistrictId('');
            setLengthId('');
          } else navigate(`/vendor/billing/invoices/${invoiceId}`);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <div className="form-card">
      <div className="field">
        <label htmlFor="tp-offer">1. Offer *</label>
        <select
          id="tp-offer"
          value={offerId}
          onChange={(e) => {
            setOfferId(e.target.value);
            setDistrictId('');
            setError('');
          }}
        >
          <option value="">Choose an approved offer</option>
          {info.offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
              {o.ends_on ? ` (until ${formatDate(o.ends_on)})` : ''}
              {o.is_paused ? ' (paused)' : ''}
            </option>
          ))}
        </select>
      </div>

      {offer && (
        <div className="field">
          <label>2. District *</label>
          {districts.length === 0 ? (
            <div className="hint">
              This offer's branches have no area set, so there is no district to show it in. Set the area on
              the branch first.
            </div>
          ) : (
            <div className="tp-choices">
              {districts.map((d) => {
                const isFull = d.live >= info.places || d.waiting > 0;
                return (
                  <label key={d.id} className={`tp-choice${Number(districtId) === d.id ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name="tp-district"
                      value={d.id}
                      checked={Number(districtId) === d.id}
                      disabled={d.taken}
                      onChange={() => setDistrictId(String(d.id))}
                    />
                    <span>
                      <b>{d.name}</b>
                      <small>
                        {d.taken
                          ? 'Already a Top Pick here'
                          : isFull
                            ? `Full · ${d.waiting} waiting${d.next_free_on ? ` · a place may open ${formatDate(d.next_free_on)}` : ''}`
                            : `${info.places - d.live} of ${info.places} places free`}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="tp-length">3. How long *</label>
        <LengthSelect id="tp-length" lengths={info.lengths} value={lengthId} onChange={setLengthId} />
        {tooLong && offer?.ends_on && (
          <div className="hint" style={{ color: 'var(--color-red, #c62828)' }}>
            The offer ends on {formatDate(offer.ends_on)}, before this would end.
          </div>
        )}
      </div>

      {district && length && !district.taken && (
        <div className={`notice${full ? ' warn' : ''}`}>
          {full ? (
            <>
              <b>{district.name} is full.</b> You join the waiting list now (#{district.waiting + 1}). Your{' '}
              {daysText(length.days)} start the day a place opens, and we tell you in your inbox.
            </>
          ) : (
            <>
              Goes live in {district.name} as soon as the payment is confirmed, at place #{district.live + 1},
              for {daysText(length.days)}.
            </>
          )}{' '}
          Online payment is confirmed at once; a UPI payment once our team checks it.
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      <button
        className="btn block"
        type="button"
        disabled={buy.isPending}
        onClick={submit}
        style={{ marginTop: 12 }}
      >
        {buy.isPending
          ? 'Please wait…'
          : length && Number(length.price) > 0
            ? `Continue to pay ${money(length.price)}`
            : 'Start Top Pick'}
      </button>
      <div className="hint" style={{ marginTop: 6 }}>
        Prices are before GST, if any. Payments are not refundable.
      </div>
    </div>
  );
}

function ManagersSwitch({ allowed }: { allowed: boolean }) {
  const toast = useToast();
  const set = useSetManagersCanSponsor();
  return (
    <section className="section">
      <div className="section-head">
        <h2>Branch managers</h2>
      </div>
      <label className="switch-row" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={allowed}
          disabled={set.isPending}
          onChange={(e) => {
            const on = e.target.checked;
            set.mutate(on, {
              onSuccess: () =>
                toast(on ? 'Branch managers can buy Top Picks' : 'Switched off for branch managers'),
              onError: (err) => toast(errorMessage(err)),
            });
          }}
        />
        <span>Branch managers can buy Top Picks for their own branch (they pay their own invoice)</span>
      </label>
    </section>
  );
}
