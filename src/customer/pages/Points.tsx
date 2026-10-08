import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell, BackHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ShopCard';
import { useToast } from '../../components/Toast';
import {
  REJECT_REASONS,
  addDays,
  isPhoto,
  pointsText,
  rupees,
  todayIndia,
  useMyBills,
  usePointsHistory,
  usePointsShop,
  usePointsShops,
  usePointsWallet,
  useSubmitBill,
} from '../../lib/points';
import { db, must } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import type { MyBill, PointsEntry, PointsWallet } from '../../lib/types';
import { formatDay } from '../scratch';
import { PointsTerms, Redeem } from './PointsRedeem';
import { ErrorNotice, Loading, NoBackend, Thumb } from '../ui';
import { errorText, formatDate } from '../util';

export default function Points() {
  const { session, loading } = useAuth();
  return (
    <AppShell header={<BackHeader back="/profile" title="My Points" subtitle="Earn on every bill" />}>
      {!supabase ? (
        <NoBackend />
      ) : loading ? (
        <Loading />
      ) : !session ? (
        <EmptyState
          emoji="💰"
          title="Sign in to earn points"
          text="Add your bills from shops on IWILLFLY and earn 1 point for every ₹50. Each point is worth ₹1."
        >
          <Link className="btn" to="/login" style={{ display: 'inline-block', marginTop: 12 }}>
            Sign in
          </Link>
        </EmptyState>
      ) : (
        <Routes>
          <Route index element={<Wallet />} />
          <Route path="add" element={<AddBill />} />
          <Route path="bills" element={<MyBills />} />
          <Route path="history" element={<History />} />
          <Route path="redeem" element={<Redeem />} />
          <Route path="terms" element={<PointsTerms />} />
          <Route path="*" element={<Navigate to="/points" replace />} />
        </Routes>
      )}
    </AppShell>
  );
}

export function SubNav() {
  return (
    <nav className="tabs" aria-label="Points">
      <NavLink to="/points" end>
        Wallet
      </NavLink>
      <NavLink to="/points/bills">My bills</NavLink>
      <NavLink to="/points/redeem">Cash out</NavLink>
      <NavLink to="/points/history">History</NavLink>
    </nav>
  );
}

// Wallet -------------------------------------------------------------------------------------------

function Wallet() {
  const wallet = usePointsWallet();
  return (
    <>
      <SubNav />
      {wallet.isPending && <Loading text="Loading your points…" />}
      {wallet.error && <ErrorNotice error={wallet.error} onRetry={() => wallet.refetch()} />}
      {wallet.data && <WalletView w={wallet.data} />}
    </>
  );
}

function WalletView({ w }: { w: PointsWallet }) {
  const goal = w.min_redeem_points;
  const reached = w.balance >= goal;
  // how much can be cashed out: whole steps once the minimum is reached
  const cashable = reached ? Math.floor(w.balance / w.redeem_step_points) * w.redeem_step_points : 0;
  const toGo = Math.max(goal - w.balance, 0);
  const pct = Math.min(100, Math.round((w.balance / goal) * 100));
  return (
    <>
      <section className="hero">
        <p>Your points</p>
        <div className="points-balance">{w.balance.toLocaleString('en-IN')}</div>
        <p>
          {pointsText(w.balance)} = <b style={{ color: '#fff' }}>{rupees(w.value)}</b>
        </p>
        <div
          className="points-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(w.balance, goal)}
          aria-label={`Progress to ${pointsText(goal)}`}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <p>
          {reached
            ? `You can cash out ${pointsText(cashable)} (${rupees(cashable * w.point_value)}) of ${w.balance.toLocaleString('en-IN')}.`
            : `${w.balance.toLocaleString('en-IN')} / ${goal.toLocaleString('en-IN')}: add ${rupees(toGo * w.rupees_per_point)} more in bills to unlock ${rupees(goal * w.point_value)}.`}
        </p>
        {reached ? (
          <Link className="hero-pill" to="/points/redeem">
            Cash out {rupees(cashable * w.point_value)} to UPI ›
          </Link>
        ) : (
          <Link className="hero-pill" to="/points/add">
            ＋ Add a bill
          </Link>
        )}
      </section>

      <section className="section">
        <div className="info-grid">
          <Link className="info-card" to="/points/bills">
            <strong>{w.pending_bills}</strong>
            <span>
              {w.pending_bills
                ? `${w.pending_bills === 1 ? 'Bill' : 'Bills'} waiting, about ${pointsText(w.pending_points)} ›`
                : 'Bills waiting for checking ›'}
            </span>
          </Link>
          <Link className="info-card" to="/points/history">
            <strong style={w.next_expiry ? { color: 'var(--color-orange)' } : undefined}>
              {w.next_expiry ? w.next_expiry.points.toLocaleString('en-IN') : '–'}
            </strong>
            <span>
              {w.next_expiry
                ? `Expiring on ${formatDay(w.next_expiry.expires_at)} ›`
                : 'Nothing expiring soon ›'}
            </span>
          </Link>
        </div>
      </section>

      <section className="section">
        <Link className="btn block" to="/points/add" style={{ display: 'block', textAlign: 'center' }}>
          ＋ Add a bill
        </Link>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>How it works</h2>
        </div>
        <div className="notice">
          <b>1.</b> Shop at any shop listed on IWILLFLY and keep the bill.
          <br />
          <b>2.</b> Add the bill here within {w.bill_age_days} days: shop, bill number, date, amount and a
          photo.
          <br />
          <b>3.</b> Once we check it, you get 1 point for every full {rupees(w.rupees_per_point)} (a{' '}
          {rupees(w.rupees_per_point * 5 + 25)} bill = 5 points). Each point is worth {rupees(w.point_value)}.
          <br />
          <b>4.</b> At {pointsText(goal)} you can cash out to UPI in steps of{' '}
          {w.redeem_step_points.toLocaleString('en-IN')}. Points stay valid for {w.validity_months} months.
        </div>
        <div className="meta">
          Bills under {rupees(w.rupees_per_point)} do not earn points. Each bill can be added only once.
          {w.lifetime_points > 0 && ` You have earned ${pointsText(w.lifetime_points)} so far.`}{' '}
          <Link to="/points/terms" style={{ color: 'var(--color-blue)', fontWeight: 700 }}>
            Points Terms
          </Link>
        </div>
      </section>
    </>
  );
}

// Add bill -----------------------------------------------------------------------------------------

interface FixBill {
  id: number;
  shop_id: number;
  bill_number: string;
  bill_date: string;
  amount: number;
  photo_key: string;
  reject_reason: string | null;
  admin_note: string | null;
  created_at: string;
  shops: { name: string } | { name: string }[] | null;
}

function AddBill() {
  const [params] = useSearchParams();
  const fixId = Number(params.get('fix')) || null;
  const shopParam = Number(params.get('shop')) || null;
  const wallet = usePointsWallet();
  const fix = useQuery({
    queryKey: ['fix_bill', fixId],
    queryFn: async () =>
      must<FixBill[]>(
        await db()
          .from('bill_submissions')
          .select(
            'id, shop_id, bill_number, bill_date, amount, photo_key, reject_reason, admin_note, created_at, shops(name)',
          )
          .eq('id', fixId!)
          .limit(1),
      )[0] ?? null,
    enabled: Boolean(fixId),
  });
  const bills = useMyBills();
  if (wallet.isPending || (fixId && (fix.isPending || bills.isPending))) return <Loading />;
  if (wallet.error) return <ErrorNotice error={wallet.error} onRetry={() => wallet.refetch()} />;
  if (fix.error) return <ErrorNotice error={fix.error} />;
  const fixable = fix.data && bills.data?.find((b) => b.id === fix.data!.id)?.can_resubmit;
  return (
    <>
      <div className="section-head">
        <h2>{fixId ? 'Fix and send again' : 'Add a bill'}</h2>
        <Link to="/points">‹ Wallet</Link>
      </div>
      {fixId && !fixable ? (
        <div className="notice warn">
          This bill can no longer be sent again. A rejected bill can be fixed once, within{' '}
          {wallet.data.bill_age_days} days. <Link to="/points/add">Add a new bill</Link> instead.
        </div>
      ) : (
        <BillForm
          key={fix.data?.id ?? 'new'}
          wallet={wallet.data}
          fix={fix.data ?? null}
          shopId={fix.data?.shop_id ?? shopParam}
        />
      )}
    </>
  );
}

function BillForm({
  wallet: w,
  fix,
  shopId,
}: {
  wallet: PointsWallet;
  fix: FixBill | null;
  shopId: number | null;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const submit = useSubmitBill();
  const today = todayIndia();
  // a fixed bill keeps the age limit of when it was first added
  const firstAdded = fix
    ? new Date(new Date(fix.created_at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)
    : today;
  const oldest = addDays(firstAdded, -w.bill_age_days);

  // undefined = not picked yet, so the shop the page was opened from (if any) is used
  const [picked, setShop] = useState<{ id: number; name: string } | null | undefined>(
    fix
      ? { id: fix.shop_id, name: (Array.isArray(fix.shops) ? fix.shops[0] : fix.shops)?.name ?? 'Shop' }
      : undefined,
  );
  const preset = usePointsShop(fix ? null : shopId);
  const shop =
    picked !== undefined ? picked : preset.data ? { id: preset.data.id, name: preset.data.name } : null;

  const [billNumber, setBillNumber] = useState(fix?.bill_number ?? '');
  const [billDate, setBillDate] = useState(fix?.bill_date ?? today);
  const [amount, setAmount] = useState(fix ? String(fix.amount) : '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(fix?.reject_reason === 'amount_mismatch');
  const [error, setError] = useState('');
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const amt = Number(amount);
  const amountOk = amount.trim() !== '' && Number.isFinite(amt) && amt > 0;
  const tooSmall = amountOk && amt < w.rupees_per_point;
  const tooOld = billDate !== '' && billDate < oldest;
  const future = billDate > today;
  const earns = amountOk && !tooSmall ? Math.floor(amt / w.rupees_per_point) : 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!shop) return setError('Pick the shop the bill is from.');
    if (!billNumber.trim()) return setError('Enter the bill number printed on the bill.');
    if (!billDate) return setError('Enter the bill date.');
    if (future) return setError('The bill date cannot be in the future.');
    if (tooOld) return setError(`Bills must be added within ${w.bill_age_days} days of the bill date.`);
    if (!amountOk || Math.round(amt * 100) !== amt * 100) return setError('Enter the bill total in rupees.');
    if (tooSmall) return setError(`Bills under ${rupees(w.rupees_per_point)} do not earn points.`);
    const usingOld = Boolean(fix && keepPhoto && !photo);
    if (!photo && !usingOld) return setError('Add a photo of the bill.');
    submit.mutate(
      {
        shopId: shop.id,
        billNumber: billNumber.trim(),
        billDate,
        amount: amt,
        photo: usingOld ? null : photo,
        keepPhotoKey: usingOld ? fix!.photo_key : null,
        resubmitOf: fix?.id ?? null,
      },
      {
        onSuccess: () => {
          toast(`Bill sent for checking: about ${pointsText(earns)} on the way`);
          navigate('/points/bills');
        },
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      {fix && (
        <div className="notice warn">
          Not approved: {REJECT_REASONS[fix.reject_reason ?? ''] ?? 'see the reason in your inbox'}
          {fix.admin_note ? ` (${fix.admin_note})` : ''}. Fix it and send it again. A bill can be sent again
          only once.
        </div>
      )}
      <ShopPicker shop={shop} onPick={setShop} locked={Boolean(fix && fix.reject_reason !== 'wrong_shop')} />
      <div className="field">
        <label htmlFor="bill-number">Bill number</label>
        <input
          id="bill-number"
          value={billNumber}
          maxLength={40}
          autoCapitalize="characters"
          placeholder="As printed on the bill, e.g. INV-10234"
          onChange={(e) => setBillNumber(e.target.value)}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="bill-date">Bill date</label>
          <input
            id="bill-date"
            type="date"
            value={billDate}
            min={oldest}
            max={today}
            onChange={(e) => setBillDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="bill-amount">Bill total (₹)</label>
          <input
            id="bill-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
      {tooOld && (
        <div className="notice bad">
          This bill is older than {w.bill_age_days} days, so it cannot earn points. Bills must be added within{' '}
          {w.bill_age_days} days of the bill date.
        </div>
      )}
      {future && <div className="notice bad">The bill date cannot be in the future.</div>}
      {tooSmall && (
        <div className="notice bad">
          Bills under {rupees(w.rupees_per_point)} do not earn points. You earn 1 point for every full{' '}
          {rupees(w.rupees_per_point)}.
        </div>
      )}
      {earns > 0 && !tooOld && !future && (
        <div className="notice">
          This bill earns <b>{pointsText(earns)}</b> ({rupees(earns * w.point_value)}) once it is checked.
        </div>
      )}

      <div className="field">
        <label>Photo of the bill</label>
        {fix && (
          <label className="check-row" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={keepPhoto && !photo}
              disabled={Boolean(photo)}
              onChange={(e) => setKeepPhoto(e.target.checked)}
            />
            Keep the photo I sent before
          </label>
        )}
        <div className="image-pick" style={{ aspectRatio: '3 / 4', maxWidth: 200 }}>
          {preview ? <img src={preview} alt="Your bill" /> : <span>📷 Take or choose a photo</span>}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            aria-label="Photo of the bill"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (f && !isPhoto(f)) return setError('Choose a photo of the bill (JPG, PNG, WebP or HEIC).');
              setError('');
              setPhoto(f);
            }}
          />
        </div>
        {photo && (
          <button type="button" className="link-btn" onClick={() => setPhoto(null)}>
            Remove photo
          </button>
        )}
        <div className="hint">
          The whole bill should be readable: shop name, bill number, date and total. The photo is only seen by
          the IWILLFLY team.
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={submit.isPending}>
          {submit.isPending ? 'Sending…' : fix ? 'Send again' : 'Send for checking'}
        </button>
      </div>
    </form>
  );
}

function ShopPicker({
  shop,
  onPick,
  locked,
}: {
  shop: { id: number; name: string } | null;
  onPick: (s: { id: number; name: string } | null) => void;
  locked: boolean;
}) {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const shops = usePointsShops(q);

  if (shop) {
    return (
      <div className="field">
        <label>Shop</label>
        <div className="shop-card" style={{ cursor: 'default' }}>
          <div className="shop-thumb">🏪</div>
          <div>
            <h4>{shop.name}</h4>
            <div className="meta">Bill from this shop</div>
          </div>
          {!locked ? (
            <button type="button" className="link-btn" onClick={() => onPick(null)}>
              Change
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor="bill-shop">Which shop is the bill from?</label>
      <input
        id="bill-shop"
        type="search"
        value={typed}
        placeholder="Type the shop name"
        autoComplete="off"
        onChange={(e) => setTyped(e.target.value)}
      />
      <div className="hint">Only shops listed on IWILLFLY can earn points.</div>
      {shops.error && <ErrorNotice error={shops.error} />}
      <div className="list" style={{ marginTop: 8 }}>
        {shops.data?.map((s) => (
          <button
            type="button"
            key={s.id}
            className="shop-card"
            style={{ width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            onClick={() => onPick({ id: s.id, name: s.name })}
          >
            <Thumb imageKey={s.logo_key} icon="🏪" />
            <div>
              <h4>{s.name}</h4>
              {s.area && <div className="meta">{s.area}</div>}
            </div>
            <div className="chev">›</div>
          </button>
        ))}
        {shops.data?.length === 0 && (
          <div className="meta">No listed shop matches “{q}”. Bills from other shops cannot earn points.</div>
        )}
      </div>
    </div>
  );
}

// My bills -----------------------------------------------------------------------------------------

const STATUS_TEXT = { pending: 'Checking', approved: 'Approved', rejected: 'Not approved' } as const;

function MyBills() {
  const bills = useMyBills();
  const rate = usePointsWallet().data?.rupees_per_point ?? 50;
  return (
    <>
      <SubNav />
      <div className="section-head">
        <h2>My bills</h2>
        <Link className="btn small" to="/points/add">
          ＋ Add a bill
        </Link>
      </div>
      {bills.isPending && <Loading text="Loading your bills…" />}
      {bills.error && <ErrorNotice error={bills.error} onRetry={() => bills.refetch()} />}
      {bills.data?.length === 0 && (
        <EmptyState
          emoji="🧾"
          title="No bills yet"
          text="Add a bill from a shop on IWILLFLY to start earning points."
        />
      )}
      <div className="list">
        {bills.data?.map((b) => (
          <BillRow key={b.id} bill={b} rate={rate} />
        ))}
      </div>
    </>
  );
}

function BillRow({ bill: b, rate }: { bill: MyBill; rate: number }) {
  return (
    <div className="manage-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <span className={`pill-status ${b.status}`}>{STATUS_TEXT[b.status]}</span>
          <h4 style={{ margin: '6px 0 2px' }}>
            {b.shop_name} · {rupees(b.approved_amount ?? b.amount)}
          </h4>
          <div className="meta">
            Bill {b.bill_number} · {formatDate(b.bill_date)}
            {b.resubmit_of ? ' · sent again' : ''}
          </div>
          {b.status === 'approved' && b.approved_amount != null && b.approved_amount !== b.amount && (
            <div className="meta">Amount corrected from {rupees(b.amount)}</div>
          )}
          {b.status === 'rejected' && (
            <div className="meta" style={{ color: 'var(--color-red)' }}>
              {REJECT_REASONS[b.reject_reason ?? ''] ?? 'Not approved'}
              {b.admin_note ? ` (${b.admin_note})` : ''}
            </div>
          )}
          {b.status === 'pending' && (
            <div className="meta">
              Added {formatDay(b.created_at)}. The IWILLFLY team checks every bill by hand.
            </div>
          )}
        </div>
        {b.status === 'approved' ? (
          <span className="points-plus">+{(b.points ?? 0).toLocaleString('en-IN')}</span>
        ) : b.status === 'pending' ? (
          <span className="meta" style={{ whiteSpace: 'nowrap' }}>
            ~{Math.floor(b.amount / rate).toLocaleString('en-IN')} pts
          </span>
        ) : null}
      </div>
      {b.can_resubmit && (
        <Link
          className="btn small"
          to={`/points/add?fix=${b.id}`}
          style={{ display: 'inline-block', marginTop: 10 }}
        >
          Fix and send again
        </Link>
      )}
    </div>
  );
}

// History ------------------------------------------------------------------------------------------

function entryTitle(e: PointsEntry) {
  switch (e.kind) {
    case 'earn':
      return e.shop_name
        ? `Bill at ${e.shop_name}${e.bill_amount != null ? ` · ${rupees(e.bill_amount)}` : ''}`
        : 'Points earned';
    case 'expire':
      return 'Points expired';
    case 'redeem':
      return 'Cashed out to UPI';
    case 'refund':
      return 'Returned from a cash-out';
    default:
      return e.note ?? 'Adjustment';
  }
}

function History() {
  const history = usePointsHistory();
  return (
    <>
      <SubNav />
      <div className="section-head">
        <h2>Points history</h2>
      </div>
      {history.isPending && <Loading />}
      {history.error && <ErrorNotice error={history.error} onRetry={() => history.refetch()} />}
      {history.data?.length === 0 && (
        <EmptyState emoji="💰" title="No points yet" text="Points from your approved bills will show here." />
      )}
      <div className="list">
        {history.data?.map((e) => {
          const live = e.points > 0 && e.expires_at && new Date(e.expires_at) > new Date();
          return (
            <div key={e.id} className="manage-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ margin: '0 0 2px' }}>{entryTitle(e)}</h4>
                  <div className="meta">
                    {formatDay(e.created_at)}
                    {live && e.points_remaining != null && e.points_remaining < e.points
                      ? ` · ${e.points_remaining.toLocaleString('en-IN')} left`
                      : ''}
                    {live ? ` · valid till ${formatDay(e.expires_at)}` : ''}
                    {e.points > 0 && !live && e.points_remaining === 0 && e.expires_at
                      ? ' · used or expired'
                      : ''}
                  </div>
                </div>
                <span className={e.points > 0 ? 'points-plus' : 'points-minus'}>
                  {e.points > 0 ? '+' : '−'}
                  {Math.abs(e.points).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
