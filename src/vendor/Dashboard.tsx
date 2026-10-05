import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useUnreadCount } from '../lib/engagement';
import { db, must } from '../lib/queries';
import type { Vendor } from '../lib/types';
import { useMyOffers, VENDOR_KEY } from './api';
import { useVendor } from './context';
import { useVendorAnalytics } from './engagement/api';
import { num } from './engagement/format';
import { errorMessage, offerPhase, orNull, phoneError } from './format';
import { ErrorNote, Lockable } from './ui';

export default function Dashboard() {
  const vendor = useVendor();
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
        <Counts />
      </section>
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
        <div className="btn-row" style={{ marginTop: 0 }}>
          <Link className="btn" to="/vendor/offers/new">
            ＋ New offer
          </Link>
          <Link className="btn secondary" to="/vendor/shops/new">
            ＋ Add shop
          </Link>
          <Link className="btn secondary" to="/vendor/offers?status=pending">
            Offers in review
          </Link>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Business details</h2>
        </div>
        <BusinessForm vendor={vendor} />
      </section>
    </>
  );
}

function StatusNotice({ vendor }: { vendor: Vendor }) {
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
  if (vendor.status === 'pending') {
    return (
      <div className="notice warn">
        <b>Your business is under review.</b> Set up your shops and offers now. Customers will see them once
        the IWILLFLY team approves your account.
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

function BusinessForm({ vendor }: { vendor: Vendor }) {
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
      <Lockable locked={vendor.status === 'blocked'}>
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
