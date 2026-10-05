import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ImageListField } from '../components/ImageField';
import { useToast } from '../components/Toast';
import { db, must, useCategories } from '../lib/queries';
import type { Offer, OfferStatus, Shop } from '../lib/types';
import { useMyOffers, VENDOR_KEY } from './api';
import { useReadOnly } from './context';
import {
  errorMessage,
  offerPhase,
  orNull,
  phaseClass,
  phaseLabel,
  suggestDiscount,
  todayIST,
} from './format';
import { BlockedNote, ErrorNote, Loading, Lockable, NotFound, PageHead } from './ui';

export default function OfferEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { offers, shops, isPending, error } = useMyOffers();
  if (isPending) return <Loading />;
  if (error || !offers || !shops) return <ErrorNote error={error} />;
  if (shops.length === 0) {
    return (
      <div className="saved-empty">
        <div className="emoji">🏪</div>
        <h3>Add a shop first</h3>
        <p>Every offer belongs to one of your shops.</p>
        <Link className="btn" to="/vendor/shops/new" style={{ display: 'inline-block', marginTop: 8 }}>
          Add a shop
        </Link>
      </div>
    );
  }
  if (!id) {
    const preset = Number(params.get('shop'));
    return (
      <OfferForm
        offer={null}
        shops={shops}
        defaultShop={shops.some((s) => s.id === preset) ? preset : shops[0].id}
      />
    );
  }
  const offer = offers.find((o) => o.id === Number(id));
  if (!offer) return <NotFound what="Offer" back="/vendor/offers" />;
  return <OfferForm key={offer.id} offer={offer} shops={shops} defaultShop={offer.shop_id} />;
}

/** "" -> null, "12.5" -> 12.5, junk -> NaN */
const parsePrice = (s: string) => (s.trim() === '' ? null : Number(s));
const priceText = (n: number | null) => (n == null ? '' : String(n));

function OfferForm({
  offer,
  shops,
  defaultShop,
}: {
  offer: Offer | null;
  shops: Shop[];
  defaultShop: number;
}) {
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: categories = [] } = useCategories();
  const [f, setF] = useState({
    shop_id: defaultShop,
    title: offer?.title ?? '',
    product_name: offer?.product_name ?? '',
    category_id: offer?.category_id ?? null,
    description: offer?.description ?? '',
    original_price: priceText(offer?.original_price ?? null),
    offer_price: priceText(offer?.offer_price ?? null),
    discount_label: offer?.discount_label ?? '',
    image_keys: offer?.image_keys ?? [],
    starts_on: offer?.starts_on ?? todayIST(),
    ends_on: offer?.ends_on ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const [error, setError] = useState('');
  const original = parsePrice(f.original_price);
  const price = parsePrice(f.offer_price);
  const suggestion = suggestDiscount(original, price);

  const save = useMutation({
    mutationFn: async () => {
      const content = {
        title: f.title.trim(),
        product_name: orNull(f.product_name),
        category_id: f.category_id,
        description: orNull(f.description),
        original_price: original,
        offer_price: price,
        discount_label: orNull(f.discount_label),
        image_keys: f.image_keys,
        starts_on: f.starts_on,
        ends_on: f.ends_on || null,
      };
      const q = offer
        ? db().from('offers').update(content).eq('id', offer.id)
        : db()
            .from('offers')
            .insert({ ...content, shop_id: f.shop_id });
      return must<{ status: OfferStatus }>(await q.select('status').single()).status;
    },
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      if (!offer) toast('Offer sent for review');
      else if (status === 'pending' && offer.status !== 'pending') toast('Saved and sent back for review');
      else toast('Offer saved');
      navigate('/vendor/offers');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const pause = useMutation({
    mutationFn: async (paused: boolean) =>
      must(await db().from('offers').update({ is_paused: paused }).eq('id', offer!.id)),
    onSuccess: (_, paused) => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast(paused ? 'Offer paused' : 'Offer resumed');
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => must(await db().from('offers').delete().eq('id', offer!.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast('Offer deleted');
      navigate('/vendor/offers', { replace: true });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const validate = () => {
    const t = f.title.trim();
    if (!f.shop_id) return 'Choose the shop this offer is for.';
    if (t.length < 2 || t.length > 120) return 'Title should be 2 to 120 characters.';
    if (f.product_name.trim().length > 120) return 'Product name is too long (120 characters max).';
    if (f.description.trim().length > 2000) return 'Description is too long (2000 characters max).';
    for (const [label, n] of [
      ['Original price', original],
      ['Offer price', price],
    ] as const) {
      if (n != null && (!Number.isFinite(n) || n < 0 || n >= 1e8))
        return `${label}: enter a valid amount in rupees.`;
    }
    if (original != null && price != null && price > original) {
      return 'The offer price should not be more than the original price.';
    }
    if (f.discount_label.trim().length > 30) return 'Discount label is too long (30 characters max).';
    if (!f.starts_on) return 'Choose a start date.';
    if (f.ends_on && f.ends_on < f.starts_on) return 'The end date must be on or after the start date.';
    if (f.ends_on && f.ends_on < todayIST())
      return 'The end date is in the past, so nobody would see this offer.';
    return null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  const phase = offer ? offerPhase(offer) : null;

  return (
    <>
      <PageHead
        title={offer ? 'Edit offer' : 'New offer'}
        action={<Link to="/vendor/offers">All offers</Link>}
      />
      {readOnly && <BlockedNote />}
      {offer && phase && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <span className={`pill-status ${phaseClass[phase]}`}>{phaseLabel[phase]}</span>
          {offer.is_featured && <span className="pill-status featured">Featured</span>}
        </div>
      )}
      {offer?.status === 'approved' && (
        <div className="notice warn">
          This offer is approved. Saving changes sends it back to the IWILLFLY team for review, and it stays
          hidden until it is approved again. Pausing or resuming does not.
        </div>
      )}
      {offer?.status === 'rejected' && (
        <div className="notice bad">
          <b>Rejected.</b> {offer.reject_reason ?? 'No reason given.'} Fix the offer and save to send it for
          review again.
        </div>
      )}
      {offer?.status === 'pending' && <div className="notice">This offer is waiting for review.</div>}
      {!offer && <div className="notice">New offers go live after the IWILLFLY team approves them.</div>}
      <form className="form-card" onSubmit={submit} noValidate>
        <Lockable locked={readOnly}>
          <div className="field">
            <label htmlFor="o-shop">Shop *</label>
            <select
              id="o-shop"
              value={f.shop_id}
              disabled={Boolean(offer)}
              onChange={(e) => set('shop_id', Number(e.target.value))}
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {offer && (
              <div className="hint">An offer can't move to another shop. Create a new one instead.</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="o-title">Offer title *</label>
            <input
              id="o-title"
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={120}
              placeholder="e.g. Festive sale on all sarees"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="o-product">Product name</label>
              <input
                id="o-product"
                value={f.product_name}
                onChange={(e) => set('product_name', e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="field">
              <label htmlFor="o-cat">Category</label>
              <select
                id="o-cat"
                value={f.category_id ?? ''}
                onChange={(e) => set('category_id', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Same as shop</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="o-desc">Description</label>
            <textarea
              id="o-desc"
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
              placeholder="What's included, conditions, how to claim"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="o-orig">Original price (₹)</label>
              <input
                id="o-orig"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={f.original_price}
                onChange={(e) => set('original_price', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="o-price">Offer price (₹)</label>
              <input
                id="o-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={f.offer_price}
                onChange={(e) => set('offer_price', e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="o-label">Discount label</label>
            <input
              id="o-label"
              value={f.discount_label}
              onChange={(e) => set('discount_label', e.target.value)}
              maxLength={30}
              placeholder={suggestion || 'e.g. 50% OFF or Buy 2 Get 1'}
            />
            {!f.discount_label.trim() && suggestion && (
              <button type="button" className="link-btn" onClick={() => set('discount_label', suggestion)}>
                Use “{suggestion}”
              </button>
            )}
          </div>
          <ImageListField
            label="Photos"
            value={f.image_keys}
            folder="offers"
            max={5}
            onChange={(k) => set('image_keys', k)}
          />
          <div className="field-row">
            <div className="field">
              <label htmlFor="o-start">Start date *</label>
              <input
                id="o-start"
                type="date"
                value={f.starts_on}
                onChange={(e) => set('starts_on', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="o-end">End date</label>
              <input
                id="o-end"
                type="date"
                min={f.starts_on || undefined}
                value={f.ends_on}
                onChange={(e) => set('ends_on', e.target.value)}
              />
              <div className="hint">Leave empty to keep it running.</div>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn block" type="submit" disabled={save.isPending} style={{ marginTop: 8 }}>
            {save.isPending ? 'Saving…' : offer ? 'Save changes' : 'Submit for review'}
          </button>
          {offer && (
            <div className="btn-row">
              <button
                className="btn secondary"
                type="button"
                style={{ flex: 1 }}
                disabled={pause.isPending}
                onClick={() => pause.mutate(!offer.is_paused)}
              >
                {offer.is_paused ? '▶ Resume offer' : '⏸ Pause offer'}
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Delete the offer "${offer.title}"? This can't be undone.`)) remove.mutate();
                }}
              >
                Delete
              </button>
            </div>
          )}
        </Lockable>
      </form>
    </>
  );
}
