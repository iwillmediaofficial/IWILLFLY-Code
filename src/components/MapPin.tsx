import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const KOCHI = { lat: 9.9312, lng: 76.2673 };

// A plain CSS dot instead of Leaflet's image markers, which need extra asset wiring.
const pinIcon = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#1760d9;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);transform:rotate(-45deg)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

/** OpenStreetMap with one draggable pin. Tap the map or drag the pin to move it. */
export function MapPin({
  lat,
  lng,
  onChange,
  fallback,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (p: { lat: number; lng: number }) => void;
  /** Where to centre the map when no pin is set yet (e.g. the chosen area). */
  fallback?: { lat: number | null; lng: number | null } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(KOCHI, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => changeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lat == null || lng == null) {
      marker.current?.remove();
      marker.current = null;
      if (fallback?.lat != null && fallback.lng != null) m.setView([fallback.lat, fallback.lng], 14);
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { draggable: true, icon: pinIcon }).addTo(m);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        changeRef.current({ lat: p.lat, lng: p.lng });
      });
      m.setView([lat, lng], Math.max(m.getZoom(), 15));
    } else {
      marker.current.setLatLng([lat, lng]);
    }
  }, [lat, lng, fallback?.lat, fallback?.lng]);

  return (
    <>
      <div ref={box} className="map-box" />
      <button
        type="button"
        className="link-btn"
        onClick={() =>
          navigator.geolocation?.getCurrentPosition((p) =>
            onChange({ lat: p.coords.latitude, lng: p.coords.longitude }),
          )
        }
      >
        📍 Use my current location
      </button>
      {lat != null && lng != null && (
        <span className="meta" style={{ marginLeft: 8 }}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
      )}
    </>
  );
}
