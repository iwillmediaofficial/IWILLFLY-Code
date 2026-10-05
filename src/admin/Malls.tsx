import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
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
type BranchSearchRow = BranchRef & { mall_shops: MallRef | MallRef[] | null };

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
      {rows.data?.length === 0 && <p className="meta">No shops added yet. Search above to add one.</p>}
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

function AddShop({ mallId, onAdded }: { mallId: number; onAdded: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [floor, setFloor] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ['admin', 'branch_search', term],
    queryFn: async () => {
      const pattern = `%${term.replace(/[%_,()\\]/g, ' ')}%`;
      return must<BranchSearchRow[]>(
        await db()
          .from('branches')
          .select('id, name, address, shop:shops!inner(id, name), mall_shops(mall_id, mall:malls(name))')
          .ilike('shop.name', pattern)
          .order('name')
          .limit(20),
      );
    },
    enabled: term.length >= 2,
  });

  const add = useMutation({
    mutationFn: async (branchId: number) => {
      must(
        await db()
          .from('mall_shops')
          .insert({ mall_id: mallId, branch_id: branchId, floor: floor.trim() || null }),
      );
    },
    onSuccess: () => {
      toast('Shop added to mall');
      setFloor('');
      setError('');
      onAdded();
    },
    onError: (e) =>
      setError(friendlyError(e, 'That branch is already listed in a mall. Remove it there first.')),
  });

  return (
    <div className="form-card">
      <div className="field-row">
        <div className="field">
          <label htmlFor="branch-q">Find a shop</label>
          <input
            id="branch-q"
            type="search"
            placeholder="Shop name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="branch-floor">Floor (optional)</label>
          <input
            id="branch-floor"
            placeholder="e.g. Ground, 2nd"
            maxLength={40}
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {term.length >= 2 && results.isPending && <Loading what="Searching…" />}
      {results.error && <ErrorNotice error={results.error} />}
      {results.data?.length === 0 && <p className="meta">No shops match “{term}”.</p>}
      {results.data?.map((b) => {
        const shop = one(b.shop);
        const inMall = one(b.mall_shops);
        const here = inMall?.mall_id === mallId;
        return (
          <div
            key={b.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 0',
              borderTop: '1px solid var(--color-line)',
            }}
          >
            <div className="grow" style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{shop?.name}</b>
              <div className="meta">
                {b.name}
                {b.address ? ` · ${b.address}` : ''}
                {inMall && !here && ` · already in ${one(inMall.mall)?.name ?? 'another mall'}`}
              </div>
            </div>
            {here ? (
              <span className="pill-status approved">Added</span>
            ) : (
              <button
                className="btn small"
                disabled={add.isPending || Boolean(inMall)}
                title={inMall ? 'A branch can be in one mall only' : undefined}
                onClick={() => add.mutate(b.id)}
              >
                Add
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
