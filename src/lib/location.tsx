import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { readJSON, writeJSON } from './storage';

export interface PlaceState {
  lat: number;
  lng: number;
  label: string;
  /** 'gps' when from the device, otherwise the chosen area's id. */
  source: 'gps' | number;
  /** GPS only: how far off the reading may be, in metres (the browser's 95% radius). */
  accuracy?: number;
}

interface LocationApi {
  place: PlaceState | null;
  locating: boolean;
  /** Ask the browser for the current position. Resolves the new place, or null if denied or unavailable. */
  locate: () => Promise<PlaceState | null>;
  setPlace: (p: PlaceState | null) => void;
}

const KEY = 'iwillfly-place';

/** Distances from a GPS reading less precise than this are shown as "approx.". */
const APPROX_OVER_M = 1000;

/**
 * High accuracy uses the phone's GPS instead of a Wi-Fi or mobile-network guess, which can be kilometres
 * off. A short maximumAge stops the browser handing back a position cached from somewhere else.
 */
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 };

const LocationContext = createContext<LocationApi>({
  place: null,
  locating: false,
  locate: async () => null,
  setPlace: () => {},
});

function readGps(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), GPS_OPTIONS);
  });
}

const gpsPlace = (pos: GeolocationPosition): PlaceState => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  label: 'Near you',
  source: 'gps',
  accuracy: Math.round(pos.coords.accuracy),
});

export function LocationProvider({ children }: { children: ReactNode }) {
  const [place, setPlaceState] = useState<PlaceState | null>(() => readJSON<PlaceState | null>(KEY, null));
  const [locating, setLocating] = useState(false);
  const openedWithGps = useRef(place?.source === 'gps');

  const setPlace = useCallback((p: PlaceState | null) => {
    setPlaceState(p);
    writeJSON(KEY, p);
  }, []);

  const locate = useCallback(async () => {
    setLocating(true);
    const pos = await readGps();
    setLocating(false);
    if (!pos) return null;
    const next = gpsPlace(pos);
    setPlace(next);
    return next;
  }, [setPlace]);

  // A saved "Near you" point goes stale when the person moves, so read the GPS again each time the app
  // opens. The old point stays in use until the new one arrives, and is kept if the GPS can't be read.
  useEffect(() => {
    if (!openedWithGps.current) return;
    openedWithGps.current = false; // once per app open (also under React's double-run in development)
    void (async () => {
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
      if (permission?.state === 'denied') return;
      const pos = await readGps();
      if (!pos) return;
      // Only replace it if the person hasn't picked an area meanwhile.
      setPlaceState((cur) => {
        if (cur?.source !== 'gps') return cur;
        const next = gpsPlace(pos);
        writeJSON(KEY, next);
        return next;
      });
    })();
  }, []);

  return (
    <LocationContext.Provider value={{ place, locating, locate, setPlace }}>
      {children}
    </LocationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlace() {
  return useContext(LocationContext);
}

/** True when distances from this place should be labelled "approx." (a GPS fix worse than about 1 km). */
// eslint-disable-next-line react-refresh/only-export-components
export function isApprox(place: PlaceState | null | undefined) {
  return place?.source === 'gps' && place.accuracy != null && place.accuracy > APPROX_OVER_M;
}
