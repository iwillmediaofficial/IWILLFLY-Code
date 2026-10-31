import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Hit = { name: string; label: string; kind: string; lat: number; lng: number };

/**
 * Admin > Locations: type a place name ("Kodakara") and pick it from the list to fill latitude and longitude.
 * The search runs in the Worker (worker/placeSearch.ts) on OpenStreetMap's free place search.
 */
export function PlaceSearch({
  initial,
  near,
  onPick,
}: {
  initial?: string;
  /** Places near this point are listed first (the parent city or district). */
  near?: { lat: number; lng: number } | null;
  onPick: (p: { lat: number; lng: number; name: string }) => void;
}) {
  const [q, setQ] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function search() {
    const text = q.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setMsg(null);
    setHits(null);
    try {
      if (!supabase) throw new Error('Supabase is not configured');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Please sign in again');
      const res = await fetch('/api/places/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, near: near ?? undefined }),
      }).catch(() => null);
      if (!res) throw new Error('No internet connection. Try again.');
      const out = (await res.json().catch(() => null)) as { hits?: Hit[]; error?: string } | null;
      if (!res.ok || !out?.hits) throw new Error(out?.error || `Search failed (${res.status})`);
      if (!out.hits.length)
        setMsg({
          tone: 'bad',
          text: 'No place found with that name. Try another spelling, or paste a Google Maps link below.',
        });
      setHits(out.hits);
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Search failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="maps-link place-search">
      <label htmlFor="place-q">Search the place by name</label>
      <div className="maps-link-row">
        <input
          id="place-q"
          type="search"
          autoComplete="off"
          placeholder="e.g. Kodakara"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter searches instead of submitting the whole form
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button
          type="button"
          className="btn small secondary"
          onClick={() => void search()}
          disabled={busy || q.trim().length < 2}
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {hits && hits.length > 0 && (
        <ul className="place-hits">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(h);
                  setHits(null);
                  setMsg({
                    tone: 'ok',
                    text: `Pin moved to ${h.name} (${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}). Drag it to adjust if needed.`,
                  });
                }}
              >
                <b>{h.name}</b>
                {h.kind && <span className="place-kind">{h.kind.replace(/_/g, ' ')}</span>}
                <span className="place-label">{h.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <div className={`maps-link-msg ${msg.tone}`}>{msg.text}</div>}
      <div className="place-credit">Search by OpenStreetMap</div>
    </div>
  );
}
