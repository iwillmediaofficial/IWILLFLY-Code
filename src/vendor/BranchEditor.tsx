import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AreaPicker } from '../components/AreaPicker';
import { useToast } from '../components/Toast';
import { openState } from '../lib/hours';
import { PARKING } from '../lib/parking';
import { db, must, useLocations } from '../lib/queries';
import type { Branch, BranchQuote, Hours, Shop } from '../lib/types';
import { useBranch, useMyShops, VENDOR_KEY } from './api';
import { useApproved, useBranchScope, useReadOnly, useVendor, useVendorRole } from './context';
import { money } from './billing/format';
import { formatDate } from './format';
import { errorMessage, hoursError, orNull, phoneError } from './format';
import { HolidaysEditor, HoursEditor } from './HoursEditor';
import { BranchPrizes } from './scratch/BranchPrizes';
import { BlockedNote, ErrorNote, Loading, Lockable, NotFound, PageHead } from './ui';
import { CreditCard, Link2 } from 'lucide-react';
import { Icon } from '../components/Icon';

// Leaflet is only downloaded when a branch editor opens.
const MapPin = lazy(() => import('../components/MapPin').then((m) => ({ default: m.MapPin })));

export default function BranchEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const branchId = id ? Number(id) : null;
  const branch = useBranch(branchId);
  const shops = useMyShops();

  if (shops.isPending || (branchId != null && branch.isPending)) return <Loading />;
  if (shops.error || branch.error) return <ErrorNote error={shops.error ?? branch.error} />;
  const shopId = branchId != null ? branch.data?.shop_id : Number(params.get('shop'));
  const shop = shops.data.find((s) => s.id === shopId);
  if (!shop || (branchId != null && !branch.data)) return <NotFound what="Branch" back="/vendor/shops" />;
  return <BranchForm key={branchId ?? 'new'} shop={shop} branch={branch.data ?? null} />;
}

type Form = Omit<
  Branch,
  | 'id'
  | 'shop_id'
  | 'address'
  | 'phone'
  | 'temp_closed_note'
  | 'parking_note'
  | 'slug'
  | 'review_status'
  | 'review_note'
  | 'awaiting_payment'
  | 'payment_invoice_id'
> & {
  address: string;
  phone: string;
  temp_closed_note: string;
  parking_note: string;
};

function BranchForm({ shop, branch }: { shop: Shop; branch: Branch | null }) {
  const brandReadOnly = useReadOnly();
  const vendor = useVendor();
  const approved = useApproved();
  const { branchId: myBranch, isBranchManager, isBranchMember } = useBranchScope();
  // Brand editors change every branch; a branch manager changes their own branch only.
  const ownBranch =
    isBranchManager && branch != null && branch.id === myBranch && vendor.status !== 'blocked';
  const readOnly = brandReadOnly && !ownBranch;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: locations = [] } = useLocations();
  const [f, setF] = useState<Form>({
    name: branch?.name ?? 'Main branch',
    address: branch?.address ?? '',
    location_id: branch?.location_id ?? null,
    lat: branch?.lat ?? null,
    lng: branch?.lng ?? null,
    phone: branch?.phone ?? '',
    hours: branch?.hours ?? {},
    holidays: branch?.holidays ?? [],
    temp_closed: branch?.temp_closed ?? false,
    temp_closed_note: branch?.temp_closed_note ?? '',
    parking: branch?.parking ?? null,
    parking_note: branch?.parking_note ?? '',
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const [error, setError] = useState('');
  const back = isBranchMember ? '/vendor' : `/vendor/shops/${shop.id}`;
  const area = locations.find((l) => l.id === f.location_id);
  const preview = openState(f);
  const { isOwner } = useVendorRole();
  // What one more branch costs (brand editors adding a branch).
  const quote = useQuery({
    queryKey: [...VENDOR_KEY, 'branch-quote'],
    queryFn: async () => must<BranchQuote | null>(await db().rpc('branch_price_quote')),
    enabled: !branch && !brandReadOnly,
  });
  // A waiting branch's invoice: the owner asks for a new one if it was cancelled or the branch was taken
  // off it (refused, then approved after a fix).
  const waitingInvoice = useQuery({
    queryKey: [...VENDOR_KEY, 'branch-invoice', branch?.payment_invoice_id, branch?.review_status],
    queryFn: async () => {
      const inv = must<{ status: string }>(
        await db().from('invoices').select('status').eq('id', branch!.payment_invoice_id!).single(),
      );
      const lines = must<{ id: number }[]>(
        await db()
          .from('invoice_items')
          .select('id')
          .eq('invoice_id', branch!.payment_invoice_id!)
          .eq('branch_id', branch!.id)
          .eq('branch_charge', true),
      );
      return { billed: inv.status !== 'void' && lines.length > 0 };
    },
    enabled: isOwner && Boolean(branch?.awaiting_payment) && branch?.payment_invoice_id != null,
  });
  const rebill = useMutation({
    mutationFn: async () => must<number | null>(await db().rpc('bill_waiting_branches')),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      if (inv != null) navigate(`/vendor/billing/invoices/${inv}`);
      else toast('Done. Nothing is left to pay for this branch.');
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        ...f,
        name: f.name.trim(),
        address: orNull(f.address),
        phone: orNull(f.phone),
        temp_closed_note: f.temp_closed ? orNull(f.temp_closed_note) : null,
        parking_note: f.parking ? orNull(f.parking_note) : null,
      };
      if (branch) {
        must(await db().from('branches').update(row).eq('id', branch.id));
        return null;
      }
      const added = must<{ id: number }>(
        await db()
          .from('branches')
          .insert({ ...row, shop_id: shop.id })
          .select('id')
          .single(),
      );
      // The database charges a branch over the plan's included ones right after it is added.
      return must<Pick<Branch, 'awaiting_payment' | 'payment_invoice_id'>>(
        await db()
          .from('branches')
          .select('awaiting_payment, payment_invoice_id')
          .eq('id', added.id)
          .single(),
      );
    },
    onSuccess: (added) => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      if (added?.awaiting_payment && added.payment_invoice_id != null) {
        // Paid once the IWILLFLY team approves it (the branch page then shows "Pay the invoice").
        toast('Branch added. Once the IWILLFLY team approves it, pay its invoice to make it live.');
        navigate(back);
        return;
      }
      toast(
        added?.awaiting_payment
          ? 'Branch added. It goes live with your plan renewal payment.'
          : branch
            ? 'Branch saved'
            : 'Branch added',
      );
      navigate(back);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => must(await db().from('branches').delete().eq('id', branch!.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast('Branch deleted');
      navigate(back, { replace: true });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = f.name.trim();
    const problem =
      (n.length < 1 || n.length > 80 ? 'Branch name should be 1 to 80 characters.' : null) ??
      (f.address.trim().length > 300 ? 'Address is too long (300 characters max).' : null) ??
      phoneError(f.phone) ??
      hoursError(f.hours) ??
      (f.temp_closed_note.trim().length > 200 ? 'Closure note is too long (200 characters max).' : null) ??
      (f.parking_note.trim().length > 100 ? 'Parking note is too long (100 characters max).' : null);
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <>
      <PageHead
        title={branch ? (ownBranch ? 'My branch' : 'Edit branch') : 'New branch'}
        action={<Link to={back}>‹ {isBranchMember ? 'Dashboard' : shop.name}</Link>}
      />
      {readOnly &&
        (isBranchMember && vendor.status !== 'blocked' ? (
          <div className="notice">
            You can look at this branch. Only its branch manager or the owner can change it.
          </div>
        ) : (
          <BlockedNote />
        ))}
      {!branch && approved && (
        <div className="notice">
          New branches are checked by the IWILLFLY team before customers can see them.
        </div>
      )}
      {!branch && quote.data && (
        <div className="notice warn">
          {quote.data.no_plan ? (
            <>
              Your {quote.data.plan} plan is not running. This branch goes live once you renew the plan from
              Plan &amp; billing ({money(quote.data.price)} every {quote.data.period_days} days for each extra
              branch) and the IWILLFLY team approves it.
            </>
          ) : quote.data.deferred ? (
            <>
              Your {quote.data.plan} plan renews on {formatDate(quote.data.renews_on)}. This branch is added
              to that renewal invoice ({money(quote.data.price)} every {quote.data.period_days} days) and goes
              live when it is paid.
            </>
          ) : (
            <>
              This branch costs <b>{money(quote.data.amount)}</b> now for the {quote.data.days_left} days left
              in your {quote.data.plan} plan, then {money(quote.data.price)} every {quote.data.period_days}{' '}
              days with your plan. It goes live once the invoice is paid and the IWILLFLY team approves it.
            </>
          )}
        </div>
      )}
      {branch?.awaiting_payment && (
        <div className="notice warn">
          <b>Waiting for payment.</b> Customers will see this branch once{' '}
          {branch.payment_invoice_id == null ? 'your plan renewal invoice' : 'its invoice'} is paid.{' '}
          {branch.review_status !== 'approved' ? (
            // Paid only once approved, so nothing is paid for a branch that is refused.
            branch.review_status === 'pending' ? (
              'You can pay once the IWILLFLY team approves it.'
            ) : (
              'Fix the branch first; you can pay once it is approved.'
            )
          ) : isOwner ? (
            waitingInvoice.data?.billed === false ? (
              <>
                Its invoice was cancelled.
                <div>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 10 }}
                    disabled={rebill.isPending}
                    onClick={() => rebill.mutate()}
                  >
                    {rebill.isPending ? 'Making the invoice…' : 'Get a new invoice'}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <Link
                  className="btn"
                  style={{ display: 'inline-block', marginTop: 10 }}
                  to={
                    branch.payment_invoice_id != null
                      ? `/vendor/billing/invoices/${branch.payment_invoice_id}`
                      : '/vendor/billing'
                  }
                >
                  {branch.payment_invoice_id != null ? (
                    <>
                      <Icon icon={CreditCard} /> Pay the invoice
                    </>
                  ) : (
                    'Go to billing'
                  )}
                </Link>
              </div>
            )
          ) : (
            'The business owner pays for branches.'
          )}
        </div>
      )}
      {branch?.review_status === 'pending' && (
        <div className="notice warn">
          Waiting for the IWILLFLY team to check this branch. Customers will see it once it is approved.
        </div>
      )}
      {branch?.review_status === 'rejected' && (
        <div className="notice bad">
          <b>Not approved.</b> {branch.review_note ?? 'No reason given.'} Fix the details and save to send it
          again.
        </div>
      )}
      {branch?.review_status === 'approved' && (
        <p className="meta" style={{ marginTop: 0 }}>
          <Icon icon={Link2} /> {window.location.host}/shop/{shop.slug}/{branch.slug}
        </p>
      )}
      <form className="form-card" onSubmit={submit} noValidate>
        <Lockable locked={readOnly}>
          <div className="field">
            <label htmlFor="b-name">Branch name *</label>
            <input id="b-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="b-addr">Address</label>
            <textarea
              id="b-addr"
              value={f.address}
              onChange={(e) => set('address', e.target.value)}
              maxLength={300}
              style={{ minHeight: 60 }}
              placeholder="Building, street, landmark"
            />
          </div>
          <AreaPicker value={f.location_id} onChange={(a) => set('location_id', a?.id ?? null)} />
          <div className="field">
            <label>Map pin</label>
            <Suspense fallback={<div className="map-box" />}>
              <MapPin
                lat={f.lat}
                lng={f.lng}
                fallback={area}
                onChange={(p) => setF((cur) => ({ ...cur, lat: p.lat, lng: p.lng }))}
              />
            </Suspense>
            <div className="hint">Tap the map or drag the pin to the shop's entrance.</div>
          </div>
          <div className="field">
            <label htmlFor="b-parking">Parking</label>
            <select
              id="b-parking"
              value={f.parking ?? ''}
              onChange={(e) => set('parking', (e.target.value || null) as Form['parking'])}
            >
              <option value="">Not set</option>
              {PARKING.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {f.parking && (
            <div className="field">
              <label htmlFor="b-parking-note">Parking note</label>
              <input
                id="b-parking-note"
                value={f.parking_note}
                onChange={(e) => set('parking_note', e.target.value)}
                maxLength={100}
                placeholder="e.g. Basement, ₹20 per hour"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="b-phone">Branch phone</label>
            <input id="b-phone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <HoursEditor value={f.hours} onChange={(h: Hours) => set('hours', h)} />
          <HolidaysEditor value={f.holidays} onChange={(d) => set('holidays', d)} />
          <label className="check-row">
            <input
              type="checkbox"
              checked={f.temp_closed}
              onChange={(e) => set('temp_closed', e.target.checked)}
            />
            Temporarily closed
          </label>
          {f.temp_closed && (
            <div className="field">
              <label htmlFor="b-note">Note for customers</label>
              <input
                id="b-note"
                value={f.temp_closed_note}
                onChange={(e) => set('temp_closed_note', e.target.value)}
                maxLength={200}
                placeholder="e.g. Closed for renovation until 20 Oct"
              />
            </div>
          )}
          <div className="status-card" style={{ marginBottom: 12 }}>
            <div className={`status ${preview.open ? 'open' : 'closed'}`}>
              <span className="light" />
              <b>{preview.label}</b>
              <span className="meta">· Today: {preview.today}</span>
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              Preview of what customers see right now (India time).
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="btn-row">
            <button className="btn" type="submit" disabled={save.isPending} style={{ flex: 1 }}>
              {save.isPending ? 'Saving…' : branch ? 'Save branch' : 'Add branch'}
            </button>
            {branch && !brandReadOnly && (
              <button
                className="btn danger"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Delete the branch "${branch.name}"?`)) remove.mutate();
                }}
              >
                Delete
              </button>
            )}
          </div>
        </Lockable>
      </form>
      {branch && <BranchPrizes branch={branch} />}
    </>
  );
}
