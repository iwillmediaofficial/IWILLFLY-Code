import type { DayKey, Hours } from './types';

export const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const JS_DAY: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Current date parts in India time, whatever the device's time zone. */
export function nowIST(d = new Date()) {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60_000);
  return {
    day: JS_DAY[ist.getDay()],
    minutes: ist.getHours() * 60 + ist.getMinutes(),
    date: `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`,
  };
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** "09:00" -> "9:00 AM" */
export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

export interface OpenState {
  open: boolean;
  label: string;
  today: string;
}

/**
 * Open/closed right now in India time. Handles holidays, temporary closure
 * and hours that run past midnight (close earlier than open).
 */
export function openState(
  b: { hours: Hours | null; holidays?: string[] | null; temp_closed?: boolean | null },
  at = new Date(),
): OpenState {
  const { day, minutes, date } = nowIST(at);
  const today = b.hours?.[day];
  const todayText = today ? `${formatTime(today.open)} – ${formatTime(today.close)}` : 'Closed today';
  if (b.temp_closed) return { open: false, label: 'Temporarily closed', today: todayText };
  if (b.holidays?.includes(date)) return { open: false, label: 'Holiday today', today: 'Holiday' };

  const prevKey = JS_DAY[(JS_DAY.indexOf(day) + 6) % 7];
  const prev = b.hours?.[prevKey];
  if (prev && toMin(prev.close) < toMin(prev.open) && minutes < toMin(prev.close)) {
    return { open: true, label: 'Open now', today: todayText };
  }
  if (!today) return { open: false, label: 'Closed today', today: todayText };
  const o = toMin(today.open);
  const c = toMin(today.close);
  const open = c > o ? minutes >= o && minutes < c : minutes >= o;
  if (open) return { open: true, label: 'Open now', today: todayText };
  return {
    open: false,
    label: minutes < o ? `Opens ${formatTime(today.open)}` : 'Closed now',
    today: todayText,
  };
}

/** "850 m", "2.4 km"; with `approx` (an imprecise GPS fix, see isApprox) "approx. 2.4 km". */
export function formatKm(km: number | null | undefined, approx = false) {
  if (km == null) return '';
  const text = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  return approx ? `approx. ${text}` : text;
}

/** Straight-line distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
}

export function formatPrice(n: number | null | undefined) {
  if (n == null) return '';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
