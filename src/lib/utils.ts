import type { Order, Product, Settings } from "./types";

/** Grouped to thousands: "$284,610.05", not "$284610.05". A product price
 * rarely reaches four digits so this changes almost nothing on the
 * storefront, but the sales and procurement dashboards deal in six-figure
 * totals, where an ungrouped run of digits has to be counted rather than
 * read. Fixed "en-US" grouping rather than the visitor's locale: the store
 * prices in USD, and a locale that groups with "." would render $1.234,50
 * beside a $ sign for a number that is not in that currency. */
export function money(n: number | string): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** Whole-number percent off, or null when there's no real discount
 * (missing/zero price, or discount_price not actually lower). Shared by
 * both product forms (bidirectional price<->percent entry) and both
 * display components (card + detail page), so the rounding rule is
 * identical everywhere a discount ever shows up. */
export function discountPercent(price: number, discountPrice: number | null | undefined): number | null {
  if (!price || discountPrice == null || discountPrice <= 0 || discountPrice >= price) return null;
  return Math.round((1 - discountPrice / price) * 100);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function phoneOk(v: string): boolean {
  const d = v.replace(/[^\d]/g, "");
  // 8 digits alone = bare Timor local number (used by the order-lookup
  // gate, which has no country selector). 9-15 digits = a full number
  // that already includes a country code, from any supported country.
  return /^\d{8}$/.test(d) || /^\d{9,15}$/.test(d);
}
export function phoneNorm(v: string): string {
  let d = v.replace(/[^\d]/g, "");
  if (d.length === 8) d = "670" + d; // bare local number → assume Timor-Leste
  return "+" + d;
}

export function nowIso(ts: string | number): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export function addrLine(a: {
  address_line?: string | null;
  landmark?: string | null; aldeia?: string | null; suku?: string | null;
  post?: string | null; municipality?: string | null;
}): string {
  if (a.address_line) {
    return [a.address_line, a.landmark].filter(Boolean).join(", ");
  }
  return [a.landmark, a.aldeia, a.suku, a.post, a.municipality].filter(Boolean).join(", ");
}

export function waNumberDigits(settings: Pick<Settings, "wa_number">): string {
  return settings.wa_number.replace(/[^\d]/g, "");
}

export function waLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** E1/E2 — pre-filled WhatsApp message with the product, size and reference. */
export function waProductMsg(p: Pick<Product, "name" | "ref" | "slug" | "price">, size: string | null, qty: number, siteUrl: (path: string) => string): string {
  const lines = ["Olá! Hau hakarak sosa:", ""];
  lines.push(
    p.name + (size ? ` — ${size}` : "") + (qty > 1 ? ` × ${qty}` : "") + ` — ${money(p.price)}`
  );
  lines.push("Ref: " + p.ref);
  lines.push(siteUrl(`/p/${p.slug}`));
  return lines.join("\n");
}

export function waOrderMsg(o: Order, siteUrl: (path: string) => string): string {
  const lines = ["Olá! Hau halo enkomenda ida:", ""];
  o.items.forEach((i) => {
    lines.push(`• ${i.name}${i.size ? " — " + i.size : ""} × ${i.qty} — ${money(i.price * i.qty)}`);
  });
  lines.push("");
  lines.push("Total: " + money(o.total));
  lines.push("Ref: " + o.ref);
  lines.push("Phone: " + o.buyer_phone);
  lines.push(o.mode === "pickup" ? "Pickup" : "Delivery: " + addrLine(o));
  lines.push(siteUrl(`/o/${o.ref}`));
  return lines.join("\n");
}

export function sum<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((a, x) => a + f(x), 0);
}

export const FLOW: Array<Order["status"]> = [
  "new", "confirmed", "preparing", "out", "arrived", "completed",
];

/** Pickup orders skip the delivery-only steps ("out for delivery",
 * "arrived — calling you") -- there's no courier, so they go straight
 * from preparing to ready-to-pick-up. */
export const PICKUP_FLOW: Array<Order["status"]> = FLOW.filter(
  (s) => s !== "out" && s !== "arrived"
);

export function flowFor(mode: "delivery" | "pickup"): Array<Order["status"]> {
  return mode === "pickup" ? PICKUP_FLOW : FLOW;
}

/** Mean star rating for a product, or null when nothing has been reviewed
 * yet. Takes the denormalised counters rather than a list of reviews, so a
 * product grid can show ratings without a second query -- and returns null
 * (not 0) for "no reviews", because a brand-new listing is unrated, not
 * badly rated. Tolerates the columns being absent entirely, which is what a
 * database that hasn't run marketplace-v2.sql looks like. */
export function ratingAverage(
  p: { rating_sum?: number | null; rating_count?: number | null }
): number | null {
  const count = Number(p.rating_count) || 0;
  if (count <= 0) return null;
  const sum = Number(p.rating_sum) || 0;
  return Math.round((sum / count) * 10) / 10;
}

/** Star string for a 1-5 rating, e.g. 4.2 -> "★★★★☆". Rounds to the nearest
 * whole star; the numeric average is always displayed next to it, so the
 * rounding is a visual cue rather than the number of record. */
export function stars(average: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(average)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** Effective unit price: the discount when one is genuinely running, the
 * list price otherwise. The same rule placeOrder() applies when it re-prices
 * a basket server-side, and the same rule search_products() sorts by -- kept
 * here so the fallback search path in lib/data/search.ts cannot disagree
 * with the SQL about what "cheapest first" means. */
export function effectivePrice(
  p: { price: number; discount_price?: number | null }
): number {
  const d = p.discount_price;
  return d != null && Number(d) > 0 ? Number(d) : Number(p.price);
}

/** Opens the phone's own SMS app with the number and message already filled
 * in -- the manual send path when no gateway is configured.
 *
 * `?&body=` is deliberate and is not a typo. iOS expects the separator before
 * `body` to be `&`, Android expects `?`; `?&` is the form both parse, and has
 * been the accepted cross-platform workaround for years. On a desktop browser
 * with no SMS handler the link does nothing, which is why the admin UI shows
 * it as one option next to "mark as sent" rather than as the only way. */
export function smsLink(phone: string, text: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(text)}`;
}
