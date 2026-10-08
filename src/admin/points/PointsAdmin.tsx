import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { REJECT_REASONS, pointsText, rupees, useBillPhoto } from '../../lib/points';
import { db, must } from '../../lib/queries';
import type { AdminBill, BillRejectReason, BillStatus, PointsSettings } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, friendlyError, toNumber, useInvalidate } from '../util';
import { Holidays, Payouts, Report } from './Payouts';

const KEYS = [['admin_bills'], ['points_settings'], ['admin-attention']];

const SUB_TABS = [
  { to: '/admin/points/bills', label: 'Bill queue' },
  { to: '/admin/points/payouts', label: 'Cash-outs' },
  { to: '/admin/points/report', label: 'Report' },
  { to: '/admin/points/settings', label: 'Settings' },
];

export default function PointsAdmin() {
  return (
    <>
      <nav className="tabs" aria-label="Points sections">
        {SUB_TABS.map((t) => (
          <NavLink key={t.to} to={t.to}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/admin/points/bills" replace />} />
        <Route path="bills" element={<Bills />} />
        <Route path="bills/:id" element={<BillReview />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="report" element={<Report />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/admin/points/bills" replace />} />
      </Routes>
    </>
  );
}

function useSettings() {
  return useQuery({
    queryKey: ['points_settings'],
    queryFn: async () =>
      must<PointsSettings>(await db().from('points_settings').select('*').eq('id', 1).single()),
  });
}

async function fetchBills(status: BillStatus | null, id?: number) {
  return must<AdminBill[]>(
    await db().rpc('admin_bills', { p_status: status, p_limit: 100, p_id: id ?? null }),
  );
}

// Queue ---------------------------------------------------------------------------------------------

const FILTERS: { key: BillStatus; label: string }[] = [
  { key: 'pending', label: 'To check' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function BillPill({ status }: { status: BillStatus }) {
  const text = { pending: 'To check', approved: 'Approved', rejected: 'Rejected' }[status];
  return <span className={`pill-status ${status}`}>{text}</span>;
}

function Bills() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get('status'))?.key ?? 'pending';
  const bills = useQuery({ queryKey: ['admin_bills', filter], queryFn: () => fetchBills(filter) });
  return (
    <>
      <div className="section-head">
        <h2>Customer bills</h2>
      </div>
      {filter === 'pending' && (
        <div className="notice">
          Open each bill, compare the photo with what the customer typed, then approve it (correct the amount
          if needed) or reject it with a reason. Points are credited the moment you approve. Oldest bills come
          first.
        </div>
      )}
      <div className="filter-bar" role="tablist" style={{ marginTop: 0 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`chip${filter === f.key ? ' active' : ''}`}
            onClick={() => setParams({ status: f.key }, { replace: true })}
          >
            {f.label}
          </button>
        ))}
      </div>
      {bills.isPending && <Loading />}
      {bills.error && <ErrorNotice error={bills.error} />}
      {bills.data?.length === 0 && (
        <Empty emoji="🧾" title={filter === 'pending' ? 'No bills to check' : 'No bills here'}>
          {filter === 'pending' ? 'New bills from customers show up here.' : undefined}
        </Empty>
      )}
      <div className="list">
        {bills.data?.map((b) => (
          <Link key={b.id} className="shop-card" to={`/admin/points/bills/${b.id}?from=${filter}`}>
            <div className="shop-thumb">🧾</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                <BillPill status={b.status} />
                {b.resubmit_of && <span className="pill-status featured">Sent again</span>}
                {b.same_shop_week >= 3 && (
                  <span className="pill-status pending">{b.same_shop_week} from shop in 7 days</span>
                )}
              </div>
              <h4>
                {b.shop_name} · {rupees(b.approved_amount ?? b.amount)}
              </h4>
              <div className="meta">
                #{b.id} · {b.customer_name || b.customer_email} · bill {b.bill_number} of{' '}
                {formatDate(b.bill_date)}
              </div>
              <div className="meta">
                Added {formatDate(b.created_at)}
                {b.status === 'approved' && ` · +${pointsText(b.points ?? 0)}`}
                {b.status === 'rejected' && b.reject_reason && ` · ${REJECT_REASONS[b.reject_reason]}`}
              </div>
            </div>
            <div className="chev">›</div>
          </Link>
        ))}
      </div>
    </>
  );
}

// Review -------------------------------------------------------------------------------------------

function BillReview() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from') ?? 'pending';
  const billId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const bill = useQuery({
    queryKey: ['admin_bills', 'one', billId],
    queryFn: async () => (await fetchBills(null, billId!))[0] ?? null,
    enabled: billId != null,
  });
  const settings = useSettings();
  if (billId == null) return <ErrorNotice error={new Error('No such bill.')} />;
  const b = bill.data;
  return (
    <>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Bill #{billId} {b && <BillPill status={b.status} />}
        </h2>
        <Link to={`/admin/points/bills?status=${from}`}>‹ All bills</Link>
      </div>
      {(bill.isPending || settings.isPending) && <Loading />}
      {bill.error && <ErrorNotice error={bill.error} />}
      {settings.error && <ErrorNotice error={settings.error} />}
      {bill.data === null && <ErrorNotice error={new Error('No such bill.')} />}
      {b && settings.data && (
        <div className="bill-review">
          <Photo bill={b} />
          <div>
            <Facts bill={b} rate={settings.data.rupees_per_point} />
            {b.status === 'pending' && <Decide key={b.id} bill={b} rate={settings.data.rupees_per_point} />}
          </div>
        </div>
      )}
    </>
  );
}

function Photo({ bill: b }: { bill: AdminBill }) {
  const link = useBillPhoto(b.photo_deleted ? null : b.photo_key);
  if (b.photo_deleted)
    return <div className="notice">The photo was deleted 90 days after this bill was decided.</div>;
  return (
    <div>
      <div className="bill-photo">
        {link.isPending ? (
          <span className="meta">Loading photo…</span>
        ) : link.error ? (
          <div className="notice bad" style={{ margin: 12 }}>
            {link.error instanceof Error ? link.error.message : 'Could not open the photo'}{' '}
            <button className="link-btn" onClick={() => link.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <a href={link.data} target="_blank" rel="noreferrer" title="Open full size">
            <img src={link.data} alt={`Bill ${b.bill_number} from ${b.shop_name}`} />
          </a>
        )}
      </div>
      {link.data && (
        <a className="link-btn" href={link.data} target="_blank" rel="noreferrer">
          Open full size ↗
        </a>
      )}
    </div>
  );
}

function Facts({ bill: b, rate }: { bill: AdminBill; rate: number }) {
  const ageDays = Math.round(
    (new Date(b.created_at).getTime() - new Date(`${b.bill_date}T00:00:00+05:30`).getTime()) / 86_400_000,
  );
  return (
    <section className="form-card" style={{ marginBottom: 12 }}>
      <dl className="bill-facts">
        <dt>Shop</dt>
        <dd>{b.shop_name}</dd>
        <dt>Bill number</dt>
        <dd>{b.bill_number}</dd>
        <dt>Bill date</dt>
        <dd>
          {formatDate(b.bill_date)}{' '}
          <span className="meta">
            (
            {ageDays <= 0 ? 'added the same day' : `added ${ageDays} ${ageDays === 1 ? 'day' : 'days'} later`}
            )
          </span>
        </dd>
        <dt>Amount typed</dt>
        <dd>
          {rupees(b.amount)} <span className="meta">= {pointsText(Math.floor(b.amount / rate))}</span>
        </dd>
        {b.approved_amount != null && (
          <>
            <dt>Approved</dt>
            <dd>
              {rupees(b.approved_amount)} · +{pointsText(b.points ?? 0)}
            </dd>
          </>
        )}
        <dt>Customer</dt>
        <dd>
          {b.customer_name || '—'}
          <div className="meta">
            {b.customer_email}
            {b.customer_phone ? ` · ${b.customer_phone}` : ''}
          </div>
        </dd>
        <dt>Added</dt>
        <dd>{new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        {b.decided_at && (
          <>
            <dt>Decided</dt>
            <dd>
              {formatDate(b.decided_at)}
              {b.reviewer_email ? ` by ${b.reviewer_email}` : ''}
            </dd>
          </>
        )}
        {b.status === 'rejected' && b.reject_reason && (
          <>
            <dt>Reason</dt>
            <dd>
              {REJECT_REASONS[b.reject_reason]}
              {b.admin_note ? ` (${b.admin_note})` : ''}
            </dd>
          </>
        )}
      </dl>
      {b.resubmit_of && (
        <div className="notice warn">
          Sent again after bill <Link to={`/admin/points/bills/${b.resubmit_of}`}>#{b.resubmit_of}</Link> was
          rejected
          {b.previous_reason ? `: ${REJECT_REASONS[b.previous_reason].toLowerCase()}` : ''}. This is the last
          try.
        </div>
      )}
      <div className={b.same_shop_week >= 3 || b.customer_rejected >= 3 ? 'notice warn' : 'meta'}>
        {b.same_shop_week} {b.same_shop_week === 1 ? 'bill' : 'bills'} from this shop in 7 days ·{' '}
        {b.customer_bills} {b.customer_bills === 1 ? 'bill' : 'bills'} in total, {b.customer_rejected}{' '}
        rejected
      </div>
    </section>
  );
}

const REASONS = Object.entries(REJECT_REASONS) as [BillRejectReason, string][];

function Decide({ bill: b, rate }: { bill: AdminBill; rate: number }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [amount, setAmount] = useState(String(b.amount));
  const [reason, setReason] = useState<BillRejectReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const amt = toNumber(amount);
  const points = amt != null && amt >= rate ? Math.floor(amt / rate) : 0;

  // after a decision, open the next bill waiting (oldest first) or go back to the queue
  const next = async (message: string) => {
    toast(message);
    await invalidate(...KEYS);
    const waiting = await fetchBills('pending').catch(() => []);
    const after = waiting.find((x) => x.id !== b.id);
    navigate(after ? `/admin/points/bills/${after.id}?from=pending` : '/admin/points/bills?status=pending', {
      replace: true,
    });
  };

  const approve = useMutation({
    mutationFn: async () =>
      must<{ points: number }>(
        await db().rpc('approve_bill', { p_bill_id: b.id, p_amount: amt === b.amount ? null : amt }),
      ),
    onSuccess: (r) => next(`Approved: +${pointsText(r.points)} for ${b.customer_name || b.customer_email}`),
    onError: (e) => setError(friendlyError(e)),
  });
  const reject = useMutation({
    mutationFn: async () =>
      must(await db().rpc('reject_bill', { p_bill_id: b.id, p_reason: reason, p_note: note.trim() || null })),
    onSuccess: () => next('Bill rejected. The customer was told why.'),
    onError: (e) => setError(friendlyError(e)),
  });
  const busy = approve.isPending || reject.isPending;

  const onApprove = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (amt == null || amt <= 0 || Math.round(amt * 100) !== amt * 100)
      return setError('Enter the bill total in rupees.');
    if (amt < rate) return setError(`Bills under ${rupees(rate)} earn no points. Reject it instead.`);
    approve.mutate();
  };

  return (
    <>
      <form className="form-card" onSubmit={onApprove} style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Approve</h3>
        <div className="field">
          <label htmlFor="bill-amt">Bill total on the photo (₹)</label>
          <input
            id="bill-amt"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="hint">
            {amt != null && amt !== b.amount
              ? `Corrected from ${rupees(b.amount)}. The customer will see the change.`
              : 'Change this if the total on the photo is different.'}
          </div>
        </div>
        <div className="btn-row">
          <button className="btn" type="submit" disabled={busy}>
            {approve.isPending ? 'Approving…' : `Approve: +${pointsText(points)}`}
          </button>
        </div>
      </form>
      <section className="form-card">
        <h3 style={{ marginTop: 0 }}>Reject</h3>
        <div
          className="filter-bar"
          role="radiogroup"
          aria-label="Reason"
          style={{ marginTop: 0, flexWrap: 'wrap' }}
        >
          {REASONS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={reason === k}
              className={`chip${reason === k ? ' active' : ''}`}
              onClick={() => setReason(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="bill-note">Note for the customer (optional)</label>
          <input
            id="bill-note"
            value={note}
            maxLength={120}
            placeholder="e.g. The total at the bottom is cut off"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="hint">
            {reason === 'duplicate' || b.resubmit_of
              ? 'The customer cannot send this bill again.'
              : 'The customer can fix the bill and send it again once.'}
          </div>
        </div>
        <div className="btn-row">
          <button
            className="btn danger"
            type="button"
            disabled={busy || !reason}
            onClick={() => {
              setError('');
              reject.mutate();
            }}
          >
            {reject.isPending ? 'Rejecting…' : 'Reject bill'}
          </button>
        </div>
      </section>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

// Settings -----------------------------------------------------------------------------------------

function Settings() {
  const settings = useSettings();
  return (
    <>
      <div className="section-head">
        <h2>Points settings</h2>
      </div>
      <div className="notice">
        Changes apply to bills approved from now on. Points already credited keep their value and expiry date.
      </div>
      {settings.isPending && <Loading />}
      {settings.error && <ErrorNotice error={settings.error} />}
      {settings.data && <SettingsForm key={settings.data.updated_at} s={settings.data} />}
      <Holidays />
    </>
  );
}

const FIELDS: {
  key: keyof Omit<PointsSettings, 'id' | 'updated_at'>;
  label: string;
  hint: string;
  min: number;
  max: number;
  step?: string;
}[] = [
  {
    key: 'rupees_per_point',
    label: 'Earn rate: ₹ per point',
    hint: 'Customers earn 1 point for every full this many rupees. Smaller bills are refused.',
    min: 1,
    max: 100000,
  },
  {
    key: 'point_value',
    label: 'Value of 1 point (₹)',
    hint: 'What a point is worth when cashed out.',
    min: 0.01,
    max: 1000,
    step: '0.01',
  },
  {
    key: 'min_redeem_points',
    label: 'Minimum points to cash out',
    hint: 'Shown as the goal on the wallet progress bar.',
    min: 1,
    max: 10000000,
  },
  {
    key: 'redeem_step_points',
    label: 'Cash-out step (points)',
    hint: 'Cash-outs are in multiples of this.',
    min: 1,
    max: 10000000,
  },
  {
    key: 'validity_months',
    label: 'Points valid for (months)',
    hint: 'Each batch of points expires this long after it is credited.',
    min: 1,
    max: 60,
  },
  {
    key: 'bill_age_days',
    label: 'Bill age limit (days)',
    hint: 'Bills older than this are refused.',
    min: 1,
    max: 365,
  },
];

function SettingsForm({ s }: { s: PointsSettings }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState(
    () => Object.fromEntries(FIELDS.map((x) => [x.key, String(Number(s[x.key]))])) as Record<string, string>,
  );
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async (patch: Record<string, number>) =>
      must(await db().from('points_settings').update(patch).eq('id', 1).select('id').single()),
    onSuccess: () => {
      invalidate(...KEYS, ['points_wallet']);
      toast('Points settings saved');
    },
    onError: (e) => setError(friendlyError(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const patch: Record<string, number> = {};
    for (const x of FIELDS) {
      const n = toNumber(f[x.key]);
      const whole = x.step == null;
      if (n == null || n < x.min || n > x.max || (whole && !Number.isInteger(n)))
        return setError(
          `${x.label}: enter ${whole ? 'a whole number' : 'a number'} from ${x.min} to ${x.max}.`,
        );
      patch[x.key] = whole ? n : Math.round(n * 100) / 100;
    }
    save.mutate(patch);
  };
  const rate = toNumber(f.rupees_per_point) ?? 0;
  const min = toNumber(f.min_redeem_points) ?? 0;
  return (
    <form className="form-card" onSubmit={submit}>
      {FIELDS.map((x) => (
        <div className="field" key={x.key}>
          <label htmlFor={`ps-${x.key}`}>{x.label}</label>
          <input
            id={`ps-${x.key}`}
            type="number"
            inputMode={x.step ? 'decimal' : 'numeric'}
            min={x.min}
            max={x.max}
            step={x.step ?? '1'}
            value={f[x.key]}
            onChange={(e) => setF((cur) => ({ ...cur, [x.key]: e.target.value }))}
          />
          <div className="hint">{x.hint}</div>
        </div>
      ))}
      {rate > 0 && min > 0 && (
        <div className="notice">
          A customer needs {rupees(rate * min)} of approved bills to reach {pointsText(min)}.
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
