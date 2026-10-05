import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import { mediaUrl } from '../../lib/supabase';
import type { Festival, ReviewStatus } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { formatDate, one, slugify, toNumber, useInvalidate } from '../util';
import {
  ENG_KEYS,
  deleteFestival,
  engError,
  festivalStatus,
  reviewSubmission,
  saveFestival,
  todayIST,
  useFestival,
  useFestivals,
  useSubmissions,
  type FestivalInput,
  type SubmissionRow,
} from './api';
import { StatusPill } from './StatusPill';

export default function AdminFestivals() {
  return (
    <Routes>
      <Route index element={<FestivalList />} />
      <Route path="new" element={<FestivalEdit />} />
      <Route path=":id" element={<FestivalEdit />} />
      <Route path="*" element={<Navigate to="/admin/festivals" replace />} />
    </Routes>
  );
}

function FestivalList() {
  const festivals = useFestivals();
  return (
    <>
      <div className="section-head">
        <h2>Festivals</h2>
        <Link className="btn small" to="/admin/festivals/new">
          ＋ New festival
        </Link>
      </div>
      {festivals.isPending && <Loading />}
      {festivals.error && <ErrorNotice error={festivals.error} />}
      {festivals.data?.length === 0 && (
        <Empty emoji="🪔" title="No festivals yet">
          Create a festival like “Onam 2026”, switch it on, and vendors can submit their offers to it.
        </Empty>
      )}
      <div className="list">
        {festivals.data?.map((f) => {
          const pending = f.festival_offers.filter((o) => o.status === 'pending').length;
          const approved = f.festival_offers.filter((o) => o.status === 'approved').length;
          return (
            <Link key={f.id} className="shop-card" to={`/admin/festivals/${f.id}`}>
              <div
                className="shop-thumb"
                style={f.theme_color && !f.banner_key ? { background: f.theme_color } : undefined}
              >
                {f.banner_key ? <img src={mediaUrl(f.banner_key)} alt="" /> : '🪔'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  <StatusPill status={festivalStatus(f)} />
                  {pending > 0 && <span className="pill-status pending">{pending} to review</span>}
                </div>
                <h4>{f.name}</h4>
                <div className="meta">
                  {formatDate(f.starts_on)} – {formatDate(f.ends_on)} · /festival/{f.slug}
                </div>
                <div className="meta">
                  {approved} approved offers · order {f.sort_order}
                </div>
              </div>
              <div className="chev">›</div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function FestivalEdit() {
  const { id } = useParams();
  const festivalId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const festival = useFestival(festivalId);

  if (id != null && festivalId == null) {
    return <ErrorNotice error={new Error('No such festival.')} />;
  }

  return (
    <>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {festivalId ? (festival.data?.name ?? 'Festival') : 'New festival'}
          </span>
          {festival.data && <StatusPill status={festivalStatus(festival.data)} />}
        </h2>
        <Link to="/admin/festivals">‹ All festivals</Link>
      </div>
      {festivalId == null && <FestivalForm />}
      {festivalId != null && festival.isPending && <Loading />}
      {festival.error && <ErrorNotice error={festival.error} />}
      {festival.data && (
        <>
          <FestivalForm key={festival.data.updated_at} festival={festival.data} />
          <Submissions festival={festival.data} />
        </>
      )}
    </>
  );
}

type Form = {
  name: string;
  slug: string;
  slugTouched: boolean;
  description: string;
  banner_key: string | null;
  useColor: boolean;
  color: string;
  starts_on: string;
  ends_on: string;
  submissions_close_on: string;
  is_active: boolean;
  sort_order: string;
};

function toForm(f?: Festival): Form {
  if (!f) {
    return {
      name: '',
      slug: '',
      slugTouched: false,
      description: '',
      banner_key: null,
      useColor: false,
      color: '#1760d9',
      starts_on: todayIST(),
      ends_on: '',
      submissions_close_on: '',
      is_active: false,
      sort_order: '0',
    };
  }
  return {
    name: f.name,
    slug: f.slug,
    slugTouched: true,
    description: f.description ?? '',
    banner_key: f.banner_key,
    useColor: f.theme_color != null,
    color: f.theme_color ?? '#1760d9',
    starts_on: f.starts_on,
    ends_on: f.ends_on,
    submissions_close_on: f.submissions_close_on ?? '',
    is_active: f.is_active,
    sort_order: String(f.sort_order),
  };
}

function FestivalForm({ festival }: { festival?: Festival }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(() => toForm(festival));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const save = useMutation({
    mutationFn: (row: FestivalInput) => saveFestival(festival?.id ?? null, row),
    onSuccess: (newId) => {
      invalidate(...ENG_KEYS);
      toast(festival ? 'Festival saved' : 'Festival created');
      if (!festival) navigate(`/admin/festivals/${newId}`, { replace: true });
    },
    onError: (e) => setError(engError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteFestival(festival!.id),
    onSuccess: () => {
      invalidate(...ENG_KEYS);
      toast('Festival deleted');
      navigate('/admin/festivals', { replace: true });
    },
    onError: (e) => setError(engError(e, 'This festival is still in use, so it cannot be deleted.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const sort = toNumber(f.sort_order);
    if (f.name.trim().length < 2) return setError('Enter the festival name.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug))
      return setError('The web address may only use small letters, numbers and single dashes.');
    if (!f.starts_on || !f.ends_on) return setError('Choose the start and end dates.');
    if (f.ends_on < f.starts_on) return setError('The end date cannot be before the start date.');
    if (f.useColor && !/^#[0-9a-fA-F]{6}$/.test(f.color)) return setError('Pick a theme colour.');
    if (sort == null || !Number.isInteger(sort)) return setError('Sort order must be a whole number.');
    save.mutate({
      name: f.name.trim(),
      slug: f.slug,
      description: f.description.trim() || null,
      banner_key: f.banner_key,
      theme_color: f.useColor ? f.color.toLowerCase() : null,
      starts_on: f.starts_on,
      ends_on: f.ends_on,
      submissions_close_on: f.submissions_close_on || null,
      is_active: f.is_active,
      sort_order: sort,
    });
  };

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="field">
        <label htmlFor="fe-name">Name</label>
        <input
          id="fe-name"
          value={f.name}
          maxLength={80}
          required
          placeholder="Onam 2026"
          onChange={(e) =>
            set({ name: e.target.value, ...(f.slugTouched ? {} : { slug: slugify(e.target.value) }) })
          }
        />
      </div>
      <div className="field">
        <label htmlFor="fe-slug">Web address</label>
        <input
          id="fe-slug"
          value={f.slug}
          maxLength={80}
          required
          onChange={(e) => set({ slug: slugify(e.target.value), slugTouched: true })}
        />
        <div className="hint">
          The festival page is /festival/{f.slug || '…'}
          {festival ? '. Changing it breaks links already shared.' : ''}
        </div>
      </div>
      <div className="field">
        <label htmlFor="fe-desc">Description</label>
        <textarea
          id="fe-desc"
          maxLength={1000}
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <ImageField
        label="Banner"
        folder="ads"
        aspect="2 / 1"
        value={f.banner_key}
        onChange={(k) => set({ banner_key: k })}
      />
      <div className="field">
        <label htmlFor="fe-color">Theme colour</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="fe-color"
            type="color"
            value={f.color}
            disabled={!f.useColor}
            onChange={(e) => set({ color: e.target.value })}
            style={{ width: 56, height: 40, padding: 2, flex: 'none', opacity: f.useColor ? 1 : 0.4 }}
          />
          <label className="check-row" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={f.useColor}
              onChange={(e) => set({ useColor: e.target.checked })}
            />
            {f.useColor ? `Custom colour ${f.color}` : 'Custom colour (off: default blue)'}
          </label>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="fe-start">Starts on</label>
          <input
            id="fe-start"
            type="date"
            required
            value={f.starts_on}
            onChange={(e) => set({ starts_on: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="fe-end">Ends on</label>
          <input
            id="fe-end"
            type="date"
            required
            min={f.starts_on || undefined}
            value={f.ends_on}
            onChange={(e) => set({ ends_on: e.target.value })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="fe-close">Submissions close on</label>
          <input
            id="fe-close"
            type="date"
            value={f.submissions_close_on}
            onChange={(e) => set({ submissions_close_on: e.target.value })}
          />
          <div className="hint">Empty: vendors can submit until the last day.</div>
        </div>
        <div className="field">
          <label htmlFor="fe-sort">Sort order</label>
          <input
            id="fe-sort"
            type="number"
            step={1}
            inputMode="numeric"
            value={f.sort_order}
            onChange={(e) => set({ sort_order: e.target.value })}
          />
          <div className="hint">Lower numbers show first.</div>
        </div>
      </div>
      <div className="hint" style={{ fontSize: 11, color: 'var(--color-muted)', margin: '-6px 0 12px' }}>
        Dates are India dates.
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Festival on (customers see it and vendors can submit offers)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : festival ? 'Save festival' : 'Create festival'}
        </button>
        {festival && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${festival.name}?\n\nAll offers submitted to it and any requests for it are removed ` +
                    'too. To hide it but keep its history, switch it off instead.',
                )
              )
                remove.mutate();
            }}
          >
            Delete festival
          </button>
        )}
      </div>
    </form>
  );
}

const FILTERS: { key: ReviewStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function Submissions({ festival }: { festival: Festival }) {
  const [status, setStatus] = useState<ReviewStatus>('pending');
  const rows = useSubmissions(festival.id, status);
  return (
    <section style={{ marginTop: 18 }}>
      <div className="section-head">
        <h2>Submissions</h2>
        <span className="meta">Close {formatDate(festival.submissions_close_on ?? festival.ends_on)}</span>
      </div>
      <div className="filter-bar" role="tablist" style={{ marginTop: 0 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={status === f.key}
            className={`chip${status === f.key ? ' active' : ''}`}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {rows.isPending && <Loading />}
      {rows.error && <ErrorNotice error={rows.error} />}
      {rows.data?.length === 0 && (
        <Empty emoji="🏷️" title={status === 'pending' ? 'Nothing to review' : 'No offers here'}>
          {status === 'pending' ? 'Offers vendors submit to this festival show up here.' : undefined}
        </Empty>
      )}
      {rows.data?.map((r) => (
        <SubmissionCard key={r.offer_id} row={r} />
      ))}
    </section>
  );
}

function SubmissionCard({ row: r }: { row: SubmissionRow }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const offer = one(r.offer);
  const shop = one(offer?.shop);
  const cover = offer?.image_keys[0];

  const review = useMutation({
    mutationFn: (v: { status: ReviewStatus; note: string | null }) =>
      reviewSubmission(r.festival_id, r.offer_id, v.status, v.note),
    onSuccess: (_, v) => {
      invalidate(...ENG_KEYS);
      toast(v.status === 'approved' ? 'Offer approved for this festival' : 'Offer rejected');
    },
    onError: (e) => toast(engError(e)),
  });

  const reject = () => {
    let note = window.prompt('Why is this offer not right for the festival? The vendor will see this.', '');
    while (note !== null && !note.trim()) {
      note = window.prompt('A reason is required so the vendor knows what to change.', '');
    }
    if (note === null) return;
    review.mutate({ status: 'rejected', note: note.trim().slice(0, 300) });
  };

  return (
    <div className="manage-card">
      <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 12 }}>
        <div className="shop-thumb" style={{ width: 64, height: 64 }}>
          {cover ? <img src={mediaUrl(cover)} alt="" /> : '🏷️'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            <span className={`pill-status ${r.status}`}>{r.status}</span>
            {offer?.discount_label && <span className="pill-status featured">{offer.discount_label}</span>}
          </div>
          <h4>{offer?.title ?? `Offer #${r.offer_id}`}</h4>
          <div className="meta">
            {shop?.name ?? 'Unknown shop'} · submitted {formatDate(r.submitted_at)}
            {r.reviewed_at ? ` · reviewed ${formatDate(r.reviewed_at)}` : ''}
          </div>
        </div>
      </div>
      {offer && offer.status !== 'approved' && (
        <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
          The offer itself is <b>{offer.status}</b> in the Offers tab. Customers only see it on the festival
          page once both are approved.
        </div>
      )}
      {r.note && (
        <div className="notice bad" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Note:</b> {r.note}
        </div>
      )}
      <div className="btn-row">
        {r.status !== 'approved' && (
          <button
            className="btn small"
            disabled={review.isPending}
            onClick={() => review.mutate({ status: 'approved', note: null })}
          >
            Approve
          </button>
        )}
        {r.status !== 'rejected' && (
          <button className="btn small danger" disabled={review.isPending} onClick={reject}>
            Reject
          </button>
        )}
      </div>
    </div>
  );
}
