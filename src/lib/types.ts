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

/** The signed-in user's business from my_vendor(), with their place in it. */
export type VendorRole = 'owner' | 'manager' | 'staff';
export interface MyVendor extends Vendor {
  my_role: VendorRole;
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
  /** Set by a paid "featured shop" add-on or an admin. */
  is_featured: boolean;
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

// Scratch & Win ----------------------------------------------------------------------------------

export type ClaimStatus = 'unclaimed' | 'claimed' | 'expired';

export interface ScratchCampaign {
  id: number;
  name: string;
  description: string | null;
  banner_key: string | null;
  starts_on: string;
  ends_on: string | null;
  /** "HH:MM:SS", India time */
  active_from: string;
  active_to: string;
  location_id: number | null;
  max_wins_per_customer: number | null;
  claim_valid_days: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScratchPrize {
  id: number;
  campaign_id: number;
  sponsor_vendor_id: number | null;
  name: string;
  description: string | null;
  image_key: string | null;
  quantity: number;
  remaining: number;
  /** 0..1 chance of winning this prize on one scratch */
  probability: number;
  /** Most wins per India day; null = no daily limit */
  daily_limit: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One play as the customer sees it (play_scratch, my_prizes, scratch_today.today_play). */
export interface PlayResult {
  play_id: number;
  campaign_id: number;
  campaign_name: string;
  played_at: string;
  won: boolean;
  prize: { id: number; name: string; description: string | null; image_key: string | null } | null;
  /** The shop that hands the prize over, with its business contact and first active shop. */
  sponsor: {
    vendor_id: number;
    name: string;
    phone?: string | null;
    whatsapp?: string | null;
    shop_id?: number | null;
  } | null;
  claim_code: string | null;
  /** already 'expired' when past expires_at, even before the hourly job runs */
  claim_status: ClaimStatus | null;
  expires_at: string | null;
  claimed_at: string | null;
}

/** play_scratch() result. */
export interface PlayResponse extends PlayResult {
  status: 'won' | 'lost' | 'already_played';
}

/** Row from the scratch_today RPC. */
export interface TodayCampaign {
  id: number;
  name: string;
  description: string | null;
  banner_key: string | null;
  starts_on: string;
  ends_on: string | null;
  active_from: string;
  active_to: string;
  is_open_now: boolean;
  /** false when the campaign is for another area (or the customer has not set one in Settings) */
  eligible: boolean;
  today_play: PlayResult | null;
}

/** claim_prize(code, confirm) result. No sponsor field. */
export type ClaimLookup =
  | { status: 'not_found' }
  | (Omit<PlayResult, 'sponsor'> & {
      status: ClaimStatus | 'claimed_now' | 'flagged';
      customer_name: string;
      customer_phone?: string | null;
      fraud_flag: boolean;
    });

/** Row from vendor_winners(campaign_id?). */
export interface VendorWinner {
  play_id: number;
  campaign_id: number;
  campaign_name: string;
  prize_id: number;
  prize_name: string;
  customer_name: string;
  /** The winner's mobile, so the shop can contact them. */
  customer_phone: string | null;
  played_at: string;
  claim_status: ClaimStatus;
  expires_at: string;
  claimed_at: string | null;
}

/** Row from campaign_winners(campaign_id), managers only. */
export interface CampaignWinner {
  play_id: number;
  prize_id: number;
  prize_name: string;
  sponsor_name: string | null;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  played_at: string;
  claim_code: string;
  claim_status: ClaimStatus;
  expires_at: string;
  claimed_at: string | null;
  fraud_flag: boolean;
  fraud_note: string | null;
  /** wins this customer has in the campaign */
  customer_wins: number;
}

/** Row from campaign_stats(campaign_id), managers only. given_out always equals won. */
export interface CampaignPrizeStats {
  prize_id: number;
  prize_name: string;
  quantity: number;
  remaining: number;
  given_out: number;
  won: number;
  claimed: number;
  unclaimed: number;
  expired: number;
  plays_total: number;
  players: number;
}

// Engagement (Phase 3) ---------------------------------------------------------------------------

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface Festival {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  banner_key: string | null;
  /** "#rrggbb" or null for the default blue */
  theme_color: string | null;
  starts_on: string;
  ends_on: string;
  /** vendors can submit until this date; null = until ends_on */
  submissions_close_on: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface FestivalOfferRow {
  festival_id: number;
  offer_id: number;
  status: ReviewStatus;
  note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/** Row from festival_offers_live(festival_id). */
export interface FestivalOffer {
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
  category_name: string | null;
}

export type AdLinkKind = 'none' | 'url' | 'shop' | 'offer' | 'festival' | 'mall';

export interface Ad {
  id: number;
  pill: string | null;
  title: string;
  subtitle: string | null;
  image_key: string | null;
  /** prototype colour themes */
  style: 'ad1' | 'ad2' | 'ad3';
  link_kind: AdLinkKind;
  /** url, or the shop/offer/mall id, or the festival slug */
  link_target: string | null;
  vendor_id: number | null;
  starts_on: string;
  ends_on: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PlacementKind = 'featured_offer' | 'home_banner' | 'festival_spotlight';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PlacementRequest {
  id: number;
  vendor_id: number;
  kind: PlacementKind;
  offer_id: number | null;
  shop_id: number | null;
  festival_id: number | null;
  message: string | null;
  wanted_from: string | null;
  wanted_to: string | null;
  status: RequestStatus;
  admin_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
}

export interface AppNotification {
  id: number;
  user_id: string;
  kind:
    'broadcast' | 'offer_review' | 'vendor_review' | 'new_winner' | 'festival_review' | 'placement_review';
  title: string;
  body: string | null;
  /** in-app path */
  link: string | null;
  broadcast_id: number | null;
  push_status: 'pending' | 'sent' | 'skipped';
  created_at: string;
  read_at: string | null;
}

export type BroadcastAudience = 'everyone' | 'customers' | 'vendors';

export interface Broadcast {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  audience: BroadcastAudience;
  location_id: number | null;
  category_id: number | null;
  with_push: boolean;
  recipients: number;
  created_by: string | null;
  created_at: string;
}

export type TrackEvent = 'view' | 'click' | 'whatsapp' | 'call' | 'directions';

export interface StatTotals {
  views: number;
  clicks: number;
  saves: number;
  whatsapp: number;
  calls: number;
  directions: number;
}

export interface StatDay extends StatTotals {
  day: string;
}

/** vendor_analytics(from, to) */
export interface VendorAnalytics {
  from: string;
  to: string;
  totals: StatTotals;
  daily: StatDay[];
  offers: {
    offer_id: number;
    title: string;
    views: number;
    clicks: number;
    saves: number;
    whatsapp: number;
  }[];
  scratch: { won: number; claimed: number };
}

/** admin_analytics(from, to) */
export interface AdminAnalytics {
  from: string;
  to: string;
  totals: StatTotals;
  daily: StatDay[];
  top_offers: {
    offer_id: number;
    title: string;
    shop_name: string;
    views: number;
    clicks: number;
    whatsapp: number;
  }[];
  top_shops: {
    shop_id: number;
    name: string;
    views: number;
    whatsapp: number;
    calls: number;
    saves: number;
  }[];
  scratch_daily: { day: string; plays: number; wins: number; claims: number }[];
  new_users: { day: string; users: number }[];
}

/** Row from my_offer_history(). */
export interface HistoryOffer {
  offer_id: number;
  title: string;
  discount_label: string | null;
  original_price: number | null;
  offer_price: number | null;
  image_key: string | null;
  ends_on: string | null;
  shop_id: number;
  shop_name: string;
  shop_logo_key: string | null;
  viewed_at: string;
}

// Phase 4: plans, add-ons, invoices, staff, support and audit -------------------------------------

export interface BillingSettings {
  id: 1;
  upi_id: string | null;
  payee_name: string | null;
  business_name: string | null;
  business_address: string | null;
  gstin: string | null;
  gst_percent: number;
  invoice_prefix: string;
  payment_note: string | null;
  updated_at: string;
}

export interface Plan {
  id: number;
  name: string;
  description: string | null;
  features: string[];
  /** Rupees. numeric columns arrive as strings or numbers; wrap in Number() before maths. */
  price: number | string;
  period_days: number;
  max_shops: number | null;
  max_live_offers: number | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export type AddonKind = 'featured_shop' | 'promoted_offer' | 'banner_ad';

export interface Addon {
  id: number;
  kind: AddonKind;
  name: string;
  description: string | null;
  price: number | string;
  duration_days: number;
  is_active: boolean;
  sort_order: number;
}

export type InvoiceStatus = 'unpaid' | 'submitted' | 'paid' | 'void';
export type PaymentMethod = 'upi' | 'cash' | 'bank' | 'razorpay' | 'free';

export interface Invoice {
  id: number;
  number: string;
  vendor_id: number;
  status: InvoiceStatus;
  subtotal: number | string;
  gst_percent: number | string;
  tax: number | string;
  total: number | string;
  issued_on: string;
  due_on: string;
  bill_to: { business_name?: string; phone?: string | null; vendor_id?: number };
  bill_from: {
    name?: string | null;
    address?: string | null;
    gstin?: string | null;
    upi_id?: string | null;
    payee_name?: string | null;
    note?: string | null;
  };
  payer_ref: string | null;
  payer_note: string | null;
  submitted_at: string | null;
  payment_method: PaymentMethod | null;
  payment_ref: string | null;
  paid_on: string | null;
  void_reason: string | null;
  admin_note: string | null;
  created_at: string;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  plan_id: number | null;
  addon_id: number | null;
  shop_id: number | null;
  offer_id: number | null;
  description: string;
  days: number;
  amount: number | string;
}

/** One line of create_invoice(p_items). */
export type PurchaseItem =
  { plan_id: number } | { addon_id: number; shop_id?: number | null; offer_id?: number | null };

export interface Subscription {
  id: number;
  vendor_id: number;
  plan_id: number;
  invoice_item_id: number | null;
  starts_on: string;
  ends_on: string;
  cancelled_at: string | null;
  created_at: string;
}

export interface AddonPurchase {
  id: number;
  vendor_id: number;
  addon_id: number;
  kind: AddonKind;
  shop_id: number | null;
  offer_id: number | null;
  invoice_item_id: number | null;
  starts_on: string;
  ends_on: string;
  cancelled_at: string | null;
  created_at: string;
}

/** my_billing() */
export interface MyBilling {
  plan: Plan | null;
  subscription: Subscription | null;
  paid_until: string | null;
  usage: { shops: number; live_offers: number };
  addons: {
    id: number;
    kind: AddonKind;
    name: string;
    shop_id: number | null;
    offer_id: number | null;
    target: string | null;
    starts_on: string;
    ends_on: string;
  }[];
}

export type StaffRole = 'manager' | 'staff';

/** vendor_team() */
export interface TeamMember {
  user_id: string;
  email: string;
  full_name: string | null;
  role: VendorRole;
  added_at: string;
}

export type TicketStatus = 'open' | 'waiting' | 'resolved' | 'closed';
export type TicketCategory = 'billing' | 'account' | 'offers' | 'scratch' | 'technical' | 'other';
export type TicketPriority = 'low' | 'normal' | 'high';

export interface SupportTicket {
  id: number;
  opened_by: string;
  vendor_id: number | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  last_message_at: string;
  last_from_staff: boolean;
  created_at: string;
}

export interface TicketMessage {
  id: number;
  ticket_id: number;
  author_id: string | null;
  is_staff: boolean;
  body: string;
  image_key: string | null;
  created_at: string;
}

/** support_queue() */
export interface QueueTicket {
  id: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  opened_by: string;
  opener_email: string | null;
  opener_name: string | null;
  vendor_id: number | null;
  business_name: string | null;
  assigned_to: string | null;
  assignee_email: string | null;
  last_message_at: string;
  last_from_staff: boolean;
  created_at: string;
}

/** admin_team() */
export interface StaffMember {
  user_id: string;
  email: string;
  full_name: string | null;
  roles: string[];
  last_sign_in_at: string | null;
}

/** audit_log() */
export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  action: 'insert' | 'update' | 'delete';
  table_name: string;
  row_id: string | null;
  /** update: {column: [old, new]}; insert/delete: the whole row */
  changes: Record<string, unknown>;
  created_at: string;
}
