// Sample content from the UI prototype. Phase 1 replaces this with Supabase queries.
export type CategoryKey = 'textile' | 'appliance' | 'supermarket' | 'electronics' | 'food' | 'beauty';

export interface DemoShop {
  id: string;
  name: string;
  cat: CategoryKey;
  icon: string;
  distance: number;
  offer: string;
  mall: string;
  open: string;
  close: string;
}

export const shops: DemoShop[] = [
  {
    id: 'lulu',
    name: 'Lulu Fashion',
    cat: 'textile',
    icon: '👗',
    distance: 0.8,
    offer: 'Up to 50% OFF',
    mall: 'Grand Mall',
    open: '09:00',
    close: '22:00',
  },
  {
    id: 'bismi',
    name: 'Bismi Home Appliances',
    cat: 'appliance',
    icon: '📺',
    distance: 1.2,
    offer: 'Festival price',
    mall: 'City Centre',
    open: '10:00',
    close: '21:30',
  },
  {
    id: 'fresh',
    name: 'Fresh Mart Supermarket',
    cat: 'supermarket',
    icon: '🛒',
    distance: 1.4,
    offer: 'Flat 25% OFF',
    mall: '',
    open: '08:00',
    close: '23:00',
  },
  {
    id: 'style',
    name: 'Style Textiles',
    cat: 'textile',
    icon: '👕',
    distance: 1.7,
    offer: 'Up to 40% OFF',
    mall: 'Metro Mall',
    open: '09:30',
    close: '21:00',
  },
  {
    id: 'home',
    name: 'Home Needs',
    cat: 'appliance',
    icon: '🧺',
    distance: 2.1,
    offer: 'Up to 35% OFF',
    mall: '',
    open: '10:00',
    close: '21:00',
  },
  {
    id: 'spice',
    name: 'Spice House Restaurant',
    cat: 'food',
    icon: '🍽️',
    distance: 2.3,
    offer: 'Flat 30% OFF',
    mall: 'Grand Mall',
    open: '11:00',
    close: '23:30',
  },
  {
    id: 'beauty',
    name: 'Glow Beauty',
    cat: 'beauty',
    icon: '💄',
    distance: 2.7,
    offer: 'Buy 2 Get 1',
    mall: 'City Centre',
    open: '10:00',
    close: '20:30',
  },
  {
    id: 'mobile',
    name: 'Digital Hub',
    cat: 'electronics',
    icon: '🎧',
    distance: 3.0,
    offer: 'Accessories 20% OFF',
    mall: 'Metro Mall',
    open: '10:00',
    close: '21:30',
  },
];

export const prizes = [
  '₹100 Shopping Voucher',
  'Bluetooth Earbuds',
  'Smart Watch',
  '₹250 Grocery Voucher',
  'Mystery Gift',
  'Better Luck Tomorrow',
];

export const filters: { key: 'all' | CategoryKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'textile', label: '👗 Textiles' },
  { key: 'supermarket', label: '🛒 Supermarkets' },
  { key: 'appliance', label: '📺 Appliances' },
  { key: 'electronics', label: '🎧 Electronics' },
  { key: 'food', label: '🍽 Food' },
  { key: 'beauty', label: '💄 Beauty' },
];

function minutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function shopIsOpen(shop: DemoShop, d = new Date()) {
  const now = d.getHours() * 60 + d.getMinutes();
  return now >= minutes(shop.open) && now < minutes(shop.close);
}
