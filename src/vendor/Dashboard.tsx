import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useUnreadCount } from '../lib/engagement';
import { db, must } from '../lib/queries';
import type { Invoice, Vendor } from '../lib/types';
import { useBranch, useMyOffers, VENDOR_KEY } from './api';
import { CHECK_TIME } from './billing/format';
import { DashboardPlanCard } from './billing/PlanCard';
import { useBranchScope, useVendor, useVendorRole } from './context';
import { useVendorAnalytics } from './engagement/api';
import { num } from './engagement/format';
import { errorMessage, offerPhase, orNull, phoneError } from './format';
import { ErrorNote, Lockable } from './ui';

export default function Dashboard() {
  const vendor = useVendor();
  const { isOwner, canEdit } = useVendorRole();
  const { isBranchMember } = useBranchScope();
  if (isBranchMember) return <BranchDashboard />;
  return (
    <>
      <section className="hero">
        <h1>{vendor.business_name}</h1>
        <p>Manage your shops, branches and offers.</p>
        <span className="hero-pill">
          {vendor.status === 'approved'
            ? 'Approved'
            : vendor.status === 'blocked'
              ? 'Blocked'
              : 'Under review'}
          {vendor.is_verified && ' · ✓ Verified'}
        </span>
      </section>
      <section className="section">
        <StatusNotice vendor={vendor} />
        {canEdit && vendor.status !== 'blocked' && <FinishShop />}
        <Counts />
      </section>
      {vendor.status !== 'blocked' && (
        <section className="section">
          <DashboardPlanCard />
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2>Last 7 days</h2>
          <Link to="/vendor/insights?days=7">See insights</Link>
        </div>
        <WeekAndAlerts />
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Quick actions</h2>
        </div>
        {!canEdit ? (
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Link className="btn" to="/vendor/scratch/claim">
              📷 Verify a prize
            </Link>
            <Link className="btn secondary" to="/vendor/insights">
              See insights
            </Link>
            <Link className="btn secondary" to="/vendor/help">
              Get help
            </Link>
          </div>
        ) : (
          <div className="btn-row" style={{ marginTop: 0 }}>
            {vendor.status === 'approved' && (
              <Link className="btn" to="/vendor/offers/new">
                ＋ New offer
              </Link>
            )}
            <Link className="btn secondary" to="/vendor/shops">
              My shop &amp; branches
            </Link>
            <Link className="btn secondary" to="/vendor/offers?status=pending">
              Offers in review
            </Link>
          </div>
        )}
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Business details</h2>
        </div>
        {!isOwner && <div className="notice">Only the business owner can change these details.</div>}
        <BusinessForm vendor={vendor} locked={vendor.status === 'blocked' || !isOwner} />
      </section>
    </>
  );
}

function StatusNotice({ vendor }: { vendor: Vendor }) {
  const inv = useLatestInvoice().data;
  if (vendor.status === 'blocked') {
    return (
      <div className="notice bad">
        <b>Your vendor account is blocked.</b> Your shops and offers are hidden and editing is switched off.
        {vendor.admin_note && (
          <>
            <br />
            Note from IWILLFLY: {vendor.admin_note}
          </>
        )}
      </div>
    );
  }
  if (vendor.status === 'pending' && inv?.status === 'submitted') {
    return (
      <div className="notice warn">
        <b>⏳ Payment verification pending.</b> We are checking your plan payment, {CHECK_TIME}. We will
        notify you once your shop is approved. Meanwhile you can set up your shops, branches, logo and cover
        photo.
      </div>
    );
  }
  if (vendor.status === 'pending' && inv?.status === 'paid') {
    return (
      <div className="notice warn">
        <b>Payment received.</b> Your application is being reviewed, {CHECK_TIME}. Meanwhile you can set up
        your shops, branches, logo and cover photo.
      </div>
    );
  }
  if (vendor.status === 'pending') {
    return (
      <div className="notice warn">
        <b>Your business is under review.</b> You can set up your shops, branches, logo and cover photo now.
        Offers can be added once the IWILLFLY team approves your account.
      </div>
    );
  }
  return (
    <div className="notice">
      <b>You are live.</b> Your active shops and approved offers are visible to customers.{' '}
      {vendor.is_verified && <span className="pill-status approved">✓ Verified</span>}
    </div>
  );
}

/** The latest plan invoice of this business that is not cancelled, if any. */
function useLatestInvoice() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor', 'latest-invoice', vendor.id],
    queryFn: async () =>
      must<Pick<Invoice, 'id' | 'status'>[]>(
        await db()
          .from('invoices')
          .select('id, status, invoice_items!inner(plan_id)')
          .eq('vendor_id', vendor.id)
          .neq('status', 'void')
          .not('invoice_items.plan_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1),
      )[0] ?? null,
  });
}

/** "Finish your shop": what is left between sending the application and the first live offer. */
function FinishShop() {
  const vendor = useVendor();
  const { isOwner } = useVendorRole();
  const { offers, shops, isPending } = useMyOffers();
  const invoice = useLatestInvoice();
  if (isPending || invoice.isPending) return null;
  const shop = shops?.[0];
  const approved = vendor.status === 'approved';
  const inv = invoice.data;
  const steps: { done: boolean; label: string; action?: { to: string; text: string } }[] = [
    {
      done: Boolean(shop),
      label: 'Shop details sent',
      action: { to: '/vendor/shops/new', text: 'Add your shop' },
    },
    {
      done: !inv || inv.status === 'paid',
      label:
        !inv || inv.status === 'paid'
          ? 'Plan active'
          : inv.status === 'submitted'
            ? 'Payment sent, we are checking it'
            : 'Pay for your plan',
      action:
        inv && isOwner
          ? {
              to: `/vendor/billing/invoices/${inv.id}`,
              text: inv.status === 'submitted' ? 'View' : 'Pay now',
            }
          : undefined,
    },
    {
      done: Boolean(shop?.logo_key && shop?.cover_key),
      label: 'Logo and cover photo',
      action: shop ? { to: `/vendor/shops/${shop.id}`, text: 'Add photos' } : undefined,
    },
    { done: approved, label: 'Approved by IWILLFLY' },
    {
      done: (offers?.length ?? 0) > 0,
      label: 'First offer',
      action: approved ? { to: '/vendor/offers/new', text: 'Add offer' } : undefined,
    },
  ];
  if (steps.every((st) => st.done)) return null;
  return (
    <div className="manage-card finish-shop">
      <h4>Finish your shop</h4>
      <ul>
        {steps.map((st) => (
          <li key={st.label} className={st.done ? 'done' : ''}>
            <span aria-hidden>{st.done ? '✓' : '○'}</span>
            <span className="grow">{st.label}</span>
            {!st.done && st.action && (
              <Link to={st.action.to} className="link-btn">
                {st.action.text}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Counts() {
  const { offers, shops, isPending, error } = useMyOffers();
  if (error) return <ErrorNote error={error} />;
  const phases = (offers ?? []).map((o) => offerPhase(o));
  const count = (p: string) => (isPending ? '…' : phases.filter((x) => x === p).length);
  const cards = [
    { label: 'Live offers', value: count('live'), to: '/vendor/offers?status=approved' },
    { label: 'In review', value: count('pending'), to: '/vendor/offers?status=pending' },
    { label: 'Rejected', value: count('rejected'), to: '/vendor/offers?status=rejected' },
    { label: 'Shops', value: isPending ? '…' : (shops?.length ?? 0), to: '/vendor/shops' },
  ];
  return (
    <div className="info-grid">
      {cards.map((c) => (
        <Link key={c.label} className="info-card" to={c.to}>
          <span>{c.label}</span>
          <strong>{c.value}</strong>
        </Link>
      ))}
    </div>
  );
}

/** Last-7-days views and WhatsApp leads, plus unread alerts. */
function WeekAndAlerts() {
  const stats = useVendorAnalytics(7);
  const unread = useUnreadCount();
  const value = (n: number | undefined) => (stats.isPending ? '…' : stats.error ? '–' : num(n ?? 0));
  const alerts = unread.isPending ? '…' : unread.error ? '–' : num(unread.data ?? 0);
  return (
    <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <Link className="info-card" to="/vendor/insights?days=7">
        <span>Views</span>
        <strong>{value(stats.data?.totals.views)}</strong>
      </Link>
      <Link className="info-card" to="/vendor/insights?days=7">
        <span>WhatsApp leads</span>
        <strong>{value(stats.data?.totals.whatsapp)}</strong>
      </Link>
      <Link
        className="info-card"
        to="/notifications"
        style={
          unread.data ? { borderColor: 'var(--color-blue)', background: 'var(--color-blue-soft)' } : undefined
        }
      >
        <span>Unread alerts</span>
        <strong>{alerts}</strong>
      </Link>
    </div>
  );
}

function BusinessForm({ vendor, locked }: { vendor: Vendor; locked: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(vendor.business_name);
  const [phone, setPhone] = useState(vendor.contact_phone ?? '');
  const [whatsapp, setWhatsapp] = useState(vendor.whatsapp ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () =>
      must(
        await db()
          .from('vendors')
          .update({ business_name: name.trim(), contact_phone: orNull(phone), whatsapp: orNull(whatsapp) })
          .eq('id', vendor.id),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast('Business details saved');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const problem =
      (n.length < 2 || n.length > 120 ? 'Business name should be 2 to 120 characters.' : null) ??
      phoneError(phone) ??
      phoneError(whatsapp, 'WhatsApp');
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <Lockable locked={locked}>
        <div className="field">
          <label htmlFor="v-name">Business name *</label>
          <input id="v-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="v-phone">Phone</label>
            <input
              id="v-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="field">
            <label htmlFor="v-wa">WhatsApp</label>
            <input
              id="v-wa"
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              maxLength={20}
            />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={save.isPending} style={{ marginTop: 8 }}>
          {save.isPending ? 'Saving…' : 'Save details'}
        </button>
      </Lockable>
    </form>
  );
}

/** Dashboard for branch managers and branch staff: their branch and its offers. */
function BranchDashboard() {
  const vendor = useVendor();
  const { branchId, branchName, isBranchManager } = useBranchScope();
  const branch = useBranch(branchId).data;
  const { offers, branchesOf } = useMyOffers();
  const mine = (offers ?? []).filter(
    (o) => o.all_branches || (branchesOf?.get(o.id) ?? []).includes(branchId!),
  );
  const own = mine.filter((o) => !o.all_branches);
  const live = mine.filter((o) => offerPhase(o) === 'live').length;
  const review = own.filter((o) => offerPhase(o) === 'pending').length;
  return (
    <>
      <section className="hero">
        <h1>{branchName}</h1>
        <p>
          {vendor.business_name} · {isBranchManager ? 'Branch manager' : 'Branch staff'}
        </p>
        <span className="hero-pill">
          {vendor.status === 'blocked'
            ? 'Blocked'
            : branch?.review_status === 'pending'
              ? 'Waiting for approval'
              : branch?.review_status === 'rejected'
                ? 'Branch not approved'
                : vendor.status === 'approved'
                  ? 'Live'
                  : 'Under review'}
        </span>
      </section>
      <section className="section">
        {vendor.status === 'blocked' ? (
          <div className="notice bad">
            <b>This business is blocked.</b> Its shops and offers are hidden and editing is switched off.
          </div>
        ) : branch?.review_status === 'pending' ? (
          <div className="notice warn">
            The IWILLFLY team is checking this branch. Customers will see it once it is approved.
          </div>
        ) : null}
        <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Link className="info-card" to="/vendor/offers?status=approved">
            <span>Live here</span>
            <strong>{offers ? live : '…'}</strong>
          </Link>
          <Link className="info-card" to="/vendor/offers">
            <span>Branch offers</span>
            <strong>{offers ? own.length : '…'}</strong>
          </Link>
          <Link className="info-card" to="/vendor/offers?status=pending">
            <span>In review</span>
            <strong>{offers ? review : '…'}</strong>
          </Link>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Quick actions</h2>
        </div>
        <div className="btn-row" style={{ marginTop: 0 }}>
          {isBranchManager && vendor.status === 'approved' && (
            <Link className="btn" to="/vendor/offers/new">
              ＋ New offer
            </Link>
          )}
          {branchId != null && (
            <Link className="btn secondary" to={`/vendor/branches/${branchId}`}>
              {isBranchManager ? 'Edit my branch' : 'My branch'}
            </Link>
          )}
          <Link className="btn secondary" to="/vendor/scratch/claim">
            📷 Verify a prize
          </Link>
        </div>
      </section>
    </>
  );
}
