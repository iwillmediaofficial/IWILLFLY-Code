import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { readJSON, writeJSON } from './storage';

export interface PlaceState {
  lat: number;
  lng: number;
  label: string;
  /** 'gps' when from the device, otherwise the chosen area's id. */
  source: 'gps' | number;
}

interface LocationApi {
  place: PlaceState | null;
  locating: boolean;
  /** Ask the browser for the current position. Resolves false if denied or unavailable. */
  locate: () => Promise<boolean>;
  setPlace: (p: PlaceState | null) => void;
}

const KEY = 'iwillfly-place';
const LocationContext = createContext<LocationApi>({
  place: null,
  locating: false,
  locate: async () => false,
  setPlace: () => {},
});

export function LocationProvider({ children }: { children: ReactNode }) {
  const [place, setPlaceState] = useState<PlaceState | null>(() => readJSON<PlaceState | null>(KEY, null));
  const [locating, setLocating] = useState(false);

  const setPlace = useCallback((p: PlaceState | null) => {
    setPlaceState(p);
    writeJSON(KEY, p);
  }, []);

  const locate = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        if (!navigator.geolocation) return resolve(false);
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocating(false);
            setPlace({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              label: 'Near you',
              source: 'gps',
            });
            resolve(true);
          },
          () => {
            setLocating(false);
            resolve(false);
          },
          { timeout: 8000, maximumAge: 5 * 60_000 },
        );
      }),
    [setPlace],
  );

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
