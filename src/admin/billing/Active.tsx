import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import { addDays, todayIST } from '../engagement/api';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, one, useInvalidate } from '../util';
import {
  ADDON_LABEL,
  BILL_KEYS,
  billError,
  daysUntil,
  endsInWords,
  updateRunning,
  usePurchases,
  useSubscriptions,
  type PurchaseRow,
  type SubscriptionRow,
} from './api';

type Table = 'subscriptions' | 'addon_purchases';

export function Active() {
  const today = todayIST();
  const [running, setRunning] = useState(true);
  const subs = useSubscriptions(running, today);
  const purchases = usePurchases(running, today);
  const { roles } = useAuth();
  const canEdit = roles.includes('admin') || roles.includes('super_admin');

  return (
    <>
      <div className="section-head">
        <h2>Active plans &amp; add-ons</h2>
      </div>
      <div className="filter-bar" role="tablist" style={{ marginTop: 0 }}>
        {[
          { key: true, label: 'Running' },
          { key: false, label: 'Ended or cancelled' },
        ].map((f) => (
          <button
            key={String(f.key)}
            role="tab"
            aria-selected={running === f.key}
            className={`chip${running === f.key ? ' active' : ''}`}
            onClick={() => setRunning(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {running && (
        <div className="notice">
          Paid plans and add-ons, soonest to end first. Featured shops and promoted offers follow these dates
          (checked every night at midnight, India time).
        </div>
      )}

      <div className="section-head">
        <h2>Plans</h2>
      </div>
      {subs.isPending && <Loading />}
      {subs.error && <ErrorNotice error={subs.error} />}
      {subs.data?.length === 0 && (
        <Empty emoji="📦" title={running ? 'No paid plans running' : 'Nothing here'}>
          {running ? 'Vendors without a paid plan are on the default plan.' : undefined}
        </Empty>
      )}
      {subs.data?.map((s) => (
        <SubscriptionCard key={s.id} row={s} today={today} canEdit={canEdit} />
      ))}

      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>Add-ons</h2>
      </div>
      {purchases.isPending && <Loading />}
      {purchases.error && <ErrorNotice error={purchases.error} />}
      {purchases.data?.length === 0 && (
        <Empty emoji="✨" title={running ? 'No add-ons running' : 'Nothing here'} />
      )}
      {purchases.data?.map((p) => (
        <PurchaseCard key={p.id} row={p} today={today} canEdit={canEdit} />
      ))}
    </>
  );
}

function SubscriptionCard({
  row: s,
  today,
  canEdit,
}: {
  row: SubscriptionRow;
  today: string;
  canEdit: boolean;
}) {
  return (
    <RunningCard
      table="subscriptions"
      id={s.id}
      title={`${one(s.plan)?.name ?? 'Plan'} plan`}
      vendor={one(s.vendor)?.business_name ?? `Vendor #${s.vendor_id}`}
      startsOn={s.starts_on}
      endsOn={s.ends_on}
      cancelledAt={s.cancelled_at}
      today={today}
      canEdit={canEdit}
    />
  );
}

function PurchaseCard({ row: p, today, canEdit }: { row: PurchaseRow; today: string; canEdit: boolean }) {
  const target = one(p.offer)?.title ?? one(p.shop)?.name ?? null;
  const live = !p.cancelled_at && p.starts_on <= today && p.ends_on >= today;
  return (
    <RunningCard
      table="addon_purchases"
      id={p.id}
      title={one(p.addon)?.name ?? ADDON_LABEL[p.kind]}
      vendor={one(p.vendor)?.business_name ?? `Vendor #${p.vendor_id}`}
      kind={ADDON_LABEL[p.kind]}
      target={target}
      startsOn={p.starts_on}
      endsOn={p.ends_on}
      cancelledAt={p.cancelled_at}
      today={today}
      canEdit={canEdit}
    >
      {p.kind === 'banner_ad' && live && (
        <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
          Create the banner in <Link to="/admin/ads">Home ads</Link> for these dates
          {target ? ` (linking to ${target})` : ''}, if you have not yet.
        </div>
      )}
    </RunningCard>
  );
}

function RunningCard(props: {
  table: Table;
  id: number;
  title: string;
  vendor: string;
  kind?: string;
  target?: string | null;
  startsOn: string;
  endsOn: string;
  cancelledAt: string | null;
  today: string;
  canEdit: boolean;
  children?: ReactNode;
}) {
  const { table, id, title, vendor, kind, target, startsOn, endsOn, cancelledAt, today, canEdit } = props;
  const toast = useToast();
  const invalidate = useInvalidate();
  const update = useMutation({
    mutationFn: (patch: { cancelled_at?: string; ends_on?: string }) => updateRunning(table, id, patch),
    onSuccess: (_, patch) => {
      invalidate(...BILL_KEYS);
      toast(patch.cancelled_at ? 'Cancelled' : `Now ends ${formatDate(patch.ends_on)}`);
    },
    onError: (e) => toast(billError(e)),
  });

  const upcoming = startsOn > today;
  const left = daysUntil(endsOn, today);
  const status = cancelledAt
    ? { text: 'Cancelled', cls: 'rejected' }
    : left < 0
      ? { text: 'Ended', cls: '' }
      : upcoming
        ? { text: 'Queued', cls: 'pending' }
        : { text: endsInWords(endsOn, today), cls: left <= 7 ? 'pending' : 'live' };

  const cancel = () => {
    if (
      window.confirm(
        `Cancel ${title} for ${vendor}?\n\nIt stops counting straight away. No money is refunded by the app.` +
          (table === 'addon_purchases' ? ' A featured badge goes away at the next nightly check.' : ''),
      )
    )
      update.mutate({ cancelled_at: new Date().toISOString() });
  };

  const extend = () => {
    const raw = window.prompt(
      `Add how many days to ${title} for ${vendor}?\nIt now ends ${formatDate(endsOn)}.`,
      '7',
    );
    if (raw === null) return;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 1 || n > 1100) {
      toast('Enter a whole number of days, 1 to 1100.');
      return;
    }
    update.mutate({ ends_on: addDays(endsOn, n) });
  };

  return (
    <div className="manage-card">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h4>{title}</h4>
          <div className="meta">
            <b style={{ color: 'var(--color-ink)' }}>{vendor}</b>
            {kind ? ` · ${kind}` : ''}
            {target ? ` · ${target}` : ''}
          </div>
          <div className="meta">
            {formatDate(startsOn)} → {formatDate(endsOn)}
            {cancelledAt ? ` · cancelled ${formatDate(cancelledAt)}` : ''}
          </div>
        </div>
        <span className={`pill-status ${status.cls}`}>{status.text}</span>
      </div>
      {props.children}
      {canEdit && !cancelledAt && left >= 0 && (
        <div className="btn-row">
          <button className="btn small secondary" disabled={update.isPending} onClick={extend}>
            Extend
          </button>
          <button className="btn small danger" disabled={update.isPending} onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
