// Row shapes returned by Supabase. Kept by hand next to supabase/migrations.

export type VendorStatus = 'pending' | 'approved' | 'blocked';
export type OfferStatus = 'pending' | 'approved' | 'rejected';
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Hours = Partial<Record<DayKey, { open: string; close: string }>>;

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface LocationNode {
  id: number;
  parent_id: number | null;
  kind: 'state' | 'district' | 'city' | 'area';
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface Vendor {
  id: number;
  owner_id: string;
  business_name: string;
  contact_phone: string | null;
  whatsapp: string | null;
  status: VendorStatus;
  is_verified: boolean;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface Shop {
  id: number;
  vendor_id: number;
  category_id: number | null;
  name: string;
  description: string | null;
  logo_key: string | null;
  cover_key: string | null;
  phone: string | null;
  whatsapp: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Branch {
  id: number;
  shop_id: number;
  name: string;
  address: string | null;
  location_id: number | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  hours: Hours;
  holidays: string[];
  temp_closed: boolean;
  temp_closed_note: string | null;
}

export interface Mall {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  location_id: number | null;
  lat: number | null;
  lng: number | null;
  cover_key: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface Offer {
  id: number;
  shop_id: number;
  category_id: number | null;
  title: string;
  product_name: string | null;
  description: string | null;
  original_price: number | null;
  offer_price: number | null;
  discount_label: string | null;
  image_keys: string[];
  starts_on: string;
  ends_on: string | null;
  status: OfferStatus;
  is_paused: boolean;
  is_featured: boolean;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Row from the search_shops RPC. */
export interface ShopResult {
  shop_id: number;
  name: string;
  logo_key: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_icon: string | null;
  branch_id: number | null;
  branch_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  hours: Hours | null;
  holidays: string[] | null;
  temp_closed: boolean | null;
  mall_id: number | null;
  mall_name: string | null;
  offer_count: number;
  top_offer: string | null;
  featured: boolean;
}

/** Row from the search_offers RPC. */
export interface OfferResult {
  offer_id: number;
  title: string;
  discount_label: string | null;
  original_price: number | null;
  offer_price: number | null;
  image_key: string | null;
  ends_on: string | null;
  is_featured: boolean;
  shop_id: number;
  shop_name: string;
  shop_logo_key: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_icon: string | null;
  distance_km: number | null;
}

/** Row from the list_malls RPC. */
export interface MallResult {
  mall_id: number;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  cover_key: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  shop_count: number;
  offer_count: number;
}
