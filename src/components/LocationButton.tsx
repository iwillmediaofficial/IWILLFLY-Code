import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { usePlace } from '../lib/location';
import { useLocations } from '../lib/queries';
import { pointFor, useProfileArea } from '../lib/profileArea';
import { AreaPicker } from './AreaPicker';
import { AreaLocationPicker } from './ScratchLocation';
import { useToast } from './Toast';
import { NeedsBackend, Sheet } from '../customer/ui';
import { MapPin } from 'lucide-react';
import { Icon } from './Icon';

/**
 * Header button showing the current place; opens a sheet to use GPS or pick an area. Signed in, it shows
 * the area saved to the account (the one Settings shows), and a pick here saves to the account too.
 */
export function LocationButton() {
  const { session } = useAuth();
  const { place } = usePlace();
  const { areaId } = useProfileArea();
  const { data: all = [] } = useLocations();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const accountArea = areaId != null ? all.find((l) => l.id === areaId) : undefined;
  const label = accountArea?.name ?? place?.label;
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
        <Icon icon={MapPin} /> {label ?? 'Set location'}
      </button>
      <Sheet open={open} onClose={close} title="Your location" subtitle="Offers are sorted nearest first">
        {session ? open && <AreaLocationPicker onSaved={close} /> : <LocationChooser onDone={close} />}
      </Sheet>
    </>
  );
}

/**
 * Keeps this device's place in step with the account's saved area: a new phone starts from it, and an area
 * picked on this device before it was saved to the account gives way to it. A GPS reading is kept, since
 * it gives truer distances.
 */
export function AccountPlaceSync() {
  const { place, setPlace } = usePlace();
  const { areaId, known } = useProfileArea();
  const { data: all = [] } = useLocations();
  useEffect(() => {
    if (!known || areaId == null || place?.source === 'gps' || place?.source === areaId) return;
    const area = all.find((l) => l.id === areaId);
    const point = area && pointFor(all, area);
    if (area && point) setPlace({ ...point, label: area.name, source: area.id });
  }, [known, areaId, place?.source, all, setPlace]);
  return null;
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
        {locating ? (
          'Locating…'
        ) : (
          <>
            <Icon icon={MapPin} /> Use my current location
          </>
        )}
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
