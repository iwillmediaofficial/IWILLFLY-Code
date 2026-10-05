import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import type { RequestStatus } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, one, useInvalidate } from '../util';
import type { AdPrefill } from './Ads';
import { ENG_KEYS, PLACEMENT_LABEL, decideRequest, engError, useRequests, type RequestRow } from './api';

const TABS: { key: RequestStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Declined' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_CLASS: Record<RequestStatus, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: '',
};

export default function AdminRequests() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'pending';
  const requests = useRequests(tab);

  return (
    <>
      <div className="section-head">
        <h2>Placement requests</h2>
      </div>
      <div className="notice">
        Vendors ask here to be promoted. Approving a <b>Featured offer</b> features that offer straight away.
        For a <b>Home banner</b>, use “Create home ad” to make the banner, then approve. For a{' '}
        <b>Festival spotlight</b>, approve their offer in the festival’s submissions too. The vendor gets a
        notification either way.
      </div>
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
      {requests.isPending && <Loading />}
      {requests.error && <ErrorNotice error={requests.error} />}
      {requests.data?.length === 0 && (
        <Empty emoji="📬" title={tab === 'pending' ? 'No requests waiting' : 'Nothing here'}>
          {tab === 'pending' ? 'When a vendor asks to be featured, it shows up here.' : undefined}
        </Empty>
      )}
      {requests.data?.map((r) => (
        <RequestCard key={r.id} request={r} />
      ))}
    </>
  );
}

function RequestCard({ request: r }: { request: RequestRow }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const vendor = one(r.vendor);
  const offer = one(r.offer);
  const shop = one(r.shop);
  const festival = one(r.festival);

  const decide = useMutation({
    mutationFn: (v: { status: 'approved' | 'rejected'; note: string | null }) =>
      decideRequest(r.id, v.status, v.note),
    onSuccess: (_, v) => {
      invalidate(...ENG_KEYS);
      toast(
        v.status === 'rejected'
          ? 'Request declined'
          : r.kind === 'featured_offer'
            ? 'Approved. The offer is now featured.'
            : 'Request approved',
      );
    },
    onError: (e) => toast(engError(e)),
  });

  const approve = () => {
    const extra =
      r.kind === 'featured_offer'
        ? `\n\n“${offer?.title ?? 'This offer'}” will be featured straight away.`
        : r.kind === 'home_banner'
          ? '\n\nMake sure you have created the home ad for it.'
          : '';
    const note = window.prompt(
      `Approve this ${PLACEMENT_LABEL[r.kind]} request?${extra}\n\nNote for the vendor (optional):`,
      '',
    );
    if (note === null) return;
    decide.mutate({ status: 'approved', note: note.trim().slice(0, 500) || null });
  };

  const decline = () => {
    let note = window.prompt('Why is this request declined? The vendor will see this.', '');
    while (note !== null && !note.trim()) {
      note = window.prompt('A reason is required so the vendor understands.', '');
    }
    if (note === null) return;
    decide.mutate({ status: 'rejected', note: note.trim().slice(0, 500) });
  };

  const createAd = () => {
    const state: AdPrefill = {
      prefill: {
        vendor_id: r.vendor_id,
        title: shop?.name ?? offer?.title ?? vendor?.business_name ?? '',
        subtitle: offer ? offer.title : null,
        link_kind: shop ? 'shop' : offer ? 'offer' : 'none',
        link_target: shop ? String(shop.id) : offer ? String(offer.id) : null,
        ...(r.wanted_from ? { starts_on: r.wanted_from } : {}),
        ends_on: r.wanted_to,
      },
      from: `Home banner for ${vendor?.business_name ?? 'a vendor'}${
        r.message ? `. Their message: “${r.message}”` : ''
      }. After saving, come back to Requests and approve it.`,
    };
    navigate('/admin/ads/new', { state });
  };

  const wanted =
    r.wanted_from || r.wanted_to
      ? `${r.wanted_from ? formatDate(r.wanted_from) : 'any time'} – ${
          r.wanted_to ? formatDate(r.wanted_to) : 'open-ended'
        }`
      : null;

  return (
    <div className="manage-card">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h4>{PLACEMENT_LABEL[r.kind]}</h4>
          <div className="meta">
            <b style={{ color: 'var(--color-ink)' }}>{vendor?.business_name ?? `Vendor #${r.vendor_id}`}</b> ·
            asked {formatDate(r.created_at)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={`pill-status ${STATUS_CLASS[r.status]}`}>
            {r.status === 'rejected' ? 'declined' : r.status}
          </span>
          {offer?.is_featured && <span className="pill-status featured">★ Featured</span>}
        </div>
      </div>
      <div style={{ fontSize: 13, marginTop: 6, display: 'grid', gap: 2 }}>
        {offer && (
          <div>
            <span className="meta">Offer:</span> {offer.title}
          </div>
        )}
        {shop && (
          <div>
            <span className="meta">Shop:</span> {shop.name}
          </div>
        )}
        {festival && (
          <div>
            <span className="meta">Festival:</span> {festival.name}
          </div>
        )}
        {wanted && (
          <div>
            <span className="meta">Wanted:</span> {wanted}
          </div>
        )}
      </div>
      {r.message && (
        <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
          <span className="meta">Message:</span> {r.message}
        </p>
      )}
      {r.admin_note && (
        <div
          className={`notice ${r.status === 'rejected' ? 'bad' : ''}`}
          style={{ marginTop: 10, marginBottom: 0 }}
        >
          <b>Note:</b> {r.admin_note}
          {r.decided_at && <span className="meta"> · {formatDate(r.decided_at)}</span>}
        </div>
      )}
      {r.status === 'pending' && (
        <div className="btn-row">
          {r.kind === 'home_banner' && (
            <button className="btn small yellow" onClick={createAd}>
              Create home ad
            </button>
          )}
          <button className="btn small" disabled={decide.isPending} onClick={approve}>
            Approve
          </button>
          <button className="btn small danger" disabled={decide.isPending} onClick={decline}>
            Decline
          </button>
        </div>
      )}
    </div>
  );
}
