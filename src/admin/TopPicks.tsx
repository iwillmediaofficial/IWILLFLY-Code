import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { db, must } from '../lib/queries';
import { money } from './billing/api';
import { Empty, ErrorNotice, Loading } from './ui';
import { formatDate, friendlyError, useInvalidate } from './util';

interface Settings {
  enabled: boolean;
  places_per_district: number;
}
interface Length {
  id: number;
  days: number;
  price: number;
  is_active: boolean;
}
interface AdminPick {
  id: number;
  status: 'awaiting_payment' | 'waiting' | 'live' | 'ended' | 'removed' | 'cancelled';
  district_id: number;
  district_name: string;
  vendor_id: number;
  business_name: string;
  shop_name: string;
  branch_name: string | null;
  offer_id: number;
  offer_title: string;
  offer_live: boolean;
  live_since: string | null;
  queued_at: string | null;
  starts_on: string | null;
  ends_on: string | null;
  waiting_days: number;
  removed_reason: string | null;
  ended_at: string | null;
  views: number;
  taps: number;
  open_invoice: { id: number; number: string; status: 'unpaid' | 'submitted' } | null;
}

const KEY = ['admin', 'top-picks'];
const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export default function AdminTopPicks() {
  return (
    <>
      <div className="notice">
        Vendors and branch managers buy Top Picks themselves for their approved offers. Customers see them on
        Home, above Offers near you, for their own district, first come first shown. Prices are before GST.
      </div>
      <SettingsCard />
      <LengthsCard />
      <PicksList />
      <GiveFree />
    </>
  );
}

function SettingsCard() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: async () =>
      must<Settings | null>(
        await db().from('top_pick_settings').select('enabled, places_per_district').eq('id', 1).maybeSingle(),
      ),
  });
  const [places, setPlaces] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (patch: Partial<Settings>) =>
      must(await db().from('top_pick_settings').update(patch).eq('id', 1).select('id').single()),
    onSuccess: () => {
      invalidate(KEY);
      setPlaces(null);
      toast('Saved');
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const s = q.data;
  const placesValue = places ?? String(s?.places_per_district ?? 10);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Top Picks settings</h2>
      </div>
      {q.error && <ErrorNotice error={q.error} />}
      <div className="form-card">
        <label className="check-row">
          <input
            type="checkbox"
            role="switch"
            checked={s?.enabled === true}
            disabled={!s || save.isPending}
            onChange={(e) => save.mutate({ enabled: e.target.checked })}
          />
          <span>
            <b>{s?.enabled ? 'On' : 'Off'}:</b>{' '}
            {s?.enabled
              ? 'vendors can buy Top Picks and customers see the row on Home.'
              : 'the Top Picks row is hidden and nobody can buy. Set the prices first, then switch it on.'}
          </span>
        </label>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="tp-places">Places per district</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="tp-places"
              type="number"
              min={1}
              max={50}
              value={placesValue}
              onChange={(e) => setPlaces(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <button
              type="button"
              className="btn small"
              disabled={!s || save.isPending || places == null}
              onClick={() => {
                const n = Number(placesValue);
                if (!Number.isInteger(n) || n < 1 || n > 50) return toast('Enter a number from 1 to 50');
                save.mutate({ places_per_district: n });
              }}
            >
              Save
            </button>
          </div>
          <div className="hint">
            How many offers each district's row holds. When it is full, new ones join a waiting list. Lowering
            it does not remove anyone; the row just shows the first ones.
          </div>
        </div>
      </div>
    </section>
  );
}

function LengthsCard() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: [...KEY, 'lengths'],
    queryFn: async () =>
      must<Length[]>(await db().from('top_pick_lengths').select('id, days, price, is_active').order('days')),
  });
  const save = useMutation({
    mutationFn: async (l: { id?: number; days: number; price: number; is_active: boolean }) =>
      l.id
        ? must(
            await db()
              .from('top_pick_lengths')
              .update({ days: l.days, price: l.price, is_active: l.is_active })
              .eq('id', l.id)
              .select('id')
              .single(),
          )
        : must(
            await db()
              .from('top_pick_lengths')
              .insert({ days: l.days, price: l.price, is_active: l.is_active })
              .select('id')
              .single(),
          ),
    onSuccess: () => {
      invalidate(KEY);
      toast('Saved');
    },
    onError: (e) => toast(friendlyError(e, 'There is already a length with those days.')),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => must(await db().from('top_pick_lengths').delete().eq('id', id)),
    onSuccess: () => invalidate(KEY),
    onError: (e) => toast(friendlyError(e)),
  });

  return (
    <section className="section">
      <div className="section-head">
        <h2>Lengths and prices</h2>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <div className="form-card">
          {q.data.map((l) => (
            <LengthRow
              key={`${l.id}-${l.days}-${l.price}-${l.is_active}`}
              length={l}
              busy={save.isPending || remove.isPending}
              onSave={(v) => save.mutate({ ...v, id: l.id })}
              onDelete={() => confirm(`Delete the ${daysText(l.days)} option?`) && remove.mutate(l.id)}
            />
          ))}
          <LengthRow key={`new-${q.data.length}`} busy={save.isPending} onSave={(v) => save.mutate(v)} />
          <p className="meta" style={{ margin: '8px 0 0' }}>
            Vendors see only the ones ticked "On sale". A price of ₹0 makes it free and it starts at once.
          </p>
        </div>
      )}
    </section>
  );
}

function LengthRow({
  length,
  busy,
  onSave,
  onDelete,
}: {
  length?: Length;
  busy: boolean;
  onSave: (v: { days: number; price: number; is_active: boolean }) => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const [days, setDays] = useState(length ? String(length.days) : '');
  const [price, setPrice] = useState(length ? String(length.price) : '');
  const [active, setActive] = useState(length?.is_active ?? true);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = Number(days);
    const p = Number(price);
    if (!Number.isInteger(d) || d < 1 || d > 366) return toast('Days must be a whole number from 1 to 366');
    if (!(p >= 0) || price.trim() === '') return toast('Enter a price (0 or more)');
    onSave({ days: d, price: p, is_active: active });
  };
  return (
    <form
      onSubmit={submit}
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}
    >
      <input
        type="number"
        min={1}
        max={366}
        placeholder="Days"
        aria-label="Days"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        style={{ width: 80 }}
      />
      <span className="meta">days for ₹</span>
      <input
        type="number"
        min={0}
        step="0.01"
        placeholder="Price"
        aria-label="Price in rupees"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        style={{ width: 110 }}
      />
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> On sale
      </label>
      <button type="submit" className="btn small" disabled={busy}>
        {length ? 'Save' : 'Add'}
      </button>
      {onDelete && (
        <button type="button" className="btn danger small" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      )}
    </form>
  );
}

const STATUS: Record<AdminPick['status'], { text: string; cls: string }> = {
  live: { text: 'Live', cls: 'live' },
  waiting: { text: 'Waiting list', cls: 'pending' },
  awaiting_payment: { text: 'Not paid yet', cls: '' },
  ended: { text: 'Ended', cls: '' },
  removed: { text: 'Removed', cls: 'rejected' },
  cancelled: { text: 'Cancelled', cls: '' },
};

function PicksList() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: async () => must<AdminPick[]>(await db().rpc('admin_top_picks')),
  });
  const remove = useMutation({
    mutationFn: async (v: { id: number; reason: string }) =>
      must(await db().rpc('admin_remove_top_pick', { p_id: v.id, p_reason: v.reason })),
    onSuccess: () => {
      invalidate(KEY);
      toast('Removed. The vendor was told why, and the next in line moved up.');
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const [showEnded, setShowEnded] = useState(false);

  const picks = (q.data ?? []).filter(
    (p) => showEnded || ['live', 'waiting', 'awaiting_payment'].includes(p.status),
  );
  const districts = [...new Set(picks.map((p) => p.district_name))];

  return (
    <section className="section">
      <div className="section-head">
        <h2>Top Picks by district</h2>
        <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show
          ended
        </label>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : districts.length === 0 ? (
        <Empty emoji="⭐" title="No Top Picks yet">
          They show here as soon as a vendor starts one.
        </Empty>
      ) : (
        districts.map((d) => {
          let live = 0;
          let waiting = 0;
          return (
            <div key={d} className="form-card" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: '0 0 6px' }}>{d}</h3>
              <div className="list">
                {picks
                  .filter((p) => p.district_name === d)
                  .map((p) => {
                    const place =
                      p.status === 'live'
                        ? `#${++live}`
                        : p.status === 'waiting'
                          ? `Waiting #${++waiting}`
                          : null;
                    return (
                      <div key={p.id} className="manage-card" style={{ marginTop: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <h4 style={{ margin: 0 }}>
                              {place && <span style={{ marginRight: 6 }}>{place}</span>}
                              {p.offer_title}
                            </h4>
                            <div className="meta">
                              <Link to={`/admin/vendors/${p.vendor_id}`}>{p.business_name}</Link> ·{' '}
                              {p.shop_name}
                              {p.branch_name ? ` · bought by the ${p.branch_name} branch manager` : ''}
                            </div>
                          </div>
                          <span className={`pill-status ${STATUS[p.status].cls}`} style={{ flex: 'none' }}>
                            {STATUS[p.status].text}
                          </span>
                        </div>
                        <div className="meta" style={{ marginTop: 4 }}>
                          {p.status === 'live'
                            ? `${formatDate(p.starts_on)} – ${formatDate(p.ends_on)}`
                            : p.status === 'waiting'
                              ? `${daysText(p.waiting_days)} paid, starts when a place opens`
                              : p.ends_on
                                ? `Ran ${formatDate(p.starts_on)} – ${formatDate(p.ends_on)}`
                                : ''}
                          {` · ${p.views} views · ${p.taps} taps`}
                          {p.status === 'live' && !p.offer_live ? ' · hidden: offer paused or in review' : ''}
                        </div>
                        {p.removed_reason && <p className="error-text">Removed: {p.removed_reason}</p>}
                        {p.open_invoice && (
                          <div className="meta" style={{ marginTop: 4 }}>
                            Invoice{' '}
                            <Link to={`/admin/billing/invoices/${p.open_invoice.id}`}>
                              {p.open_invoice.number}
                            </Link>{' '}
                            {p.open_invoice.status === 'submitted' ? 'needs checking' : 'not paid yet'}
                          </div>
                        )}
                        {(p.status === 'live' || p.status === 'waiting') && (
                          <div className="btn-row">
                            <button
                              type="button"
                              className="btn danger small"
                              disabled={remove.isPending}
                              onClick={() => {
                                const reason = prompt('Why remove it? The vendor will see this.');
                                if (reason?.trim()) remove.mutate({ id: p.id, reason: reason.trim() });
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

interface OfferOption {
  id: number;
  title: string;
  shops: { name: string } | { name: string }[] | null;
}

function GiveFree() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [search, setSearch] = useState('');
  const [offerId, setOfferId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [days, setDays] = useState('7');
  const [note, setNote] = useState('');
  const offers = useQuery({
    queryKey: [...KEY, 'offers'],
    queryFn: async () =>
      must<OfferOption[]>(
        await db()
          .from('offers')
          .select('id, title, shops(name)')
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(500),
      ),
  });
  const districts = useQuery({
    queryKey: [...KEY, 'districts'],
    queryFn: async () =>
      must<{ id: number; name: string }[]>(
        await db().from('locations').select('id, name').eq('kind', 'district').order('name'),
      ),
  });
  const give = useMutation({
    mutationFn: async () =>
      must(
        await db().rpc('admin_give_top_pick', {
          p_offer_id: Number(offerId),
          p_district_id: Number(districtId),
          p_days: Number(days),
          p_note: note.trim() || null,
        }),
      ),
    onSuccess: () => {
      invalidate(KEY);
      toast('Free Top Pick added');
      setOfferId('');
      setNote('');
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const shopName = (o: OfferOption) => (Array.isArray(o.shops) ? o.shops[0]?.name : o.shops?.name) ?? '';
  const list = (offers.data ?? []).filter((o) =>
    `${o.title} ${shopName(o)}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <section className="section">
      <div className="section-head">
        <h2>Give a free Top Pick</h2>
      </div>
      <form
        className="form-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!offerId || !districtId) return toast('Choose the offer and the district');
          give.mutate();
        }}
      >
        <p className="meta" style={{ marginTop: 0 }}>
          For a launch partner, or to give days back after removing one. If the offer is already a Top Pick in
          that district, the days are added to it; otherwise it joins the line like any other.
        </p>
        <div className="field">
          <label htmlFor="tpf-search">Offer</label>
          <input
            id="tpf-search"
            placeholder="Search offers or shops"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={offerId} onChange={(e) => setOfferId(e.target.value)} style={{ marginTop: 6 }}>
            <option value="">Choose an approved offer</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {shopName(o)} · {o.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tpf-district">District</label>
            <select id="tpf-district" value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              <option value="">Choose</option>
              {(districts.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tpf-days">Days</label>
            <input
              id="tpf-days"
              type="number"
              min={1}
              max={366}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="tpf-note">Note (on the free invoice, admins only)</label>
          <input id="tpf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" className="btn block" disabled={give.isPending}>
          {give.isPending ? 'Adding…' : 'Give free Top Pick'}
        </button>
        <p className="meta" style={{ margin: '8px 0 0' }}>
          It shows to the vendor as a {money(0)} invoice.
        </p>
      </form>
    </section>
  );
}
