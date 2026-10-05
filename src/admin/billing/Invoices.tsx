import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import type { AddonKind, Invoice, InvoiceStatus, PurchaseItem } from '../../lib/types';
import { todayIST } from '../engagement/api';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, useInvalidate } from '../util';
import {
  ADDON_HELP,
  BILL_KEYS,
  INVOICE_STATUS,
  PAY_METHODS,
  billError,
  createInvoice,
  markPaid,
  money,
  useAddons,
  useBillableVendors,
  useBillingSettings,
  useInvoice,
  useInvoices,
  usePlans,
  useVendorShops,
  voidInvoice,
  type InvoiceFilter,
  type InvoiceWithItems,
} from './api';

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: 'submitted', label: 'Needs checking' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'paid', label: 'Paid' },
  { key: 'void', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

export function InvoicePill({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_STATUS[status];
  return <span className={`pill-status ${s.cls}`}>{s.text}</span>;
}

/** Admin or super admin: may change invoices. Support can only read them. */
function useIsAdmin() {
  const { roles } = useAuth();
  return roles.includes('admin') || roles.includes('super_admin');
}

export function Invoices() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get('status'))?.key ?? 'submitted';
  const invoices = useInvoices(filter);
  const isAdmin = useIsAdmin();

  return (
    <>
      <div className="section-head">
        <h2>Invoices</h2>
        {isAdmin && (
          <Link className="btn small" to="/admin/billing/invoices/new">
            ＋ Bill a vendor
          </Link>
        )}
      </div>
      {filter === 'submitted' && (
        <div className="notice">
          Vendors pay to your UPI ID and type the UPI transaction ID here. Check the money arrived in your UPI
          or bank app, then open the invoice and mark it paid. What they bought switches on straight away.
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
      {invoices.isPending && <Loading />}
      {invoices.error && <ErrorNotice error={invoices.error} />}
      {invoices.data?.length === 0 && (
        <Empty emoji="🧾" title={filter === 'submitted' ? 'Nothing to check' : 'No invoices here'}>
          {filter === 'submitted'
            ? 'When a vendor says they have paid, the invoice shows up here.'
            : undefined}
        </Empty>
      )}
      <div className="list">
        {invoices.data?.map((i) => (
          <InvoiceRow key={i.id} invoice={i} />
        ))}
      </div>
    </>
  );
}

function InvoiceRow({ invoice: i }: { invoice: Invoice }) {
  return (
    <Link className="shop-card" to={`/admin/billing/invoices/${i.id}`}>
      <div className="shop-thumb">🧾</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          <InvoicePill status={i.status} />
        </div>
        <h4>
          {i.bill_to.business_name ?? `Vendor #${i.vendor_id}`} · {money(i.total)}
        </h4>
        <div className="meta">
          {i.number} · issued {formatDate(i.issued_on)}
          {i.status === 'unpaid' ? ` · due ${formatDate(i.due_on)}` : ''}
          {i.status === 'paid' && i.paid_on ? ` · paid ${formatDate(i.paid_on)}` : ''}
        </div>
        {i.payer_ref && i.status !== 'paid' && (
          <div className="meta">
            UPI ref <b style={{ color: 'var(--color-ink)' }}>{i.payer_ref}</b>
            {i.submitted_at ? ` · sent ${formatDate(i.submitted_at)}` : ''}
          </div>
        )}
      </div>
      <div className="chev">›</div>
    </Link>
  );
}

// Invoice detail -----------------------------------------------------------------------------------

const PRINT_CSS = `
@media print {
  .topbar, .tabs, .no-print { display: none !important; }
  html, body, .app-shell, .page { background: #fff !important; }
  .app-shell { max-width: none !important; padding: 0 !important; }
  .page { padding: 0 !important; }
  .invoice-sheet { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
}`;

export function InvoiceDetail() {
  const { id } = useParams();
  const invoiceId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const invoice = useInvoice(invoiceId);
  const isAdmin = useIsAdmin();

  if (invoiceId == null) return <ErrorNotice error={new Error('No such invoice.')} />;

  const inv = invoice.data;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="section-head no-print">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inv?.number ?? 'Invoice'}
          </span>
          {inv && <InvoicePill status={inv.status} />}
        </h2>
        <Link to="/admin/billing/invoices">‹ All invoices</Link>
      </div>
      {invoice.isPending && <Loading />}
      {invoice.error && <ErrorNotice error={invoice.error} />}
      {inv && (
        <>
          {isAdmin && (inv.status === 'unpaid' || inv.status === 'submitted') && (
            <PaymentPanel key={inv.id} invoice={inv} />
          )}
          <InvoiceSheet invoice={inv} />
          <div className="btn-row no-print">
            <button className="btn small secondary" onClick={() => window.print()}>
              🖨 Print / save as PDF
            </button>
          </div>
        </>
      )}
    </>
  );
}

function PaymentPanel({ invoice: inv }: { invoice: InvoiceWithItems }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [method, setMethod] = useState('upi');
  const [ref, setRef] = useState(inv.payer_ref ?? '');
  const [paidOn, setPaidOn] = useState(todayIST());
  const [error, setError] = useState('');

  const pay = useMutation({
    mutationFn: () => markPaid(inv.id, method, ref.trim().slice(0, 60) || null, paidOn || null),
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast('Marked paid. What they bought is now switched on.');
    },
    onError: (e) => setError(billError(e)),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => voidInvoice(inv.id, reason),
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast('Invoice cancelled. The vendor has been told.');
    },
    onError: (e) => setError(billError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (method === 'upi' && !ref.trim())
      return setError('Enter the UPI transaction ID you checked in your UPI app.');
    if (
      window.confirm(
        `Mark ${inv.number} as paid (${money(inv.total)})?\n\nOnly do this after you have seen the money in ` +
          'your UPI or bank app. The plan and add-ons switch on straight away.',
      )
    )
      pay.mutate();
  };

  const voidIt = () => {
    let reason = window.prompt(
      `Cancel ${inv.number}? The vendor is told and cannot pay it any more.\n\nReason (the vendor sees this):`,
      '',
    );
    while (reason !== null && !reason.trim()) {
      reason = window.prompt('A reason is required so the vendor understands.', '');
    }
    if (reason === null) return;
    cancel.mutate(reason.trim().slice(0, 300));
  };

  return (
    <form className="form-card no-print" onSubmit={submit} style={{ marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>Record payment</h3>
      {inv.status === 'submitted' ? (
        <div className="notice">
          The vendor says they paid {inv.submitted_at ? `on ${formatDate(inv.submitted_at)}` : ''}.
          <div style={{ marginTop: 4 }}>
            UPI transaction ID: <b>{inv.payer_ref}</b>
          </div>
          {inv.payer_note && (
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
              Their note: <i>{inv.payer_note}</i>
            </div>
          )}
        </div>
      ) : (
        <div className="notice">The vendor has not told us about a payment yet.</div>
      )}
      <div className="notice warn">
        <b>Check the money arrived in your UPI/bank app first.</b> Look for {money(inv.total)} with this
        transaction ID before marking the invoice paid.
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pay-method">Paid by</label>
          <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAY_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pay-on">Paid on</label>
          <input
            id="pay-on"
            type="date"
            value={paidOn}
            max={todayIST()}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pay-ref">Transaction / reference ID</label>
        <input
          id="pay-ref"
          value={ref}
          maxLength={60}
          placeholder={method === 'cash' ? 'Optional, e.g. receipt number' : 'UPI or bank reference'}
          onChange={(e) => setRef(e.target.value)}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={pay.isPending}>
          {pay.isPending ? 'Saving…' : 'Mark paid'}
        </button>
        <button
          className="btn danger"
          type="button"
          style={{ marginLeft: 'auto' }}
          disabled={cancel.isPending}
          onClick={voidIt}
        >
          Cancel invoice
        </button>
      </div>
    </form>
  );
}

const cell = { padding: '8px 4px', borderBottom: '1px solid var(--color-line)' } as const;

function InvoiceSheet({ invoice: inv }: { invoice: InvoiceWithItems }) {
  const from = inv.bill_from;
  const gst = Number(inv.gst_percent);
  return (
    <div className="form-card invoice-sheet" style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{from.name || 'IWILLFLY'}</h3>
          {from.address && <div style={{ whiteSpace: 'pre-wrap' }}>{from.address}</div>}
          {from.gstin && <div>GSTIN: {from.gstin}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{gst > 0 ? 'TAX INVOICE' : 'INVOICE'}</div>
          <div>
            <b>{inv.number}</b>
          </div>
          <div className="meta">Issued {formatDate(inv.issued_on)}</div>
          {inv.status !== 'paid' && inv.status !== 'void' && (
            <div className="meta">Due {formatDate(inv.due_on)}</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="meta">Bill to</div>
        <b>{inv.bill_to.business_name ?? `Vendor #${inv.vendor_id}`}</b>
        {inv.bill_to.phone && <div>{inv.bill_to.phone}</div>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={cell}>Item</th>
            <th style={{ ...cell, textAlign: 'right', width: 110 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.invoice_items.map((it) => (
            <tr key={it.id}>
              <td style={cell}>{it.description}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{money(it.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...cell, textAlign: 'right' }}>Subtotal</td>
            <td style={{ ...cell, textAlign: 'right' }}>{money(inv.subtotal)}</td>
          </tr>
          {gst > 0 && (
            <tr>
              <td style={{ ...cell, textAlign: 'right' }}>GST {gst}%</td>
              <td style={{ ...cell, textAlign: 'right' }}>{money(inv.tax)}</td>
            </tr>
          )}
          <tr>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 900 }}>Total</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 900 }}>{money(inv.total)}</td>
          </tr>
        </tfoot>
      </table>

      <div style={{ marginTop: 14 }}>
        {inv.status === 'paid' ? (
          <div>
            <b style={{ color: 'var(--color-green)' }}>PAID</b>
            {inv.paid_on ? ` on ${formatDate(inv.paid_on)}` : ''}
            {inv.payment_method
              ? ` by ${PAY_METHODS.find((m) => m.key === inv.payment_method)?.label ?? inv.payment_method}`
              : ''}
            {inv.payment_ref ? ` · ref ${inv.payment_ref}` : ''}
          </div>
        ) : inv.status === 'void' ? (
          <div>
            <b style={{ color: 'var(--color-red)' }}>CANCELLED</b>
            {inv.void_reason ? `: ${inv.void_reason}` : ''}
          </div>
        ) : (
          from.upi_id && (
            <div>
              Pay by UPI to <b>{from.upi_id}</b>
              {from.payee_name ? ` (${from.payee_name})` : ''}
            </div>
          )
        )}
        {from.note && (
          <div className="meta" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
            {from.note}
          </div>
        )}
      </div>
    </div>
  );
}

// Bill a vendor ------------------------------------------------------------------------------------

type Line = { key: number; addon_id: string; target: string };

export function BillVendor() {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const isAdmin = useIsAdmin();
  const vendors = useBillableVendors();
  const plans = usePlans();
  const addons = useAddons();
  const settings = useBillingSettings();
  const [vendorId, setVendorId] = useState('');
  const [planId, setPlanId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const shops = useVendorShops(vendorId ? Number(vendorId) : null);

  const plan = plans.data?.find((p) => String(p.id) === planId);
  const addonOf = (l: Line) => addons.data?.find((a) => String(a.id) === l.addon_id);
  const subtotal =
    Number(plan?.price ?? 0) + lines.reduce((sum, l) => sum + Number(addonOf(l)?.price ?? 0), 0);
  const gst = Number(settings.data?.gst_percent ?? 0);
  const tax = Math.round(subtotal * gst) / 100;

  const create = useMutation({
    mutationFn: (items: PurchaseItem[]) => createInvoice(Number(vendorId), items),
    onSuccess: (id) => {
      invalidate(...BILL_KEYS);
      toast(subtotal === 0 ? 'Done. It cost nothing, so it is already switched on.' : 'Invoice created');
      navigate(`/admin/billing/invoices/${id}`, { replace: true });
    },
    onError: (e) => setError(billError(e)),
  });

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!vendorId) return setError('Choose the vendor.');
    if (!planId && lines.length === 0) return setError('Choose a plan or add an add-on.');
    const items: PurchaseItem[] = [];
    if (planId) items.push({ plan_id: Number(planId) });
    for (const l of lines) {
      const a = addonOf(l);
      if (!a) return setError('Choose which add-on each line is.');
      const t = l.target ? Number(l.target) : null;
      if (a.kind === 'promoted_offer') {
        if (t == null) return setError(`Choose the offer for “${a.name}”.`);
        items.push({ addon_id: a.id, offer_id: t });
      } else {
        if (a.kind === 'featured_shop' && t == null) return setError(`Choose the shop for “${a.name}”.`);
        items.push({ addon_id: a.id, shop_id: t });
      }
    }
    if (items.length > 10) return setError('An invoice can have at most 10 items.');
    const vendor = vendors.data?.find((v) => String(v.id) === vendorId);
    const total = subtotal + tax;
    if (
      window.confirm(
        `Create an invoice for ${vendor?.business_name ?? 'this vendor'} for ${money(total)}?\n\n` +
          (total === 0
            ? 'It costs nothing, so it is switched on straight away.'
            : 'The vendor sees it in Plan & billing and pays to your UPI ID.'),
      )
    )
      create.mutate(items);
  };

  if (!isAdmin) return <ErrorNotice error={new Error('Only admins can bill vendors.')} />;

  const loadError = vendors.error ?? plans.error ?? addons.error;
  const shopList = shops.data ?? [];

  return (
    <>
      <div className="section-head">
        <h2>Bill a vendor</h2>
        <Link to="/admin/billing/invoices">‹ All invoices</Link>
      </div>
      <div className="notice">
        Use this for vendors who pay you outside the app or need help buying. The invoice appears in their
        Plan &amp; billing screen. Mark it paid once the money arrives.
      </div>
      {loadError && <ErrorNotice error={loadError} />}
      <form className="form-card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="bv-vendor">Vendor</label>
          <select
            id="bv-vendor"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setLines((cur) => cur.map((l) => ({ ...l, target: '' })));
            }}
          >
            <option value="">Choose a vendor…</option>
            {vendors.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.business_name}
                {v.status !== 'approved' ? ` (${v.status})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bv-plan">Plan</label>
          <select id="bv-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">No plan</option>
            {plans.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.price)} for {p.period_days} days
                {p.is_active ? '' : ' (not on sale)'}
              </option>
            ))}
          </select>
          <div className="hint">Buying the plan they are on adds the days after their current period.</div>
        </div>

        <div style={{ fontWeight: 800, fontSize: 13, margin: '4px 0 8px' }}>Add-ons</div>
        {lines.map((l) => {
          const a = addonOf(l);
          return (
            <div key={l.key} className="manage-card" style={{ marginBottom: 10 }}>
              <div className="field">
                <label htmlFor={`bv-addon-${l.key}`}>Add-on</label>
                <select
                  id={`bv-addon-${l.key}`}
                  value={l.addon_id}
                  onChange={(e) => setLine(l.key, { addon_id: e.target.value, target: '' })}
                >
                  <option value="">Choose…</option>
                  {addons.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {money(x.price)} for {x.duration_days} days
                      {x.is_active ? '' : ' (not on sale)'}
                    </option>
                  ))}
                </select>
                {a && <div className="hint">{ADDON_HELP[a.kind]}</div>}
              </div>
              {a && (
                <TargetPicker
                  id={`bv-target-${l.key}`}
                  kind={a.kind}
                  value={l.target}
                  shops={shopList}
                  loading={vendorId !== '' && shops.isPending}
                  noVendor={!vendorId}
                  onChange={(target) => setLine(l.key, { target })}
                />
              )}
              <button
                type="button"
                className="link-btn"
                style={{ color: 'var(--color-red)' }}
                onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
              >
                Remove this add-on
              </button>
            </div>
          );
        })}
        {lines.length < 9 && (
          <button
            type="button"
            className="btn small secondary"
            style={{ marginBottom: 12 }}
            onClick={() => setLines((cur) => [...cur, { key: Date.now(), addon_id: '', target: '' }])}
          >
            ＋ Add an add-on
          </button>
        )}

        <div style={{ borderTop: '1px solid var(--color-line)', paddingTop: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          {gst > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>GST {gst}%</span>
              <span>{money(tax)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900 }}>
            <span>Total</span>
            <span>{money(subtotal + tax)}</span>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="btn-row">
          <button className="btn" type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create invoice'}
          </button>
        </div>
      </form>
    </>
  );
}

function TargetPicker({
  id,
  kind,
  value,
  shops,
  loading,
  noVendor,
  onChange,
}: {
  id: string;
  kind: AddonKind;
  value: string;
  shops: { id: number; name: string; offers: { id: number; title: string; status: string }[] }[];
  loading: boolean;
  noVendor: boolean;
  onChange: (v: string) => void;
}) {
  const label =
    kind === 'promoted_offer' ? 'Offer to promote' : kind === 'featured_shop' ? 'Shop' : 'Shop (optional)';
  if (noVendor)
    return (
      <p className="meta">
        Choose the vendor first to pick their {kind === 'promoted_offer' ? 'offer' : 'shop'}.
      </p>
    );
  if (loading) return <Loading />;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{kind === 'banner_ad' ? 'No particular shop' : 'Choose…'}</option>
        {kind === 'promoted_offer'
          ? shops.map((s) =>
              s.offers.length ? (
                <optgroup key={s.id} label={s.name}>
                  {s.offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                      {o.status !== 'approved' ? ` (${o.status})` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )
          : shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
      </select>
      {kind === 'promoted_offer' && (
        <div className="hint">Only approved offers are featured; others wait until they are approved.</div>
      )}
      {kind === 'promoted_offer' && shops.every((s) => s.offers.length === 0) && (
        <p className="error-text">This vendor has no offers yet.</p>
      )}
      {kind !== 'promoted_offer' && shops.length === 0 && (
        <p className="error-text">This vendor has no shops yet.</p>
      )}
    </div>
  );
}
