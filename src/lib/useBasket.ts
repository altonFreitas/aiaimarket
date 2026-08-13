"use client";
import { useCallback, useSyncExternalStore } from "react";

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

  const add = useCallback((line: BasketLine) => {
    const cur = getSnapshot().slice();
    const hit = cur.find((l) => l.id === line.id && l.size === line.size);
    if (hit) cur[cur.indexOf(hit)] = { ...hit, qty: hit.qty + line.qty };
    else cur.push(line);
    write(cur);
  }, []);

  const setQty = useCallback((index: number, qty: number) => {
    const cur = getSnapshot().slice();
    if (!cur[index]) return;
    cur[index] = { ...cur[index], qty: Math.max(1, qty) };
    write(cur);
  }, []);

  const remove = useCallback((index: number) => {
    const cur = getSnapshot().slice();
    cur.splice(index, 1);
    write(cur);
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = lines.reduce((a, l) => a + l.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);

  return { lines, add, setQty, remove, clear, count, subtotal };
}
