import { useState } from 'react';
import { haversineKm } from '../lib/hours';
import { inIndia, linkKind, parseCoords, spotFromGoogleUrl, type Spot } from '../lib/mapsLink';
import { nearestArea } from '../lib/profileArea';
import { useLocations } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { LocationNode } from '../lib/types';

// Areas are saved as a centre point, not a boundary. A spot is inside an area when that area's
// point is the nearest one (within BORDER_KM of the halfway line, either area is accepted)
// and it is no further than this from the centre. Neighbouring areas in Kochi are about 4 to 10 km apart.
const AREA_RADIUS_KM: Record<LocationNode['kind'], number> = { area: 5, city: 15, district: 40, state: 0 };
const BORDER_KM = 1;

const NOT_FOUND =
  "Couldn't find the exact spot in this link. In Google Maps, press and hold on your shop to drop a pin, then tap Share and copy the link, or copy the numbers shown at the top. You can also drag the pin on the map.";

class SpotError extends Error {}

/** Short links (and place links without numbers) are followed by the Worker; see worker/mapsLink.ts. */
async function resolveOnServer(url: string): Promise<Spot> {
  if (!supabase) throw new SpotError('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new SpotError('Please sign in first');
  const res = await fetch('/api/maps/resolve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch(() => null);
  if (!res) throw new SpotError('No internet connection. Try again.');
  const out = (await res.json().catch(() => null)) as (Spot & { error?: string }) | null;
  if (res.ok && out && typeof out.lat === 'number' && typeof out.lng === 'number') return out;
  if (out?.error === 'not_google') throw new SpotError("This doesn't look like a Google Maps link.");
  if (out?.error === 'not_opened')
    throw new SpotError("This link didn't open. Copy it again from Google Maps.");
  if (out?.error === 'not_found') throw new SpotError(NOT_FOUND);
  throw new SpotError(out?.error || `Could not read the link (${res.status})`);
}

async function findSpot(text: string): Promise<Spot> {
  const kind = linkKind(text);
  if (kind === 'coords') return parseCoords(text)!;
  if (kind === 'other') throw new SpotError("This doesn't look like a Google Maps link.");
  if (kind === 'google') {
    const spot = spotFromGoogleUrl(text);
    if (spot && !spot.approx) return spot;
    // a place link with only the map view or no numbers: the Worker may find the place on its page
    return resolveOnServer(text).catch((e) => {
      if (spot) return spot;
      throw e;
    });
  }
  return resolveOnServer(text);
}

/** Why the spot is outside the chosen area, or null when it is inside (or the area has no map point). */
function outsideArea(all: LocationNode[], area: LocationNode, spot: Spot): string | null {
  if (area.lat == null || area.lng == null) return null;
  const km = haversineKm(spot, { lat: area.lat, lng: area.lng });
  const near = area.kind === 'area' ? nearestArea(all, spot) : null;
  if (near && near.area.id !== area.id && km - near.km > BORDER_KM)
    return `This spot is in ${near.area.name}, not ${area.name}. Choose ${near.area.name} as the Area, or check the link. The pin was not moved.`;
  const radius = AREA_RADIUS_KM[area.kind];
  if (radius && km > radius)
    return `This spot is ${Math.round(km)} km from ${area.name}, so it isn't inside that area. Choose the right Area, or check the link. The pin was not moved.`;
  return null;
}

type Result = { tone: 'ok' | 'warn' | 'bad'; text: string };

/** "Or paste a Google Maps link" under the map pin. Moves the pin; the form still needs Save. */
export function MapsLinkBox({
  onSpot,
  area,
  anywhere = false,
}: {
  onSpot: (p: { lat: number; lng: number }) => void;
  /** The chosen area: a pasted spot must be inside it. */
  area?: LocationNode | null;
  /** Admin > Locations sets an area's own centre, so any spot in India is accepted and no Area is needed. */
  anywhere?: boolean;
}) {
  const { data: locations = [] } = useLocations();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function find(value = text) {
    const v = value.trim();
    if (!v || busy) return;
    if (!area && !anywhere) {
      setResult({ tone: 'bad', text: 'Choose the Area first, then paste the link.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const spot = await findSpot(v);
      if (!inIndia(spot)) throw new SpotError('This spot is outside India. Check the link.');
      const outside = area && !anywhere ? outsideArea(locations, area, spot) : null;
      if (outside) throw new SpotError(outside);
      onSpot({ lat: spot.lat, lng: spot.lng });
      const where = `${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`;
      if (spot.approx)
        setResult({
          tone: 'warn',
          text: `Approximate: this link only shows where the map was looking. Pin moved to ${where}, drag it onto the ${anywhere ? 'right spot' : 'shop'}.`,
        });
      else
        setResult({
          tone: 'ok',
          text: anywhere
            ? `Pin moved to ${where}. Drag it to adjust if needed.`
            : `Pin moved to ${where}. Check it is on your shop entrance, drag to adjust.`,
        });
    } catch (e) {
      setResult({ tone: 'bad', text: e instanceof SpotError ? e.message : NOT_FOUND });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="maps-link">
      <label htmlFor="maps-link">Or paste a Google Maps link</label>
      <div className="maps-link-row">
        <input
          id="maps-link"
          inputMode="url"
          autoComplete="off"
          placeholder="maps.app.goo.gl/… or 10.41570, 76.27017"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (!pasted) return;
            e.preventDefault();
            setText(pasted.trim());
            void find(pasted);
          }}
          onKeyDown={(e) => {
            // Enter finds the spot instead of submitting the whole form
            if (e.key === 'Enter') {
              e.preventDefault();
              void find();
            }
          }}
        />
        <button
          type="button"
          className="btn small secondary"
          onClick={() => void find()}
          disabled={busy || !text.trim()}
        >
          {busy ? 'Finding…' : 'Find'}
        </button>
      </div>
      {result && <div className={`maps-link-msg ${result.tone}`}>{result.text}</div>}
    </div>
  );
}
