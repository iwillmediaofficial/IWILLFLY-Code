import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import type { Addon, AddonKind } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { toNumber, useInvalidate } from '../util';
import {
  ADDON_HELP,
  ADDON_LABEL,
  BILL_KEYS,
  billError,
  deleteAddon,
  money,
  saveAddon,
  useAddons,
  type AddonInput,
} from './api';

const KINDS = Object.keys(ADDON_LABEL) as AddonKind[];

export function Addons() {
  const [editing, setEditing] = useState<Addon | 'new' | null>(null);
  const addons = useAddons();
  const list = addons.data ?? [];
  const nextSort = list.length ? Math.max(...list.map((a) => a.sort_order)) + 10 : 10;

  return (
    <>
      <div className="section-head">
        <h2>Add-ons</h2>
        {editing !== 'new' && (
          <button className="btn small" onClick={() => setEditing('new')}>
            ＋ Add add-on
          </button>
        )}
      </div>
      <div className="notice">
        Extras vendors buy on top of their plan. <b>Featured shop</b> and <b>Promoted offer</b> switch on by
        themselves once paid. For a <b>Home banner ad</b> you make the banner yourself in Home ads.
      </div>
      {editing === 'new' && <AddonForm nextSort={nextSort} onDone={() => setEditing(null)} />}
      {addons.isPending && <Loading />}
      {addons.error && <ErrorNotice error={addons.error} />}
      {addons.data?.length === 0 && (
        <Empty emoji="✨" title="No add-ons yet">
          For example “Featured shop · 7 days · ₹199”.
        </Empty>
      )}
      <div style={{ marginTop: 10 }}>
        {list.map((a) =>
          editing !== 'new' && editing?.id === a.id ? (
            <AddonForm key={a.id} addon={a} nextSort={nextSort} onDone={() => setEditing(null)} />
          ) : (
            <div key={a.id} className="manage-card">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <h4>
                    {a.name} · {money(a.price)}
                    <span className="meta"> / {a.duration_days} days</span>
                  </h4>
                  <div className="meta">
                    {ADDON_LABEL[a.kind]} · order {a.sort_order}
                  </div>
                </div>
                <span className={`pill-status ${a.is_active ? 'live' : ''}`}>
                  {a.is_active ? 'On sale' : 'Off'}
                </span>
              </div>
              {a.description && <p style={{ fontSize: 13, margin: '6px 0 0' }}>{a.description}</p>}
              <div className="btn-row">
                <button className="btn small secondary" onClick={() => setEditing(a)}>
                  Edit
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </>
  );
}

type Form = {
  kind: AddonKind;
  name: string;
  description: string;
  price: string;
  duration_days: string;
  is_active: boolean;
  sort_order: string;
};

function AddonForm({ addon, nextSort, onDone }: { addon?: Addon; nextSort: number; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(() => ({
    kind: addon?.kind ?? 'featured_shop',
    name: addon?.name ?? '',
    description: addon?.description ?? '',
    price: addon ? String(Number(addon.price)) : '',
    duration_days: String(addon?.duration_days ?? 7),
    is_active: addon?.is_active ?? true,
    sort_order: String(addon?.sort_order ?? nextSort),
  }));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const save = useMutation({
    mutationFn: (row: AddonInput) => saveAddon(addon?.id ?? null, row),
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast(addon ? 'Add-on saved' : 'Add-on added');
      onDone();
    },
    onError: (e) => setError(billError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteAddon(addon!.id),
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast('Add-on deleted');
      onDone();
    },
    onError: (e) => setError(billError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const price = toNumber(f.price);
    const days = toNumber(f.duration_days);
    const sort = toNumber(f.sort_order);
    if (f.name.trim().length < 2) return setError('Enter the add-on name.');
    if (price == null || price < 0) return setError('Enter the price in rupees.');
    if (days == null || !Number.isInteger(days) || days < 1 || days > 366)
      return setError('Days must be a whole number, 1 to 366.');
    if (sort == null || !Number.isInteger(sort)) return setError('Sort order must be a whole number.');
    save.mutate({
      kind: f.kind,
      name: f.name.trim(),
      description: f.description.trim() || null,
      price: Math.round(price * 100) / 100,
      duration_days: days,
      is_active: f.is_active,
      sort_order: sort,
    });
  };

  return (
    <form className="form-card" onSubmit={submit} style={{ marginBottom: 10 }}>
      <div className="field">
        <label htmlFor="ao-kind">Type</label>
        <select
          id="ao-kind"
          value={f.kind}
          disabled={addon != null}
          onChange={(e) => set({ kind: e.target.value as AddonKind })}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {ADDON_LABEL[k]}
            </option>
          ))}
        </select>
        <div className="hint">
          {ADDON_HELP[f.kind]}
          {addon ? ' The type cannot be changed later.' : ''}
        </div>
      </div>
      <div className="field">
        <label htmlFor="ao-name">Name</label>
        <input
          id="ao-name"
          value={f.name}
          maxLength={60}
          required
          placeholder="Featured shop for a week"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="ao-desc">Description</label>
        <textarea
          id="ao-desc"
          maxLength={500}
          value={f.description}
          style={{ minHeight: 60 }}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ao-price">Price (₹)</label>
          <input
            id="ao-price"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
            value={f.price}
            onChange={(e) => set({ price: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="ao-days">Runs for (days)</label>
          <input
            id="ao-days"
            type="number"
            min={1}
            max={366}
            step={1}
            inputMode="numeric"
            required
            value={f.duration_days}
            onChange={(e) => set({ duration_days: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ao-sort">Sort order</label>
        <input
          id="ao-sort"
          type="number"
          step={1}
          inputMode="numeric"
          value={f.sort_order}
          onChange={(e) => set({ sort_order: e.target.value })}
        />
        <div className="hint">Lower numbers show first.</div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Can be bought (on sale)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : addon ? 'Save add-on' : 'Add add-on'}
        </button>
        <button className="btn secondary" type="button" onClick={onDone}>
          Cancel
        </button>
        {addon && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${addon.name}?\n\nAn add-on that was ever bought cannot be deleted; switch it off instead.`,
                )
              )
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
