import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import { locationPath } from '../../lib/locationPath';
import { useLocations } from '../../lib/queries';
import { mediaUrl } from '../../lib/supabase';
import type { LocationNode, ScratchPrize } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { one, toNumber, useInvalidate } from '../util';
import {
  SCRATCH_KEYS,
  deletePrize,
  savePrize,
  scratchError,
  updatePrize,
  useCampaignVendors,
  usePrizes,
  type AdminPrize,
  type PrizeInput,
} from './api';

/** 0.05 -> "5"; up to 3 decimals (the database keeps 5 decimals of probability). */
function toPercent(p: number) {
  return String(Math.round(p * 100_000) / 1000);
}

function fromPercent(pct: number) {
  return Math.round(pct * 1000) / 100_000;
}

/** Vendor-added prizes arrive switched off with 0% chance and wait for a manager. */
function needsReview(p: ScratchPrize) {
  return p.sponsor_vendor_id != null && !p.is_active && p.probability === 0;
}

export function Prizes({ campaignId }: { campaignId: number }) {
  const prizes = usePrizes(campaignId);
  const vendors = useCampaignVendors(campaignId);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const vendorNames = new Map<number, string>();
  for (const r of vendors.data ?? []) {
    const v = one(r.vendor);
    if (v) vendorNames.set(r.vendor_id, v.business_name);
  }
  // Only approved vendors that joined this campaign can sponsor a new prize.
  const sponsors = (vendors.data ?? [])
    .map((r) => one(r.vendor))
    .filter((v): v is NonNullable<typeof v> => v != null && v.status === 'approved')
    .map((v) => ({ id: v.id, name: v.business_name }));

  const list = prizes.data?.list ?? [];
  const upgraded = prizes.data?.upgraded ?? true;
  const activeTotal = list.filter((p) => p.is_active).reduce((sum, p) => sum + p.probability, 0);
  const totalPct = Math.round(activeTotal * 100_000) / 1000;
  const reviewCount = list.filter(needsReview).length;

  return (
    <section>
      <div className="section-head">
        <h2>Prizes</h2>
        {editing !== 'new' && (
          <button className="btn small" onClick={() => setEditing('new')}>
            ＋ Add prize
          </button>
        )}
      </div>

      {prizes.data && (
        <div className={`notice${activeTotal > 1 ? ' bad' : ''}`}>
          Active prizes add up to <b>{totalPct}%</b> chance of winning per scratch
          {activeTotal > 1
            ? '. This is over 100%: lower some chances so they add up to 100% or less.'
            : `, so ${Math.round((100 - totalPct) * 1000) / 1000}% of scratches win nothing.`}
        </div>
      )}
      {reviewCount > 0 && (
        <div className="notice warn">
          <b>{reviewCount}</b> vendor-added {reviewCount === 1 ? 'prize needs' : 'prizes need'} review. Set a
          chance and switch {reviewCount === 1 ? 'it' : 'them'} on to include{' '}
          {reviewCount === 1 ? 'it' : 'them'} in the draw.
        </div>
      )}

      {editing === 'new' && (
        <PrizeForm
          campaignId={campaignId}
          sponsors={sponsors}
          vendorNames={vendorNames}
          upgraded={upgraded}
          onDone={() => setEditing(null)}
        />
      )}

      {!upgraded && (
        <div className="notice warn">
          Daily limits and win locations need the latest database update. Until it is applied, prizes save
          without them.
        </div>
      )}
      {prizes.isPending && <Loading />}
      {prizes.error && <ErrorNotice error={prizes.error} />}
      {vendors.error && <ErrorNotice error={vendors.error} />}
      {prizes.data?.list.length === 0 && editing !== 'new' && (
        <Empty emoji="🎁" title="No prizes yet">
          Add the prizes customers can win, with stock and a chance for each.
        </Empty>
      )}

      {list.map((p) =>
        editing === p.id ? (
          <PrizeForm
            key={p.id}
            campaignId={campaignId}
            prize={p}
            sponsors={sponsors}
            vendorNames={vendorNames}
            upgraded={upgraded}
            onDone={() => setEditing(null)}
          />
        ) : (
          <PrizeCard
            key={p.id}
            prize={p}
            sponsorName={
              p.sponsor_vendor_id == null ? 'IWILLFLY' : (vendorNames.get(p.sponsor_vendor_id) ?? 'Vendor')
            }
            onEdit={() => setEditing(p.id)}
          />
        ),
      )}
    </section>
  );
}

function PrizeCard({
  prize: p,
  sponsorName,
  onEdit,
}: {
  prize: AdminPrize;
  sponsorName: string;
  onEdit: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const review = needsReview(p);
  const { data: locations = [] } = useLocations();
  const areas = p.location_ids.map((id) => locations.find((l) => l.id === id)?.name ?? 'Area').join(', ');

  const toggle = useMutation({
    mutationFn: () => updatePrize(p.id, { is_active: !p.is_active }),
    onSuccess: () => {
      invalidate(...SCRATCH_KEYS);
      toast(p.is_active ? 'Prize switched off' : 'Prize switched on');
    },
    onError: (e) => toast(scratchError(e, 'This prize is still in use.')),
  });

  return (
    <div
      className="manage-card"
      style={review ? { borderColor: '#f5b45c', boxShadow: '0 0 0 2px #fff4e5' } : undefined}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 12 }}>
        <div className="shop-thumb" style={{ width: 72, height: 72 }}>
          {p.image_key ? <img src={mediaUrl(p.image_key)} alt="" /> : '🎁'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            <span className={`pill-status ${p.is_active ? 'live' : ''}`}>{p.is_active ? 'On' : 'Off'}</span>
            {review && <span className="pill-status pending">Needs review</span>}
            {p.remaining === 0 && p.quantity > 0 && (
              <span className="pill-status rejected">Out of stock</span>
            )}
          </div>
          <h4>{p.name}</h4>
          <div className="meta">Sponsor: {sponsorName}</div>
          <div className="meta">
            <b style={{ color: 'var(--color-ink)' }}>
              {p.remaining}/{p.quantity}
            </b>{' '}
            left · <b style={{ color: 'var(--color-ink)' }}>{toPercent(p.probability)}%</b> chance
            {p.daily_limit != null && (
              <>
                {' '}
                · max <b style={{ color: 'var(--color-ink)' }}>{p.daily_limit}</b>/day
              </>
            )}
          </div>
          <div className="meta">
            📍 {p.location_ids.length ? `Won only in: ${areas}` : 'Can be won everywhere'}
          </div>
          {p.description && (
            <p style={{ fontSize: 13, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{p.description}</p>
          )}
        </div>
      </div>
      <div className="btn-row">
        <button className="btn small secondary" onClick={onEdit}>
          {review ? 'Review' : 'Edit'}
        </button>
        <button
          className={`btn small${p.is_active ? ' danger' : ''}`}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {p.is_active ? 'Switch off' : 'Switch on'}
        </button>
      </div>
    </div>
  );
}

type Form = {
  name: string;
  description: string;
  image_key: string | null;
  sponsor: string; // '' = IWILLFLY
  quantity: string;
  remaining: string;
  chance: string; // percent
  dailyLimit: string; // '' = no limit
  locations: number[]; // empty = everywhere
  is_active: boolean;
};

function PrizeForm({
  campaignId,
  prize,
  sponsors,
  vendorNames,
  upgraded,
  onDone,
}: {
  campaignId: number;
  prize?: AdminPrize;
  sponsors: { id: number; name: string }[];
  vendorNames: Map<number, string>;
  upgraded: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(() => ({
    name: prize?.name ?? '',
    description: prize?.description ?? '',
    image_key: prize?.image_key ?? null,
    sponsor: prize?.sponsor_vendor_id != null ? String(prize.sponsor_vendor_id) : '',
    quantity: prize ? String(prize.quantity) : '',
    remaining: prize ? String(prize.remaining) : '',
    chance: prize ? toPercent(prize.probability) : '',
    dailyLimit: prize?.daily_limit != null ? String(prize.daily_limit) : '',
    locations: prize?.location_ids ?? [],
    is_active: prize?.is_active ?? true,
  }));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  // Keep the current sponsor selectable even if they left the campaign or are no longer approved.
  const options = [...sponsors];
  if (prize?.sponsor_vendor_id != null && !options.some((s) => s.id === prize.sponsor_vendor_id)) {
    options.push({
      id: prize.sponsor_vendor_id,
      name: `${vendorNames.get(prize.sponsor_vendor_id) ?? 'Current vendor'} (not an approved campaign vendor)`,
    });
  }

  const save = useMutation({
    mutationFn: (row: PrizeInput) =>
      savePrize(campaignId, prize?.id ?? null, row, upgraded ? f.locations : null, prize?.location_ids ?? []),
    onSuccess: () => {
      invalidate(...SCRATCH_KEYS);
      toast(prize ? 'Prize saved' : 'Prize added');
      onDone();
    },
    onError: (e) => setError(scratchError(e, 'This prize is still in use.')),
  });

  const remove = useMutation({
    mutationFn: () => deletePrize(prize!.id),
    onSuccess: () => {
      invalidate(...SCRATCH_KEYS);
      toast('Prize deleted');
      onDone();
    },
    onError: (e) =>
      setError(
        scratchError(
          e,
          'Customers have already won this prize, so it cannot be deleted. Switch it off instead.',
        ),
      ),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const quantity = toNumber(f.quantity);
    const chance = toNumber(f.chance);
    const remaining = prize ? toNumber(f.remaining) : null;
    const dailyLimit = f.dailyLimit.trim() === '' ? null : toNumber(f.dailyLimit);
    if (f.name.trim().length < 2) return setError('Enter the prize name.');
    if (quantity == null || !Number.isInteger(quantity) || quantity < 0 || quantity > 100000)
      return setError('Quantity must be a whole number from 0 to 100000.');
    if (prize) {
      if (remaining == null || !Number.isInteger(remaining) || remaining < 0)
        return setError('Stock left must be a whole number of 0 or more.');
      if (remaining > quantity) return setError('Stock left cannot be more than the quantity.');
    }
    if (chance == null || chance < 0 || chance > 100) return setError('Chance must be between 0 and 100%.');
    if (f.dailyLimit.trim() !== '' && (dailyLimit == null || !Number.isInteger(dailyLimit) || dailyLimit < 1))
      return setError('Daily limit must be a whole number of 1 or more, or left blank for no limit.');
    if (dailyLimit != null && dailyLimit > quantity)
      return setError(`Daily limit (${dailyLimit}) cannot be more than the quantity (${quantity}).`);
    const row: PrizeInput = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      image_key: f.image_key,
      sponsor_vendor_id: f.sponsor ? Number(f.sponsor) : null,
      quantity,
      probability: fromPercent(chance),
      ...(upgraded && { daily_limit: dailyLimit }),
      is_active: f.is_active,
    };
    // Sending the unchanged value lets the database move stock along with a quantity change.
    if (prize && remaining != null) row.remaining = remaining;
    save.mutate(row);
  };

  const won = prize ? prize.quantity - prize.remaining : 0;

  return (
    <form className="form-card" onSubmit={submit}>
      <h4 style={{ margin: '0 0 10px' }}>{prize ? `Edit ${prize.name}` : 'New prize'}</h4>
      {prize && needsReview(prize) && (
        <div className="notice warn">
          Added by {vendorNames.get(prize.sponsor_vendor_id!) ?? 'a vendor'}. Check the details, set a chance
          and switch it on.
        </div>
      )}
      <div className="field">
        <label htmlFor="pz-name">Name</label>
        <input
          id="pz-name"
          value={f.name}
          maxLength={120}
          required
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pz-desc">Description</label>
        <textarea
          id="pz-desc"
          maxLength={500}
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <ImageField
        label="Prize image"
        folder="prizes"
        value={f.image_key}
        onChange={(k) => set({ image_key: k })}
      />
      <div className="field">
        <label htmlFor="pz-sponsor">Sponsor</label>
        <select id="pz-sponsor" value={f.sponsor} onChange={(e) => set({ sponsor: e.target.value })}>
          <option value="">IWILLFLY (we hand it over)</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="hint">
          The sponsor's shop hands the prize over and checks the claim code. Add vendors in the Vendors tab.
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pz-qty">Quantity</label>
          <input
            id="pz-qty"
            type="number"
            min={0}
            max={100000}
            step={1}
            inputMode="numeric"
            required
            value={f.quantity}
            onChange={(e) => set({ quantity: e.target.value })}
          />
          {prize && <div className="hint">{won} already won.</div>}
        </div>
        <div className="field">
          <label htmlFor="pz-chance">Chance (%)</label>
          <input
            id="pz-chance"
            type="number"
            min={0}
            max={100}
            step="any"
            inputMode="decimal"
            required
            placeholder="e.g. 5"
            value={f.chance}
            onChange={(e) => set({ chance: e.target.value })}
          />
          <div className="hint">5 means 5 in 100 scratches win this.</div>
        </div>
      </div>
      {prize && (
        <div className="field">
          <label htmlFor="pz-remaining">Stock left</label>
          <input
            id="pz-remaining"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            required
            value={f.remaining}
            onChange={(e) => set({ remaining: e.target.value })}
          />
          <div className="hint">
            Leave as is and it follows quantity changes. Changing it by hand makes the stock check in Stats
            show a mismatch.
          </div>
        </div>
      )}
      {upgraded && (
        <div className="field">
          <label htmlFor="pz-daily">Daily limit (optional)</label>
          <input
            id="pz-daily"
            type="number"
            min={1}
            max={toNumber(f.quantity) ?? undefined}
            step={1}
            inputMode="numeric"
            placeholder="No limit"
            value={f.dailyLimit}
            onChange={(e) => set({ dailyLimit: e.target.value })}
          />
          {(() => {
            const limit = toNumber(f.dailyLimit);
            const qty = toNumber(f.quantity);
            return limit != null && qty != null && limit > qty ? (
              <p className="error-text">Cannot be more than the quantity ({qty}).</p>
            ) : null;
          })()}
          <div className="hint">
            Most times this prize can be won per day (India time), up to the quantity. Leave blank for no
            limit. Once the limit is reached, scratches that land on this prize lose until tomorrow.
          </div>
        </div>
      )}
      {upgraded && <LocationPicker value={f.locations} onChange={(locations) => set({ locations })} />}
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Prize on (included in the draw)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : prize ? 'Save prize' : 'Add prize'}
        </button>
        <button className="btn secondary" type="button" onClick={onDone}>
          Cancel
        </button>
        {prize && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (window.confirm(`Delete ${prize.name}? A prize someone has won cannot be deleted.`))
                remove.mutate();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Tick the areas where a prize can be won. Ticking a city or district covers every area inside it.
 * Nothing ticked = everywhere.
 */
function LocationPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { data: all = [], isPending, error } = useLocations();
  const [q, setQ] = useState('');
  const rows = useMemo(
    () =>
      all
        .map((l: LocationNode) => ({ l, path: locationPath(all, l.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [all],
  );
  const term = q.trim().toLowerCase();
  const shown = term ? rows.filter((r) => r.path.toLowerCase().includes(term)) : rows;
  const picked = new Set(value);
  const toggle = (id: number) => onChange(picked.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  const names = value.map((id) => all.find((l) => l.id === id)?.name ?? 'Area').join(', ');

  return (
    <div className="field">
      <label htmlFor="pz-loc-q">Where can it be won?</label>
      <div className="hint" style={{ marginTop: 0, marginBottom: 6 }}>
        {value.length === 0
          ? 'Nothing ticked: it can be won everywhere.'
          : `Only players whose area is inside: ${names}.`}{' '}
        Ticking a city or district covers every area inside it.
      </div>
      <input
        id="pz-loc-q"
        type="search"
        placeholder="Search locations…"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {isPending && <Loading what="Loading locations…" />}
      {error && <ErrorNotice error={error} />}
      <div className="check-list" role="group" aria-label="Win locations">
        {!isPending && shown.length === 0 && <p className="meta">No locations match “{q}”.</p>}
        {shown.map(({ l, path }) => {
          const above = path.split(' › ').slice(0, -1).join(' › ');
          return (
            <label key={l.id}>
              <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
              <span style={{ minWidth: 0 }}>
                {l.name} <span className="sub">· {l.kind}</span>
                {!l.is_active && <span className="sub"> · hidden</span>}
                {above && <div className="sub">{above}</div>}
              </span>
            </label>
          );
        })}
      </div>
      {value.length > 0 && (
        <button
          type="button"
          className="btn small secondary"
          style={{ marginTop: 6 }}
          onClick={() => onChange([])}
        >
          Clear (can be won everywhere)
        </button>
      )}
    </div>
  );
}
