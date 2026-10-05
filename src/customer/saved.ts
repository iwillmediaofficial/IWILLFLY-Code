import { readJSON, writeJSON } from '../lib/storage';

const KEY = 'iwillfly-saved';

export const getSaved = () => readJSON<string[]>(KEY, []);

export function saveOffer(id: string) {
  const a = getSaved();
  if (!a.includes(id)) writeJSON(KEY, [...a, id]);
}

export function removeSaved(id: string) {
  writeJSON(
    KEY,
    getSaved().filter((x) => x !== id),
  );
}
