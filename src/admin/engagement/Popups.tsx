import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { PopupCard, PopupLayer, POPUP_ICONS } from '../../components/AnnouncementPopup';
import { ImageListField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import { useLocations } from '../../lib/queries';
import { mediaUrl } from '../../lib/supabase';
import type { Popup, PopupContent, PopupLinkKind } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { toNumber, useInvalidate } from '../util';
import {
  ENG_KEYS,
  deletePopup,
  engError,
  popupStatus,
  savePopup,
  useFestivals,
  useMallRefs,
  usePopup,
  usePopups,
  useShopRefs,
  type PopupInput,
} from './api';
import { StatusPill } from './StatusPill';
import { Eye, Image as ImageIcon, Megaphone, Plus, Star, Type } from 'lucide-react';
import { Icon } from '../../components/Icon';

export default function AdminPopups() {
  return (
    <Routes>
      <Route index element={<PopupList />} />
      <Route path="new" element={<PopupEdit />} />
      <Route path=":id" element={<PopupEdit />} />
      <Route path="*" element={<Navigate to="/admin/popups" replace />} />
    </Routes>
  );
}

const LINK_KINDS: { key: PopupLinkKind; label: string }[] = [
  { key: 'none', label: 'Nothing (only a Close button)' },
  { key: 'page', label: 'An app page' },
  { key: 'offer', label: 'An offer' },
  { key: 'shop', label: 'A shop' },
  { key: 'festival', label: 'A festival' },
  { key: 'mall', label: 'A mall' },
  { key: 'url', label: 'A web address' },
];

const PAGES: { path: string; label: string }[] = [
  { path: '/scratch', label: 'Scratch & Win' },
  { path: '/points/add', label: 'Add a bill' },
  { path: '/points', label: 'Reward points' },
  { path: '/explore', label: 'Explore offers' },
  { path: '/malls', label: 'Malls' },
  { path: '/prizes', label: 'My prizes' },
  { path: '/', label: 'Home' },
];

const FREQUENCY: { key: Popup['frequency']; label: string; hint: string }[] = [
  { key: 'once', label: 'Once per customer', hint: 'Each customer sees it one time only.' },
  { key: 'daily', label: 'Once a day', hint: 'At most once a day for each customer.' },
  { key: 'visit', label: 'Every visit', hint: 'Each time the app is opened, at most once an hour.' },
];

const AUDIENCE: { key: Popup['audience']; label: string }[] = [
  { key: 'all', label: 'All districts' },
  { key: 'districts', label: 'Pick districts' },
  { key: 'areas', label: 'Pick areas' },
];

/** India time, as a datetime-local input wants it ("2026-10-31T09:00"). */
function toLocalIST(iso: string) {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 16);
}

function fromLocalIST(v: string) {
  return new Date(`${v}:00+05:30`).toISOString();
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function runs(p: Pick<Popup, 'starts_at' | 'ends_at'>) {
  return `${shortDate(p.starts_at)} – ${p.ends_at ? shortDate(p.ends_at) : 'no end'}`;
}

function percent(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

function Thumb({ p }: { p: Pick<Popup, 'style' | 'image_key' | 'icon'> }) {
  if (p.style === 'picture' && p.image_key)
    return <img className="popup-thumb" src={mediaUrl(p.image_key)} alt="" loading="lazy" />;
  const glyph = POPUP_ICONS.find((i) => i.key === p.icon)?.icon ?? Star;
  return (
    <span className="popup-thumb">
      <Icon icon={glyph} size={20} />
    </span>
  );
}

type Tab = 'live' | 'off' | 'ended';

function PopupList() {
  const popups = usePopups();
  const [tab, setTab] = useState<Tab>('live');
  const { data: locations } = useLocations();
  const names = useMemo(() => new Map((locations ?? []).map((l) => [l.id, l.name])), [locations]);
  const groups = useMemo(() => {
    const g: Record<Tab, Popup[]> = { live: [], off: [], ended: [] };
    for (const p of popups.data ?? []) {
      const s = popupStatus(p);
      g[s === 'ended' ? 'ended' : s === 'off' ? 'off' : 'live'].push(p);
    }
    return g;
  }, [popups.data]);
  const list = groups[tab];
  const who = (p: Popup) =>
    p.audience === 'all'
      ? 'All districts'
      : p.location_ids.map((id) => names.get(id) ?? `#${id}`).join(', ') || '–';

  return (
    <>
      <div className="section-head">
        <h2>Pop-ups</h2>
        <Link className="btn small" to="/admin/popups/new">
          <Icon icon={Plus} /> New pop-up
        </Link>
      </div>
      <p className="meta" style={{ marginTop: 0 }}>
        A pop-up shows over the customer app to announce a big offer or a new reward. Customers see one at a
        time, the lowest order number first.
      </p>
      <div className="filter-bar" role="tablist">
        {(
          [
            ['live', 'Live & scheduled'],
            ['off', 'Switched off'],
            ['ended', 'Ended'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`chip${tab === k ? ' active' : ''}`}
            onClick={() => setTab(k)}
          >
            {label} ({groups[k].length})
          </button>
        ))}
      </div>
      {popups.isPending && <Loading />}
      {popups.error && <ErrorNotice error={popups.error} />}
      {popups.data && list.length === 0 && (
        <Empty icon={Megaphone} title={popups.data.length ? 'Nothing here' : 'No pop-ups yet'}>
          {popups.data.length ? 'No pop-ups in this list.' : 'Announce a big offer or a new reward system.'}
        </Empty>
      )}
      <div className="popup-list">
        {list.map((p) => (
          <Link key={p.id} to={`/admin/popups/${p.id}`} className="manage-card" style={{ display: 'block' }}>
            <div className="popup-row">
              <Thumb p={p} />
              <div className="grow">
                <b>{p.title}</b>
                <div className="meta">{runs(p)}</div>
                <div className="meta">
                  {who(p)} · {FREQUENCY.find((f) => f.key === p.frequency)?.label}
                </div>
                <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <StatusPill status={popupStatus(p)} />
                  <span className="pill-status">{p.style === 'picture' ? 'Picture' : 'Text card'}</span>
                </div>
              </div>
            </div>
            <div className="popup-stats">
              <div>
                <b>{p.seen_count.toLocaleString('en-IN')}</b>
                <span>Seen</span>
              </div>
              <div>
                <b>{p.tapped_count.toLocaleString('en-IN')}</b>
                <span>Tapped {percent(p.tapped_count, p.seen_count)}</span>
              </div>
              <div>
                <b>{p.closed_count.toLocaleString('en-IN')}</b>
                <span>Closed</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function PopupEdit() {
  const { id } = useParams();
  const popupId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const popup = usePopup(popupId);
  if (id != null && popupId == null) return <ErrorNotice error={new Error('No such pop-up.')} />;
  return (
    <>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {popupId ? 'Edit pop-up' : 'New pop-up'}
          </span>
          {popup.data && <StatusPill status={popupStatus(popup.data)} />}
        </h2>
        <Link to="/admin/popups">‹ All pop-ups</Link>
      </div>
      {popupId == null && <PopupForm />}
      {popupId != null && popup.isPending && <Loading />}
      {popup.error && <ErrorNotice error={popup.error} />}
      {popup.data && <PopupForm key={popup.data.updated_at} popup={popup.data} />}
    </>
  );
}

type Form = {
  style: Popup['style'];
  image_key: string | null;
  icon: Popup['icon'];
  tag: string;
  title: string;
  message: string;
  bullets: [string, string, string];
  button_text: string;
  link_kind: PopupLinkKind;
  link_target: string;
  audience: Popup['audience'];
  location_ids: number[];
  starts_at: string;
  ends_at: string;
  frequency: Popup['frequency'];
  show_on: Popup['show_on'];
  add_to_inbox: boolean;
  sort_order: string;
  is_active: boolean;
};

function toForm(p?: Popup): Form {
  const b = p?.bullets ?? [];
  const now = toLocalIST(new Date().toISOString());
  return {
    style: p?.style ?? 'picture',
    image_key: p?.image_key ?? null,
    icon: p?.icon ?? 'star',
    tag: p?.tag ?? '',
    title: p?.title ?? '',
    message: p?.message ?? '',
    bullets: [b[0] ?? '', b[1] ?? '', b[2] ?? ''],
    button_text: p?.button_text ?? '',
    link_kind: p?.link_kind ?? 'none',
    link_target: p?.link_target ?? '',
    audience: p?.audience ?? 'all',
    location_ids: p?.location_ids ?? [],
    starts_at: p ? toLocalIST(p.starts_at) : now,
    ends_at: p?.ends_at ? toLocalIST(p.ends_at) : '',
    frequency: p?.frequency ?? 'once',
    show_on: p?.show_on ?? 'home',
    add_to_inbox: p?.add_to_inbox ?? true,
    sort_order: String(p?.sort_order ?? 0),
    is_active: p?.is_active ?? true,
  };
}

/** A row of buttons that work like radio buttons. */
function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg-pick" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PopupForm({ popup }: { popup?: Popup }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(() => toForm(popup));
  const [error, setError] = useState('');
  const [showing, setShowing] = useState(false);
  const [q, setQ] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const shops = useShopRefs(f.link_kind === 'shop');
  const malls = useMallRefs(f.link_kind === 'mall');
  const festivals = useFestivals();
  const locations = useLocations();

  const save = useMutation({
    mutationFn: (row: PopupInput) => savePopup(popup?.id ?? null, row),
    onSuccess: () => {
      invalidate(...ENG_KEYS);
      toast(popup ? 'Pop-up saved' : 'Pop-up created');
      navigate('/admin/popups', { replace: true });
    },
    onError: (e) => setError(engError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deletePopup(popup!.id),
    onSuccess: () => {
      invalidate(...ENG_KEYS);
      toast('Pop-up deleted');
      navigate('/admin/popups', { replace: true });
    },
    onError: (e) => setError(engError(e)),
  });

  const content: Omit<PopupContent, 'id'> = {
    style: f.style,
    image_key: f.image_key,
    icon: f.icon,
    tag: f.tag.trim() || null,
    title: f.title.trim(),
    message: f.message.trim() || null,
    bullets: f.bullets.map((b) => b.trim()).filter(Boolean),
    button_text: f.button_text.trim() || null,
    link_kind: f.link_kind,
    link_target: f.link_kind === 'none' ? null : f.link_target.trim() || null,
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const sort = toNumber(f.sort_order);
    const target = f.link_target.trim();
    if (content.title.length < 2) return setError('Write a title (at least 2 letters).');
    if (f.style === 'picture' && !f.image_key) return setError('Add the picture, or choose Text card.');
    if (f.link_kind !== 'none' && !target) return setError('Choose where the button opens.');
    if (f.link_kind !== 'none' && !content.button_text) return setError('Write the button text.');
    if (f.link_kind === 'url' && !/^https:\/\/[^\s]+\.[^\s]+$/.test(target))
      return setError('The web address must start with https://');
    if (f.link_kind === 'offer' && !/^\d+$/.test(target))
      return setError('Enter the offer number (the digits at the end of the offer link).');
    if (f.audience !== 'all' && f.location_ids.length === 0)
      return setError(f.audience === 'districts' ? 'Tick at least one district.' : 'Tick at least one area.');
    if (!f.starts_at) return setError('Choose when it starts.');
    if (f.ends_at && f.ends_at <= f.starts_at) return setError('The end must be after the start.');
    if (sort == null || !Number.isInteger(sort)) return setError('Order must be a whole number.');
    save.mutate({
      ...content,
      image_key: f.style === 'picture' ? f.image_key : null,
      bullets: f.style === 'card' ? content.bullets : [],
      button_text: f.link_kind === 'none' ? null : content.button_text,
      audience: f.audience,
      location_ids: f.audience === 'all' ? [] : f.location_ids,
      starts_at: fromLocalIST(f.starts_at),
      ends_at: f.ends_at ? fromLocalIST(f.ends_at) : null,
      frequency: f.frequency,
      show_on: f.show_on,
      add_to_inbox: f.add_to_inbox,
      sort_order: sort,
      is_active: f.is_active,
    });
  };

  const targetField = () => {
    switch (f.link_kind) {
      case 'none':
        return null;
      case 'page':
        return (
          <select id="pp-target" value={f.link_target} onChange={(e) => set({ link_target: e.target.value })}>
            <option value="">Choose…</option>
            {PAGES.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </select>
        );
      case 'url':
        return (
          <input
            id="pp-target"
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
            id="pp-target"
            inputMode="numeric"
            placeholder="Offer number, e.g. 42"
            maxLength={20}
            value={f.link_target}
            onChange={(e) => set({ link_target: e.target.value.replace(/\D/g, '') })}
          />
        );
      default: {
        const q2 = f.link_kind === 'shop' ? shops : f.link_kind === 'mall' ? malls : festivals;
        const options =
          f.link_kind === 'festival'
            ? (festivals.data ?? []).map((x) => ({ value: x.slug, label: x.name }))
            : ((f.link_kind === 'shop' ? shops.data : malls.data) ?? []).map((x) => ({
                value: String(x.id),
                label: x.name,
              }));
        const known = options.some((o) => o.value === f.link_target);
        return (
          <select id="pp-target" value={f.link_target} onChange={(e) => set({ link_target: e.target.value })}>
            <option value="">{q2.isPending ? 'Loading…' : 'Choose…'}</option>
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

  const kind = f.audience === 'districts' ? 'district' : 'area';
  const all = locations.data ?? [];
  const byId = new Map(all.map((l) => [l.id, l]));
  const parentName = (id: number | null) => (id != null ? byId.get(id)?.name : undefined);
  const needle = q.trim().toLowerCase();
  const places = all
    .filter((l) => l.kind === kind)
    .filter((l) => !needle || l.name.toLowerCase().includes(needle) || f.location_ids.includes(l.id));
  const toggle = (id: number) =>
    set({
      location_ids: f.location_ids.includes(id)
        ? f.location_ids.filter((x) => x !== id)
        : [...f.location_ids, id],
    });

  return (
    <form onSubmit={submit} className="popup-edit">
      <div className="form-card">
        <div className="field">
          <label>Style</label>
          <Seg
            label="Style"
            value={f.style}
            onChange={(style) => set({ style })}
            options={[
              {
                key: 'picture',
                label: (
                  <>
                    <Icon icon={ImageIcon} /> Picture
                  </>
                ),
              },
              {
                key: 'card',
                label: (
                  <>
                    <Icon icon={Type} /> Text card
                  </>
                ),
              },
            ]}
          />
          <div className="hint">
            {f.style === 'picture'
              ? 'For a big offer: your 4:5 poster on top, the title and message below.'
              : 'For a new reward: a blue header with an icon, and up to 3 short points.'}
          </div>
        </div>
        {f.style === 'picture' ? (
          <ImageListField
            label="Picture"
            folder="ads"
            poster
            max={1}
            value={f.image_key ? [f.image_key] : []}
            onChange={(keys) => set({ image_key: keys[0] ?? null })}
          />
        ) : (
          <div className="field">
            <label>Icon</label>
            <div className="filter-bar" role="radiogroup" style={{ margin: 0, flexWrap: 'wrap' }}>
              {POPUP_ICONS.map((i) => (
                <button
                  key={i.key}
                  type="button"
                  role="radio"
                  aria-checked={f.icon === i.key}
                  className={`chip${f.icon === i.key ? ' active' : ''}`}
                  onClick={() => set({ icon: i.key })}
                >
                  <Icon icon={i.icon} /> {i.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="pp-tag">Tag (optional)</label>
          <input
            id="pp-tag"
            value={f.tag}
            maxLength={24}
            placeholder={f.style === 'card' ? 'NEW REWARD' : 'MAIN FESTIVAL OFFER'}
            onChange={(e) => set({ tag: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="field">
          <label htmlFor="pp-title">Title</label>
          <input
            id="pp-title"
            value={f.title}
            maxLength={60}
            required
            placeholder={f.style === 'card' ? 'Earn points on every shop bill' : 'Diwali Mega Sale is live!'}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="pp-msg">Message (optional)</label>
          <textarea
            id="pp-msg"
            rows={3}
            maxLength={200}
            value={f.message}
            placeholder="Up to 60% off at 200+ shops near you."
            onChange={(e) => set({ message: e.target.value })}
          />
          <div className="hint">{f.message.length}/200</div>
        </div>
        {f.style === 'card' && (
          <div className="field">
            <label>Points (optional, up to 3)</label>
            {f.bullets.map((b, i) => (
              <input
                key={i}
                aria-label={`Point ${i + 1}`}
                value={b}
                maxLength={60}
                style={{ marginTop: i ? 6 : 0 }}
                placeholder={['Every ₹50 on your bill = 1 point', '1 point = ₹1', 'Cash out to UPI'][i]}
                onChange={(e) => {
                  const next = [...f.bullets] as Form['bullets'];
                  next[i] = e.target.value;
                  set({ bullets: next });
                }}
              />
            ))}
          </div>
        )}
        <div className="field-row">
          <div className="field">
            <label htmlFor="pp-kind">Button opens</label>
            <select
              id="pp-kind"
              value={f.link_kind}
              onChange={(e) => set({ link_kind: e.target.value as PopupLinkKind, link_target: '' })}
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
              <label htmlFor="pp-target">
                {LINK_KINDS.find((k) => k.key === f.link_kind)?.label.replace(/^(A|An) /, '')}
              </label>
              {targetField()}
            </div>
          )}
        </div>
        {f.link_kind !== 'none' && (
          <div className="field">
            <label htmlFor="pp-btn">Button text</label>
            <input
              id="pp-btn"
              value={f.button_text}
              maxLength={24}
              placeholder={f.style === 'card' ? 'Add a bill' : 'See offers'}
              onChange={(e) => set({ button_text: e.target.value })}
            />
          </div>
        )}

        <h3 style={{ margin: '18px 0 10px', fontSize: 15 }}>Who and when</h3>
        <div className="field">
          <label>Who sees it</label>
          <Seg
            label="Who sees it"
            value={f.audience}
            onChange={(audience) => {
              set({ audience, location_ids: [] });
              setQ('');
            }}
            options={AUDIENCE}
          />
          {f.audience !== 'all' && (
            <>
              <input
                type="search"
                style={{ marginTop: 8 }}
                placeholder={`Search ${kind}s…`}
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {locations.isPending && <Loading what="Loading locations…" />}
              <div className="check-list" role="group" aria-label={`${kind}s`}>
                {!locations.isPending && places.length === 0 && <p className="meta">No {kind}s match.</p>}
                {places.map((l) => (
                  <label key={l.id}>
                    <input
                      type="checkbox"
                      checked={f.location_ids.includes(l.id)}
                      onChange={() => toggle(l.id)}
                    />
                    <span style={{ minWidth: 0 }}>
                      {l.name}
                      {parentName(l.parent_id) && <span className="sub"> · {parentName(l.parent_id)}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div className="hint">
                {f.location_ids.length} ticked. Customers are matched by the area they picked in the app.
              </div>
            </>
          )}
        </div>
        <div className="field-row popup-dates">
          <div className="field">
            <label htmlFor="pp-start">Starts</label>
            <input
              id="pp-start"
              type="datetime-local"
              required
              value={f.starts_at}
              onChange={(e) => set({ starts_at: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="pp-end">Ends</label>
            <input
              id="pp-end"
              type="datetime-local"
              min={f.starts_at || undefined}
              value={f.ends_at}
              onChange={(e) => set({ ends_at: e.target.value })}
            />
            <div className="hint">India time. Empty: runs until switched off.</div>
          </div>
        </div>
        <div className="field">
          <label>How often</label>
          <Seg
            label="How often"
            value={f.frequency}
            onChange={(frequency) => set({ frequency })}
            options={FREQUENCY}
          />
          <div className="hint">{FREQUENCY.find((x) => x.key === f.frequency)?.hint}</div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Show on</label>
            <Seg
              label="Show on"
              value={f.show_on}
              onChange={(show_on) => set({ show_on })}
              options={[
                { key: 'home', label: 'Home only' },
                { key: 'any', label: 'Any page' },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="pp-sort">Order</label>
            <input
              id="pp-sort"
              type="number"
              step={1}
              inputMode="numeric"
              value={f.sort_order}
              onChange={(e) => set({ sort_order: e.target.value })}
            />
            <div className="hint">When two are live, the lower number shows first.</div>
          </div>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={f.add_to_inbox}
            onChange={(e) => set({ add_to_inbox: e.target.checked })}
          />
          Also add to the customer’s Notifications, so they can find it again after closing
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={f.is_active}
            onChange={(e) => set({ is_active: e.target.checked })}
          />
          Show to customers (off = saved as a draft)
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="btn-row">
          <button className="btn" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : popup ? 'Save pop-up' : 'Create pop-up'}
          </button>
          <button className="btn secondary" type="button" onClick={() => setShowing(true)}>
            <Icon icon={Eye} /> Show it to me now
          </button>
          {popup && (
            <button
              className="btn danger"
              type="button"
              disabled={remove.isPending}
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                if (window.confirm('Delete this pop-up and its numbers? To keep it, switch it off instead.'))
                  remove.mutate();
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <aside>
        <div className="meta" style={{ fontWeight: 800, marginBottom: 6 }}>
          Preview
        </div>
        <div className="popup-preview" aria-hidden="true" inert>
          <PopupCard popup={content} />
        </div>
        {popup && (
          <div className="popup-stats">
            <div>
              <b>{popup.seen_count.toLocaleString('en-IN')}</b>
              <span>Seen</span>
            </div>
            <div>
              <b>{popup.tapped_count.toLocaleString('en-IN')}</b>
              <span>Tapped {percent(popup.tapped_count, popup.seen_count)}</span>
            </div>
            <div>
              <b>{popup.closed_count.toLocaleString('en-IN')}</b>
              <span>Closed</span>
            </div>
          </div>
        )}
      </aside>
      {showing && (
        <PopupLayer popup={content} onClose={() => setShowing(false)} onTap={() => setShowing(false)} />
      )}
    </form>
  );
}
