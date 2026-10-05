import { useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import type { Addon, Invoice, MyBilling, Offer, Plan, PurchaseItem, Shop } from '../../lib/types';
import { useMyOffers } from '../api';
import { useVendor, useVendorRole } from '../context';
import { errorMessage, formatDate, offerPhase } from '../format';
import { ErrorNote, Loading, PageHead } from '../ui';
import { useAddons, useCreateInvoice, useInvoices, useMyBilling, usePlans } from './api';
import { addonHint, invoiceClass, invoiceLabel, limitText, money, periodText, planPrice } from './format';
import InvoicePage from './InvoicePage';
import { CurrentPlanCard } from './PlanCard';

export default function VendorBilling() {
  return (
    <Routes>
      <Route index element={<BillingHome />} />
      <Route path="invoices/:id" element={<InvoicePage />} />
    </Routes>
  );
}

function BillingHome() {
  const vendor = useVendor();
  const { isOwner } = useVendorRole();
  const canBuy = isOwner && vendor.status !== 'blocked';

  return (
    <>
      <PageHead title="Plan & billing" />
      <CurrentPlanCard />
      {!isOwner ? (
        <div className="notice" style={{ marginTop: 12 }}>
          The business owner manages the plan, add-ons and invoices.
        </div>
      ) : (
        <>
          {canBuy && <BuySections />}
          <section className="section">
            <div className="section-head">
              <h2>Invoices</h2>
            </div>
            <InvoiceList />
          </section>
        </>
      )}
    </>
  );
}

/** Plans and add-ons the owner can buy. */
function BuySections() {
  const billing = useMyBilling();
  const plans = usePlans();
  const addons = useAddons();
  const { offers, shops, isPending, error } = useMyOffers();

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>Plans</h2>
        </div>
        {plans.isPending ? (
          <Loading />
        ) : plans.error ? (
          <ErrorNote error={plans.error} />
        ) : plans.data.length === 0 ? (
          <p className="meta" style={{ fontSize: 13 }}>
            There are no plans to choose from yet.
          </p>
        ) : (
          <div className="list">
            {plans.data.map((p) => (
              <PlanOption key={p.id} plan={p} billing={billing.data} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Add-ons</h2>
        </div>
        {addons.isPending || isPending ? (
          <Loading />
        ) : addons.error || error ? (
          <ErrorNote error={addons.error ?? error} />
        ) : addons.data.length === 0 ? (
          <p className="meta" style={{ fontSize: 13 }}>
            No add-ons are on sale right now.
          </p>
        ) : (
          <div className="list">
            {addons.data.map((a) => (
              <AddonOption key={a.id} addon={a} shops={shops ?? []} offers={offers ?? []} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** Creates the invoice and opens it; free items are switched on at once. */
function useBuy() {
  const toast = useToast();
  const navigate = useNavigate();
  const create = useCreateInvoice();
  const buy = (items: PurchaseItem[], free: boolean) =>
    create.mutate(items, {
      onSuccess: (id) => {
        toast(free ? 'Done. It is active now.' : 'Invoice created. Pay it by UPI below.');
        navigate(`/vendor/billing/invoices/${id}`);
      },
      onError: (e) => toast(errorMessage(e)),
    });
  return { buy, busy: create.isPending };
}

function PlanOption({ plan: p, billing }: { plan: Plan; billing: MyBilling | undefined }) {
  const { buy, busy } = useBuy();
  const current = billing?.plan?.id === p.id;
  const free = Number(p.price) === 0;
  const label = current ? (free ? 'Current plan' : 'Renew') : 'Choose';

  const choose = () => {
    const what = free
      ? `Switch to the free ${p.name} plan?`
      : `Create an invoice for the ${p.name} plan (${money(p.price)} for ${p.period_days} days, plus GST if any)?`;
    if (confirm(what)) buy([{ plan_id: p.id }], free);
  };

  return (
    <div
      className="manage-card"
      style={{ marginTop: 0, borderColor: current ? 'var(--color-blue)' : undefined }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <h4>{p.name}</h4>
          <div style={{ fontWeight: 800, color: 'var(--color-blue)' }}>{planPrice(p)}</div>
        </div>
        {current && (
          <span className="pill-status live" style={{ flex: 'none' }}>
            Your plan
          </span>
        )}
      </div>
      {p.description && <p style={{ fontSize: 13, lineHeight: 1.5, margin: '6px 0 0' }}>{p.description}</p>}
      <ul style={{ fontSize: 13, lineHeight: 1.6, margin: '8px 0 0', paddingLeft: 18 }}>
        <li>{limitText(p.max_shops, 'shop', 'shops')}</li>
        <li>{limitText(p.max_live_offers, 'live offer', 'live offers')}</li>
        {p.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {!(current && free) && (
        <div className="btn-row">
          <button
            type="button"
            className={`btn small${current ? ' secondary' : ''}`}
            disabled={busy}
            onClick={choose}
          >
            {busy ? 'Please wait…' : label}
          </button>
          {current && !free && (
            <span className="meta" style={{ alignSelf: 'center' }}>
              Adds another {periodText(p.period_days)} after your paid time
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function AddonOption({ addon: a, shops, offers }: { addon: Addon; shops: Shop[]; offers: Offer[] }) {
  const toast = useToast();
  const { buy, busy } = useBuy();
  const promotable = offers.filter((o) => o.status === 'approved' && offerPhase(o) !== 'ended');
  const needsOffer = a.kind === 'promoted_offer';
  const needsShop = a.kind === 'featured_shop';
  const pickShop = a.kind !== 'promoted_offer';
  const [target, setTarget] = useState(pickShop && shops.length === 1 ? String(shops[0].id) : '');
  const free = Number(a.price) === 0;

  const onBuy = () => {
    if (needsOffer && !target) return toast('Choose the offer to promote');
    if (needsShop && !target) return toast('Choose the shop to feature');
    const name = needsOffer
      ? promotable.find((o) => String(o.id) === target)?.title
      : shops.find((s) => String(s.id) === target)?.name;
    const what = free
      ? `Switch on ${a.name}${name ? ` for ${name}` : ''}?`
      : `Create an invoice for ${a.name}${name ? ` (${name})` : ''}: ${money(a.price)} for ${a.duration_days} days, plus GST if any?`;
    if (!confirm(what)) return;
    const item: PurchaseItem = needsOffer
      ? { addon_id: a.id, offer_id: Number(target) }
      : { addon_id: a.id, shop_id: target ? Number(target) : null };
    buy([item], free);
  };

  const options = needsOffer
    ? promotable.map((o) => ({ id: o.id, label: o.title + (o.is_featured ? ' (featured now)' : '') }))
    : shops.map((s) => ({ id: s.id, label: s.name + (s.is_featured && needsShop ? ' (featured now)' : '') }));

  return (
    <div className="manage-card" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <h4 style={{ minWidth: 0 }}>{a.name}</h4>
        <div style={{ fontWeight: 800, color: 'var(--color-blue)', flex: 'none', textAlign: 'right' }}>
          {free ? 'Free' : money(a.price)}
          <div className="meta" style={{ fontWeight: 600 }}>
            {a.duration_days} days
          </div>
        </div>
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: '4px 0 0' }}>{a.description || addonHint[a.kind]}</p>
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label htmlFor={`addon-${a.id}`}>
          {needsOffer ? 'Offer to promote *' : needsShop ? 'Shop to feature *' : 'Shop (optional)'}
        </label>
        <select id={`addon-${a.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">
            {needsOffer ? 'Choose an offer' : needsShop ? 'Choose a shop' : 'No particular shop'}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {needsOffer && promotable.length === 0 && (
          <div className="hint">Only approved offers that are still running can be promoted.</div>
        )}
        {pickShop && shops.length === 0 && (
          <div className="hint">
            <Link to="/vendor/shops/new" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
              Add a shop
            </Link>{' '}
            first.
          </div>
        )}
      </div>
      <div className="btn-row">
        <button type="button" className="btn small" disabled={busy} onClick={onBuy}>
          {busy ? 'Please wait…' : 'Buy'}
        </button>
      </div>
    </div>
  );
}

function InvoiceList() {
  const { data, isPending, error } = useInvoices();
  if (isPending) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (data.length === 0)
    return (
      <p className="meta" style={{ fontSize: 13 }}>
        No invoices yet. Choosing a plan or add-on creates one.
      </p>
    );
  return (
    <div className="list">
      {data.map((i) => (
        <InvoiceRow key={i.id} invoice={i} />
      ))}
    </div>
  );
}

function InvoiceRow({ invoice: i }: { invoice: Invoice }) {
  return (
    <Link
      className="manage-card"
      to={`/vendor/billing/invoices/${i.id}`}
      style={{ marginTop: 0, display: 'block' }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4>{i.number}</h4>
          <div className="meta">
            {formatDate(i.issued_on)} · {money(i.total)}
          </div>
        </div>
        <span className={`pill-status ${invoiceClass[i.status]}`} style={{ flex: 'none' }}>
          {invoiceLabel[i.status]}
        </span>
        <div className="chev">›</div>
      </div>
    </Link>
  );
}
