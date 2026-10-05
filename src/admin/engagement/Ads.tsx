import { useState, type CSSProperties, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import { mediaUrl } from '../../lib/supabase';
import type { Ad, AdLinkKind } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, toNumber, useInvalidate } from '../util';
import {
  ENG_KEYS,
  adStatus,
  deleteAd,
  engError,
  reorderAds,
  saveAd,
  todayIST,
  useAd,
  useAds,
  useFestivals,
  useMallRefs,
  useShopRefs,
  useVendorRefs,
  type AdInput,
} from './api';
import { StatusPill } from './StatusPill';

/** Router state the Requests screen passes to prefill a new home banner. */
export type AdPrefill = { prefill: Partial<AdInput>; from?: string };

export default function AdminAds() {
  return (
    <Routes>
      <Route index element={<AdList />} />
      <Route path="new" element={<AdEdit />} />
      <Route path=":id" element={<AdEdit />} />
      <Route path="*" element={<Navigate to="/admin/ads" replace />} />
    </Routes>
  );
}

const STYLES: { key: Ad['style']; label: string }[] = [
  { key: 'ad1', label: 'Orange' },
  { key: 'ad2', label: 'Blue' },
  { key: 'ad3', label: 'Pink' },
];

const LINK_KINDS: { key: AdLinkKind; label: string }[] = [
  { key: 'none', label: 'Nothing (no link)' },
  { key: 'url', label: 'A web address' },
  { key: 'shop', label: 'A shop' },
  { key: 'offer', label: 'An offer' },
  { key: 'festival', label: 'A festival' },
  { key: 'mall', label: 'A mall' },
];

function linkLabel(a: Pick<Ad, 'link_kind' | 'link_target'>) {
  if (a.link_kind === 'none' || !a.link_target) return 'No link';
  if (a.link_kind === 'url') return a.link_target;
  if (a.link_kind === 'festival') return `/festival/${a.link_target}`;
  return `${a.link_kind} #${a.link_target}`;
}

/** The home slider card, drawn with the same classes customers see. */
export function AdPreview({
  pill,
  title,
  subtitle,
  style,
  image_key,
}: Pick<Ad, 'pill' | 'title' | 'subtitle' | 'style' | 'image_key'>) {
  const bg: CSSProperties | undefined = image_key
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.6)), url("${mediaUrl(image_key)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;
  return (
    <section className="ad-slider" aria-label="Preview">
      <div className="ad-track">
        <div className={`ad ${style}`} style={bg}>
          {pill && <span className="pill">{pill}</span>}
          <h3 style={{ whiteSpace: 'pre-line' }}>{title || 'Your title here'}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
    </section>
  );
}

function AdList() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const ads = useAds();
  const list = ads.data ?? [];

  const move = useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return reorderAds(next);
    },
    onSuccess: () => invalidate(...ENG_KEYS),
    onError: (e) => toast(engError(e)),
  });

  return (
    <>
      <div className="section-head">
        <h2>Home ads</h2>
        <Link className="btn small" to="/admin/ads/new">
          ＋ New ad
        </Link>
      </div>
      <p className="meta" style={{ marginTop: 0 }}>
        Running ads show in the slider at the top of the home page, in this order.
      </p>
      {ads.isPending && <Loading />}
      {ads.error && <ErrorNotice error={ads.error} />}
      {ads.data?.length === 0 && (
        <Empty emoji="📣" title="No home ads yet">
          Add a banner for a festival, a mall or a vendor’s shop.
        </Empty>
      )}
      {list.map((a, i) => (
        <div key={a.id} className="manage-card">
          <Link to={`/admin/ads/${a.id}`} style={{ display: 'block', color: 'inherit' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              <StatusPill status={adStatus(a)} />
              {a.vendor_id != null && <span className="pill-status featured">Vendor ad</span>}
            </div>
            <div style={{ pointerEvents: 'none' }}>
              <AdPreview {...a} />
            </div>
            <div className="meta" style={{ marginTop: 6 }}>
              {formatDate(a.starts_on)} – {a.ends_on ? formatDate(a.ends_on) : 'no end date'} · {linkLabel(a)}
            </div>
          </Link>
          <div className="btn-row">
            <button
              className="btn small secondary"
              aria-label="Move up"
              disabled={i === 0 || move.isPending}
              onClick={() => move.mutate({ from: i, to: i - 1 })}
            >
              ↑ Up
            </button>
            <button
              className="btn small secondary"
              aria-label="Move down"
              disabled={i === list.length - 1 || move.isPending}
              onClick={() => move.mutate({ from: i, to: i + 1 })}
            >
              ↓ Down
            </button>
            <Link className="link-btn" to={`/admin/ads/${a.id}`} style={{ marginLeft: 'auto' }}>
              Edit ›
            </Link>
          </div>
        </div>
      ))}
    </>
  );
}

function AdEdit() {
  const { id } = useParams();
  const location = useLocation();
  const adId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const ad = useAd(adId);
  const prefill = (location.state as AdPrefill | null) ?? null;

  if (id != null && adId == null) {
    return <ErrorNotice error={new Error('No such ad.')} />;
  }

  return (
    <>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {adId ? 'Edit ad' : 'New ad'}
          </span>
          {ad.data && <StatusPill status={adStatus(ad.data)} />}
        </h2>
        <Link to="/admin/ads">‹ All ads</Link>
      </div>
      {adId == null && prefill?.from && <div className="notice">{prefill.from}</div>}
      {adId == null && <AdForm prefill={prefill?.prefill} />}
      {adId != null && ad.isPending && <Loading />}
      {ad.error && <ErrorNotice error={ad.error} />}
      {ad.data && <AdForm key={ad.data.updated_at} ad={ad.data} />}
    </>
  );
}

type Form = {
  pill: string;
  title: string;
  subtitle: string;
  image_key: string | null;
  style: Ad['style'];
  link_kind: AdLinkKind;
  link_target: string;
  vendor_id: number | null;
  starts_on: string;
  ends_on: string;
  sort_order: string;
  is_active: boolean;
};

function toForm(a?: Partial<AdInput>): Form {
  return {
    pill: a?.pill ?? '',
    title: a?.title ?? '',
    subtitle: a?.subtitle ?? '',
    image_key: a?.image_key ?? null,
    style: a?.style ?? 'ad1',
    link_kind: a?.link_kind ?? 'none',
    link_target: a?.link_target ?? '',
    vendor_id: a?.vendor_id ?? null,
    starts_on: a?.starts_on ?? todayIST(),
    ends_on: a?.ends_on ?? '',
    sort_order: String(a?.sort_order ?? 0),
    is_active: a?.is_active ?? true,
  };
}

function AdForm({ ad, prefill }: { ad?: Ad; prefill?: Partial<AdInput> }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(() => toForm(ad ?? prefill));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const shops = useShopRefs(f.link_kind === 'shop');
  const malls = useMallRefs(f.link_kind === 'mall');
  const festivals = useFestivals();
  const vendors = useVendorRefs();

  const save = useMutation({
    mutationFn: (row: AdInput) => saveAd(ad?.id ?? null, row),
    onSuccess: () => {
      invalidate(...ENG_KEYS);
      toast(ad ? 'Ad saved' : 'Ad created');
      navigate('/admin/ads', { replace: true });
    },
    onError: (e) => setError(engError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteAd(ad!.id),
    onSuccess: () => {
      invalidate(...ENG_KEYS);
      toast('Ad deleted');
      navigate('/admin/ads', { replace: true });
    },
    onError: (e) => setError(engError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const sort = toNumber(f.sort_order);
    const target = f.link_target.trim();
    const title = f.title
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    if (title.length < 2) return setError('Enter the title.');
    if (title.split('\n').length > 2) return setError('The title can have at most two lines.');
    if (!f.starts_on) return setError('Choose a start date.');
    if (f.ends_on && f.ends_on < f.starts_on)
      return setError('The end date cannot be before the start date.');
    if (sort == null || !Number.isInteger(sort)) return setError('Sort order must be a whole number.');
    if (f.link_kind !== 'none' && !target) return setError('Choose where the ad opens.');
    if (f.link_kind === 'url' && !/^https:\/\/[^\s]+\.[^\s]+$/.test(target))
      return setError('The web address must start with https://');
    if (f.link_kind === 'offer' && !/^\d+$/.test(target))
      return setError('Enter the offer number (the digits at the end of the offer link).');
    save.mutate({
      pill: f.pill.trim() || null,
      title,
      subtitle: f.subtitle.trim() || null,
      image_key: f.image_key,
      style: f.style,
      link_kind: f.link_kind,
      link_target: f.link_kind === 'none' ? null : target,
      vendor_id: f.vendor_id,
      starts_on: f.starts_on,
      ends_on: f.ends_on || null,
      sort_order: sort,
      is_active: f.is_active,
    });
  };

  const targetField = () => {
    switch (f.link_kind) {
      case 'none':
        return null;
      case 'url':
        return (
          <input
            id="ad-target"
            type="url"
            inputMode="url"
            placeholder="https://"
            maxLength={300}
            value={f.link_target}
            onChange={(e) => set({ link_target: e.target.value })}
          />
        );
      case 'offer':
        return (
          <input
            id="ad-target"
            inputMode="numeric"
            placeholder="Offer number, e.g. 42"
            maxLength={20}
            value={f.link_target}
            onChange={(e) => set({ link_target: e.target.value.replace(/\D/g, '') })}
          />
        );
      case 'shop':
      case 'mall':
      case 'festival': {
        const q = f.link_kind === 'shop' ? shops : f.link_kind === 'mall' ? malls : festivals;
        const options =
          f.link_kind === 'festival'
            ? (festivals.data ?? []).map((x) => ({ value: x.slug, label: `${x.name} (/${x.slug})` }))
            : ((f.link_kind === 'shop' ? shops.data : malls.data) ?? []).map((x) => ({
                value: String(x.id),
                label: x.name,
              }));
        const known = options.some((o) => o.value === f.link_target);
        return (
          <select id="ad-target" value={f.link_target} onChange={(e) => set({ link_target: e.target.value })}>
            <option value="">{q.isPending ? 'Loading…' : 'Choose…'}</option>
            {!known && f.link_target && <option value={f.link_target}>#{f.link_target} (not found)</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      }
    }
  };

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="field">
        <label>Preview</label>
        <AdPreview
          pill={f.pill.trim() || null}
          title={f.title}
          subtitle={f.subtitle.trim() || null}
          style={f.style}
          image_key={f.image_key}
        />
      </div>
      <div className="field">
        <label htmlFor="ad-pill">Pill text</label>
        <input
          id="ad-pill"
          value={f.pill}
          maxLength={40}
          placeholder="MAIN FESTIVAL OFFER"
          onChange={(e) => set({ pill: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="field">
        <label htmlFor="ad-title">Title</label>
        <textarea
          id="ad-title"
          rows={2}
          maxLength={80}
          required
          placeholder={'Celebrate Local.\nSave More.'}
          value={f.title}
          onChange={(e) => set({ title: e.target.value })}
          style={{ minHeight: 0 }}
        />
        <div className="hint">Two short lines read best. Press Enter to start the second line.</div>
      </div>
      <div className="field">
        <label htmlFor="ad-sub">Subtitle</label>
        <input
          id="ad-sub"
          value={f.subtitle}
          maxLength={160}
          placeholder="Big festive offers from your favourite stores."
          onChange={(e) => set({ subtitle: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Colour</label>
        <div className="filter-bar" role="radiogroup" style={{ margin: 0 }}>
          {STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={f.style === s.key}
              className={`chip${f.style === s.key ? ' active' : ''}`}
              onClick={() => set({ style: s.key })}
            >
              <span
                className={s.key}
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  marginRight: 6,
                  verticalAlign: -1,
                }}
              />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ImageField
        label="Background photo (optional)"
        folder="ads"
        aspect="2 / 1"
        value={f.image_key}
        onChange={(k) => set({ image_key: k })}
      />
      <div className="field-row">
        <div className="field">
          <label htmlFor="ad-kind">Tapping opens</label>
          <select
            id="ad-kind"
            value={f.link_kind}
            onChange={(e) => set({ link_kind: e.target.value as AdLinkKind, link_target: '' })}
          >
            {LINK_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        {f.link_kind !== 'none' && (
          <div className="field">
            <label htmlFor="ad-target">
              {LINK_KINDS.find((k) => k.key === f.link_kind)?.label.replace(/^(A|An) /, '')}
            </label>
            {targetField()}
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="ad-vendor">Advertiser</label>
        <select
          id="ad-vendor"
          value={f.vendor_id ?? ''}
          onChange={(e) => set({ vendor_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">IWILLFLY (no vendor)</option>
          {f.vendor_id != null && !vendors.data?.some((v) => v.id === f.vendor_id) && (
            <option value={f.vendor_id}>Vendor #{f.vendor_id}</option>
          )}
          {vendors.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.business_name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ad-start">Starts on</label>
          <input
            id="ad-start"
            type="date"
            required
            value={f.starts_on}
            onChange={(e) => set({ starts_on: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="ad-end">Ends on</label>
          <input
            id="ad-end"
            type="date"
            min={f.starts_on || undefined}
            value={f.ends_on}
            onChange={(e) => set({ ends_on: e.target.value })}
          />
          <div className="hint">Empty: runs until switched off.</div>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ad-sort">Sort order</label>
        <input
          id="ad-sort"
          type="number"
          step={1}
          inputMode="numeric"
          value={f.sort_order}
          onChange={(e) => set({ sort_order: e.target.value })}
        />
        <div className="hint">Lower numbers show first. You can also use ↑ ↓ in the list.</div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Ad on (shows on the home page between its dates)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : ad ? 'Save ad' : 'Create ad'}
        </button>
        {ad && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (window.confirm('Delete this ad? To keep it for later, switch it off instead.'))
                remove.mutate();
            }}
          >
            Delete ad
          </button>
        )}
      </div>
    </form>
  );
}
