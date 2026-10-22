import { useState } from 'react';
import { haversineKm } from '../lib/hours';
import { inIndia, linkKind, parseCoords, spotFromGoogleUrl, type Spot } from '../lib/mapsLink';
import { supabase } from '../lib/supabase';

// Far enough from the chosen area that a wrong paste is likely, so the vendor is asked to check.
const FAR_KM = 25;

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

type Result = { tone: 'ok' | 'warn' | 'bad'; text: string };

/** "Or paste a Google Maps link" under the map pin. Moves the pin; the form still needs Save. */
export function MapsLinkBox({
  onSpot,
  area,
}: {
  onSpot: (p: { lat: number; lng: number }) => void;
  /** The chosen area, to warn when the pasted spot is far from it. */
  area?: { lat: number | null; lng: number | null; name?: string } | null;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function find(value = text) {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const spot = await findSpot(v);
      if (!inIndia(spot)) throw new SpotError('This spot is outside India. Check the link.');
      onSpot({ lat: spot.lat, lng: spot.lng });
      const where = `${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`;
      const km =
        area?.lat != null && area.lng != null ? haversineKm(spot, { lat: area.lat, lng: area.lng }) : 0;
      if (km > FAR_KM)
        setResult({
          tone: 'warn',
          text: `Pin moved to ${where}, but this spot is ${Math.round(km)} km from ${area?.name ?? 'the chosen area'}. Is the link right?`,
        });
      else if (spot.approx)
        setResult({
          tone: 'warn',
          text: `Approximate: this link only shows where the map was looking. Pin moved to ${where}, drag it onto the shop.`,
        });
      else
        setResult({
          tone: 'ok',
          text: `Pin moved to ${where}. Check it is on your shop entrance, drag to adjust.`,
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
