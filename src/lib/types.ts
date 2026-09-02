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
  /** Whether shoppers may pre-order this when it is out of stock.
   * Optional: a database without supabase/preorders.sql has no column,
   * and a missing value reads as enabled, matching the column default. */
  preorder_enabled?: boolean;
  /** Expected availability, YYYY-MM-DD. Null/absent means genuinely
   * unknown, which is shown as such rather than guessed at. */
  preorder_eta?: string | null;
  /** Denormalised review aggregates, maintained by a trigger on
   * product_reviews (see supabase/marketplace-v2.sql). Optional because a
   * database that hasn't had that migration run yet simply won't have the
   * columns -- every reader must treat "missing" as "no reviews yet", never
   * as an error. Use ratingAverage() in lib/utils.ts rather than dividing
   * these by hand. */
  rating_sum?: number;
  rating_count?: number;
  created_at: string;
}

/** One buyer's review of one product, from one completed order. Mirrors
 * product_reviews in supabase/marketplace-v2.sql. buyer_phone is absent by
 * design -- the anon column grant excludes it, so it never reaches a
 * browser. */
export interface ProductReview {
  id: string;
  product_id: string;
  order_id: string | null;
  buyer_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

export type NotifyEventName =
  | "placed" | "confirmed" | "out" | "arrived" | "completed" | "cancelled";
export type NotifyStatus = "queued" | "sent" | "failed" | "skipped";

/** One message the store owes, or has sent, a buyer about their order.
 * Mirrors the notifications table in supabase/notifications.sql. `body` is
 * the exact text rendered at queue time -- not a template to be re-rendered
 * later -- so what the admin sees is what the buyer got. */
export interface OrderNotification {
  id: string;
  order_id: string;
  order_ref: string;
  event: NotifyEventName;
  to_phone: string;
  lang: Lang;
  body: string;
  tracking_url: string;
  channel: "whatsapp" | "manual";
  provider: string;
  provider_ref: string | null;
  status: NotifyStatus;
  error: string | null;
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

/* ---------------------------------------------------------------------------
 * Procurement. Mirrors supabase/procurement.sql.
 * ------------------------------------------------------------------------ */

/** The eight stages a purchase order moves through. "Delayed" is absent on
 * purpose -- lateness is derived from dates (see poDelayDays), so it can
 * never fall out of step with them the way a stored flag would. */
export type PoStatus =
  | "draft" | "approved" | "sent" | "confirmed"
  | "in_production" | "in_transit" | "arrived" | "received" | "cancelled";

export type PoPaymentStatus = "unpaid" | "partial" | "paid" | "overdue";

/** SPEND category -- what kind of money a purchase line is. Distinct from
 * the catalog category, which is where goods sit in the shop; a line can
 * have both, and they answer different questions. "goods_for_resale" is the
 * only value that lets a line touch stock or the catalog. */
export type PoCategory =
  | "goods_for_resale"
  | "raw_materials" | "components" | "packaging"
  | "office" | "equipment" | "services" | "other";

export interface Supplier {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2, or "" when unknown. */
  country_code: string;
  contact_name: string;
  email: string;
  phone: string;
  lead_time_days: number | null;
  notes: string;
  active: boolean;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  /** The catalog product this line stocks. Null until the line is received
   * (a new product is created then, not before -- a draft order that never
   * arrives must not leave unbuyable products in the shop). */
  product_id: string | null;
  product_name: string;
  category: PoCategory;
  qty: number;
  unit_price: number;
  /** Where a product this line CREATES should sit in the shop. Null when the
   * line links to an existing product, which already has a category. */
  catalog_category_id?: string | null;
  /** Intended shelf price for a product this line creates. Purchase price
   * and selling price are unrelated, so the buyer states it. */
  sell_price?: number | null;
  /** Sizes as typed on the supplier's order, e.g. "S, M, L, XL".
   * Parsed into products.sizes at receipt by parseSizes(). */
  sizes?: string;
  /** Product description. Fills a product this line creates, or a blank
   * one on an existing product -- it never overwrites text already there. */
  description?: string;
  created_at: string;
}

export type ReturnReason =
  | "damaged" | "wrong_item" | "not_as_described" | "changed_mind" | "other";

/** Goods handed back. A document of its own, not a flag on the order: one
 * order can be returned in parts, on different days, for different reasons,
 * and only some of what comes back is fit to sell again. Mirrors
 * order_returns in supabase/returns.sql. */
export interface OrderReturn {
  id: string;
  order_id: string;
  /** RET + year + last four of the phone + six random. */
  ref: string;
  reason: ReturnReason;
  note: string;
  /** In the order's currency. Stored rather than derived: a shop may refund
   * the delivery fee, or not, or settle on a different figure at the
   * counter, and next year nobody will remember which. */
  refund_total: number;
  refunded_at: string | null;
  created_at: string;
  items?: OrderReturnItem[];
}

export interface OrderReturnItem {
  id: string;
  return_id: string;
  product_id: string | null;
  product_name: string;
  qty: number;
  /** Damaged goods come back into the building but not onto the shelf. */
  restock: boolean;
  created_at: string;
}

export type StockMovementReason =
  | "purchase_receipt" | "sale" | "adjustment" | "return" | "correction";

/** One change to a product's stock. Mirrors stock_movements in
 * supabase/stock-receipt.sql. Signed and append-only: products.qty is the
 * running balance, these rows are the history behind it. */
export interface StockMovement {
  id: string;
  product_id: string;
  delta: number;
  reason: StockMovementReason;
  po_id: string | null;
  po_item_id: string | null;
  order_id: string | null;
  /** Landed unit cost in USD at receipt. Null for non-purchase movements. */
  unit_cost: number | null;
  note: string;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  buyer: string;
  /** YYYY-MM-DD. Dates, not timestamps: a purchase order is placed on a day,
   * and a time zone on it only ever creates off-by-one bugs. */
  order_date: string;
  expected_arrival: string | null;
  actual_arrival: string | null;
  currency: string;
  /** Multiply an amount in `currency` by this for base currency (USD),
   * captured at order time so historical totals do not move. */
  fx_rate: number;
  tax: number;
  shipping: number;
  discount: number;
  status: PoStatus;
  payment_status: PoPaymentStatus;
  payment_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  items?: PurchaseOrderItem[];
}

export type PayoutMethod = "bank" | "wallet" | "cash" | "other";

/** One recorded transfer from the platform to a seller. Mirrors
 * seller_payouts in supabase/marketplace-v2.sql. What a seller is still
 * *owed* is never stored -- it is derived as net earnings minus the sum of
 * these rows (see computeSellerLedger), so two stored numbers can never
 * disagree about the same money. */
export interface SellerPayout {
  id: string;
  seller_id: string;
  amount: number;
  method: PayoutMethod;
  reference: string;
  note: string;
  paid_at: string;
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
  /* The reorder plan's four numbers. Optional, because a store that has
     not run supabase/reorder-policy.sql has no columns for them and falls
     back to the same defaults these were seeded with. */
  reorder_window_days?: number;
  reorder_review_days?: number;
  reorder_safety_days?: number;
  reorder_default_lead_days?: number;
}

export interface OrderItem {
  product_id: string;
  seller_id: string | null;
  name: string;
  size: string;
  price: number;
  qty: number;
  /** Unit cost at the moment of sale, copied from product_costs at checkout.
   * Snapshotted for the same reason purchase_orders captures fx_rate: if
   * margin read today's cost, re-pricing a supplier would silently rewrite
   * last year's profit. Absent on orders placed before costs were recorded
   * (and on every order predating supabase/sales.sql), which is why readers
   * fall back to the live cost and treat a still-missing value as unknown
   * rather than zero.
   *
   * NEVER send this to a seller or a buyer -- see stripCost() in
   * lib/data/seller.ts. It is the platform's purchase cost. */
  cost?: number | null;
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
  /** The language the buyer was browsing in at checkout, so notifications
   * reach them in it. Optional: orders placed before
   * supabase/notifications.sql was run have no value, and fall back to Tetun. */
  lang?: Lang;
  /** True when placed for goods that were out of stock. Set by the SERVER
   * from live stock at checkout, never from the browser -- a client that
   * could claim it would be claiming the right to buy what is not there. */
  is_preorder?: boolean;
  /** Fulfilment dates, YYYY-MM-DD. Mirrors supabase/sales.sql. All optional:
   * an order placed before that migration has none, and the dashboard reads
   * a missing expected_delivery as "no date was promised" -- never as
   * "on time", which would count unpromised orders as punctual. */
  expected_delivery?: string | null;
  delivered_at?: string | null;
  invoiced_at?: string | null;
  created_at: string;
  order_log?: OrderLogEntry[];
}

/** One revenue target for one period. Mirrors sales_targets in
 * supabase/sales.sql. `period` is '2026', '2026-Q3' or '2026-08' -- the
 * format is the type, enforced by a check constraint. */
export interface SalesTargetRow {
  id: string;
  period: string;
  scope: "global" | "category" | "seller" | "municipality";
  scope_id: string;
  amount: number;
  created_at: string;
}

/** Unit acquisition cost for one product. Mirrors product_costs in
 * supabase/sales.sql -- a separate table, not a products column, because
 * `products` is readable with the anon key and a table-level grant covers
 * columns added later. */
export interface ProductCost {
  product_id: string;
  cost_price: number;
  note: string;
  updated_at: string;
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
