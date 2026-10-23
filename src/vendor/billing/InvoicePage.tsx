import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Invoice, InvoiceItem } from '../../lib/types';
import { VENDOR_KEY } from '../api';
import { useVendorRole } from '../context';
import { errorMessage, formatDate } from '../format';
import { formatDateTime } from '../scratch/format';
import { ErrorNote, Loading, NotFound, PageHead } from '../ui';
import { useInvoice } from './api';
import { invoiceClass, invoiceLabel, money } from './format';
import { payOnline } from './pay';

const methodLabel: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank: 'Bank transfer',
  razorpay: 'Online payment',
  instamojo: 'Online payment (Instamojo)',
  free: 'No charge',
};

export default function InvoicePage() {
  const id = Number(useParams().id);
  const { isOwner } = useVendorRole();
  const { data, isPending, error } = useInvoice(id);
  if (!isOwner)
    return (
      <>
        <PageHead title="Invoice" action={<Link to="/vendor/billing">Plan & billing</Link>} />
        <div className="notice">Only the business owner can see invoices.</div>
      </>
    );
  if (isPending) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data.invoice) return <NotFound what="Invoice" back="/vendor/billing" />;
  const inv = data.invoice;
  const open = inv.status === 'unpaid' || inv.status === 'submitted';

  return (
    <>
      <div className="no-print">
        <PageHead title="Invoice" action={<Link to="/vendor/billing">Plan & billing</Link>} />
      </div>
      {open ? (
        <div className="no-print">
          <PayOnline invoice={inv} />
        </div>
      ) : (
        <PaidNotice />
      )}
      <InvoiceSheet invoice={inv} items={data.items} />
      <div className="btn-row no-print" style={{ marginTop: 12 }}>
        <button type="button" className="btn secondary" onClick={() => window.print()}>
          🖨 Print or save as PDF
        </button>
      </div>
    </>
  );
}

/** Shown once, straight after Instamojo sends the vendor back to a paid invoice. */
function PaidNotice() {
  const [params] = useSearchParams();
  if (params.get('payment') !== 'paid') return null;
  return <div className="notice no-print">Payment received, thank you! Your purchase is switched on.</div>;
}

/** The printable invoice. */
function InvoiceSheet({ invoice: i, items }: { invoice: Invoice; items: InvoiceItem[] }) {
  const from = i.bill_from;
  const to = i.bill_to;
  const cell = {
    padding: '8px 4px',
    borderBottom: '1px solid var(--color-line)',
    verticalAlign: 'top',
  } as const;
  const gst = Number(i.gst_percent);

  return (
    <div className="manage-card invoice-sheet" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <span className="meta">{gst > 0 ? 'Tax invoice' : 'Invoice'}</span>
          <h4 style={{ fontSize: 18 }}>{i.number}</h4>
          <div className="meta">
            Issued {formatDate(i.issued_on)}
            {(i.status === 'unpaid' || i.status === 'submitted') && ` · Due ${formatDate(i.due_on)}`}
          </div>
        </div>
        <span className={`pill-status ${invoiceClass[i.status]}`} style={{ flex: 'none' }}>
          {invoiceLabel[i.status]}
        </span>
      </div>

      <div className="field-row" style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div className="meta" style={{ fontWeight: 800 }}>
            From
          </div>
          <b>{from.name || 'IWILLFLY'}</b>
          {from.address && <div style={{ whiteSpace: 'pre-line' }}>{from.address}</div>}
          {from.gstin && <div>GSTIN: {from.gstin}</div>}
        </div>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div className="meta" style={{ fontWeight: 800 }}>
            Bill to
          </div>
          <b>{to.business_name}</b>
          {to.phone && <div>{to.phone}</div>}
          {to.vendor_id != null && <div className="meta">Vendor #{to.vendor_id}</div>}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 14 }}>
        <thead>
          <tr className="meta" style={{ textAlign: 'left' }}>
            <th style={cell}>Item</th>
            <th style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td style={{ ...cell, overflowWrap: 'anywhere' }}>{it.description}</td>
              <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(it.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...cell, textAlign: 'right' }}>Subtotal</td>
            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(i.subtotal)}</td>
          </tr>
          <tr>
            <td style={{ ...cell, textAlign: 'right' }}>GST {gst}%</td>
            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(i.tax)}</td>
          </tr>
          <tr>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 900, borderBottom: 0 }}>Total</td>
            <td
              style={{
                ...cell,
                textAlign: 'right',
                fontWeight: 900,
                fontSize: 16,
                borderBottom: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {money(i.total)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
        {i.status === 'paid' && (
          <div>
            Paid {i.paid_on ? formatDate(i.paid_on) : ''}
            {i.payment_method && ` by ${methodLabel[i.payment_method] ?? i.payment_method}`}
            {i.payment_ref && ` · Ref ${i.payment_ref}`}
          </div>
        )}
        {i.status === 'submitted' && (
          <div>
            Payment submitted {formatDateTime(i.submitted_at)}
            {i.payer_ref && ` · UPI ref ${i.payer_ref}`}
          </div>
        )}
        {i.status === 'void' && (
          <div className="error-text">Cancelled{i.void_reason ? `: ${i.void_reason}` : ''}</div>
        )}
        {from.note && (
          <div className="meta" style={{ marginTop: 6, whiteSpace: 'pre-line' }}>
            {from.note}
          </div>
        )}
      </div>
    </div>
  );
}

const RESULT: Record<string, { tone: string; text: string }> = {
  paid: { tone: '', text: 'Payment received, thank you! Your purchase is switched on.' },
  pending: {
    tone: 'warn',
    text: 'We are confirming your payment with Instamojo. This page updates in a minute; you will not be charged twice.',
  },
  failed: {
    tone: 'bad',
    text: 'The payment did not go through. No money was taken. You can try again below.',
  },
  mismatch: {
    tone: 'bad',
    text: 'The paid amount did not match this invoice. Please contact IWILLFLY support; nothing is lost.',
  },
  duplicate: {
    tone: 'warn',
    text: 'This invoice was already paid, so the extra payment will be refunded by the IWILLFLY team.',
  },
};

/** "Pay securely" through Instamojo; the result of a payment comes back in ?payment=. */
function PayOnline({ invoice: i }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const result = RESULT[params.get('payment') ?? ''];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Back from Instamojo before the payment was confirmed: look again a few times.
  useEffect(() => {
    if (params.get('payment') !== 'pending') return;
    const t = window.setInterval(() => qc.invalidateQueries({ queryKey: VENDOR_KEY }), 8000);
    const stop = window.setTimeout(() => window.clearInterval(t), 80_000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [params, qc]);

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      if ((await payOnline(i.id)) === 'paid') {
        await qc.invalidateQueries({ queryKey: VENDOR_KEY });
        setBusy(false);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="form-card">
      {result && <div className={`notice ${result.tone}`}>{result.text}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Pay online</h3>
        <b style={{ fontSize: 18 }}>{money(i.total)}</b>
      </div>
      <p className="meta" style={{ margin: '6px 0 12px' }}>
        UPI, card, net banking or wallet on Instamojo&apos;s secure page. Your purchase switches on as soon as
        the payment goes through.
      </p>
      {i.status === 'submitted' && (
        <div className="notice">
          You sent UPI payment details for this invoice earlier ({i.payer_ref}). The IWILLFLY team is checking
          them, so only pay online if you have not paid yet.
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn block" onClick={pay} disabled={busy}>
        {busy ? 'Opening the payment page…' : `🔒 Pay ${money(i.total)} securely`}
      </button>
    </div>
  );
}
