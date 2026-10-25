import { useMemo, useState, type ReactNode } from 'react';
import { formatKm, openState } from '../lib/hours';
import { mediaUrl } from '../lib/supabase';
import type { Branch, LocationNode } from '../lib/types';

export type BranchWithKm = Branch & { km: number | null };

type Group = { key: string; district: LocationNode | null; branches: BranchWithKm[] };

/** The district a location sits in (walking up area > city > district), or null. */
function districtOf(byId: Map<number, LocationNode>, id: number | null) {
  let cur = id != null ? byId.get(id) : undefined;
  while (cur && cur.kind !== 'district') cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
  return cur ?? null;
}

/**
 * A shop's branches grouped by district: one card per district (nearest first, the customer's district or
 * the nearest one open), each branch with its photo, area, distance, open/closed and View Offers.
 */
export function BranchesByDistrict({
  branches,
  locations,
  photo,
  approx,
  homeArea,
  activeId,
  title = 'Branches by District',
  extra,
  onView,
}: {
  branches: BranchWithKm[];
  locations: LocationNode[];
  /** The picture shown for every branch (the shop's cover, else its logo or category icon) */
  photo: ReactNode;
  approx: boolean;
  /** The area the customer chose, to open their district first */
  homeArea: number | null;
  /** The branch being viewed, marked in the list */
  activeId?: number;
  title?: string;
  /** More details under a branch (offer count, "This offer too") */
  extra?: (b: BranchWithKm) => ReactNode;
  onView: (b: BranchWithKm) => void;
}) {
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const b of branches) {
      const d = districtOf(byId, b.location_id);
      const key = d ? String(d.id) : 'other';
      const g = map.get(key) ?? { key, district: d, branches: [] };
      g.branches.push(b);
      map.set(key, g);
    }
    const near = (g: Group) => Math.min(...g.branches.map((b) => b.km ?? Infinity));
    for (const g of map.values())
      g.branches.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.name.localeCompare(b.name));
    return [...map.values()].sort(
      (a, b) =>
        Number(a.key === 'other') - Number(b.key === 'other') ||
        near(a) - near(b) ||
        (a.district?.name ?? '').localeCompare(b.district?.name ?? ''),
    );
  }, [branches, byId]);

  const home = districtOf(byId, homeArea);
  const first =
    groups.find((g) => g.branches.some((b) => b.id === activeId))?.key ??
    (home && groups.some((g) => g.key === String(home.id)) ? String(home.id) : groups[0]?.key);
  // null until the customer opens or closes a district: then the default one is open.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const open = picked ?? new Set(first ? [first] : []);
  const [only, setOnly] = useState('all');
  const shown = only === 'all' ? groups : groups.filter((g) => g.key === only);
  const isOpen = (key: string) => only !== 'all' || open.has(key);
  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  if (branches.length === 0) return null;
  return (
    <div className="districts">
      <div className="districts-head">
        <h3>{title}</h3>
        {groups.length > 1 && (
          <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Choose a district">
            <option value="all">All Districts</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.district?.name ?? 'Other'}
              </option>
            ))}
          </select>
        )}
      </div>
      {shown.map((g) => {
        const n = g.branches.length;
        const expanded = isOpen(g.key);
        return (
          <div key={g.key} className="district-card">
            <button
              type="button"
              className="district-top"
              aria-expanded={expanded}
              onClick={() => toggle(g.key)}
              disabled={only !== 'all'}
            >
              <span className="district-pic">
                {g.district?.image_key ? (
                  <img src={mediaUrl(g.district.image_key)} alt="" width={44} height={44} loading="lazy" />
                ) : (
                  '🏞️'
                )}
              </span>
              <span className="grow">
                <b>{g.district?.name ?? 'Other'}</b>
                <span className="meta">
                  {n} {n === 1 ? 'branch' : 'branches'} available
                </span>
              </span>
              {only === 'all' && <span className="chev">{expanded ? '⌃' : '⌄'}</span>}
            </button>
            {expanded && (
              <div className="district-list">
                {g.branches.map((b) => {
                  const st = openState(b);
                  const area = b.location_id != null ? byId.get(b.location_id) : undefined;
                  const where = [area && area.kind !== 'district' ? area.name : null, g.district?.name]
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <div key={b.id} className={`district-branch${b.id === activeId ? ' active' : ''}`}>
                      <span className="district-photo">{photo}</span>
                      <div style={{ minWidth: 0 }}>
                        <h4>{b.name}</h4>
                        {where && <div className="meta">{where}</div>}
                        <div className="district-tags">
                          {b.km != null && <span className="meta">📍 {formatKm(b.km, approx)}</span>}
                          <span className={`district-open${st.open ? '' : ' closed'}`}>
                            {st.open ? 'Open Now' : 'Closed'}
                          </span>
                        </div>
                        {extra?.(b)}
                      </div>
                      {b.id === activeId ? (
                        <span className="pill-status live">Viewing</span>
                      ) : (
                        <button type="button" className="btn small" onClick={() => onView(b)}>
                          View Offers
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
