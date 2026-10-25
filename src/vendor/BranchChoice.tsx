import { useState } from 'react';
import type { Branch } from '../lib/types';

/** "Where?": all branches, or ticked ones (with a search box for big brands). Used by offers and prizes. */
export function BranchChoice({
  name,
  label,
  hint,
  branches,
  all,
  picked,
  onChange,
}: {
  /** Radio group name, unique on the page */
  name: string;
  label: string;
  hint?: string;
  branches: Branch[];
  all: boolean;
  picked: number[];
  onChange: (all: boolean, picked: number[]) => void;
}) {
  const [q, setQ] = useState('');
  const usable = branches.filter((b) => b.review_status !== 'rejected');
  const shown = usable.filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: number) =>
    onChange(false, picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="field">
      <label>{label}</label>
      <label className="check-row">
        <input type="radio" name={name} checked={all} onChange={() => onChange(true, picked)} />
        All branches ({usable.length})
      </label>
      <label className="check-row">
        <input type="radio" name={name} checked={!all} onChange={() => onChange(false, picked)} />
        Only some branches
      </label>
      {!all && (
        <>
          {usable.length > 8 && (
            <input
              type="search"
              placeholder="Search branches"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search branches"
              style={{ marginTop: 6 }}
            />
          )}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 4 }}>
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                onChange(
                  false,
                  usable.map((b) => b.id),
                )
              }
            >
              Select all
            </button>
            <button type="button" className="link-btn" onClick={() => onChange(false, [])}>
              Clear
            </button>
            <span className="meta">{picked.length} chosen</span>
          </div>
          <div className="check-list">
            {shown.map((b) => (
              <label key={b.id}>
                <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} />
                <span>
                  {b.name}
                  {b.review_status === 'pending' && <span className="meta"> · waiting for approval</span>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
