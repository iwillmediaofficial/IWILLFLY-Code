import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import type { Plan } from '../../lib/types';
import { Empty, ErrorNotice, Loading } from '../ui';
import { toNumber, useInvalidate } from '../util';
import { BILL_KEYS, billError, deletePlan, money, savePlan, usePlans, type PlanInput } from './api';

export function Plans() {
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const plans = usePlans();
  const list = plans.data ?? [];
  const nextSort = list.length ? Math.max(...list.map((p) => p.sort_order)) + 10 : 10;

  return (
    <>
      <div className="section-head">
        <h2>Plans</h2>
        {editing !== 'new' && (
          <button className="btn small" onClick={() => setEditing('new')}>
            ＋ Add plan
          </button>
        )}
      </div>
      <div className="notice">
        Vendors buy a plan for a number of days. The <b>default</b> plan (usually Free) is what every vendor
        gets without paying. Limits stop vendors adding more shops or live offers than their plan allows.
      </div>
      {editing === 'new' && <PlanForm nextSort={nextSort} onDone={() => setEditing(null)} />}
      {plans.isPending && <Loading />}
      {plans.error && <ErrorNotice error={plans.error} />}
      {plans.data?.length === 0 && (
        <Empty emoji="📦" title="No plans yet">
          Start with a Free default plan, then add paid plans with higher limits.
        </Empty>
      )}
      <div style={{ marginTop: 10 }}>
        {list.map((p) =>
          editing !== 'new' && editing?.id === p.id ? (
            <PlanForm key={p.id} plan={p} nextSort={nextSort} onDone={() => setEditing(null)} />
          ) : (
            <div key={p.id} className="manage-card">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <h4>
                    {p.name} · {money(p.price)}
                    <span className="meta"> / {p.period_days} days</span>
                  </h4>
                  <div className="meta">
                    {p.max_shops == null ? 'Unlimited shops' : `${p.max_shops} shops`} ·{' '}
                    {p.max_live_offers == null ? 'unlimited live offers' : `${p.max_live_offers} live offers`}{' '}
                    · order {p.sort_order}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {p.is_default && <span className="pill-status featured">Default</span>}
                  <span className={`pill-status ${p.is_active ? 'live' : ''}`}>
                    {p.is_active ? 'On sale' : 'Off'}
                  </span>
                </div>
              </div>
              {p.description && <p style={{ fontSize: 13, margin: '6px 0 0' }}>{p.description}</p>}
              {p.features.length > 0 && (
                <ul style={{ fontSize: 13, margin: '6px 0 0', paddingLeft: 18 }}>
                  {p.features.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
              <div className="btn-row">
                <button className="btn small secondary" onClick={() => setEditing(p)}>
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
  name: string;
  description: string;
  features: string;
  price: string;
  period_days: string;
  max_shops: string;
  max_live_offers: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: string;
};

function toForm(p: Plan | undefined, nextSort: number): Form {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    features: p?.features.join('\n') ?? '',
    price: p ? String(Number(p.price)) : '',
    period_days: String(p?.period_days ?? 30),
    max_shops: p?.max_shops == null ? '' : String(p.max_shops),
    max_live_offers: p?.max_live_offers == null ? '' : String(p.max_live_offers),
    is_default: p?.is_default ?? false,
    is_active: p?.is_active ?? true,
    sort_order: String(p?.sort_order ?? nextSort),
  };
}

const isWhole = (n: number | null) => n != null && Number.isInteger(n);

function PlanForm({ plan, nextSort, onDone }: { plan?: Plan; nextSort: number; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Form>(() => toForm(plan, nextSort));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const save = useMutation({
    mutationFn: (row: PlanInput) => savePlan(plan?.id ?? null, row),
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast(plan ? 'Plan saved' : 'Plan added');
      onDone();
    },
    onError: (e) => setError(billError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deletePlan(plan!.id),
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast('Plan deleted');
      onDone();
    },
    onError: (e) => setError(billError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const price = toNumber(f.price);
    const days = toNumber(f.period_days);
    const shops = toNumber(f.max_shops);
    const offers = toNumber(f.max_live_offers);
    const sort = toNumber(f.sort_order);
    if (f.name.trim().length < 2) return setError('Enter the plan name.');
    if (price == null || price < 0) return setError('Enter the price in rupees (0 for free).');
    if (!isWhole(days) || days! < 1 || days! > 1100)
      return setError('Days must be a whole number, 1 to 1100.');
    if (f.max_shops.trim() && (!isWhole(shops) || shops! < 0))
      return setError('Max shops must be a whole number, or blank for no limit.');
    if (f.max_live_offers.trim() && (!isWhole(offers) || offers! < 0))
      return setError('Max live offers must be a whole number, or blank for no limit.');
    if (!isWhole(sort)) return setError('Sort order must be a whole number.');
    const features = f.features
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    save.mutate({
      name: f.name.trim(),
      description: f.description.trim() || null,
      features,
      price: Math.round(price * 100) / 100,
      period_days: days!,
      max_shops: f.max_shops.trim() ? shops : null,
      max_live_offers: f.max_live_offers.trim() ? offers : null,
      is_default: f.is_default,
      is_active: f.is_active,
      sort_order: sort!,
    });
  };

  return (
    <form className="form-card" onSubmit={submit} style={{ marginBottom: 10 }}>
      <div className="field">
        <label htmlFor="pl-name">Name</label>
        <input
          id="pl-name"
          value={f.name}
          maxLength={60}
          required
          placeholder="Pro"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pl-desc">Short description</label>
        <textarea
          id="pl-desc"
          maxLength={500}
          value={f.description}
          style={{ minHeight: 60 }}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pl-features">What vendors get</label>
        <textarea
          id="pl-features"
          value={f.features}
          placeholder={'Up to 3 shops\n10 live offers\nPriority support'}
          onChange={(e) => set({ features: e.target.value })}
        />
        <div className="hint">One point per line. Shown as a bullet list to vendors.</div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pl-price">Price (₹)</label>
          <input
            id="pl-price"
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
          <label htmlFor="pl-days">For how many days</label>
          <input
            id="pl-days"
            type="number"
            min={1}
            max={1100}
            step={1}
            inputMode="numeric"
            required
            value={f.period_days}
            onChange={(e) => set({ period_days: e.target.value })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pl-shops">Max shops</label>
          <input
            id="pl-shops"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="No limit"
            value={f.max_shops}
            onChange={(e) => set({ max_shops: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="pl-offers">Max live offers</label>
          <input
            id="pl-offers"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="No limit"
            value={f.max_live_offers}
            onChange={(e) => set({ max_live_offers: e.target.value })}
          />
        </div>
      </div>
      <div className="hint" style={{ fontSize: 11, color: 'var(--color-muted)', margin: '-6px 0 12px' }}>
        Leave a limit blank for no limit.
      </div>
      <div className="field">
        <label htmlFor="pl-sort">Sort order</label>
        <input
          id="pl-sort"
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
      <label className="check-row">
        <input
          type="checkbox"
          checked={f.is_default}
          onChange={(e) => set({ is_default: e.target.checked })}
        />
        Default plan: what vendors get without paying (only one plan)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : plan ? 'Save plan' : 'Add plan'}
        </button>
        <button className="btn secondary" type="button" onClick={onDone}>
          Cancel
        </button>
        {plan && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete the ${plan.name} plan?\n\nA plan that was ever bought cannot be deleted; switch it off instead.`,
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
