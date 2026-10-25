import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { db, must } from '../lib/queries';
import { Empty, ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, formatDate, friendlyError, useInvalidate } from './util';

/** Row from admin_pending_branches() */
type PendingBranch = {
  branch_id: number;
  branch_name: string;
  address: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  created_at: string;
  shop_id: number;
  shop_name: string;
  shop_slug: string;
  vendor_id: number;
  business_name: string;
  branch_count: number;
  review_status: 'approved' | 'pending' | 'rejected';
  /** Added over the plan's included branches and not paid yet */
  awaiting_payment: boolean;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_status: 'unpaid' | 'submitted' | 'paid' | 'void' | null;
  invoice_total: number | null;
};

const invoiceState = {
  unpaid: 'not paid yet',
  submitted: 'payment sent, check it',
  paid: 'paid',
  void: 'cancelled',
};

/** Branches added by approved vendors, waiting for a check or for payment before customers see them. */
export function PendingBranches() {
  const list = useQuery({
    queryKey: ['admin', 'pending-branches'],
    queryFn: async () => must<PendingBranch[]>(await db().rpc('admin_pending_branches')),
  });
  return (
    <>
      <p className="meta" style={{ marginTop: 0 }}>
        Branches that approved vendors add later wait here. Check the address and map pin, then approve or
        refuse with a reason the vendor will see. A branch over the plan's included branches also waits for
        its invoice to be paid; it goes live when both are done.
      </p>
      {list.isPending && <Loading />}
      {list.error && <ErrorNotice error={list.error} />}
      {list.data?.length === 0 && (
        <Empty emoji="📍" title="No branches to check">
          New branches from vendors will show up here.
        </Empty>
      )}
      {list.data?.map((b) => (
        <BranchCard key={b.branch_id} branch={b} />
      ))}
    </>
  );
}

function BranchCard({ branch: b }: { branch: PendingBranch }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const review = useMutation({
    mutationFn: async (v: { approve: boolean; note?: string }) =>
      must(
        await db().rpc('review_branch', {
          p_branch_id: b.branch_id,
          p_approve: v.approve,
          p_note: v.note ?? null,
        }),
      ),
    onSuccess: (_, v) => {
      invalidate(['admin', 'pending-branches'], ['admin-attention'], ...PUBLIC_KEYS);
      toast(v.approve ? `${b.branch_name} approved` : `${b.branch_name} refused`);
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const refuse = () => {
    let note = window.prompt('Why is this branch refused? The vendor will see this.', '');
    while (note !== null && !note.trim())
      note = window.prompt('A reason is required so the vendor can fix it.', '');
    if (note !== null) review.mutate({ approve: false, note: note.trim().slice(0, 300) });
  };
  return (
    <div className="manage-card">
      <h4>
        {b.shop_name} · {b.branch_name}
      </h4>
      <div className="meta">
        <Link to={`/admin/vendors/${b.vendor_id}`}>{b.business_name}</Link> · {b.branch_count} approved{' '}
        {b.branch_count === 1 ? 'branch' : 'branches'} · added {formatDate(b.created_at)}
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        {[b.address, b.area].filter(Boolean).join(' · ') || 'No address given'}
        {b.phone && ` · 📞 ${b.phone}`}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        {b.review_status === 'pending' ? (
          <span className="pill-status pending">Waiting for approval</span>
        ) : (
          <span className="pill-status live">Approved</span>
        )}
        {b.awaiting_payment && (
          <span className="pill-status pending">
            Waiting for payment
            {b.invoice_status ? ` · ${invoiceState[b.invoice_status]}` : ' · with the plan renewal'}
          </span>
        )}
      </div>
      {b.invoice_id != null && b.awaiting_payment && (
        <Link
          className="meta"
          to={`/admin/billing/invoices/${b.invoice_id}`}
          style={{ display: 'block', color: 'var(--color-blue)', fontWeight: 700 }}
        >
          🧾 Invoice {b.invoice_number}
          {b.invoice_total != null && ` · ₹${Number(b.invoice_total).toFixed(2)}`}
        </Link>
      )}
      {b.lat != null && b.lng != null ? (
        <a
          className="meta"
          href={`https://www.google.com/maps?q=${b.lat},${b.lng}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--color-blue)', fontWeight: 700 }}
        >
          📍 Open the map pin
        </a>
      ) : (
        <div className="meta">No map pin yet</div>
      )}
      {b.review_status === 'pending' && (
        <div className="btn-row">
          <button
            type="button"
            className="btn small"
            disabled={review.isPending}
            onClick={() => review.mutate({ approve: true })}
          >
            Approve
          </button>
          <button type="button" className="btn danger small" disabled={review.isPending} onClick={refuse}>
            Refuse
          </button>
        </div>
      )}
    </div>
  );
}
