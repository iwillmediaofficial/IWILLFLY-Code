import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import { locationPath } from '../../lib/locationPath';
import { flushPushQueue } from '../../lib/push';
import { db, must, useCategories, useLocations } from '../../lib/queries';
import type { BroadcastAudience } from '../../lib/types';
import { generateVapidKeys } from '../../lib/vapid';
import { Empty, ErrorNotice, Loading } from '../ui';
import { useInvalidate } from '../util';
import {
  ENG_KEY,
  engError,
  festivalStatus,
  sendBroadcast,
  useAudienceSize,
  useBroadcasts,
  useFestivals,
  type BroadcastInput,
} from './api';

const AUDIENCES: { key: BroadcastAudience; label: string }[] = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'customers', label: 'Customers' },
  { key: 'vendors', label: 'Vendors' },
];

const AUDIENCE_LABEL: Record<BroadcastAudience, string> = {
  everyone: 'Everyone',
  customers: 'Customers',
  vendors: 'Vendors',
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminNotify() {
  return (
    <>
      <Composer />
      <History />
      <PushSetup />
    </>
  );
}

function Composer() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: locations = [] } = useLocations();
  const { data: categories = [] } = useCategories();
  const festivals = useFestivals();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [audience, setAudience] = useState<BroadcastAudience>('everyone');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [push, setPush] = useState(true);
  const [error, setError] = useState('');
  const size = useAudienceSize(audience, locationId, categoryId);

  const places = useMemo(
    () =>
      locations
        .filter((l) => l.is_active)
        .map((l) => ({ id: l.id, label: locationPath(locations, l.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [locations],
  );

  const picks = useMemo(
    () => [
      { path: '/scratch', label: 'Scratch & Win' },
      ...(festivals.data ?? [])
        .filter((f) => {
          const s = festivalStatus(f);
          return s === 'live' || s === 'upcoming';
        })
        .map((f) => ({ path: `/festival/${f.slug}`, label: f.name })),
      { path: '/explore', label: 'Explore' },
      { path: '/prizes', label: 'My prizes' },
    ],
    [festivals.data],
  );

  const send = useMutation({
    mutationFn: async (b: BroadcastInput) => {
      const res = await sendBroadcast(b);
      if (b.push && res.recipients > 0) await flushPushQueue();
      return res;
    },
    onSuccess: (res) => {
      invalidate([ENG_KEY, 'broadcasts']);
      toast(`Sent to ${res.recipients} ${res.recipients === 1 ? 'person' : 'people'}`);
      setTitle('');
      setBody('');
      setLink('');
    },
    onError: (e) => setError(engError(e)),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const t = title.trim();
    const l = link.trim();
    if (t.length < 2) return setError('Enter a title.');
    if (l && (!l.startsWith('/') || l.startsWith('//') || /\s/.test(l)))
      return setError('The link must be an app path starting with /, like /explore.');
    let n: number;
    try {
      n = Number(
        must<number>(
          await db().rpc('broadcast_audience_size', {
            p_audience: audience,
            p_location_id: locationId,
            p_category_id: categoryId,
          }),
        ),
      );
    } catch (err) {
      return setError(engError(err));
    }
    if (n === 0) return setError('Nobody matches this audience. Widen the area or category.');
    if (
      !window.confirm(
        `Send to ${n} ${n === 1 ? 'person' : 'people'}?${push ? '\n\nAlso as a push notification.' : ''}`,
      )
    )
      return;
    send.mutate({
      title: t,
      body: body.trim() || null,
      link: l || null,
      audience,
      location_id: locationId,
      category_id: categoryId,
      push,
    });
  };

  return (
    <section>
      <div className="section-head">
        <h2>Send a notification</h2>
      </div>
      <form className="form-card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="nt-title">Title ({title.length}/80)</label>
          <input
            id="nt-title"
            value={title}
            maxLength={80}
            required
            placeholder="Onam offers are live!"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="nt-body">Message ({body.length}/300)</label>
          <textarea id="nt-body" maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nt-link">Opens (app link)</label>
          <input
            id="nt-link"
            value={link}
            maxLength={300}
            placeholder="/explore"
            onChange={(e) => setLink(e.target.value)}
          />
          <div className="filter-bar" style={{ margin: '8px 0 0' }}>
            {picks.map((p) => (
              <button
                key={p.path}
                type="button"
                className={`chip${link === p.path ? ' active' : ''}`}
                onClick={() => setLink(p.path)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="hint">Optional. A path inside the app, starting with /.</div>
        </div>
        <div className="field">
          <label>Send to</label>
          <div className="tabs" role="radiogroup" style={{ marginBottom: 0 }}>
            {AUDIENCES.map((a) => (
              <button
                key={a.key}
                type="button"
                role="radio"
                aria-checked={audience === a.key}
                className={audience === a.key ? 'active' : ''}
                onClick={() => setAudience(a.key)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="nt-area">Area</label>
            <select
              id="nt-area"
              value={locationId ?? ''}
              onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All areas</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nt-cat">Category</label>
            <select
              id="nt-cat"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hint" style={{ fontSize: 11, color: 'var(--color-muted)', margin: '-6px 0 12px' }}>
          Customers match by their chosen area and what they saved; vendors by their branches and shop
          category.
        </div>
        <label className="check-row">
          <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
          Also send as a push notification
        </label>
        <div className="notice" style={{ marginTop: 4 }}>
          {size.isPending ? (
            'Counting people…'
          ) : size.error ? (
            <>Could not count: {engError(size.error)}</>
          ) : (
            <>
              Reaches <b>{size.data}</b> {size.data === 1 ? 'person' : 'people'} in the app
              {push ? ' (push only on phones where they turned notifications on)' : ''}.
            </>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="btn-row">
          <button className="btn" type="submit" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send notification'}
          </button>
        </div>
      </form>
    </section>
  );
}

function History() {
  const { data: locations = [] } = useLocations();
  const { data: categories = [] } = useCategories();
  const broadcasts = useBroadcasts();
  return (
    <section style={{ marginTop: 18 }}>
      <div className="section-head">
        <h2>Sent</h2>
        <span className="meta">Latest 50</span>
      </div>
      {broadcasts.isPending && <Loading />}
      {broadcasts.error && <ErrorNotice error={broadcasts.error} />}
      {broadcasts.data?.length === 0 && (
        <Empty emoji="🔔" title="Nothing sent yet">
          Notifications you send show up here.
        </Empty>
      )}
      {broadcasts.data?.map((b) => {
        const filters = [
          b.location_id != null ? locationPath(locations, b.location_id) || 'An area' : null,
          b.category_id != null
            ? (categories.find((c) => c.id === b.category_id)?.name ?? 'A category')
            : null,
        ].filter(Boolean);
        return (
          <div key={b.id} className="manage-card">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <h4>{b.title}</h4>
                {b.body && (
                  <p style={{ fontSize: 13, margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>{b.body}</p>
                )}
              </div>
              <span className="pill-status">{AUDIENCE_LABEL[b.audience]}</span>
            </div>
            <div className="meta">
              {b.recipients} {b.recipients === 1 ? 'person' : 'people'} · {when(b.created_at)}
              {b.with_push ? ' · push' : ''}
              {b.link ? ` · ${b.link}` : ''}
              {filters.length > 0 ? ` · ${filters.join(', ')}` : ''}
            </div>
          </div>
        );
      })}
    </section>
  );
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function CopyBox({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        readOnly
        value={value}
        rows={value.length > 100 ? 4 : 2}
        onFocus={(e) => e.target.select()}
        style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 0, wordBreak: 'break-all' }}
      />
      <button
        type="button"
        className="btn small secondary"
        style={{ marginTop: 6 }}
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => toast(`${label} copied`))
            .catch(() => toast('Could not copy. Select the text and copy it by hand.'))
        }
      >
        Copy
      </button>
    </div>
  );
}

function PushSetup() {
  const [keys, setKeys] = useState<{ publicKey: string; privateJwk: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (
      keys &&
      !window.confirm(
        'Make a new pair of keys? The keys shown now will be replaced. Only use the newest pair.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      setKeys(await generateVapidKeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This browser could not create keys.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: 18 }}>
      <div className="section-head">
        <h2>Push notification setup</h2>
        {VAPID_PUBLIC_KEY && <span className="pill-status live">Configured</span>}
      </div>
      <div className="manage-card">
        {VAPID_PUBLIC_KEY ? (
          <>
            <p style={{ fontSize: 13, margin: 0 }}>
              Push is configured. Customers and vendors who turn on notifications get your messages on their
              phone, even when the app is closed.
            </p>
            <p className="meta" style={{ margin: '8px 0 0' }}>
              Making new push keys later stops pushes to everyone who turned notifications on with the old
              keys, until they turn them on again. Only do it if the private key leaked.
            </p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, margin: '0 0 10px' }}>
              Push is not set up yet. In-app messages (the bell in the app) already work without this; push
              also shows them on the phone when the app is closed. Do this once:
            </p>
            <ol style={{ fontSize: 13, paddingLeft: 20, margin: 0, display: 'grid', gap: 10 }}>
              <li>
                Tap <b>Create push keys</b>. The keys are made here in your browser.
                <div style={{ marginTop: 8 }}>
                  <button className="btn small" type="button" disabled={busy} onClick={create}>
                    {busy ? 'Creating…' : keys ? 'Create new keys' : 'Create push keys'}
                  </button>
                </div>
                {error && <p className="error-text">{error}</p>}
                {keys && (
                  <div style={{ marginTop: 10 }}>
                    <CopyBox label="Public key" value={keys.publicKey} />
                    <div className="notice bad">
                      <b>The private key is a secret.</b> Paste it only into Cloudflare as shown below. Never
                      share it in chat, email or with anyone, including Claude. Leave this page open until you
                      have saved both keys; they are not stored anywhere else.
                    </div>
                    <CopyBox label="Private key" value={keys.privateJwk} />
                  </div>
                )}
              </li>
              <li>
                In Cloudflare open <b>Workers &amp; Pages › iwillfly › Settings › Build › Variables</b> and
                add <code>VITE_VAPID_PUBLIC_KEY</code> = the public key.
              </li>
              <li>
                In <b>Settings › Variables and Secrets</b> add:
                <ul style={{ paddingLeft: 18, margin: '6px 0 0', display: 'grid', gap: 4 }}>
                  <li>
                    secret <code>VAPID_PRIVATE_JWK</code> = the private key
                  </li>
                  <li>
                    secret <code>SUPABASE_SERVICE_ROLE_KEY</code> = the “service_role” (secret) key from
                    Supabase › Project Settings › API Keys
                  </li>
                  <li>
                    text variable <code>VAPID_SUBJECT</code> = <code>mailto:</code> followed by your email,
                    e.g. mailto:you@example.com
                  </li>
                </ul>
              </li>
              <li>
                Redeploy: open the latest deployment and tap <b>Retry build</b>. When it finishes, this card
                says “Configured”.
              </li>
            </ol>
            <p className="meta" style={{ margin: '10px 0 0' }}>
              Making new keys later stops pushes to browsers that turned notifications on with the old keys,
              until those people turn notifications on again.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
