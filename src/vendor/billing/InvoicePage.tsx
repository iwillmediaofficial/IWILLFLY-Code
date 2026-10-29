import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { UploadProgressBar } from '../../components/UploadProgressBar';
import { checkPickedSize, type UploadProgress } from '../../lib/upload';
import type { BillingSettings, Invoice, InvoiceItem } from '../../lib/types';
import { VENDOR_KEY } from '../api';
import { useVendor, useVendorRole } from '../context';
import { errorMessage, formatDate, orNull } from '../format';
import { formatDateTime } from '../scratch/format';
import { ErrorNote, Loading, NotFound, PageHead } from '../ui';
import { useBillingSettings, useInvoice, useSubmitPayment } from './api';
import { CHECK_TIME, invoiceClass, invoiceLabel, money, upiLink } from './format';
import { payOnline, type Gateway } from './pay';
import { CircleCheck, Hourglass, Lock, Printer } from 'lucide-react';
import { Icon } from '../../components/Icon';

const methodLabel: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  bank: 'Bank transfer',
  razorpay: 'Online payment (Razorpay)',
  instamojo: 'Online payment (Instamojo)',
  free: 'No charge',
};

export default function InvoicePage() {
  const id = Number(useParams().id);
  const { isOwner, role } = useVendorRole();
  // Branch managers see and pay the Top Picks invoices they made themselves (RLS shows them no others).
  const back = isOwner ? '/vendor/billing' : '/vendor/top-picks';
  const backLabel = isOwner ? 'Plan & billing' : 'Top Picks';
  const { data, isPending, error } = useInvoice(id);
  const settings = useBillingSettings();
  // "Sent the wrong details?" opens the ways to pay again while a payment is being checked. It is tied to
  // the details sent, so sending fresh ones goes back to the pending card.
  const sentAt = data?.invoice?.submitted_at ?? '';
  const [changingAt, setChangingAt] = useState<string | null>(null);
  const changing = changingAt === sentAt;
  if (role === 'staff')
    return (
      <>
        <PageHead title="Invoice" action={<Link to="/vendor/billing">Plan & billing</Link>} />
        <div className="notice">Only the business owner can see invoices.</div>
      </>
    );
  if (isPending) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data.invoice) return <NotFound what="Invoice" back={back} />;
  const inv = data.invoice;
  const open = inv.status === 'unpaid' || (inv.status === 'submitted' && changing);

  return (
    <>
      <div className="no-print">
        <PageHead title="Invoice" action={<Link to={back}>{backLabel}</Link>} />
      </div>
      {inv.status === 'submitted' && (
        <PendingCard
          invoice={inv}
          changing={changing}
          onChange={() => setChangingAt(changing ? null : sentAt)}
        />
      )}
      {open ? (
        <div className="no-print">
          {/* The methods an admin switched on in Admin > Billing settings. */}
          {settings.isPending ? (
            <Loading />
          ) : settings.error ? (
            <ErrorNote error={settings.error} />
          ) : (
            <PayOptions invoice={inv} settings={settings.data} />
          )}
        </div>
      ) : (
        inv.status === 'paid' && <PaidNotice />
      )}
      <InvoiceSheet invoice={inv} items={data.items} />
      <div className="btn-row no-print" style={{ marginTop: 12 }}>
        <button type="button" className="btn secondary" onClick={() => window.print()}>
          <Icon icon={Printer} /> Print or save as PDF
        </button>
      </div>
    </>
  );
}

function PayOptions({ invoice: i, settings }: { invoice: Invoice; settings: BillingSettings | null }) {
  // Razorpay first: it is the main gateway when both are on.
  const gateways: Gateway[] = [];
  if (settings?.pay_razorpay === true) gateways.push('razorpay');
  if (settings?.pay_instamojo !== false) gateways.push('instamojo');
  const online = gateways.length > 0;
  const upi = settings?.pay_upi !== false;
  if (!online && !upi) {
    return (
      <div className="notice warn">
        <b>Online payment is not available right now.</b> Please{' '}
        <Link to="/vendor/help/new" style={{ color: 'var(--color-blue)', fontWeight: 800 }}>
          contact IWILLFLY support
        </Link>{' '}
        to pay invoice {i.number}.
      </div>
    );
  }
  return (
    <>
      {online && <PayOnline invoice={i} gateways={gateways} />}
      {/* Direct UPI to the admin's UPI ID; an admin checks the payment and marks the invoice paid. */}
      {upi && (
        <div style={online ? { marginTop: 12 } : undefined}>
          <PayByUpi invoice={i} settings={settings} first={!online} />
        </div>
      )}
    </>
  );
}

/** A UPI payment the vendor sent, waiting for the IWILLFLY team to check it. */
function PendingCard({
  invoice: i,
  changing,
  onChange,
}: {
  invoice: Invoice;
  changing: boolean;
  onChange: () => void;
}) {
  const applying = useVendor().status === 'pending';
  return (
    <div className="form-card pay-status no-print">
      <div className="pay-status-icon" aria-hidden>
        <Icon icon={Hourglass} />
      </div>
      <h3>Payment verification pending</h3>
      <p>
        We are checking your payment of <b>{money(i.total)}</b> for invoice {i.number}. It will take{' '}
        <b>{CHECK_TIME}</b>.
      </p>
      <p className="meta">
        {i.payer_ref ? `UPI ref ${i.payer_ref}` : 'Screenshot sent'}
        {i.payer_ref && i.payer_proof_key && ' · screenshot sent'}
        {i.submitted_at && ` · sent ${formatDateTime(i.submitted_at)}`}
      </p>
      <p className="meta">
        {applying
          ? 'We will notify you once your payment is confirmed and your shop is approved.'
          : 'We will notify you and switch on your purchase once your payment is confirmed.'}
      </p>
      <Link className="btn block" to="/vendor" style={{ display: 'block', textAlign: 'center' }}>
        Go to dashboard
      </Link>
      <button type="button" className="link-btn" onClick={onChange} style={{ marginTop: 10 }}>
        {changing ? 'Hide payment options' : 'Sent the wrong details? Update them'}
      </button>
    </div>
  );
}

/** A paid invoice: shown straight after the payment gateway sends the vendor back, and to applicants waiting for approval. */
function PaidNotice() {
  const [params] = useSearchParams();
  const applying = useVendor().status === 'pending';
  if (applying) {
    return (
      <div className="form-card pay-status no-print">
        <div className="pay-status-icon" aria-hidden style={{ color: 'var(--color-green)' }}>
          <Icon icon={CircleCheck} />
        </div>
        <h3>Payment received</h3>
        <p>
          Thank you! Your application is being reviewed, <b>{CHECK_TIME}</b>. We will notify you once your
          shop is approved.
        </p>
        <Link className="btn block" to="/vendor" style={{ display: 'block', textAlign: 'center' }}>
          Go to dashboard
        </Link>
      </div>
    );
  }
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
            {i.payer_proof_key && ' · screenshot sent'}
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
    text: 'We are confirming your payment with the payment gateway. This page updates in a minute; you will not be charged twice.',
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

const GATEWAY_NAME: Record<Gateway, string> = { razorpay: 'Razorpay', instamojo: 'Instamojo' };

/** "Pay securely" through Razorpay and/or Instamojo; the result of a payment comes back in ?payment=. */
function PayOnline({ invoice: i, gateways }: { invoice: Invoice; gateways: Gateway[] }) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const result = RESULT[params.get('payment') ?? ''];
  const [busy, setBusy] = useState<Gateway | null>(null);
  const [error, setError] = useState('');

  // Back from the gateway before the payment was confirmed: look again a few times.
  useEffect(() => {
    if (params.get('payment') !== 'pending') return;
    const t = window.setInterval(() => qc.invalidateQueries({ queryKey: VENDOR_KEY }), 8000);
    const stop = window.setTimeout(() => window.clearInterval(t), 80_000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [params, qc]);

  const pay = async (gateway: Gateway) => {
    setBusy(gateway);
    setError('');
    try {
      if ((await payOnline(i.id, gateway)) === 'paid') {
        await qc.invalidateQueries({ queryKey: VENDOR_KEY });
        setBusy(null);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  const several = gateways.length > 1;

  return (
    <div className="form-card">
      {result && <div className={`notice ${result.tone}`}>{result.text}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Pay online</h3>
        <b style={{ fontSize: 18 }}>{money(i.total)}</b>
      </div>
      <p className="meta" style={{ margin: '6px 0 12px' }}>
        UPI, card, net banking or wallet on {several ? 'a' : `${GATEWAY_NAME[gateways[0]]}'s`} secure page.
        Your purchase switches on as soon as the payment goes through.
      </p>
      {i.status === 'submitted' && (
        <div className="notice">
          You sent UPI payment details for this invoice earlier
          {i.payer_ref ? ` (${i.payer_ref})` : ' (screenshot)'}. The IWILLFLY team is checking them, so only
          pay online if you have not paid yet.
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {gateways.map((g, n) => (
        <button
          key={g}
          type="button"
          className={`btn block${n > 0 ? ' secondary' : ''}`}
          style={n > 0 ? { marginTop: 8 } : undefined}
          onClick={() => pay(g)}
          disabled={busy !== null}
        >
          {busy === g ? (
            'Opening the payment page…'
          ) : several ? (
            <>
              <Icon icon={Lock} /> Pay {money(i.total)} with {GATEWAY_NAME[g]}
            </>
          ) : (
            <>
              <Icon icon={Lock} /> Pay {money(i.total)} securely
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/** UPI QR, app link, UPI ID and the "I have paid" form. */
function PayByUpi({
  invoice: i,
  settings,
  first,
}: {
  invoice: Invoice;
  settings: BillingSettings | null;
  first?: boolean;
}) {
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
        <h3 style={{ margin: 0, fontSize: 16 }}>
          {first ? 'Pay by UPI' : 'Or pay by UPI'} (Google Pay, PhonePe, Paytm)
        </h3>
        <b style={{ fontSize: 18 }}>{money(i.total)}</b>
      </div>
      {i.status === 'submitted' ? (
        <div className="notice" style={{ marginTop: 10 }}>
          <b>Thanks, we got your payment details.</b> IWILLFLY checks the payment and switches on your
          purchase, {CHECK_TIME}. Sent the wrong details? Send them again below.
        </div>
      ) : (
        <p className="meta" style={{ margin: '6px 0 0' }}>
          Scan with any UPI app (Google Pay, PhonePe, Paytm, BHIM) or tap the button on your phone. Then send
          the transaction ID or a screenshot below.
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

/** After paying by UPI: the transaction ID, a screenshot of the payment, or both (at least one). */
function SubmitPaymentForm({ invoice: i }: { invoice: Invoice }) {
  const toast = useToast();
  const submitPayment = useSubmitPayment(i.id);
  const [ref, setRef] = useState(i.payer_ref ?? '');
  const [note, setNote] = useState(i.payer_note ?? '');
  const [shot, setShot] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const hadShot = Boolean(i.payer_proof_key);

  const pick = (file: File | undefined) => {
    setError('');
    if (!file) return setShot(null);
    try {
      checkPickedSize(file);
      setShot(file);
    } catch (e) {
      setShot(null);
      setError(errorMessage(e));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = ref.trim();
    const problem =
      (!r && !shot && !hadShot ? 'Enter the UPI transaction ID or add a screenshot of the payment.' : null) ??
      (r.length > 60 ? 'Transaction ID is too long (60 characters max).' : null) ??
      (note.trim().length > 300 ? 'Note is too long (300 characters max).' : null);
    setError(problem ?? '');
    if (problem) return;
    submitPayment.mutate(
      {
        ref: orNull(r),
        note: orNull(note),
        screenshot: shot,
        keepProof: i.payer_proof_key,
        onProgress: setProgress,
      },
      {
        onSuccess: () => {
          setShot(null);
          toast('Payment details sent');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        onError: (err) => setError(errorMessage(err)),
        onSettled: () => setProgress(null),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate style={{ borderTop: '1px solid var(--color-line)', paddingTop: 12 }}>
      <p className="meta" style={{ margin: '0 0 8px' }}>
        After paying, send the transaction ID <b>or</b> a screenshot of the payment (or both).
      </p>
      <div className="field">
        <label htmlFor="pay-ref">UPI transaction ID</label>
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
        <label htmlFor="pay-shot">Screenshot of the payment</label>
        <input id="pay-shot" type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
        <div className="hint">
          {shot
            ? `Added: ${shot.name}`
            : hadShot
              ? 'You sent a screenshot earlier. Pick a new one only to replace it.'
              : 'The screen in Google Pay or your UPI app that shows the payment went through.'}
        </div>
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
      {progress && <UploadProgressBar progress={progress} />}
      {error && <p className="error-text">{error}</p>}
      <button className="btn block" type="submit" disabled={submitPayment.isPending} style={{ marginTop: 4 }}>
        {submitPayment.isPending
          ? 'Sending…'
          : i.status === 'submitted'
            ? 'Update payment details'
            : 'I have paid, send for approval'}
      </button>
    </form>
  );
}
