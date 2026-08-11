import type { Order, Product, Settings } from "./types";

export function money(n: number | string): string {
  return "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
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
  const lines = ["Ola! Hau hakarak sosa:", ""];
  lines.push(
    p.name + (size ? ` — ${size}` : "") + (qty > 1 ? ` × ${qty}` : "") + ` — ${money(p.price)}`
  );
  lines.push("Ref: " + p.ref);
  lines.push(siteUrl(`/p/${p.slug}`));
  return lines.join("\n");
}

export function waOrderMsg(o: Order, siteUrl: (path: string) => string): string {
  const lines = ["Botardi! Hau halo enkomenda ida:", ""];
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
