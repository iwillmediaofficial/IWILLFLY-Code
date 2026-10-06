import { useMemo, useState } from 'react';
import { usePlace } from '../lib/location';
import { locationPath } from '../lib/locationPath';
import { NEAREST_AREA_MAX_KM, nearestArea, pointFor, useProfileArea } from '../lib/profileArea';
import { useLocations } from '../lib/queries';
import type { LocationNode } from '../lib/types';
import { Sheet } from '../customer/ui';
import { errorText } from '../customer/util';
import { useToast } from './Toast';

type Found = { area: LocationNode; km: number } | 'denied' | 'far';

/**
 * Sets the customer's area: find it from the phone's location (then confirm), or pick it from a searchable
 * list. Saves it to the account (used by Scratch & Win) and shows nearby offers for it on this device.
 */
export function AreaLocationPicker({ onSaved }: { onSaved?: (area: LocationNode) => void }) {
  const toast = useToast();
  const { locate, locating, setPlace } = usePlace();
  const { areaId, save } = useProfileArea();
  const { data: all = [], isPending } = useLocations();
  const [found, setFound] = useState<Found | null>(null);
  const [farFrom, setFarFrom] = useState<{ area: LocationNode; km: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [q, setQ] = useState('');

  const areas = useMemo(
    () =>
      all
        .filter((l) => l.kind === 'area' && l.is_active)
        .map((l) => ({ l, path: locationPath(all, l.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [all],
  );
  const term = q.trim().toLowerCase();
  const shown = term ? areas.filter((a) => a.path.toLowerCase().includes(term)) : areas;
  const current = areaId != null ? all.find((l) => l.id === areaId) : undefined;

  const commit = (area: LocationNode, fromGps: boolean) => {
    save.mutate(area.id, {
      onSuccess: () => {
        // A GPS reading already set "Near you" for distances; a picked area shows offers around it.
        if (!fromGps) {
          const p = pointFor(all, area);
          if (p) setPlace({ ...p, label: area.name, source: area.id });
        }
        toast(`Location saved: ${area.name}`);
        setFound(null);
        setPicked(null);
        onSaved?.(area);
      },
      onError: (e) => toast(errorText(e)),
    });
  };

  const useGps = async () => {
    setFound(null);
    const here = await locate();
    if (!here) return setFound('denied');
    const near = nearestArea(all, here);
    if (!near) return setFound('far');
    if (near.km > NEAREST_AREA_MAX_KM) {
      setFarFrom(near);
      return setFound('far');
    }
    setFound(near);
  };

  return (
    <div>
      {current && (
        <div className="notice" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 18 }}>📍</span>
          <span>
            Your area: <b>{current.name}</b>
            <span className="meta"> · {locationPath(all, current.parent_id)}</span>
          </span>
        </div>
      )}

      {found && typeof found === 'object' ? (
        <div className="form-card" style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 32 }}>📍</div>
          <div className="meta">Is this your area?</div>
          <h3 style={{ margin: '4px 0 2px' }}>{found.area.name}</h3>
          <div className="meta" style={{ marginBottom: 12 }}>
            {locationPath(all, found.area.parent_id)}
            {found.km >= 0.1
              ? ` · about ${found.km < 10 ? found.km.toFixed(1) : Math.round(found.km)} km away`
              : ''}
          </div>
          <button className="btn block" disabled={save.isPending} onClick={() => commit(found.area, true)}>
            {save.isPending ? 'Saving…' : `✓ Yes, use ${found.area.name}`}
          </button>
          <button className="btn secondary block" style={{ marginTop: 8 }} onClick={() => setFound(null)}>
            No, I’ll choose it myself
          </button>
        </div>
      ) : (
        <>
          <button className="btn yellow block" onClick={useGps} disabled={locating || isPending}>
            {locating ? 'Finding your location…' : '📍 Use my current location'}
          </button>
          <div className="meta" style={{ textAlign: 'center', marginTop: 6 }}>
            Quickest way. We only use it to find your area.
          </div>
          {found === 'denied' && (
            <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
              We couldn’t get your location. Allow location for this site in your browser or phone settings,
              or choose your area below.
            </div>
          )}
          {found === 'far' && (
            <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
              You seem to be outside the areas we cover
              {farFrom ? ` (nearest is ${farFrom.area.name}, ${Math.round(farFrom.km)} km away)` : ''}. Choose
              your area below if you’re in one of them.
            </div>
          )}

          <div className="meta" style={{ textAlign: 'center', margin: '14px 0 8px' }}>
            or choose your area
          </div>
          <input
            type="search"
            aria-label="Search your area"
            placeholder="Search your area, e.g. Aluva"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              width: '100%',
              border: '1px solid var(--color-line)',
              borderRadius: 12,
              padding: 12,
              outline: 'none',
            }}
          />
          <div className="check-list" role="radiogroup" aria-label="Areas">
            {isPending && <p className="meta">Loading areas…</p>}
            {!isPending && shown.length === 0 && <p className="meta">No areas match “{q}”.</p>}
            {shown.map(({ l, path }) => (
              <label key={l.id}>
                <input
                  type="radio"
                  name="scratch-area"
                  checked={(picked ?? areaId) === l.id}
                  onChange={() => setPicked(l.id)}
                />
                <span style={{ minWidth: 0 }}>
                  {l.name}
                  {l.id === areaId && <span className="sub"> · current</span>}
                  <div className="sub">{path.split(' › ').slice(0, -1).join(' › ')}</div>
                </span>
              </label>
            ))}
          </div>
          <button
            className="btn block"
            style={{ marginTop: 10 }}
            disabled={picked == null || picked === areaId || save.isPending}
            onClick={() => {
              const area = all.find((l) => l.id === picked);
              if (area) commit(area, false);
            }}
          >
            {save.isPending ? 'Saving…' : 'Save my area'}
          </button>
        </>
      )}
    </div>
  );
}

/** The "Set your location to play" sheet shown before scratching. */
export function ScratchLocationSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (area: LocationNode) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Set your location to play"
      subtitle="Scratch & Win prizes depend on your area"
    >
      {open && <AreaLocationPicker onSaved={onSaved} />}
    </Sheet>
  );
}
