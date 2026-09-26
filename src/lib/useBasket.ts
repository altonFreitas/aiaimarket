"use client";
import { useCallback, useSyncExternalStore } from "react";
import { stockKey } from "./basketKey";

export interface BasketLine {
  id: string;
  name: string;
  size: string;
  price: number;
  qty: number;
  /** Denormalized at add-time, same as name/price above — lets the cart
   * group items by seller (Phase 2) without a network round trip just to
   * render the basket. null for the platform's own products (no real
   * seller row) or anything added before this existed. */
  seller_id: string | null;
  sellerName: string | null;
  /** Denormalized at add-time so the checkout summary can show what is
   * being bought without a round trip. Both optional: a basket saved
   * before this existed has neither, and the summary falls back to the
   * inline placeholder and a plain name. */
  image?: string;
  slug?: string;
  /** The price before the discount, when this line was bought on one.
   *
   * `price` above is what is being CHARGED -- the discounted figure -- and
   * that has always been the case, so the subtotal and the total need no
   * adjusting. This is only so the summary can show the saving on its own
   * line, the way a receipt does.
   *
   * Absent when there was no discount, and absent on a basket saved before
   * this existed: in both cases no discount line is shown, which is right,
   * because a discount of zero is not a discount. */
  listPrice?: number;
  /** HOW MANY OF THIS SIZE THE SHELF HELD when the line was added.
   *
   * The + button in the cart counted up for ever. A shopper could ask for
   * thirty of a size with ten on it, reach the checkout, and only find out
   * when the order was refused -- the database has always refused it
   * (reserve_order_stock), which is why this was never an oversell, but it
   * was a wasted trip through a form. The product page was given a ceiling
   * for exactly this reason; the basket was not, and the same + button two
   * screens later still counted past the shelf.
   *
   * Undefined means "no ceiling known", which is the honest answer for a
   * pre-order, for a shop that has not counted this product, and for every
   * basket saved before this existed. In all three the button behaves as it
   * always did.
   *
   * IT IS A COURTESY, NOT THE AUTHORITY. A basket sits in localStorage for
   * days and stock moves underneath it, so this number can be stale by the
   * time anybody looks at the cart. refreshBasketStock() re-reads it when
   * the cart opens, and the database is what actually cannot be fooled. */
  stock?: number;
}

/** What a line may be raised to. Infinity when nothing is known, which is
 * what keeps an uncounted product behaving as it always did. */
export function lineCeiling(line: { stock?: number }): number {
  const n = Number(line.stock);
  return Number.isFinite(n) && n >= 0 ? n : Infinity;
}

/* THE THREE RULES, AS PLAIN FUNCTIONS.
 *
 * They live outside the hook so they can be tested by calling them with a
 * line and a number, rather than by reading the hook's source and hoping.
 * The version of this that only asserted "the file contains Math.min" would
 * have passed against a clamp applied to the wrong end. */

/** What a quantity becomes when somebody types or steps to it. */
export function clampQty(line: { stock?: number }, qty: number): number {
  // Both ends. The lower bound was always here; the upper one is the bug.
  return Math.max(1, Math.min(lineCeiling(line), Math.floor(qty) || 1));
}

/** What the quantity becomes when the same size is added to the basket
 * twice. Each add can be legal on its own while the sum is not. */
export function mergedQty(
  hit: { stock?: number; qty: number }, line: { stock?: number; qty: number }
): number {
  // The newer ceiling wins where both are known: it was read more recently.
  const cap = Math.min(lineCeiling(hit), lineCeiling(line));
  return Math.max(1, Math.min(cap, hit.qty + line.qty));
}

/** The basket with today's ceilings on it.
 *
 * Quantities only ever come DOWN: a shelf that has been restocked must not
 * silently increase what somebody asked for. A line whose size has sold out
 * entirely keeps its quantity and gains a ceiling of zero -- the screen says
 * sold out and the shopper decides, rather than the basket quietly editing
 * itself to something they did not choose. */
export function withFreshStock(
  lines: BasketLine[], fresh: Record<string, number>
): BasketLine[] {
  return lines.map((l) => {
    const key = stockKey(l.id, l.size);
    if (!(key in fresh)) return l;
    const cap = Math.max(0, Math.floor(fresh[key]));
    const qty = cap === 0 ? l.qty : Math.max(1, Math.min(cap, l.qty));
    return l.stock === cap && l.qty === qty ? l : { ...l, stock: cap, qty };
  });
}



const KEY = "loja:basket:v1";
const EVT = "loja:basket:change";
const EMPTY: BasketLine[] = [];

let cache: BasketLine[] = EMPTY;
let cacheRaw: string | null = null;

function readRaw(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** The snapshot must be referentially stable between changes or React
 * will loop, so the parsed array is cached against the raw string. */
function getSnapshot(): BasketLine[] {
  const raw = readRaw();
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try { cache = raw ? JSON.parse(raw) : EMPTY; } catch { cache = EMPTY; }
  return cache;
}
function getServerSnapshot(): BasketLine[] { return EMPTY; }

/* "Do we know what is in the basket yet?"
 *
 * The basket lives in localStorage, which the server cannot see. So the
 * server render, and the first client render that hydrates it, both get an
 * empty basket -- and a component that branches on lines.length announces
 * "your cart is empty" for a frame before the real contents arrive.
 *
 * That is what a shopper saw every time they landed on the cart: their
 * order, briefly replaced by a message saying they had not ordered
 * anything.
 *
 * Empty and not-yet-known are different states and the difference has to
 * survive as far as the component. This is the same mechanism the basket
 * itself uses -- false while rendering on the server and while hydrating,
 * true from the moment React re-reads on the client, which is the exact
 * moment the real basket becomes available. */
function readyOnClient(): boolean { return true; }
function readyOnServer(): boolean { return false; }

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}
function write(lines: BasketLine[]) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch {}
  window.dispatchEvent(new Event(EVT));
}

/** The basket is deliberately local to the visitor's browser — a
 * pre-checkout scratchpad, not shared catalog data. It becomes a real
 * `orders` row in Postgres the moment placeOrder() runs. */
export function useBasket() {
  const lines = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /** False until the browser's own basket has been read. Anything that
   * says "empty" must wait for this, or it says it about a basket it has
   * not looked in. */
  const ready = useSyncExternalStore(subscribe, readyOnClient, readyOnServer);

  const add = useCallback((line: BasketLine) => {
    const cur = getSnapshot().slice();
    const hit = cur.find((l) => l.id === line.id && l.size === line.size);
    if (hit) {
      // Capped on the way in too: see mergedQty.
      cur[cur.indexOf(hit)] = {
        ...hit,
        ...(line.stock !== undefined ? { stock: line.stock } : {}),
        qty: mergedQty(hit, line),
      };
    } else {
      cur.push({ ...line, qty: clampQty(line, line.qty) });
    }
    write(cur);
  }, []);

  const setQty = useCallback((index: number, qty: number) => {
    const cur = getSnapshot().slice();
    if (!cur[index]) return;
    cur[index] = { ...cur[index], qty: clampQty(cur[index], qty) };
    write(cur);
  }, []);

  /** Replaces the stored ceilings with what the shelf holds NOW, and pulls
   * any line that is over it back down.
   *
   * Called when the cart or the checkout opens. A basket is kept in the
   * browser for as long as the shopper leaves it there, so the number
   * written at add-time is a guess about the present; this is the part that
   * stops it being a stale promise. Quantities only ever come DOWN here --
   * a shelf that has been restocked does not silently increase what
   * somebody asked for. */
  const applyStock = useCallback((fresh: Record<string, number>) => {
    const cur = getSnapshot();
    const next = withFreshStock(cur, fresh);
    // Written only when something moved: every write wakes every subscriber,
    // and a re-render per cart open with nothing to show for it is waste.
    if (next.some((l, i) => l !== cur[i])) write(next);
  }, []);

  const remove = useCallback((index: number) => {
    const cur = getSnapshot().slice();
    cur.splice(index, 1);
    write(cur);
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = lines.reduce((a, l) => a + l.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);

  return { lines, ready, add, setQty, remove, clear, applyStock, count, subtotal };
}
