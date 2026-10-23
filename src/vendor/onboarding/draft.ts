import type { Hours, Parking, Plan } from '../../lib/types';
import { hoursError, phoneError } from '../format';

/** One branch as typed into the application. The first one is the shop's main branch. */
export interface BranchDraft {
  name: string;
  address: string;
  location_id: number | null;
  lat: number | null;
  lng: number | null;
  parking: Parking | null;
  parking_note: string;
  phone: string;
  hours: Hours;
}

/** Everything the vendor application asks for, kept on the device until it is sent. */
export interface Draft {
  step: number;
  plan_id: number | null;
  name: string;
  category_id: number | null;
  description: string;
  phone: string;
  whatsapp: string;
  waSame: boolean;
  /** Only when the registered business name differs from the shop name. */
  business_name: string;
  /** "Does this shop have other branches?" */
  multi: boolean;
  branches: BranchDraft[];
}

export const STEPS = ['Plan', 'Shop', 'Location', 'Hours', 'Branches', 'Review'] as const;

/** The most branches the application takes; more can be added from the dashboard later. */
export const MAX_APPLY_BRANCHES = 2;

const WEEK: Hours = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '09:00', close: '21:00' }]),
) as Hours;

export const emptyBranch = (name = ''): BranchDraft => ({
  name,
  address: '',
  location_id: null,
  lat: null,
  lng: null,
  parking: null,
  parking_note: '',
  phone: '',
  hours: { ...WEEK },
});

export const emptyDraft = (phone = ''): Draft => ({
  step: 0,
  plan_id: null,
  name: '',
  category_id: null,
  description: '',
  phone,
  whatsapp: '',
  waSame: true,
  business_name: '',
  multi: false,
  branches: [emptyBranch()],
});

const key = (uid: string) => `iwf-vendor-apply:${uid}`;

/** The saved draft for this account, if any. Storage can be missing or blocked, so failures are ignored. */
export function loadDraft(uid: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return Array.isArray(d.branches) && d.branches.length ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(uid: string, d: Draft) {
  try {
    localStorage.setItem(key(uid), JSON.stringify(d));
  } catch {
    // Not saved on this device; the form still works.
  }
}

export function clearDraft(uid: string) {
  try {
    localStorage.removeItem(key(uid));
  } catch {
    // nothing to clear
  }
}

/** A 6-to-20 character phone, required. */
function requiredPhone(value: string, label: string) {
  if (!value.trim()) return `Please enter the ${label.toLowerCase()} number.`;
  return phoneError(value, label);
}

/** What is wrong with one branch's place details (step 3, and the second branch on step 5). */
export function placeError(b: BranchDraft, label = '') {
  const p = label ? `${label}: ` : '';
  if (b.address.trim().length < 5) return `${p}Please enter the full address.`;
  if (b.address.trim().length > 300) return `${p}Address is too long (300 characters max).`;
  if (b.location_id == null) return `${p}Please choose the Area.`;
  if (b.lat == null || b.lng == null) return `${p}Please put the pin on the map at the shop's entrance.`;
  if (!b.parking) return `${p}Please choose the parking option.`;
  if (b.parking_note.trim().length > 100) return `${p}Parking note is too long (100 characters max).`;
  const ph = phoneError(b.phone, 'Branch phone');
  return ph ? `${p}${ph}` : null;
}

export function openHoursError(h: Hours, label = '') {
  const p = label ? `${label}: ` : '';
  if (Object.keys(h).length === 0) return `${p}Please open at least one day.`;
  const e = hoursError(h);
  return e ? `${p}${e}` : null;
}

/** The first problem on a step, or null when the vendor can go on. */
export function stepError(step: number, d: Draft, plan: Plan | undefined): string | null {
  const main = d.branches[0];
  switch (step) {
    case 0:
      return plan ? null : 'Please choose a plan to continue.';
    case 1: {
      const n = d.name.trim();
      if (n.length < 2 || n.length > 120) return 'Shop name should be 2 to 120 characters.';
      if (
        d.business_name.trim() &&
        (d.business_name.trim().length < 2 || d.business_name.trim().length > 120)
      )
        return 'Business name should be 2 to 120 characters.';
      if (d.category_id == null) return 'Please choose a category.';
      if (!d.description.trim()) return 'Please describe your shop in a line or two.';
      if (d.description.trim().length > 1000) return 'Description is too long (1000 characters max).';
      return (
        requiredPhone(d.phone, 'Shop phone') ?? (d.waSame ? null : requiredPhone(d.whatsapp, 'WhatsApp'))
      );
    }
    case 2:
      return placeError(main);
    case 3:
      return openHoursError(main.hours);
    case 4: {
      if (!d.multi) return null;
      if (!main.name.trim()) return 'Please name your main branch, for example "MG Road".';
      const second = d.branches[1];
      if (!second) return 'Please add your other branch, or choose "No".';
      if (!second.name.trim()) return 'Please name the other branch.';
      if (main.name.trim().toLowerCase() === second.name.trim().toLowerCase())
        return 'The two branches need different names.';
      return placeError(second, second.name.trim()) ?? openHoursError(second.hours, second.name.trim());
    }
    default:
      return null;
  }
}

/** The body for submit_vendor_application(). */
export function applicationBody(d: Draft) {
  const branches = (d.multi ? d.branches.slice(0, MAX_APPLY_BRANCHES) : d.branches.slice(0, 1)).map((b) => ({
    name: b.name.trim(),
    address: b.address.trim(),
    location_id: b.location_id,
    lat: b.lat,
    lng: b.lng,
    parking: b.parking,
    parking_note: b.parking_note.trim(),
    phone: b.phone.trim(),
    hours: b.hours,
  }));
  return {
    plan_id: d.plan_id,
    business_name: d.business_name.trim(),
    shop: {
      name: d.name.trim(),
      category_id: d.category_id,
      description: d.description.trim(),
      phone: d.phone.trim(),
      whatsapp: (d.waSame ? d.phone : d.whatsapp).trim(),
    },
    branches,
  };
}
