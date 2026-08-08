export type StockStatus = "in" | "low" | "out";
export type PayMethod = "cod" | "cop" | "bank" | "wallet" | "fiar";
export type PayStatus = "unpaid" | "deposit" | "paid" | "refunded";
export type OrderStatus =
  | "new" | "confirmed" | "preparing" | "out" | "arrived" | "completed" | "cancelled";
export type Lang = "tet" | "pt" | "en";

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}

export interface Product {
  id: string;
  ref: string;
  name: string;
  slug: string;
  category_id: string | null;
  price: number;
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
  views: number;
  wa_clicks: number;
  created_at: string;
}

export interface Zone {
  id: string;
  name: string;
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
  banks: Bank[];
  wallets: Wallet[];
  zones: Zone[];
}

export interface OrderItem {
  product_id: string;
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
