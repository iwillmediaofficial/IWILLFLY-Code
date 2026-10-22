import type { Parking } from './types';

// Order and wording for the vendor's Parking choice and the shop page.
export const PARKING: { value: Parking; icon: string; label: string; short: string }[] = [
  { value: 'free', icon: '🅿️', label: 'Free parking (cars and bikes)', short: 'Free' },
  { value: 'free_bike', icon: '🛵', label: 'Free bike parking only', short: 'Bikes only' },
  { value: 'paid', icon: '💳', label: 'Paid parking', short: 'Paid' },
  { value: 'street', icon: '🛣️', label: 'Roadside parking nearby', short: 'Roadside' },
  { value: 'none', icon: '🚫', label: 'No parking', short: 'None' },
];

export const parkingInfo = (p: Parking | null | undefined) => PARKING.find((o) => o.value === p);
