import { Ban, Bike, Car, CreditCard, Route, type LucideIcon } from 'lucide-react';
import type { Parking } from './types';

// Order and wording for the vendor's Parking choice and the shop page.
export const PARKING: { value: Parking; icon: LucideIcon; label: string; short: string }[] = [
  { value: 'free', icon: Car, label: 'Free parking (cars and bikes)', short: 'Free' },
  { value: 'free_bike', icon: Bike, label: 'Free bike parking only', short: 'Bikes only' },
  { value: 'paid', icon: CreditCard, label: 'Paid parking', short: 'Paid' },
  { value: 'street', icon: Route, label: 'Roadside parking nearby', short: 'Roadside' },
  { value: 'none', icon: Ban, label: 'No parking', short: 'None' },
];

export const parkingInfo = (p: Parking | null | undefined) => PARKING.find((o) => o.value === p);
