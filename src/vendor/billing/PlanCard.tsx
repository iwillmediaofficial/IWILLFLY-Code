import { Link } from 'react-router-dom';
import type { MyBilling } from '../../lib/types';
import { useVendor, useVendorRole } from '../context';
import { formatDate, todayIST } from '../format';
import { ErrorNote, Loading } from '../ui';
import { useMyBilling } from './api';
import { daysUntil, planPrice, usageText } from './format';

/** "Paid until 12 Oct 2026" and whether it ends within a week. */
function endInfo(b: MyBilling) {
  if (!b.paid_until) return null;
  const left = daysUntil(b.paid_until, todayIST());
  return { left, soon: left <= 7 };
}

function endsText(left: number) {
  return left <= 0 ? 'ends today' : left === 1 ? 'ends tomorrow' : `ends in ${left} days`;
}

/** The full current-plan card on Plan & billing: limits with usage, paid-until date and running add-ons. */
export function CurrentPlanCard() {
  const vendor = useVendor();
  const { data: b, isPending, error } = useMyBilling();
  if (vendor.status === 'blocked')
    return (
      <div className="notice bad">
        Your account is blocked, so plans and add-ons are paused. Contact IWILLFLY support for help.
      </div>
    );
  if (isPending) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const p = b.plan;
  const end = endInfo(b);

  return (
    <div className="manage-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <span className="meta">Your plan</span>
          <h4 style={{ fontSize: 20, margin: '2px 0' }}>{p?.name ?? 'Free listing'}</h4>
          <div className="meta">{p ? planPrice(p) : 'No plan needed for now'}</div>
        </div>
        <span className="pill-status live" style={{ flex: 'none' }}>
          Current
        </span>
      </div>
      {p?.description && <p style={{ fontSize: 13, lineHeight: 1.5, margin: '8px 0 0' }}>{p.description}</p>}

      <div className="info-grid" style={{ marginTop: 12 }}>
        <div className="info-card">
          <span>Shops</span>
          <strong>{usageText(b.usage.shops, p?.max_shops ?? null)}</strong>
        </div>
        <div className="info-card">
          <span>Live offers</span>
          <strong>{usageText(b.usage.live_offers, p?.max_live_offers ?? null)}</strong>
        </div>
      </div>
      <div className="meta" style={{ marginTop: 6 }}>
        Live offers count every offer that hasn't ended or been rejected, including ones in review.
      </div>

      {end ? (
        <div className={`notice${end.soon ? ' warn' : ''}`} style={{ marginTop: 12, marginBottom: 0 }}>
          Paid until <b>{formatDate(b.paid_until)}</b>
          {end.soon && <> · Your plan {endsText(end.left)}. Renew below to keep your limits.</>}
        </div>
      ) : (
        p &&
        Number(p.price) > 0 && (
          <div className="meta" style={{ marginTop: 8 }}>
            No end date
          </div>
        )
      )}

      <h4 style={{ fontSize: 13, margin: '14px 0 6px' }}>Active add-ons</h4>
      {b.addons.length === 0 ? (
        <div className="meta">None right now.</div>
      ) : (
        <div className="list">
          {b.addons.map((a) => (
            <div
              key={a.id}
              style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8 }}
            >
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <b>{a.name}</b>
                {a.target && ` · ${a.target}`}
              </span>
              <span className="meta" style={{ flex: 'none' }}>
                until {formatDate(a.ends_on)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small plan summary for the dashboard, with a renew/upgrade link and a warning near the end date. */
export function DashboardPlanCard() {
  const vendor = useVendor();
  const { isOwner } = useVendorRole();
  const { data: b, isPending, error } = useMyBilling();
  if (vendor.status === 'blocked') return null;
  if (error) return <ErrorNote error={error} />;
  const end = b ? endInfo(b) : null;
  const action = end?.soon ? 'Renew' : 'Upgrade';

  return (
    <>
      {end?.soon && (
        <div className="notice warn">
          <b>
            Your {b?.plan?.name} plan {endsText(end.left)}.
          </b>{' '}
          {isOwner ? 'Renew it to keep your shop and offer limits.' : 'Ask the business owner to renew it.'}{' '}
          {isOwner && (
            <Link to="/vendor/billing" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
              Renew now
            </Link>
          )}
        </div>
      )}
      <Link
        className="info-card"
        to="/vendor/billing"
        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span>Your plan</span>
          <strong style={{ fontSize: 17 }}>{isPending ? '…' : (b?.plan?.name ?? 'Free listing')}</strong>
          <span>
            {isPending || !b
              ? ''
              : b.paid_until
                ? `Paid until ${formatDate(b.paid_until)}`
                : b.plan
                  ? planPrice(b.plan)
                  : 'No plan needed for now'}
          </span>
        </div>
        <span style={{ color: 'var(--color-blue)', fontWeight: 800, fontSize: 12, flex: 'none' }}>
          {isOwner ? `${action} ›` : 'View ›'}
        </span>
      </Link>
    </>
  );
}
