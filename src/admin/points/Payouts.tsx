import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { formatWhen, pointsText, rupees, todayIndia } from '../../lib/points';
import { db, must } from '../../lib/queries';
import type { AdminRedemption, Holiday, PointsReportRow, RedemptionStatus } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, friendlyError, useInvalidate } from '../util';

const KEYS = [['admin_redemptions'], ['points_report'], ['admin-attention']];

// Payout queue ----------------------------------------------------------------------------------------

const FILTERS: { key: RedemptionStatus; label: string }[] = [
  { key: 'requested', label: 'To pay' },
  { key: 'paid', label: 'Paid' },
  { key: 'rejected', label: 'Rejected' },
];

/** "1 day 4 h left" / "5 h late" against the 2-business-day promise. */
function timeLeft(dueAt: string) {
  const mins = Math.round((new Date(dueAt).getTime() - Date.now()) / 60_000);
  const abs = Math.abs(mins);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const text = d > 0 ? `${d} day${d === 1 ? '' : 's'} ${h} h` : h > 0 ? `${h} h` : `${abs % 60} min`;
  return {
    late: mins < 0,
    soon: mins >= 0 && mins < 12 * 60,
    text: mins < 0 ? `${text} late` : `${text} left`,
  };
}

export function Payouts() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get('status'))?.key ?? 'requested';
  const list = useQuery({
    queryKey: ['admin_redemptions', filter],
    queryFn: async () => must<AdminRedemption[]>(await db().rpc('admin_redemptions', { p_status: filter })),
  });
  return (
    <>
      <div className="section-head">
        <h2>Cash-outs</h2>
      </div>
      {filter === 'requested' && (
        <div className="notice">
          Send each amount from your UPI app to the customer's UPI ID, then type the UPI transaction ID (UTR)
          here and mark it paid. The promise is 2 business days (Sundays and your holiday list do not count).
          If you cannot pay, reject it with a reason: the points go back to the customer.
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
      {list.isPending && <Loading />}
      {list.error && <ErrorNotice error={list.error} />}
      {list.data?.length === 0 && (
        <Empty emoji="🏦" title={filter === 'requested' ? 'Nothing to pay' : 'No cash-outs here'}>
          {filter === 'requested' ? 'New cash-out requests show up here, oldest first.' : undefined}
        </Empty>
      )}
      <div className="list">
        {list.data?.map((r) => (
          <PayoutCard key={r.id} r={r} />
        ))}
      </div>
    </>
  );
}

function PayoutCard({ r }: { r: AdminRedemption }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [utr, setUtr] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const left = r.status === 'requested' ? timeLeft(r.due_at) : null;

  const paid = useMutation({
    mutationFn: async () => must(await db().rpc('mark_redemption_paid', { p_id: r.id, p_utr: utr })),
    onSuccess: () => {
      invalidate(...KEYS);
      toast(`Marked paid. ${r.customer_name || r.customer_email} has been told.`);
    },
    onError: (e) => setError(friendlyError(e)),
  });
  const reject = useMutation({
    mutationFn: async () => must(await db().rpc('reject_redemption', { p_id: r.id, p_reason: reason })),
    onSuccess: () => {
      invalidate(...KEYS);
      toast('Cash-out rejected. The points went back to the customer.');
    },
    onError: (e) => setError(friendlyError(e)),
  });
  const busy = paid.isPending || reject.isPending;

  const onPaid = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^[A-Za-z0-9]{6,35}$/.test(utr.replace(/\s/g, '')))
      return setError('Enter the UPI transaction ID (UTR) from your payment app.');
    paid.mutate();
  };

  const upiChangedRecently =
    r.upi_changed_at != null &&
    !r.upi_first_set &&
    new Date(r.requested_at).getTime() - new Date(r.upi_changed_at).getTime() < 7 * 86_400_000;

  return (
    <section className="form-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            <span
              className={`pill-status ${r.status === 'requested' ? 'pending' : r.status === 'paid' ? 'approved' : 'rejected'}`}
            >
              {r.status === 'requested' ? 'To pay' : r.status === 'paid' ? 'Paid' : 'Rejected'}
            </span>
            {left && (
              <span className={`pill-status ${left.late ? 'rejected' : left.soon ? 'pending' : ''}`}>
                {left.text}
              </span>
            )}
            {r.upi_other_accounts > 0 && (
              <span className="pill-status rejected">
                UPI ID on {r.upi_other_accounts} other account{r.upi_other_accounts === 1 ? '' : 's'}
              </span>
            )}
            {upiChangedRecently && <span className="pill-status pending">UPI ID changed recently</span>}
          </div>
          <h3 style={{ margin: '2px 0' }}>{rupees(r.amount)}</h3>
          <div className="meta">
            #{r.id} · {pointsText(r.points)} · requested {formatWhen(r.requested_at)}
          </div>
        </div>
      </div>
      <dl className="bill-facts" style={{ marginTop: 10 }}>
        <dt>UPI ID</dt>
        <dd>
          {r.upi_id}{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              navigator.clipboard?.writeText(r.upi_id).then(
                () => toast('UPI ID copied'),
                () => undefined,
              )
            }
          >
            Copy
          </button>
        </dd>
        <dt>Customer</dt>
        <dd>
          {r.customer_name || '—'}
          <div className="meta">
            {r.customer_email}
            {r.customer_phone ? ` · ${r.customer_phone}` : ''}
          </div>
        </dd>
        <dt>History</dt>
        <dd>
          {r.bills_approved} bills approved · {pointsText(r.points_earned)} earned · {r.previous_paid} earlier
          payout{r.previous_paid === 1 ? '' : 's'}
        </dd>
        {r.status === 'requested' && (
          <>
            <dt>Due by</dt>
            <dd>{formatWhen(new Date(new Date(r.due_at).getTime() - 60_000).toISOString())}</dd>
          </>
        )}
        {r.utr && (
          <>
            <dt>UTR</dt>
            <dd>{r.utr}</dd>
          </>
        )}
        {r.reject_reason && (
          <>
            <dt>Reason</dt>
            <dd>{r.reject_reason}</dd>
          </>
        )}
        {r.decided_at && (
          <>
            <dt>Decided</dt>
            <dd>
              {formatDate(r.decided_at)}
              {r.decider_email ? ` by ${r.decider_email}` : ''}
            </dd>
          </>
        )}
      </dl>
      {r.status === 'requested' &&
        (rejecting ? (
          <div className="field">
            <label htmlFor={`rr-${r.id}`}>Reason the customer will see</label>
            <input
              id={`rr-${r.id}`}
              value={reason}
              maxLength={300}
              placeholder="e.g. The UPI ID does not exist"
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn small danger"
                type="button"
                disabled={busy || reason.trim().length < 2}
                onClick={() => {
                  setError('');
                  reject.mutate();
                }}
              >
                {reject.isPending ? 'Rejecting…' : 'Reject and return points'}
              </button>
              <button className="btn small secondary" type="button" onClick={() => setRejecting(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onPaid}>
            <div className="field">
              <label htmlFor={`utr-${r.id}`}>UPI transaction ID (UTR)</label>
              <input
                id={`utr-${r.id}`}
                value={utr}
                maxLength={40}
                autoCapitalize="characters"
                placeholder="12-digit number from your UPI app"
                onChange={(e) => setUtr(e.target.value)}
              />
            </div>
            <div className="btn-row">
              <button className="btn small" type="submit" disabled={busy}>
                {paid.isPending ? 'Saving…' : 'Mark paid'}
              </button>
              <button className="btn small secondary" type="button" onClick={() => setRejecting(true)}>
                Reject
              </button>
            </div>
          </form>
        ))}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

// Report ------------------------------------------------------------------------------------------------

export function Report() {
  const report = useQuery({
    queryKey: ['points_report'],
    queryFn: async () => must<PointsReportRow[]>(await db().rpc('points_report', { p_months: 12 })),
  });
  const rows = report.data ?? [];
  const total = (k: keyof PointsReportRow) => rows.reduce((sum, r) => sum + Number(r[k]), 0);
  const month = (m: string) =>
    new Date(`${m}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  return (
    <>
      <div className="section-head">
        <h2>Points report</h2>
      </div>
      {report.isPending && <Loading />}
      {report.error && <ErrorNotice error={report.error} />}
      {report.data && (
        <>
          <div className="info-grid" style={{ marginBottom: 12 }}>
            <div className="info-card">
              <strong>{total('points_issued').toLocaleString('en-IN')}</strong>
              <span>Points issued (12 months)</span>
            </div>
            <div className="info-card">
              <strong>{rupees(total('rupees_paid'))}</strong>
              <span>Paid out (12 months)</span>
            </div>
            <div className="info-card">
              <strong>{total('points_expired').toLocaleString('en-IN')}</strong>
              <span>Points expired</span>
            </div>
            <div className="info-card">
              <strong style={rows[0]?.points_pending ? { color: 'var(--color-orange)' } : undefined}>
                {(rows[0]?.points_pending ?? 0).toLocaleString('en-IN')}
              </strong>
              <span>Points waiting to be paid</span>
            </div>
          </div>
          <div className="form-card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'right', color: 'var(--color-muted)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Month</th>
                  <th style={{ padding: '10px 8px' }}>Bills</th>
                  <th style={{ padding: '10px 8px' }}>Issued</th>
                  <th style={{ padding: '10px 8px' }}>Redeemed</th>
                  <th style={{ padding: '10px 8px' }}>Paid</th>
                  <th style={{ padding: '10px 12px' }}>Expired</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} style={{ textAlign: 'right', borderTop: '1px solid var(--color-line)' }}>
                    <td style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 700 }}>
                      {month(r.month)}
                    </td>
                    <td style={{ padding: '9px 8px' }}>{Number(r.bills_approved).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '9px 8px' }}>{Number(r.points_issued).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '9px 8px' }}>
                      {Number(r.points_redeemed).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '9px 8px' }}>
                      {rupees(Number(r.rupees_paid))}
                      {Number(r.payouts) > 0 && <div className="meta">{r.payouts} payouts</div>}
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      {Number(r.points_expired).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// Holidays ------------------------------------------------------------------------------------------------

export function Holidays() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const holidays = useQuery({
    queryKey: ['holidays'],
    queryFn: async () => must<Holiday[]>(await db().from('holidays').select('day, name').order('day')),
  });
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const add = useMutation({
    mutationFn: async () => must(await db().from('holidays').insert({ day, name: name.trim() })),
    onSuccess: () => {
      invalidate(['holidays']);
      setDay('');
      setName('');
      toast('Holiday added');
    },
    onError: (e) => setError(friendlyError(e, 'That day is already on the list.')),
  });
  const remove = useMutation({
    mutationFn: async (d: string) => must(await db().from('holidays').delete().eq('day', d)),
    onSuccess: () => invalidate(['holidays']),
    onError: (e) => setError(friendlyError(e)),
  });
  const today = todayIndia();
  const upcoming = holidays.data?.filter((h) => h.day >= today) ?? [];
  return (
    <section className="form-card" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Holidays</h3>
      <p className="meta" style={{ marginTop: 0 }}>
        These days, and every Sunday, do not count towards the 2-business-day cash-out promise.
      </p>
      {holidays.error && <ErrorNotice error={holidays.error} />}
      {upcoming.length === 0 && !holidays.isPending && <p className="meta">No upcoming holidays.</p>}
      <div className="list" style={{ marginBottom: 12 }}>
        {upcoming.map((h) => (
          <div
            key={h.day}
            className="manage-card"
            style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
          >
            <span>
              <b>{formatDate(h.day)}</b> · {h.name}
            </span>
            <button className="link-btn" onClick={() => remove.mutate(h.day)} disabled={remove.isPending}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!day) return setError('Pick a date.');
          if (!name.trim()) return setError('Give the holiday a name.');
          add.mutate();
        }}
      >
        <div className="field-row">
          <div className="field">
            <label htmlFor="hol-day">Date</label>
            <input
              id="hol-day"
              type="date"
              min={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hol-name">Name</label>
            <input
              id="hol-name"
              value={name}
              maxLength={80}
              placeholder="Onam"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn small" type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add holiday'}
        </button>
      </form>
    </section>
  );
}
