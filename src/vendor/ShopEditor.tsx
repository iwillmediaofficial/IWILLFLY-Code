import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ImageField } from '../components/ImageField';
import { useToast } from '../components/Toast';
import { openState } from '../lib/hours';
import { db, must, useCategories } from '../lib/queries';
import type { Shop } from '../lib/types';
import { useBranches, useMyShops, VENDOR_KEY } from './api';
import { useReadOnly, useVendor } from './context';
import { errorMessage, orNull, phoneError } from './format';
import { BlockedNote, ErrorNote, Loading, Lockable, NotFound, PageHead } from './ui';

export default function ShopEditor() {
  const { id } = useParams();
  const { data: shops, isPending, error } = useMyShops();
  if (!id) return <ShopForm shop={null} />;
  if (isPending) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const shop = shops.find((s) => s.id === Number(id));
  if (!shop) return <NotFound what="Shop" back="/vendor/shops" />;
  return (
    <>
      <ShopForm key={shop.id} shop={shop} />
      <BranchList shopId={shop.id} />
    </>
  );
}

function ShopForm({ shop }: { shop: Shop | null }) {
  const vendor = useVendor();
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: categories = [] } = useCategories();
  const [f, setF] = useState({
    name: shop?.name ?? '',
    category_id: shop?.category_id ?? null,
    description: shop?.description ?? '',
    phone: shop?.phone ?? '',
    whatsapp: shop?.whatsapp ?? '',
    logo_key: shop?.logo_key ?? null,
    cover_key: shop?.cover_key ?? null,
    is_active: shop?.is_active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        ...f,
        name: f.name.trim(),
        description: orNull(f.description),
        phone: orNull(f.phone),
        whatsapp: orNull(f.whatsapp),
      };
      if (shop) {
        must(await db().from('shops').update(row).eq('id', shop.id));
        return shop.id;
      }
      const created = must<{ id: number }>(
        await db()
          .from('shops')
          .insert({ ...row, vendor_id: vendor.id })
          .select('id')
          .single(),
      );
      return created.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      if (shop) toast('Shop saved');
      else {
        toast('Shop added. Now add a branch so customers can find you.');
        navigate(`/vendor/shops/${id}`, { replace: true });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => must(await db().from('shops').delete().eq('id', shop!.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast('Shop deleted');
      navigate('/vendor/shops', { replace: true });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = f.name.trim();
    const problem =
      (n.length < 2 || n.length > 120 ? 'Shop name should be 2 to 120 characters.' : null) ??
      (f.description.trim().length > 1000 ? 'Description is too long (1000 characters max).' : null) ??
      phoneError(f.phone) ??
      phoneError(f.whatsapp, 'WhatsApp');
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <>
      <PageHead title={shop ? 'Edit shop' : 'New shop'} action={<Link to="/vendor/shops">All shops</Link>} />
      {readOnly && <BlockedNote />}
      <form className="form-card" onSubmit={submit} noValidate>
        <Lockable locked={readOnly}>
          <div className="field">
            <label htmlFor="s-name">Shop name *</label>
            <input id="s-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="s-cat">Category</label>
            <select
              id="s-cat"
              value={f.category_id ?? ''}
              onChange={(e) => set('category_id', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Choose a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-desc">Description</label>
            <textarea
              id="s-desc"
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={1000}
              placeholder="What you sell, what makes your shop special"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="s-phone">Phone</label>
              <input id="s-phone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="s-wa">WhatsApp</label>
              <input
                id="s-wa"
                type="tel"
                value={f.whatsapp}
                onChange={(e) => set('whatsapp', e.target.value)}
              />
            </div>
          </div>
          <div style={{ maxWidth: 140 }}>
            <ImageField label="Logo" value={f.logo_key} folder="shops" onChange={(k) => set('logo_key', k)} />
          </div>
          <ImageField
            label="Cover photo"
            value={f.cover_key}
            folder="shops"
            aspect="16 / 9"
            onChange={(k) => set('cover_key', k)}
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
            />
            Show this shop to customers
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="btn-row">
            <button className="btn" type="submit" disabled={save.isPending} style={{ flex: 1 }}>
              {save.isPending ? 'Saving…' : shop ? 'Save shop' : 'Add shop'}
            </button>
            {shop && (
              <button
                className="btn danger"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Delete "${shop.name}"? Its branches and offers are deleted too.`))
                    remove.mutate();
                }}
              >
                Delete
              </button>
            )}
          </div>
        </Lockable>
      </form>
    </>
  );
}

function BranchList({ shopId }: { shopId: number }) {
  const { data: branches, isPending, error } = useBranches(shopId);
  const readOnly = useReadOnly();
  return (
    <section className="section">
      <PageHead
        title="Branches"
        action={!readOnly && <Link to={`/vendor/branches/new?shop=${shopId}`}>＋ Add branch</Link>}
      />
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : branches.length === 0 ? (
        <div className="notice warn">
          No branches yet. Add at least one with its address and hours so customers can find you.
        </div>
      ) : (
        <div className="list">
          {branches.map((b) => {
            const state = openState(b);
            return (
              <Link key={b.id} className="shop-card" to={`/vendor/branches/${b.id}`}>
                <div className="shop-thumb">📍</div>
                <div>
                  <h4>{b.name}</h4>
                  <div className="meta">{b.address || 'No address yet'}</div>
                  <div className={`status ${state.open ? 'open' : 'closed'}`} style={{ marginTop: 6 }}>
                    <span className="light" />
                    {state.label} · {state.today}
                  </div>
                </div>
                <div className="chev">›</div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
