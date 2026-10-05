import type { LocationNode } from './types';

/** Full path like "Kerala › Ernakulam › Kochi › Edappally". */
export function locationPath(all: LocationNode[], id: number | null) {
  const byId = new Map(all.map((l) => [l.id, l]));
  const parts: string[] = [];
  let cur = id != null ? byId.get(id) : undefined;
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(' › ');
}
