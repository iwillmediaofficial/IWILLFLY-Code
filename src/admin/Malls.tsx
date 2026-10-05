import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AreaPicker } from '../components/AreaPicker';
import { locationPath } from '../lib/locationPath';
import { ImageField } from '../components/ImageField';
import { useToast } from '../components/Toast';
import { db, must, useLocations } from '../lib/queries';
import { mediaUrl } from '../lib/supabase';
import type { Mall } from '../lib/types';
import { Empty, ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, friendlyError, one, slugify, toNumber, useInvalidate } from './util';

const MapPin = lazy(() => import('../components/MapPin').then((m) => ({ default: m.MapPin })));

const MALL_KEYS = [['admin', 'malls'], ['admin', 'mall'], ...PUBLIC_KEYS];

export function Malls() {
  const { data: locations = [] } = useLocations();
  const malls = useQuery({
    queryKey: ['admin', 'malls'],
    queryFn: async () =>
      must<(Mall & { mall_shops: { count: number }[] })[]>(
        await db().from('malls').select('*, mall_shops(count)').order('sort_order').order('name'),
      ),
  });

  return (
    <>
      <div className="section-head">
        <h2>Malls</h2>
        <Link className="btn small" to="/admin/malls/new">
          ＋ Add mall
        </Link>
      </div>
      {malls.isPending && <Loading />}
      {malls.error && <ErrorNotice error={malls.error} />}
      {malls.data?.length === 0 && (
        <Empty emoji="🏢" title="No malls yet">
          Add a mall, then add the shops inside it.
        </Empty>
      )}
      <div className="list">
        {malls.data?.map((m) => (
          <Link key={m.id} className="shop-card" to={`/admin/malls/${m.id}`}>
            <div className="shop-thumb">
              {m.cover_key ? <img src={mediaUrl(m.cover_key)} alt="" /> : '🏢'}
            </div>
            <div style={{ minWidth: 0 }}>
              <h4>
                {m.name} {!m.is_active && <span className="pill-status">Hidden</span>}
              </h4>
              <div className="meta">{locationPath(locations, m.location_id) || 'No area set'}</div>
              <div className="meta">
                {m.mall_shops[0]?.count ?? 0} shops · order {m.sort_order}
                {m.lat == null && ' · ⚠ no map pin'}
              </div>
            </div>
            <div className="chev">›</div>
          </Link>
        ))}
      </div>
    </>
  );
}

type MallForm = Omit<Mall, 'id'>;
const blank: MallForm = {
  name: '',
  slug: '',
  description: null,
  address: null,
  location_id: null,
  lat: null,
  lng: null,
  cover_key: null,
  is_active: true,
  sort_order: 0,
};

export function MallEdit() {
  const { id } = useParams();
  const mallId = id ? Number(id) : null;
  const mall = useQuery({
    queryKey: ['admin', 'mall', mallId],
    queryFn: async () => must<Mall>(await db().from('malls').select('*').eq('id', mallId!).single()),
    enabled: mallId != null,
  });

  return (
    <>
      <div className="section-head">
        <h2>{mallId ? (mall.data?.name ?? 'Mall') : 'New mall'}</h2>
        <Link to="/admin/malls">‹ All malls</Link>
      </div>
      {mallId != null && mall.isPending && <Loading />}
      {mall.error && <ErrorNotice error={mall.error} />}
      {mallId == null && <MallFormCard />}
      {mall.data && (
        <>
          <MallFormCard key={mall.data.id} mall={mall.data} />
          <MallShops mallId={mall.data.id} />
        </>
      )}
    </>
  );
}

function MallFormCard({ mall }: { mall?: Mall }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const { data: locations = [] } = useLocations();
  const [f, setF] = useState<MallForm>(() => (mall ? { ...mall } : { ...blank }));
  const [slugTouched, setSlugTouched] = useState(Boolean(mall));
  const [error, setError] = useState('');
  const set = (patch: Partial<MallForm>) => setF((cur) => ({ ...cur, ...patch }));
  const area = locations.find((l) => l.id === f.location_id) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: f.name.trim(),
        slug: slugify(f.slug),
        description: f.description?.trim() || null,
        address: f.address?.trim() || null,
        location_id: f.location_id,
        lat: f.lat,
        lng: f.lng,
        cover_key: f.cover_key,
        is_active: f.is_active,
        sort_order: Math.round(f.sort_order || 0),
      };
      if (mall) {
        must(await db().from('malls').update(row).eq('id', mall.id));
        return mall.id;
      }
      return must<{ id: number }>(await db().from('malls').insert(row).select('id').single()).id;
    },
    onSuccess: (newId) => {
      invalidate(...MALL_KEYS);
      toast(mall ? 'Mall saved' : 'Mall added. Now add its shops.');
      if (!mall) navigate(`/admin/malls/${newId}`, { replace: true });
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      must(await db().from('malls').delete().eq('id', mall!.id));
    },
    onSuccess: () => {
      invalidate(...MALL_KEYS);
      toast('Mall deleted');
      navigate('/admin/malls', { replace: true });
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (f.name.trim().length < 2) return setError('Enter the mall name.');
    if (!slugify(f.slug)) return setError('Enter a slug (letters and numbers).');
    save.mutate();
  };

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="field">
        <label htmlFor="mall-name">Name</label>
        <input
          id="mall-name"
          value={f.name}
          maxLength={120}
          required
          onChange={(e) =>
            set({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })
          }
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="mall-slug">Slug</label>
          <input
            id="mall-slug"
            value={f.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set({ slug: e.target.value });
            }}
            onBlur={() => set({ slug: slugify(f.slug) })}
          />
        </div>
        <div className="field">
          <label htmlFor="mall-sort">Sort order</label>
          <input
            id="mall-sort"
            type="number"
            value={f.sort_order}
            onChange={(e) => set({ sort_order: toNumber(e.target.value) ?? 0 })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="mall-desc">Description</label>
        <textarea
          id="mall-desc"
          maxLength={1000}
          value={f.description ?? ''}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="mall-address">Address</label>
        <input
          id="mall-address"
          maxLength={300}
          value={f.address ?? ''}
          onChange={(e) => set({ address: e.target.value })}
        />
      </div>
      <AreaPicker value={f.location_id} onChange={(a) => set({ location_id: a?.id ?? null })} />
      <div className="field">
        <label>Map pin</label>
        <Suspense fallback={<div className="map-box" />}>
          <MapPin lat={f.lat} lng={f.lng} fallback={area} onChange={(p) => set({ lat: p.lat, lng: p.lng })} />
        </Suspense>
        <div className="hint">Tap the map or drag the pin. Customers see malls nearest to them first.</div>
      </div>
      <ImageField
        label="Cover image"
        folder="shops"
        aspect="16 / 9"
        value={f.cover_key}
        onChange={(k) => set({ cover_key: k })}
      />
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Active (shown to customers)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : mall ? 'Save mall' : 'Add mall'}
        </button>
        {mall && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${mall.name}?\n\nThe shops inside are not deleted; they just stop being listed in this ` +
                    'mall. To hide it for now, untick Active instead.',
                )
              )
                remove.mutate();
            }}
          >
            Delete mall
          </button>
        )}
      </div>
    </form>
  );
}

type ShopRef = { id: number; name: string };
type BranchRef = { id: number; name: string; address: string | null; shop: ShopRef | ShopRef[] | null };
type MallShopRow = { branch_id: number; floor: string | null; branch: BranchRef | BranchRef[] | null };
type MallRef = { mall_id: number; mall: { name: string } | { name: string }[] | null };
type VendorRef = { business_name: string; status: string };
type ShopWithVendor = ShopRef & { vendor: VendorRef | VendorRef[] | null };
type BranchSearchRow = {
  id: number;
  name: string;
  address: string | null;
  shop: ShopWithVendor | ShopWithVendor[] | null;
  mall_shops: MallRef | MallRef[] | null;
};

function MallShops({ mallId }: { mallId: number }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const keys = [
    ['admin', 'mall_shops', mallId],
    ['admin', 'malls'],
    ['admin', 'branch_search'],
    ...PUBLIC_KEYS,
  ];

  const rows = useQuery({
    queryKey: ['admin', 'mall_shops', mallId],
    queryFn: async () =>
      must<MallShopRow[]>(
        await db()
          .from('mall_shops')
          .select('branch_id, floor, branch:branches(id, name, address, shop:shops(id, name))')
          .eq('mall_id', mallId),
      ),
  });

  const removeShop = useMutation({
    mutationFn: async (branchId: number) => {
      must(await db().from('mall_shops').delete().eq('mall_id', mallId).eq('branch_id', branchId));
    },
    onSuccess: () => {
      invalidate(...keys);
      toast('Removed from mall');
    },
    onError: (e) => toast(friendlyError(e)),
  });

  const sorted = [...(rows.data ?? [])].sort((a, b) =>
    (one(one(a.branch)?.shop)?.name ?? '').localeCompare(one(one(b.branch)?.shop)?.name ?? ''),
  );

  return (
    <section className="section">
      <div className="section-head">
        <h2>Shops in this mall</h2>
        <span className="meta">{rows.data?.length ?? 0} shops</span>
      </div>
      <AddShop mallId={mallId} onAdded={() => invalidate(...keys)} />
      {rows.isPending && <Loading />}
      {rows.error && <ErrorNotice error={rows.error} />}
      {rows.data?.length === 0 && (
        <p className="meta">No shops added yet. Click "Find shops" above to pick some.</p>
      )}
      <div style={{ marginTop: 10 }}>
        {sorted.map((r) => {
          const branch = one(r.branch);
          const shop = one(branch?.shop);
          return (
            <div
              key={r.branch_id}
              className="manage-card"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <h4>{shop?.name ?? 'Shop'}</h4>
                <div className="meta">
                  {branch?.name}
                  {r.floor ? ` · Floor ${r.floor}` : ''}
                  {branch?.address ? ` · ${branch.address}` : ''}
                </div>
              </div>
              <button
                className="btn small danger"
                disabled={removeShop.isPending}
                onClick={() => {
                  if (window.confirm(`Remove ${shop?.name ?? 'this shop'} (${branch?.name}) from this mall?`))
                    removeShop.mutate(r.branch_id);
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Pick one or more vendor shop branches and add them to the mall in one go.
 * The list opens when the search box is clicked and closes when clicking elsewhere.
 */
function AddShop({ mallId, onAdded }: { mallId: number; onAdded: () => void }) {
  const toast = useToast();
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [floor, setFloor] = useState('');
  const [error, setError] = useState('');
  const [onlyFree, setOnlyFree] = useState(true);
  const [picked, setPicked] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const results = useQuery({
    queryKey: ['admin', 'branch_search', term],
    queryFn: async () => {
      let query = db()
        .from('branches')
        .select(
          'id, name, address, shop:shops!inner(id, name, vendor:vendors(business_name, status)), mall_shops(mall_id, mall:malls(name))',
        )
        .order('name')
        .limit(term ? 50 : 500);
      if (term) query = query.ilike('shop.name', `%${term.replace(/[%_,()\\]/g, ' ')}%`);
      const rows = must<BranchSearchRow[]>(await query);
      return rows.sort(
        (a, b) =>
          (one(a.shop)?.name ?? '').localeCompare(one(b.shop)?.name ?? '') || a.name.localeCompare(b.name),
      );
    },
    enabled: open && (term.length === 0 || term.length >= 2),
  });
  const listed = (results.data ?? []).filter((b) => {
    const m = one(b.mall_shops);
    return !onlyFree || !m || m.mall_id === mallId;
  });

  const toggle = (id: number, label: string) =>
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(id)) next.delete(id);
      else next.set(id, label);
      return next;
    });

  const add = useMutation({
    mutationFn: async () => {
      const f = floor.trim() || null;
      must(
        await db()
          .from('mall_shops')
          .insert([...picked.keys()].map((branch_id) => ({ mall_id: mallId, branch_id, floor: f }))),
      );
    },
    onSuccess: () => {
      toast(picked.size === 1 ? 'Shop added to mall' : `${picked.size} shops added to mall`);
      setPicked(new Map());
      setFloor('');
      setError('');
      setOpen(false);
      onAdded();
    },
    onError: (e) =>
      setError(friendlyError(e, 'One of these branches is already listed in a mall. Remove it there first.')),
  });

  return (
    <div className="form-card">
      <div ref={boxRef} style={{ position: 'relative' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="branch-q">Find shops</label>
          <input
            id="branch-q"
            type="search"
            placeholder="Click to see all vendor shops, or type a name…"
            autoComplete="off"
            value={q}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            aria-expanded={open}
            aria-controls="branch-list"
          />
        </div>
        {open && (
          <div
            id="branch-list"
            role="listbox"
            aria-multiselectable="true"
            style={{
              position: 'absolute',
              zIndex: 20,
              left: 0,
              right: 0,
              top: '100%',
              marginTop: 4,
              background: '#fff',
              border: '1px solid var(--color-line)',
              borderRadius: 12,
              boxShadow: '0 10px 30px rgba(15, 23, 42, 0.15)',
              padding: '8px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span className="meta grow">
                {term ? `Matching “${term}”` : 'All vendor shops'}
                {results.data ? ` · ${listed.length}` : ''}
              </span>
              <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
                Hide shops in other malls
              </label>
            </div>
            {results.isPending && <Loading what={term ? 'Searching…' : 'Loading shops…'} />}
            {results.error && <ErrorNotice error={results.error} />}
            {results.data && listed.length === 0 && (
              <p className="meta">{term ? `No shops match “${term}”.` : 'No vendor shops to add yet.'}</p>
            )}
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {listed.map((b) => {
                const shop = one(b.shop);
                const vendor = one(shop?.vendor ?? null);
                const inMall = one(b.mall_shops);
                const here = inMall?.mall_id === mallId;
                const blocked = Boolean(inMall);
                const label = `${shop?.name ?? 'Shop'} (${b.name})`;
                return (
                  <label
                    key={b.id}
                    role="option"
                    aria-selected={picked.has(b.id)}
                    aria-disabled={blocked}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderTop: '1px solid var(--color-line)',
                      cursor: blocked ? 'default' : 'pointer',
                      opacity: blocked && !here ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={here || picked.has(b.id)}
                      disabled={blocked}
                      onChange={() => toggle(b.id, label)}
                    />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <b style={{ fontSize: 13 }}>{shop?.name}</b>
                      <div className="meta">
                        {vendor &&
                          `🏪 ${vendor.business_name}${vendor.status !== 'approved' ? ` (${vendor.status})` : ''} · `}
                        {b.name}
                        {b.address ? ` · ${b.address}` : ''}
                        {here && ' · already in this mall'}
                        {inMall && !here && ` · in ${one(inMall.mall)?.name ?? 'another mall'}`}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className="btn small secondary" onClick={() => setOpen(false)}>
                Done{picked.size ? ` (${picked.size} selected)` : ''}
              </button>
              {picked.size > 0 && (
                <button type="button" className="btn small secondary" onClick={() => setPicked(new Map())}>
                  Clear selection
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {picked.size > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="meta" style={{ marginBottom: 6 }}>
            <b>{picked.size} selected:</b> {[...picked.values()].join(', ')}
          </div>
          <div className="field">
            <label htmlFor="branch-floor">Floor for these shops (optional)</label>
            <input
              id="branch-floor"
              placeholder="e.g. Ground, 2nd"
              maxLength={40}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
            />
          </div>
          <button type="button" className="btn" disabled={add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : `Add ${picked.size} shop${picked.size === 1 ? '' : 's'} to mall`}
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
