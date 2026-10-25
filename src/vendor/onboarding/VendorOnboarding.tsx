import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AreaPicker } from '../../components/AreaPicker';
import { useToast } from '../../components/Toast';
import { UploadProgressBar } from '../../components/UploadProgressBar';
import { formatTime, DAYS } from '../../lib/hours';
import { PARKING, parkingInfo } from '../../lib/parking';
import { db, must, useCategories, useLocations } from '../../lib/queries';
import { checkPickedSize, uploadImage, type UploadProgress } from '../../lib/upload';
import type { Hours, Parking, Plan } from '../../lib/types';
import { VENDOR_KEY } from '../api';
import { limitText, money, planPrice } from '../billing/format';
import { errorMessage } from '../format';
import { HoursEditor } from '../HoursEditor';
import {
  applicationBody,
  clearDraft,
  emptyBranch,
  emptyDraft,
  loadDraft,
  MAX_APPLY_BRANCHES,
  saveDraft,
  stepError,
  STEPS,
  type BranchDraft,
  type Draft,
} from './draft';

// Leaflet is only downloaded when the location step opens.
const MapPin = lazy(() => import('../../components/MapPin').then((m) => ({ default: m.MapPin })));

type Result = { vendor_id: number; shop_id: number; branch_ids: number[]; invoice_id: number };

function usePlans() {
  return useQuery({
    queryKey: ['apply', 'plans'],
    queryFn: async () =>
      must<Plan[]>(
        await db().from('plans').select('*').eq('is_active', true).order('sort_order').order('price'),
      ),
  });
}

/**
 * The vendor application: plan, shop, where it is (the main branch), hours, other branches, review.
 * Everything is sent together by submit_vendor_application(); the logo and cover photo are uploaded right
 * after, once the account is a vendor (applicants may add only those two pictures).
 */
export function VendorOnboarding() {
  const { session, refreshRoles } = useAuth();
  const uid = session?.user.id ?? '';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const plans = usePlans();
  const [d, setD] = useState<Draft>(
    () => loadDraft(uid) ?? emptyDraft(String(session?.user.user_metadata?.phone ?? '')),
  );
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [agree, setAgree] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    if (uid) saveDraft(uid, d);
  }, [uid, d]);

  const plan = plans.data?.find((p) => p.id === d.plan_id);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const setBranch = (i: number, patch: Partial<BranchDraft>) =>
    setD((cur) => ({ ...cur, branches: cur.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));

  const go = (step: number) => {
    setError('');
    set({ step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const next = () => {
    const problem = stepError(d.step, d, plan);
    if (problem) return setError(problem);
    go(d.step + 1);
  };

  const send = async () => {
    for (let s = 0; s < STEPS.length - 1; s++) {
      const problem = stepError(s, d, plan);
      if (problem) {
        go(s);
        return setError(problem);
      }
    }
    if (!agree) return setError('Please accept the Terms to send your application.');
    setError('');
    setSending('Sending your application…');
    let result: Result;
    try {
      result = must<Result>(await db().rpc('submit_vendor_application', { p: applicationBody(d) }));
    } catch (e) {
      setSending(null);
      const msg = errorMessage(e);
      const step = /^Step (\d)/.exec(msg)?.[1];
      if (step) go(Number(step) - 1);
      return setError(msg);
    }
    clearDraft(uid);
    await refreshRoles();
    // Pictures go up now that the account is a vendor; a failure here is fixed later from the shop page.
    const photos: { file: File; column: 'logo_key' | 'cover_key'; what: string }[] = [];
    if (logo) photos.push({ file: logo, column: 'logo_key', what: 'logo' });
    if (cover) photos.push({ file: cover, column: 'cover_key', what: 'cover photo' });
    let photoProblem = '';
    for (const p of photos) {
      setSending(`Adding your ${p.what}…`);
      try {
        const key = await uploadImage(p.file, 'shops', { onProgress: setProgress });
        must(
          await db()
            .from('shops')
            .update({ [p.column]: key })
            .eq('id', result.shop_id),
        );
      } catch (e) {
        photoProblem = `Your ${p.what} could not be added (${errorMessage(e)}). Add it from Shops.`;
      } finally {
        setProgress(null);
      }
    }
    await qc.invalidateQueries({ queryKey: VENDOR_KEY });
    if (plan && Number(plan.price) > 0) {
      // On to the invoice, which offers the ways to pay an admin switched on: Razorpay, Instamojo, or UPI with a transaction ID/screenshot.
      toast(photoProblem || 'Application sent! Now pay the plan invoice so we can approve you.');
      navigate(`/vendor/billing/invoices/${result.invoice_id}`, { replace: true });
      return;
    }
    toast(photoProblem || 'Application sent! The IWILLFLY team will review your shop.');
    navigate('/vendor', { replace: true });
  };

  if (sending) {
    return (
      <div className="form-card" style={{ textAlign: 'center' }}>
        <h3 style={{ marginTop: 0 }}>{sending}</h3>
        {progress ? (
          <UploadProgressBar progress={progress} />
        ) : (
          <p className="meta">Please keep this page open.</p>
        )}
      </div>
    );
  }

  return (
    <div className="onboarding">
      <StepBar step={d.step} onPick={(s) => s < d.step && go(s)} />
      <div className="form-card">
        {d.step === 0 && (
          <PlanStep plans={plans} value={d.plan_id} onChange={(plan_id) => set({ plan_id })} />
        )}
        {d.step === 1 && (
          <ShopStep d={d} set={set} logo={logo} setLogo={setLogo} cover={cover} setCover={setCover} />
        )}
        {d.step === 2 && (
          <>
            <h3 style={{ marginTop: 0 }}>Where is your shop?</h3>
            <p className="meta" style={{ marginTop: 0 }}>
              This is your main branch. Customers use it to find you and get directions.
            </p>
            <PlaceFields
              b={d.branches[0]}
              set={(patch) => setBranch(0, patch)}
              shopPhone={d.phone}
              idPrefix="m"
            />
          </>
        )}
        {d.step === 3 && (
          <>
            <h3 style={{ marginTop: 0 }}>Opening hours</h3>
            <p className="meta" style={{ marginTop: 0 }}>
              Tick Closed for days you don't open. Holidays can be added later from your dashboard.
            </p>
            <HoursEditor value={d.branches[0].hours} onChange={(hours) => setBranch(0, { hours })} />
          </>
        )}
        {d.step === 4 && <BranchesStep d={d} set={set} setBranch={setBranch} plan={plan} />}
        {d.step === 5 && (
          <ReviewStep d={d} plan={plan} logo={logo} cover={cover} go={go} agree={agree} setAgree={setAgree} />
        )}

        {error && <p className="error-text">{error}</p>}
        <div className="btn-row">
          {d.step > 0 && (
            <button type="button" className="btn secondary" onClick={() => go(d.step - 1)}>
              ‹ Back
            </button>
          )}
          {d.step < STEPS.length - 1 ? (
            <button type="button" className="btn" style={{ flex: 1 }} onClick={next}>
              Next ›
            </button>
          ) : (
            <button type="button" className="btn" style={{ flex: 1 }} onClick={send}>
              {plan && Number(plan.price) > 0 ? 'Send and pay' : 'Send application'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBar({ step, onPick }: { step: number; onPick: (s: number) => void }) {
  return (
    <div className="onboarding-steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      <div className="meta">
        Step {step + 1} of {STEPS.length} · <b>{STEPS[step]}</b>
      </div>
      <ol>
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''}>
            <button type="button" onClick={() => onPick(i)} disabled={i >= step} aria-label={s}>
              <span />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanStep({
  plans,
  value,
  onChange,
}: {
  plans: ReturnType<typeof usePlans>;
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Choose your plan</h3>
      <p className="meta" style={{ marginTop: 0 }}>
        You can change plans later from Plan &amp; billing.
      </p>
      {plans.isPending && <p className="meta">Loading plans…</p>}
      {plans.error && <p className="error-text">Could not load the plans: {errorMessage(plans.error)}</p>}
      {plans.data?.length === 0 && (
        <div className="notice warn">No plans are open right now. Please check back soon.</div>
      )}
      <div className="list" role="radiogroup" aria-label="Plans">
        {plans.data?.map((p) => {
          const picked = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={picked}
              className={`plan-pick${picked ? ' picked' : ''}`}
              onClick={() => onChange(p.id)}
            >
              <div className="plan-pick-head">
                <span className="plan-pick-dot" />
                <h4>{p.name}</h4>
                <b>{planPrice(p)}</b>
              </div>
              {p.description && <p>{p.description}</p>}
              <ul>
                <li>{limitText(p.max_shops, 'shop', 'shops')}</li>
                <li>{limitText(p.max_branches ?? null, 'branch', 'branches')}</li>
                <li>{limitText(p.max_live_offers, 'live offer', 'live offers')}</li>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {Number(p.price) > 0 && (
                <div className="meta">
                  Pay the plan invoice after sending. We review your shop once it is paid.
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function ShopStep({
  d,
  set,
  logo,
  setLogo,
  cover,
  setCover,
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  logo: File | null;
  setLogo: (f: File | null) => void;
  cover: File | null;
  setCover: (f: File | null) => void;
}) {
  const { data: categories = [] } = useCategories();
  const [showBiz, setShowBiz] = useState(Boolean(d.business_name));
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Your shop</h3>
      <div className="field">
        <label htmlFor="ob-name">Shop name *</label>
        <input id="ob-name" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
        {!showBiz && (
          <button type="button" className="link-btn" onClick={() => setShowBiz(true)}>
            Business name is different
          </button>
        )}
      </div>
      {showBiz && (
        <div className="field">
          <label htmlFor="ob-biz">Registered business name</label>
          <input
            id="ob-biz"
            value={d.business_name}
            onChange={(e) => set({ business_name: e.target.value })}
            maxLength={120}
            placeholder="e.g. Lulu Retail Pvt Ltd"
          />
          <div className="hint">Shown on your invoices. Leave empty to use the shop name.</div>
        </div>
      )}
      <div className="field">
        <label htmlFor="ob-cat">Category *</label>
        <select
          id="ob-cat"
          value={d.category_id ?? ''}
          onChange={(e) => set({ category_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Choose a category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ob-desc">About your shop *</label>
        <textarea
          id="ob-desc"
          value={d.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={1000}
          placeholder="What you sell, brands you carry, anything special"
        />
      </div>
      <div className="field">
        <label htmlFor="ob-phone">Shop phone *</label>
        <input
          id="ob-phone"
          type="tel"
          value={d.phone}
          onChange={(e) => set({ phone: e.target.value })}
          maxLength={20}
        />
      </div>
      <label className="check-row">
        <input type="checkbox" checked={d.waSame} onChange={(e) => set({ waSame: e.target.checked })} />
        WhatsApp is on the same number
      </label>
      {!d.waSame && (
        <div className="field">
          <label htmlFor="ob-wa">WhatsApp *</label>
          <input
            id="ob-wa"
            type="tel"
            value={d.whatsapp}
            onChange={(e) => set({ whatsapp: e.target.value })}
            maxLength={20}
          />
        </div>
      )}
      <div style={{ maxWidth: 140 }}>
        <PhotoPick label="Logo" file={logo} onChange={setLogo} />
      </div>
      <PhotoPick label="Cover photo" file={cover} onChange={setCover} aspect="16 / 9" />
      <div className="hint">
        Logo and cover are optional. They are uploaded when you send the application.
      </div>
    </>
  );
}

/** Picks a picture and previews it on the device; it is uploaded after the application is sent. */
function PhotoPick({
  label,
  file,
  onChange,
  aspect = '1 / 1',
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  aspect?: string;
}) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label>{label}</label>
      <div className="image-pick" style={{ aspectRatio: aspect }}>
        {url ? <img src={url} alt="" /> : <span>＋ Add photo</span>}
        <input
          type="file"
          accept="image/*"
          aria-label={label}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              checkPickedSize(f);
              setError('');
              onChange(f);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        />
      </div>
      {file && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>
          Remove photo
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** Address, Area, map pin, parking and phone of one branch. */
function PlaceFields({
  b,
  set,
  shopPhone,
  idPrefix,
}: {
  b: BranchDraft;
  set: (patch: Partial<BranchDraft>) => void;
  shopPhone: string;
  idPrefix: string;
}) {
  const { data: locations = [] } = useLocations();
  const area = locations.find((l) => l.id === b.location_id);
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-addr`}>Address *</label>
        <textarea
          id={`${idPrefix}-addr`}
          value={b.address}
          onChange={(e) => set({ address: e.target.value })}
          maxLength={300}
          style={{ minHeight: 60 }}
          placeholder="Building, street, landmark"
        />
      </div>
      <AreaPicker
        label="Area *"
        value={b.location_id}
        onChange={(a) => set({ location_id: a?.id ?? null })}
      />
      <div className="field">
        <label>Map pin *</label>
        <Suspense fallback={<div className="map-box" />}>
          <MapPin lat={b.lat} lng={b.lng} fallback={area} onChange={(p) => set({ lat: p.lat, lng: p.lng })} />
        </Suspense>
        <div className="hint">Tap the map, drag the pin to the entrance, or paste a Google Maps link.</div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-parking`}>Parking *</label>
        <select
          id={`${idPrefix}-parking`}
          value={b.parking ?? ''}
          onChange={(e) => set({ parking: (e.target.value || null) as Parking | null })}
        >
          <option value="">Choose one</option>
          {PARKING.map((p) => (
            <option key={p.value} value={p.value}>
              {p.icon} {p.label}
            </option>
          ))}
        </select>
      </div>
      {b.parking && (
        <div className="field">
          <label htmlFor={`${idPrefix}-parking-note`}>Parking note</label>
          <input
            id={`${idPrefix}-parking-note`}
            value={b.parking_note}
            onChange={(e) => set({ parking_note: e.target.value })}
            maxLength={100}
            placeholder="e.g. Basement, ₹20 per hour"
          />
        </div>
      )}
      <div className="field">
        <label htmlFor={`${idPrefix}-phone`}>Branch phone</label>
        <input
          id={`${idPrefix}-phone`}
          type="tel"
          value={b.phone}
          onChange={(e) => set({ phone: e.target.value })}
          maxLength={20}
          placeholder={shopPhone ? `Same as shop: ${shopPhone}` : undefined}
        />
      </div>
    </>
  );
}

function BranchesStep({
  d,
  set,
  setBranch,
  plan,
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  setBranch: (i: number, patch: Partial<BranchDraft>) => void;
  plan: Plan | undefined;
}) {
  const allowed = Math.min(MAX_APPLY_BRANCHES, plan?.max_branches ?? MAX_APPLY_BRANCHES);
  const choose = (multi: boolean) => {
    if (multi && d.branches.length < 2) set({ multi, branches: [...d.branches, emptyBranch()] });
    else set({ multi });
  };
  const second = d.branches[1];
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Does this shop have other branches?</h3>
      {allowed < 2 ? (
        <div className="notice">
          The {plan?.name} plan includes 1 branch. You can upgrade later to add more.
        </div>
      ) : (
        <div className="btn-row" role="radiogroup" style={{ marginTop: 0 }}>
          <button
            type="button"
            role="radio"
            aria-checked={!d.multi}
            className={`btn${d.multi ? ' secondary' : ''}`}
            style={{ flex: 1 }}
            onClick={() => choose(false)}
          >
            No, just this one
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={d.multi}
            className={`btn${d.multi ? '' : ' secondary'}`}
            style={{ flex: 1 }}
            onClick={() => choose(true)}
          >
            Yes
          </button>
        </div>
      )}
      {d.multi && allowed >= 2 && second && (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="ob-main-name">Name of the branch you already added *</label>
            <input
              id="ob-main-name"
              value={d.branches[0].name}
              onChange={(e) => setBranch(0, { name: e.target.value })}
              maxLength={80}
              placeholder="e.g. MG Road"
            />
            <div className="meta">{d.branches[0].address}</div>
          </div>
          <h4 style={{ margin: '16px 0 8px' }}>Your other branch</h4>
          <div className="field">
            <label htmlFor="ob-b2-name">Branch name *</label>
            <input
              id="ob-b2-name"
              value={second.name}
              onChange={(e) => setBranch(1, { name: e.target.value })}
              maxLength={80}
              placeholder="e.g. Edappally"
            />
          </div>
          <PlaceFields b={second} set={(patch) => setBranch(1, patch)} shopPhone={d.phone} idPrefix="b2" />
          <button
            type="button"
            className="link-btn"
            onClick={() => setBranch(1, { hours: { ...d.branches[0].hours } })}
          >
            Copy hours from {d.branches[0].name.trim() || 'the main branch'}
          </button>
          <HoursEditor value={second.hours} onChange={(hours: Hours) => setBranch(1, { hours })} />
          <p className="meta">You can add more branches from your dashboard after sending.</p>
        </>
      )}
      {!d.multi && (
        <p className="meta">
          Your shop is saved with one branch. You can add more later from your dashboard.
        </p>
      )}
    </>
  );
}

function hoursSummary(h: Hours) {
  const open = DAYS.filter((day) => h[day.key]);
  if (open.length === 0) return 'Closed every day';
  return open
    .map((day) => `${day.label.slice(0, 3)} ${formatTime(h[day.key]!.open)}–${formatTime(h[day.key]!.close)}`)
    .join(' · ');
}

function ReviewStep({
  d,
  plan,
  logo,
  cover,
  go,
  agree,
  setAgree,
}: {
  d: Draft;
  plan: Plan | undefined;
  logo: File | null;
  cover: File | null;
  go: (step: number) => void;
  agree: boolean;
  setAgree: (v: boolean) => void;
}) {
  const { data: categories = [] } = useCategories();
  const { data: locations = [] } = useLocations();
  const cat = categories.find((c) => c.id === d.category_id);
  const branches = d.multi ? d.branches.slice(0, MAX_APPLY_BRANCHES) : d.branches.slice(0, 1);
  const edit = (step: number) => (
    <button type="button" className="link-btn" onClick={() => go(step)}>
      Edit
    </button>
  );
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Check and send</h3>
      <div className="review-block">
        <div className="review-head">
          <b>Plan</b>
          {edit(0)}
        </div>
        {plan ? (
          <div>
            {plan.name} · {planPrice(plan)}
            {Number(plan.price) > 0 && (
              <div className="meta">
                After you send, your invoice for {money(plan.price)} (plus GST if any) opens with the ways you
                can pay. We review your shop once the payment is confirmed.
              </div>
            )}
          </div>
        ) : (
          <div className="error-text">No plan chosen</div>
        )}
      </div>
      <div className="review-block">
        <div className="review-head">
          <b>Shop</b>
          {edit(1)}
        </div>
        <div>
          <b>{d.name}</b>{' '}
          {cat && (
            <span className="meta">
              · {cat.icon} {cat.name}
            </span>
          )}
        </div>
        {d.business_name.trim() && <div className="meta">Business: {d.business_name}</div>}
        <div className="meta" style={{ whiteSpace: 'pre-line' }}>
          {d.description}
        </div>
        <div className="meta">
          📞 {d.phone} · 💬 {d.waSame ? d.phone : d.whatsapp}
        </div>
        <div className="meta">
          Logo: {logo ? 'added' : 'not added'} · Cover photo: {cover ? 'added' : 'not added'}
        </div>
      </div>
      {branches.map((b, i) => (
        <div className="review-block" key={i}>
          <div className="review-head">
            <b>{branches.length === 1 ? 'Location' : b.name || `Branch ${i + 1}`}</b>
            {edit(i === 0 ? 2 : 4)}
          </div>
          <div>{b.address}</div>
          <div className="meta">
            {locations.find((l) => l.id === b.location_id)?.name ?? 'No Area'} ·{' '}
            {b.lat != null ? '📍 Pin set' : 'No pin'} · {parkingInfo(b.parking)?.icon}{' '}
            {parkingInfo(b.parking)?.label ?? 'Parking not set'}
            {b.parking_note.trim() && ` (${b.parking_note.trim()})`}
          </div>
          <div className="meta">🕘 {hoursSummary(b.hours)}</div>
        </div>
      ))}
      <label className="check-row">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I accept the{' '}
          <Link to="/terms" target="_blank">
            Terms
          </Link>{' '}
          and confirm these details are correct.
        </span>
      </label>
      <p className="meta">
        The IWILLFLY team checks every new shop. Offers can be added once your business is approved.
      </p>
    </>
  );
}
