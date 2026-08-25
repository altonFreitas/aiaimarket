export type StockStatus = "in" | "low" | "out";
/** "card" is the gateway-backed method (BNCTL / Mastercard acquiring, see
 * lib/payments/). Every other value is a manual method the owner reconciles
 * by hand -- which is why pay_status stays a separate column: a card order
 * is paid when the gateway says so, a bank-transfer order when the owner
 * says so. */
export type PayMethod = "cod" | "cop" | "bank" | "wallet" | "fiar" | "card";
export type PayStatus = "unpaid" | "deposit" | "paid" | "refunded";
export type OrderStatus =
  | "new" | "confirmed" | "preparing" | "out" | "arrived" | "completed" | "cancelled";
export type Lang = "tet" | "pt" | "en";

export type SellerType = "individual" | "business";
export type SellerStatus = "pending" | "approved" | "rejected" | "suspended";

export interface Customer {
  id: string;
  user_id: string;
  email: string;
  phone: string;
  notify_new_products: boolean;
  created_at: string;
}

export interface Seller {
  id: string;
  user_id: string | null;
  full_name: string;
  store_name: string;
  slug: string;
  email: string;
  phone: string;
  description: string;
  address: string;
  city: string;
  country: string;
  seller_type: SellerType;
  status: SellerStatus;
  commission_rate: number | null;
  delivery_available: boolean;
  pickup_available: boolean;
  delivery_fee: number | null;
  delivery_area: string;
  totp_enabled: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}

export interface HeroSlide {
  id: string;
  image_url: string;
  headline: string;
  subtext: string;
  cta_label: string;
  cta_href: string;
  sort_order: number;
  created_at: string;
}

export type ProductStatus = "pending" | "approved" | "rejected";

export interface Product {
  id: string;
  seller_id: string;
  ref: string;
  name: string;
  slug: string;
  category_id: string | null;
  price: number;
  /** Sale price in dollars, or null when there's no discount running.
   * The percentage shown anywhere in the UI is always computed from
   * price vs discount_price, never stored — see schema.sql. */
  discount_price: number | null;
  sizes: string[];
  tags: string[];
  stock_status: StockStatus;
  qty: number;
  description: string;
  images: string[];
  municipality: string | null;
  post: string | null;
  suku: string | null;
  landmark: string | null;
  pay_cod: boolean;
  pay_cop: boolean;
  pay_bank: boolean;
  pay_wallet: boolean;
  pay_fiar: boolean;
  archived: boolean;
  status: ProductStatus;
  views: number;
  wa_clicks: number;
  created_at: string;
}

/** Fixed set — the spec calls out exactly these three delivery zones.
 * Fixing the id (rather than free-text names) is what lets the label
 * translate correctly when the buyer switches language; only the fee
 * and quote-on-request toggle are configurable per zone. */
export type ZoneId = "dili_center" | "dili_outskirts" | "other_municipality";
export interface Zone {
  id: ZoneId;
  fee: number;
  quote: boolean;
}
export interface Bank { label: string; account: string; holder: string; }
export interface Wallet { label: string; number: string; }

export interface Settings {
  id: number;
  store_name: string;
  tagline_tet: string;
  tagline_pt: string;
  tagline_en: string;
  wa_number: string;
  hours: string;
  municipality: string;
  post: string;
  suku: string;
  landmark: string;
  pickup: boolean;
  commission_rate: number;
  seller_registration_enabled: boolean;
  banks: Bank[];
  wallets: Wallet[];
  zones: Zone[];
}

export interface OrderItem {
  product_id: string;
  seller_id: string | null;
  name: string;
  size: string;
  price: number;
  qty: number;
}

export interface OrderLogEntry {
  id: number;
  text: string;
  created_at: string;
}

export interface Order {
  id: string;
  ref: string;
  buyer_name: string;
  buyer_phone: string;
  items: OrderItem[];
  mode: "delivery" | "pickup";
  zone_id: string | null;
  fee: number;
  quote_requested: boolean;
  subtotal: number;
  total: number;
  // Central Dili orders use a simple street address (address_line);
  // outskirts/other-municipality orders use the full hierarchy below.
  address_line: string | null;
  municipality: string | null;
  post: string | null;
  suku: string | null;
  aldeia: string | null;
  landmark: string | null;
  pay_method: PayMethod;
  pay_status: PayStatus;
  proof_url: string | null;
  note: string;
  status: OrderStatus;
  cancel_reason: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  order_log?: OrderLogEntry[];
}

/** A card payment attempt. Mirrors the `payments` table in
 * supabase/payments.sql. Amounts are integer MINOR UNITS (cents) here, not
 * dollars -- see lib/payments/money.ts for why. */
export interface Payment {
  id: string;
  order_id: string;
  provider: string;
  provider_ref: string | null;
  idempotency_key: string;
  amount_minor: number;
  currency: string;
  status:
    | "initiated" | "pending" | "authorized"
    | "captured" | "failed" | "cancelled" | "refunded";
  failure_reason: string | null;
  redirect_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Homepage promo tile ("Oportunidades aos melhores preços" style). Mirrors
 * the promotions table in supabase/promotions.sql. */
export interface Promotion {
  id: string;
  title: string;
  badge_label: string;
  image_url: string;
  href: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}
