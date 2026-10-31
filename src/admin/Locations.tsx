import { Suspense, lazy, useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { db, must, useLocations } from '../lib/queries';
import { mediaUrl } from '../lib/supabase';
import type { LocationNode } from '../lib/types';
import { PlaceSearch } from './PlaceSearch';
import { SquareImageField } from './SquareImageField';
import { Empty, ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, friendlyError, slugify, toNumber, useInvalidate } from './util';
import { Building, MapIcon, MapPin, Mountain, TriangleAlert } from 'lucide-react';
import { Icon, type LucideIcon } from '../components/Icon';

// Leaflet is big, so the map loads only when a form is open.
const MapPinPicker = lazy(() => import('../components/MapPin').then((m) => ({ default: m.MapPin })));

type Kind = LocationNode['kind'];
const CHILD_KIND: Record<Kind, Kind | null> = {
  state: 'district',
  district: 'city',
  city: 'area',
  area: null,
};
const KIND_ICON: Record<Kind, LucideIcon> = {
  state: MapIcon,
  district: Mountain,
  city: Building,
  area: MapPin,
};
const KEYS = [['locations'], ['admin', 'malls'], ...PUBLIC_KEYS];

/** What is open below a row: an edit form for it, or an add form for a new child. */
type Editing = { mode: 'edit'; node: LocationNode } | { mode: 'add'; parent: LocationNode | null } | null;

export function Locations() {
  const locations = useLocations();
  const [editing, setEditing] = useState<Editing>(null);

  // Depth-first order so each node is followed by its children.
  const rows = useMemo(() => {
    const all = locations.data ?? [];
    const kids = new Map<number | null, LocationNode[]>();
    for (const l of all) kids.set(l.parent_id, [...(kids.get(l.parent_id) ?? []), l]);
    const out: { node: LocationNode; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      const list = (kids.get(parent) ?? []).sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      );
      for (const node of list) {
        out.push({ node, depth });
        walk(node.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [locations.data]);

  const missingPins = rows.filter(
    (r) => r.node.kind === 'area' && (r.node.lat == null || r.node.lng == null),
  );

  return (
    <>
      <div className="section-head">
        <h2>Locations</h2>
        <button className="btn small" onClick={() => setEditing({ mode: 'add', parent: null })}>
          ＋ Add state
        </button>
      </div>
      <div className="notice">
        State › District › City › Area. Vendors and malls pick an <b>area</b>. Every area needs a latitude and
        longitude so “nearby” sorting works.
        {missingPins.length > 0 && (
          <>
            {' '}
            <b style={{ color: 'var(--color-red)' }}>
              {missingPins.length} area{missingPins.length > 1 ? 's are' : ' is'} missing lat/lng.
            </b>
          </>
        )}
      </div>
      {editing?.mode === 'add' && editing.parent === null && (
        <LocationForm parent={null} onDone={() => setEditing(null)} />
      )}
      {locations.isPending && <Loading />}
      {locations.error && <ErrorNotice error={locations.error} />}
      {locations.data?.length === 0 && <Empty icon={MapIcon} title="No locations yet" />}
      <div>
        {rows.map(({ node, depth }) => (
          <div key={node.id} style={{ marginLeft: depth * 16 }}>
            <LocationRow
              node={node}
              onEdit={() => setEditing({ mode: 'edit', node })}
              onAdd={() => setEditing({ mode: 'add', parent: node })}
            />
            {editing?.mode === 'edit' && editing.node.id === node.id && (
              <LocationForm node={node} parent={null} onDone={() => setEditing(null)} />
            )}
            {editing?.mode === 'add' && editing.parent?.id === node.id && (
              <div style={{ marginLeft: 16 }}>
                <LocationForm parent={node} onDone={() => setEditing(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function LocationRow({ node, onEdit, onAdd }: { node: LocationNode; onEdit: () => void; onAdd: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const child = CHILD_KIND[node.kind];
  const toggle = useMutation({
    mutationFn: async (active: boolean) => {
      must(await db().from('locations').update({ is_active: active }).eq('id', node.id));
    },
    onSuccess: (_, active) => {
      invalidate(...KEYS);
      toast(active ? `${node.name} shown` : `${node.name} hidden`);
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const noPin = node.kind === 'area' && (node.lat == null || node.lng == null);

  return (
    <div
      className="manage-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 8,
        padding: '8px 12px',
        opacity: node.is_active ? 1 : 0.6,
      }}
    >
      {node.image_key ? (
        <img
          src={mediaUrl(node.image_key)}
          alt=""
          width={28}
          height={28}
          style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }}
        />
      ) : (
        <span style={{ fontSize: 18, color: 'var(--color-blue)' }}>
          <Icon icon={KIND_ICON[node.kind]} />
        </span>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{node.name}</b>{' '}
        <span className="meta">
          {node.kind} · /{node.slug}
          {node.lat != null && node.lng != null && ` · ${node.lat.toFixed(4)}, ${node.lng.toFixed(4)}`}
        </span>
        {noPin && (
          <div className="meta" style={{ color: 'var(--color-red)' }}>
            <Icon icon={TriangleAlert} /> No lat/lng: nearby sorting cannot use this area
          </div>
        )}
      </div>
      <label className="check-row" style={{ margin: 0, fontSize: 11 }} title="Active">
        <input
          type="checkbox"
          checked={node.is_active}
          disabled={toggle.isPending}
          onChange={(e) => toggle.mutate(e.target.checked)}
        />
        Active
      </label>
      <button className="link-btn" onClick={onEdit}>
        Edit
      </button>
      {child && (
        <button className="link-btn" onClick={onAdd} title={`Add a ${child} under ${node.name}`}>
          ＋ {child}
        </button>
      )}
    </div>
  );
}

function LocationForm({
  node,
  parent,
  onDone,
}: {
  node?: LocationNode;
  parent: LocationNode | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const kind: Kind = node?.kind ?? (parent ? CHILD_KIND[parent.kind]! : 'state');
  const [name, setName] = useState(node?.name ?? '');
  const [slug, setSlug] = useState(node?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(node));
  const [lat, setLat] = useState(node?.lat != null ? String(node.lat) : '');
  const [lng, setLng] = useState(node?.lng != null ? String(node.lng) : '');
  const [sort, setSort] = useState(String(node?.sort_order ?? 0));
  const [imageKey, setImageKey] = useState<string | null>(node?.image_key ?? null);
  const [error, setError] = useState('');

  // The map and the two boxes stay in step: the pin follows what is typed, and moving the pin fills the boxes.
  const pinLat = toNumber(lat);
  const pinLng = toNumber(lng);
  const setPin = (p: { lat: number; lng: number }) => {
    setLat(String(Math.round(p.lat * 1e6) / 1e6));
    setLng(String(Math.round(p.lng * 1e6) / 1e6));
  };
  // With no pin yet, centre the map on the nearest place above this one that has a point (city, then district).
  const { data: all = [] } = useLocations();
  const centreOn = useMemo(() => {
    let p: LocationNode | null | undefined = parent;
    while (p && (p.lat == null || p.lng == null)) p = all.find((n) => n.id === p!.parent_id);
    return p ?? null;
  }, [parent, all]);
  const near = centreOn?.lat != null && centreOn.lng != null ? { lat: centreOn.lat, lng: centreOn.lng } : null;

  const save = useMutation({
    mutationFn: async () => {
      // `center` is generated from lat/lng by the database; never write it.
      const row = {
        name: name.trim(),
        slug: slugify(slug),
        lat: toNumber(lat),
        lng: toNumber(lng),
        sort_order: Math.round(toNumber(sort) ?? 0),
        // Sent only when changed, so the form keeps working before the district-picture column exists.
        ...(imageKey !== (node?.image_key ?? null) && { image_key: imageKey }),
      };
      if (node) must(await db().from('locations').update(row).eq('id', node.id));
      else
        must(
          await db()
            .from('locations')
            .insert({ ...row, kind, parent_id: parent?.id ?? null }),
        );
    },
    onSuccess: () => {
      invalidate(...KEYS);
      toast(node ? 'Location saved' : `${kind[0].toUpperCase()}${kind.slice(1)} added`);
      onDone();
    },
    onError: (e) => setError(friendlyError(e, 'Another place under the same parent already uses that slug.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter a name.');
    if (!slugify(slug)) return setError('Enter a slug (letters and numbers).');
    const la = toNumber(lat);
    const ln = toNumber(lng);
    if ((lat.trim() && la == null) || (la != null && (la < -90 || la > 90)))
      return setError('Latitude must be a number between -90 and 90.');
    if ((lng.trim() && ln == null) || (ln != null && (ln < -180 || ln > 180)))
      return setError('Longitude must be a number between -180 and 180.');
    if ((la == null) !== (ln == null)) return setError('Enter both latitude and longitude, or neither.');
    save.mutate();
  };

  return (
    <form className="form-card" style={{ marginTop: 8 }} onSubmit={submit}>
      <h4 style={{ margin: '0 0 10px' }}>
        {node ? `Edit ${node.name}` : parent ? `New ${kind} in ${parent.name}` : 'New state'}
      </h4>
      <div className="field-row">
        <div className="field">
          <label htmlFor="loc-name">Name</label>
          <input
            id="loc-name"
            value={name}
            maxLength={80}
            required
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="loc-slug">Slug</label>
          <input
            id="loc-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            onBlur={() => setSlug(slugify(slug))}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="loc-lat">Latitude</label>
          <input
            id="loc-lat"
            inputMode="decimal"
            placeholder="9.9312"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="loc-lng">Longitude</label>
          <input
            id="loc-lng"
            inputMode="decimal"
            placeholder="76.2673"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
      </div>
      {kind !== 'state' && (
        <div className="field">
          <label>Map pin</label>
          <PlaceSearch initial={name} near={near} onPick={setPin} />
          <Suspense fallback={<div className="map-box" />}>
            <MapPinPicker
              lat={pinLat}
              lng={pinLng}
              fallback={centreOn}
              pasteAnywhere
              onChange={setPin}
            />
          </Suspense>
          <p className="meta" style={{ marginTop: 6 }}>
            Search the name, paste a Google Maps link, or tap the map. Latitude and Longitude fill in by
            themselves; then Save.
            {kind === 'area' && ' Areas need lat/lng for “nearby” sorting.'}
          </p>
        </div>
      )}
      {kind === 'district' && (
        <SquareImageField
          value={imageKey}
          onChange={setImageKey}
          icon={<Icon icon={Mountain} />}
          folder="locations"
          alt="District picture"
        />
      )}
      <div className="field" style={{ maxWidth: 160 }}>
        <label htmlFor="loc-sort">Sort order</label>
        <input id="loc-sort" type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn small" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn small secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
