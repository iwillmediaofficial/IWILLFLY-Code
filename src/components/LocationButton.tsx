import { useCallback, useState } from 'react';
import { usePlace } from '../lib/location';
import { useLocations } from '../lib/queries';
import type { LocationNode } from '../lib/types';
import { AreaPicker } from './AreaPicker';
import { useToast } from './Toast';
import { NeedsBackend, Sheet } from '../customer/ui';

/** Header button showing the current place; opens a sheet to use GPS or pick an area. */
export function LocationButton() {
  const { place } = usePlace();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        className="icon-btn"
        title="Change location"
        onClick={() => setOpen(true)}
        style={{
          display: 'block',
          lineHeight: '40px',
          width: 'auto',
          maxWidth: 150,
          padding: '0 10px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        📍 {place ? place.label : 'Set location'}
      </button>
      <Sheet open={open} onClose={close} title="Your location" subtitle="Offers are sorted nearest first">
        <LocationChooser onDone={close} />
      </Sheet>
    </>
  );
}

/** "Use my current location" plus an area list. Shared by the header sheet and Settings. */
export function LocationChooser({
  onDone,
  onArea,
}: {
  onDone?: () => void;
  /** Extra work after an area is chosen, e.g. saving it to the profile. */
  onArea?: (areaId: number) => void;
}) {
  const { place, locating, locate, setPlace } = usePlace();
  const toast = useToast();
  const { data: all = [] } = useLocations();
  const useGps = async () => {
    if (await locate()) {
      toast('Showing offers near you');
      onDone?.();
    } else {
      toast('Location permission was not enabled. Choose your area instead.');
    }
  };
  return (
    <div>
      {place && (
        <div className="notice">
          Current: <b>{place.label}</b>
        </div>
      )}
      <button className="btn yellow block" onClick={useGps} disabled={locating}>
        {locating ? 'Locating…' : '📍 Use my current location'}
      </button>
      <div className="meta" style={{ textAlign: 'center', margin: '12px 0' }}>
        or choose your area
      </div>
      <NeedsBackend>
        <AreaPicker
          value={typeof place?.source === 'number' ? place.source : null}
          onChange={(area) => {
            if (!area) return;
            const point = pointFor(all, area);
            if (!point) {
              toast('This area has no map point yet. Try another.');
              return;
            }
            setPlace({ ...point, label: area.name, source: area.id });
            onArea?.(area.id);
            toast(`Showing offers near ${area.name}`);
            onDone?.();
          }}
        />
      </NeedsBackend>
    </div>
  );
}

/** The area's own map point, or its nearest parent's (city, district) when the area has none. */
function pointFor(all: LocationNode[], area: LocationNode) {
  const byId = new Map(all.map((l) => [l.id, l]));
  let cur: LocationNode | undefined = area;
  while (cur) {
    if (cur.lat != null && cur.lng != null) return { lat: cur.lat, lng: cur.lng };
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}
