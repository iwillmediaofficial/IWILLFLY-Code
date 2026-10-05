import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import type { BillingSettings, Invoice, InvoiceItem } from '../../lib/types';
import { useVendorRole } from '../context';
import { errorMessage, formatDate, orNull } from '../format';
import { formatDateTime } from '../scratch/format';
import { ErrorNote, Loading, NotFound, PageHead } from '../ui';
import { useBillingSettings, useInvoice, useSubmitPayment } from './api';
import { invoiceClass, invoiceLabel, money, upiLink } from './format';

const methodLabel: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank: 'Bank transfer',
  razorpay: 'Online payment',
  free: 'No charge',
};

export default function InvoicePage() {
  const id = Number(useParams().id);
  const { isOwner } = useVendorRole();
  const { data, isPending, error } = useInvoice(id);
  const settings = useBillingSettings();
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
      {open && (
        <div className="no-print">
          {settings.isPending ? (
            <Loading />
          ) : settings.error ? (
            <ErrorNote error={settings.error} />
          ) : (
            <PayByUpi invoice={inv} settings={settings.data} />
          )}
        </div>
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

/** UPI QR, app link, UPI ID and the "I have paid" form. */
function PayByUpi({ invoice: i, settings }: { invoice: Invoice; settings: BillingSettings | null }) {
  const toast = useToast();
  const upiId = settings?.upi_id;
  if (!upiId) {
    return (
      <div className="notice warn">
        <b>Online payment details are not set up yet.</b> Please{' '}
        <Link to="/vendor/help/new" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
          contact IWILLFLY support
        </Link>{' '}
        to pay invoice {i.number}.
      </div>
    );
  }
  const payee = settings.payee_name || settings.business_name || 'IWILLFLY';
  const link = upiLink({ upiId, payee, amount: i.total, note: i.number });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(upiId);
      toast('UPI ID copied');
    } catch {
      toast('Could not copy. Please select and copy it.');
    }
  };

  return (
    <div className="form-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Pay by UPI</h3>
        <b style={{ fontSize: 18 }}>{money(i.total)}</b>
      </div>
      {i.status === 'submitted' ? (
        <div className="notice" style={{ marginTop: 10 }}>
          <b>Thanks, we got your payment details.</b> IWILLFLY checks the payment and switches on your
          purchase, usually within a working day. Entered the wrong transaction ID? Send the right one below.
        </div>
      ) : (
        <p className="meta" style={{ margin: '6px 0 0' }}>
          Scan with any UPI app (Google Pay, PhonePe, Paytm, BHIM) or tap the button on your phone. Then enter
          the transaction ID below.
        </p>
      )}
      <UpiQr link={link} />
      <a className="btn block" href={link} style={{ display: 'block', textAlign: 'center' }}>
        Open UPI app
      </a>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="upi-id">UPI ID ({payee})</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="upi-id" value={upiId} readOnly onFocus={(e) => e.target.select()} />
          <button type="button" className="btn secondary small" onClick={copy} style={{ flex: 'none' }}>
            Copy
          </button>
        </div>
        <div className="hint">
          Pay exactly {money(i.total)} and add {i.number} as the note.
        </div>
      </div>
      <SubmitPaymentForm invoice={i} />
    </div>
  );
}

function UpiQr({ link }: { link: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import('qrcode')
      .then((mod) => {
        const qr = (mod as unknown as { default?: typeof mod }).default ?? mod;
        return qr.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: 'M' });
      })
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [link]);
  if (failed) return null;
  const box = { width: 220, height: 220, margin: '12px auto', display: 'block', borderRadius: 12 } as const;
  return src ? (
    <img src={src} alt="UPI payment QR code" width={220} height={220} decoding="async" style={box} />
  ) : (
    <div style={{ ...box, display: 'grid', placeItems: 'center', background: 'var(--color-bg)' }}>
      <span className="meta">Loading QR…</span>
    </div>
  );
}

function SubmitPaymentForm({ invoice: i }: { invoice: Invoice }) {
  const toast = useToast();
  const submitPayment = useSubmitPayment(i.id);
  const [ref, setRef] = useState(i.payer_ref ?? '');
  const [note, setNote] = useState(i.payer_note ?? '');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = ref.trim();
    const problem =
      (!r ? 'Enter the UPI transaction ID from your payment app.' : null) ??
      (r.length > 60 ? 'Transaction ID is too long (60 characters max).' : null) ??
      (note.trim().length > 300 ? 'Note is too long (300 characters max).' : null);
    setError(problem ?? '');
    if (problem) return;
    submitPayment.mutate(
      { ref: r, note: orNull(note) },
      {
        onSuccess: () => toast('Thanks! We will confirm your payment soon.'),
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate style={{ borderTop: '1px solid var(--color-line)', paddingTop: 12 }}>
      <div className="field">
        <label htmlFor="pay-ref">UPI transaction ID *</label>
        <input
          id="pay-ref"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          maxLength={60}
          placeholder="12-digit UTR / transaction ID"
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="pay-note">Note</label>
        <input
          id="pay-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder="Optional, e.g. paid from my partner's account"
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button className="btn block" type="submit" disabled={submitPayment.isPending} style={{ marginTop: 4 }}>
        {submitPayment.isPending
          ? 'Sending…'
          : i.status === 'submitted'
            ? 'Update payment details'
            : 'I have paid'}
      </button>
    </form>
  );
}
