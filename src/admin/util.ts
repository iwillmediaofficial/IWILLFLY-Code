import { useQueryClient, type QueryKey } from '@tanstack/react-query';

/** Query keys of the customer-facing lists that change when admins edit marketplace data. */
export const PUBLIC_KEYS: QueryKey[] = [['search_shops'], ['search_offers'], ['list_malls']];

/** Returns a function that invalidates several query keys at once. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** "Fresh Mart & Co." -> "fresh-mart-co" */
export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Turns Postgres errors into something an admin can act on. */
export function friendlyError(err: unknown, duplicate = 'That slug is already used. Pick another.') {
  const msg = err instanceof Error ? err.message : String(err);
  if (/duplicate key|unique constraint/i.test(msg)) return duplicate;
  if (/violates check constraint/i.test(msg)) return 'Some values are too long or out of range.';
  if (/violates foreign key/i.test(msg)) return 'This item is still in use, so it cannot be removed.';
  return msg;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** wa.me link; assumes an Indian number when only 10 digits are given. */
export function waLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}

/** "" -> null, otherwise a finite number or null. */
export function toNumber(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** PostgREST returns a one-to-one embed as an object and one-to-many as an array; accept both. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
