import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ShopCard';
import { useToast } from '../../components/Toast';
import {
  formatWhen,
  isUpiId,
  pointsText,
  rupees,
  useMyRedemptions,
  useMyUpi,
  usePointsWallet,
  useRequestRedemption,
  useSaveUpi,
} from '../../lib/points';
import type { MyUpi, PointsWallet, Redemption } from '../../lib/types';
import { formatDay } from '../scratch';
import { ErrorNotice, Loading, Sheet } from '../ui';
import { errorText } from '../util';
import { SubNav } from './Points';

/** The last day a payout is due (due_at is the end of that day). */
const dueDay = (iso: string) => formatDay(new Date(new Date(iso).getTime() - 1000).toISOString());

export function Redeem() {
  const wallet = usePointsWallet();
  const upi = useMyUpi();
  const list = useMyRedemptions();
  const loading = wallet.isPending || upi.isPending || list.isPending;
  const error = wallet.error ?? upi.error ?? list.error;
  const open = list.data?.find((r) => r.status === 'requested');
  // shown once, right after a successful request
  const [done, setDone] = useState<{ amount: number; upi: string; points: number } | null>(null);
  return (
    <>
      <SubNav />
      {loading && <Loading />}
      {error && <ErrorNotice error={error} />}
      {wallet.data && upi.data !== undefined && list.data && (
        <>
          {open ? (
            <section className="hero">
              <p>Cash-out pending</p>
              <div className="points-balance">{rupees(open.amount)}</div>
              <p>
                To <b style={{ color: '#fff' }}>{open.upi_id}</b>. It reaches your account within 2 business
                days (by {dueDay(open.due_at)}). Your {pointsText(open.points)} are on hold and are taken only
                when the money is sent. The UPI transaction ID will show here.
              </p>
            </section>
          ) : (
            <RedeemForm key={upi.data?.upi_id ?? 'none'} w={wallet.data} upi={upi.data} onDone={setDone} />
          )}
          <section className="section">
            <div className="section-head">
              <h2>My cash-outs</h2>
            </div>
            {list.data.length === 0 ? (
              <EmptyState emoji="🏦" title="No cash-outs yet" text="Cash-outs you request will show here." />
            ) : (
              <div className="list">
                {list.data.map((r) => (
                  <RedemptionRow key={r.id} r={r} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <Sheet open={done != null} onClose={() => setDone(null)} title="Request successful">
        {done && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, lineHeight: 1 }}>✅</div>
            <h3 style={{ margin: '10px 0 6px' }}>{rupees(done.amount)} cash-out requested</h3>
            <p className="meta" style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 14px' }}>
              It takes up to 2 business days to reflect in your account ({done.upi}). Your{' '}
              {pointsText(done.points)} are on hold until then. We will let you know when the money is sent.
            </p>
            <button className="btn block" onClick={() => setDone(null)}>
              OK
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}

function RedeemForm({
  w,
  upi,
  onDone,
}: {
  w: PointsWallet;
  upi: MyUpi | null;
  onDone: (d: { amount: number; upi: string; points: number }) => void;
}) {
  const toast = useToast();
  const save = useSaveUpi();
  const request = useRequestRedemption();
  const steps: number[] = [];
  for (let p = w.min_redeem_points; p <= w.balance; p += w.redeem_step_points) steps.push(p);
  const [points, setPoints] = useState(steps[steps.length - 1] ?? 0);
  const [editing, setEditing] = useState(!upi);
  const [typed, setTyped] = useState(upi?.upi_id ?? '');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');

  const usableFrom = upi ? new Date(upi.usable_from) : null;
  const waiting = usableFrom != null && usableFrom > new Date();

  if (!steps.length) {
    const toGo = w.min_redeem_points - w.balance;
    return (
      <section className="hero">
        <p>Cash out to UPI</p>
        <div className="points-balance">{w.balance.toLocaleString('en-IN')}</div>
        <p>
          You can cash out from {pointsText(w.min_redeem_points)} (
          {rupees(w.min_redeem_points * w.point_value)}). Add {rupees(toGo * w.rupees_per_point)} more in
          bills to get there.
        </p>
        <Link className="hero-pill" to="/points/add">
          ＋ Add a bill
        </Link>
      </section>
    );
  }

  const onSaveUpi = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const v = typed.trim().toLowerCase();
    if (!isUpiId(v)) return setError('Enter a UPI ID like name@okicici or 9876543210@ybl.');
    if (upi && v === upi.upi_id) return setEditing(false);
    save.mutate(v, {
      onSuccess: (u) => {
        setEditing(false);
        toast(
          upi && new Date(u.usable_from) > new Date()
            ? `UPI ID saved. For your safety it can be used from ${formatWhen(u.usable_from)}.`
            : 'UPI ID saved',
        );
      },
      onError: (err) => setError(errorText(err)),
    });
  };

  const onRequest = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!upi) return setError('Add your UPI ID first.');
    if (waiting) return setError(`Your new UPI ID can be used from ${formatWhen(upi.usable_from)}.`);
    if (!agree) return setError('Please read and accept the Points Terms.');
    request.mutate(points, {
      onSuccess: () => onDone({ amount: points * w.point_value, upi: upi.upi_id, points }),
      onError: (err) => setError(errorText(err)),
    });
  };

  return (
    <form className="form-card" onSubmit={onRequest}>
      <h3 style={{ marginTop: 0 }}>Cash out to UPI</h3>
      <p className="meta" style={{ marginTop: 0 }}>
        You have {pointsText(w.balance)}. Cash out in steps of {w.redeem_step_points.toLocaleString('en-IN')}{' '}
        points; the rest stays in your wallet.
      </p>
      <div className="field">
        <label htmlFor="redeem-points">How much?</label>
        <select id="redeem-points" value={points} onChange={(e) => setPoints(Number(e.target.value))}>
          {steps.map((p) => (
            <option key={p} value={p}>
              {pointsText(p)} = {rupees(p * w.point_value)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="redeem-upi">Send to UPI ID</label>
        {editing ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="redeem-upi"
                value={typed}
                maxLength={265}
                autoCapitalize="none"
                autoComplete="off"
                placeholder="name@okicici"
                onChange={(e) => setTyped(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn small" type="button" onClick={onSaveUpi} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="hint">
              {upi
                ? 'For your safety, a new UPI ID can be used 24 hours after you save it.'
                : 'Find it in your UPI app (Google Pay, PhonePe, Paytm…) under your profile.'}
            </div>
          </>
        ) : (
          <div className="shop-card" style={{ cursor: 'default' }}>
            <div className="shop-thumb">🏦</div>
            <div style={{ minWidth: 0 }}>
              <h4 style={{ overflowWrap: 'anywhere' }}>{upi?.upi_id}</h4>
              <div className="meta">
                {waiting ? `Can be used from ${formatWhen(upi!.usable_from)}` : 'Saved UPI ID'}
              </div>
            </div>
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Change
            </button>
          </div>
        )}
      </div>

      <label className="check-row" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I have read the{' '}
          <Link to="/points/terms" style={{ color: 'var(--color-blue)', fontWeight: 700 }}>
            Points Terms
          </Link>
        </span>
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={request.isPending || editing || waiting}>
          {request.isPending ? 'Requesting…' : `Cash out ${rupees(points * w.point_value)}`}
        </button>
      </div>
      <div className="meta" style={{ marginTop: 10 }}>
        The points go on hold straight away and are taken only when the money is sent. We send it within 2
        business days (not counting Sundays and holidays). If we cannot send it, the hold is lifted and
        nothing is taken.
      </div>
    </form>
  );
}

const STATUS = { requested: 'On its way', paid: 'Sent', rejected: 'Not sent' } as const;
const PILL = { requested: 'pending', paid: 'approved', rejected: 'rejected' } as const;

function RedemptionRow({ r }: { r: Redemption }) {
  return (
    <div className="manage-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span className={`pill-status ${PILL[r.status]}`}>{STATUS[r.status]}</span>
          <h4 style={{ margin: '6px 0 2px' }}>
            {rupees(r.amount)} to {r.upi_id}
          </h4>
          <div className="meta">
            Requested {formatDay(r.requested_at)}
            {r.status === 'requested' && ` · due by ${dueDay(r.due_at)}`}
            {r.status === 'paid' && r.decided_at && ` · sent ${formatDay(r.decided_at)}`}
          </div>
          {r.utr && (
            <div className="meta">
              UPI transaction ID (UTR): <b style={{ color: 'var(--color-ink)' }}>{r.utr}</b>
            </div>
          )}
          {r.status === 'rejected' && (
            <div className="meta" style={{ color: 'var(--color-red)' }}>
              {r.reject_reason}. Nothing was taken from your points.
            </div>
          )}
        </div>
        {r.status === 'paid' ? (
          <span className="points-minus">−{r.points.toLocaleString('en-IN')}</span>
        ) : r.status === 'requested' ? (
          <span className="meta" style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>
            {r.points.toLocaleString('en-IN')} on hold
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PointsTerms() {
  const wallet = usePointsWallet();
  const w = wallet.data;
  const rate = w ? rupees(w.rupees_per_point) : '₹50';
  const value = w ? rupees(w.point_value) : '₹1';
  const min = w ? w.min_redeem_points.toLocaleString('en-IN') : '1,000';
  const step = w ? w.redeem_step_points.toLocaleString('en-IN') : '1,000';
  const months = w?.validity_months ?? 6;
  const days = w?.bill_age_days ?? 7;
  return (
    <>
      <div className="section-head">
        <h2>Points Terms</h2>
        <Link to="/points">‹ Wallet</Link>
      </div>
      <section className="form-card" style={{ fontSize: 13, lineHeight: 1.6 }}>
        <h3 style={{ marginTop: 0 }}>Earning points</h3>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            You earn 1 point for every full {rate} on a bill from a shop listed on IWILLFLY, after the
            IWILLFLY team checks the bill. Each point is worth {value}.
          </li>
          <li>
            Add a bill within {days} days of its date, with a clear photo. Bills under {rate} do not earn
            points.
          </li>
          <li>
            Each bill can be added only once, by one person. Shop owners and their staff cannot earn on their
            own shop.
          </li>
          <li>A rejected bill can be fixed and sent again once.</li>
        </ul>
        <h3>Expiry</h3>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            Points from each bill stay valid for {months} months from the day they are added to your wallet.
            We remind you 30 and 7 days before they expire.
          </li>
          <li>Cash-outs use your oldest points first.</li>
        </ul>
        <h3>Cashing out</h3>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            You can cash out from {min} points, in steps of {step} points, to a UPI ID in your name. One
            cash-out at a time.
          </li>
          <li>
            Points go on hold as soon as you ask and are taken from your wallet only when the money is sent.
            We send the money within 2 business days (Sundays and holidays do not count) and show the UPI
            transaction ID (UTR).
          </li>
          <li>For your safety, a new or changed UPI ID can be used 24 hours after you save it.</li>
          <li>
            If we cannot send a cash-out, we tell you why and lift the hold: nothing is taken and the points
            keep their original expiry dates.
          </li>
        </ul>
        <h3>Fair use</h3>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            IWILLFLY may refuse bills, cancel cash-outs, and take back points that came from fake, edited or
            duplicate bills, or from misuse of the app.
          </li>
          <li>IWILLFLY may change these rules or end the points programme with notice in the app.</li>
        </ul>
      </section>
    </>
  );
}
