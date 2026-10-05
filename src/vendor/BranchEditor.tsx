import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AreaPicker } from '../components/AreaPicker';
import { useToast } from '../components/Toast';
import { openState } from '../lib/hours';
import { db, must, useLocations } from '../lib/queries';
import type { Branch, Hours, Shop } from '../lib/types';
import { useBranch, useMyShops, VENDOR_KEY } from './api';
import { useReadOnly } from './context';
import { errorMessage, hoursError, orNull, phoneError } from './format';
import { HolidaysEditor, HoursEditor } from './HoursEditor';
import { BlockedNote, ErrorNote, Loading, Lockable, NotFound, PageHead } from './ui';

// Leaflet is only downloaded when a branch editor opens.
const MapPin = lazy(() => import('../components/MapPin').then((m) => ({ default: m.MapPin })));

export default function BranchEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const branchId = id ? Number(id) : null;
  const branch = useBranch(branchId);
  const shops = useMyShops();

  if (shops.isPending || (branchId != null && branch.isPending)) return <Loading />;
  if (shops.error || branch.error) return <ErrorNote error={shops.error ?? branch.error} />;
  const shopId = branchId != null ? branch.data?.shop_id : Number(params.get('shop'));
  const shop = shops.data.find((s) => s.id === shopId);
  if (!shop || (branchId != null && !branch.data)) return <NotFound what="Branch" back="/vendor/shops" />;
  return <BranchForm key={branchId ?? 'new'} shop={shop} branch={branch.data ?? null} />;
}

type Form = Omit<Branch, 'id' | 'shop_id' | 'address' | 'phone' | 'temp_closed_note'> & {
  address: string;
  phone: string;
  temp_closed_note: string;
};

function BranchForm({ shop, branch }: { shop: Shop; branch: Branch | null }) {
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: locations = [] } = useLocations();
  const [f, setF] = useState<Form>({
    name: branch?.name ?? 'Main branch',
    address: branch?.address ?? '',
    location_id: branch?.location_id ?? null,
    lat: branch?.lat ?? null,
    lng: branch?.lng ?? null,
    phone: branch?.phone ?? '',
    hours: branch?.hours ?? {},
    holidays: branch?.holidays ?? [],
    temp_closed: branch?.temp_closed ?? false,
    temp_closed_note: branch?.temp_closed_note ?? '',
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const [error, setError] = useState('');
  const back = `/vendor/shops/${shop.id}`;
  const area = locations.find((l) => l.id === f.location_id);
  const preview = openState(f);

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        ...f,
        name: f.name.trim(),
        address: orNull(f.address),
        phone: orNull(f.phone),
        temp_closed_note: f.temp_closed ? orNull(f.temp_closed_note) : null,
      };
      if (branch) must(await db().from('branches').update(row).eq('id', branch.id));
      else
        must(
          await db()
            .from('branches')
            .insert({ ...row, shop_id: shop.id }),
        );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast(branch ? 'Branch saved' : 'Branch added');
      navigate(back);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => must(await db().from('branches').delete().eq('id', branch!.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast('Branch deleted');
      navigate(back, { replace: true });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = f.name.trim();
    const problem =
      (n.length < 1 || n.length > 80 ? 'Branch name should be 1 to 80 characters.' : null) ??
      (f.address.trim().length > 300 ? 'Address is too long (300 characters max).' : null) ??
      phoneError(f.phone) ??
      hoursError(f.hours) ??
      (f.temp_closed_note.trim().length > 200 ? 'Closure note is too long (200 characters max).' : null);
    setError(problem ?? '');
    if (!problem) save.mutate();
  };

  return (
    <>
      <PageHead title={branch ? 'Edit branch' : 'New branch'} action={<Link to={back}>‹ {shop.name}</Link>} />
      {readOnly && <BlockedNote />}
      <form className="form-card" onSubmit={submit} noValidate>
        <Lockable locked={readOnly}>
          <div className="field">
            <label htmlFor="b-name">Branch name *</label>
            <input id="b-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="b-addr">Address</label>
            <textarea
              id="b-addr"
              value={f.address}
              onChange={(e) => set('address', e.target.value)}
              maxLength={300}
              style={{ minHeight: 60 }}
              placeholder="Building, street, landmark"
            />
          </div>
          <AreaPicker value={f.location_id} onChange={(a) => set('location_id', a?.id ?? null)} />
          <div className="field">
            <label>Map pin</label>
            <Suspense fallback={<div className="map-box" />}>
              <MapPin
                lat={f.lat}
                lng={f.lng}
                fallback={area}
                onChange={(p) => setF((cur) => ({ ...cur, lat: p.lat, lng: p.lng }))}
              />
            </Suspense>
            <div className="hint">Tap the map or drag the pin to the shop's entrance.</div>
          </div>
          <div className="field">
            <label htmlFor="b-phone">Branch phone</label>
            <input id="b-phone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <HoursEditor value={f.hours} onChange={(h: Hours) => set('hours', h)} />
          <HolidaysEditor value={f.holidays} onChange={(d) => set('holidays', d)} />
          <label className="check-row">
            <input
              type="checkbox"
              checked={f.temp_closed}
              onChange={(e) => set('temp_closed', e.target.checked)}
            />
            Temporarily closed
          </label>
          {f.temp_closed && (
            <div className="field">
              <label htmlFor="b-note">Note for customers</label>
              <input
                id="b-note"
                value={f.temp_closed_note}
                onChange={(e) => set('temp_closed_note', e.target.value)}
                maxLength={200}
                placeholder="e.g. Closed for renovation until 20 Oct"
              />
            </div>
          )}
          <div className="status-card" style={{ marginBottom: 12 }}>
            <div className={`status ${preview.open ? 'open' : 'closed'}`}>
              <span className="light" />
              <b>{preview.label}</b>
              <span className="meta">· Today: {preview.today}</span>
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              Preview of what customers see right now (India time).
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="btn-row">
            <button className="btn" type="submit" disabled={save.isPending} style={{ flex: 1 }}>
              {save.isPending ? 'Saving…' : branch ? 'Save branch' : 'Add branch'}
            </button>
            {branch && (
              <button
                className="btn danger"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Delete the branch "${branch.name}"?`)) remove.mutate();
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
