"use client";
import { useCallback, useSyncExternalStore } from "react";

/* Which products THIS browser has loved.
 *
 * The count lives in the database (products.loves) and belongs to the shop;
 * this is the other half -- whether the heart on the card in front of you is
 * filled, and whether tapping it adds or removes. It has to be local:
 * buyers have no account here (a phone number is the identity, and only at
 * checkout), so there is nowhere else to keep it.
 *
 * The honest consequence, written down rather than hidden: clearing browser
 * storage forgets what you loved, and the shop's count does not go back
 * down. That is the same bargain products.views makes, and it is why every
 * screen treats the number as popularity rather than as a tally of people.
 *
 * Same machinery as useBasket: one localStorage key, one custom event so
 * every card on the page re-renders together, and a snapshot cached against
 * the raw string because useSyncExternalStore requires referential
 * stability between changes.
 */

const KEY = "loja:loves:v1";
const EVT = "loja:loves:change";
const EMPTY: string[] = [];

let cache: string[] = EMPTY;
let cacheRaw: string | null = null;

function readRaw(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : EMPTY;
    cache = Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : EMPTY;
  } catch { cache = EMPTY; }
  return cache;
}
function getServerSnapshot(): string[] { return EMPTY; }

/* Empty and not-yet-known are different states, and the difference has to
 * survive as far as the component -- otherwise every heart on the page
 * renders hollow for a frame before the real answer arrives, which reads as
 * the shop forgetting. Same mechanism useBasket uses. */
function readyOnClient(): boolean { return true; }
function readyOnServer(): boolean { return false; }

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  // Another tab loving something is the same event to this one.
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

function write(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVT));
}

export function useLoves() {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(subscribe, readyOnClient, readyOnServer);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  /** Flips this browser's opinion and reports which way it went, so the
   * caller can tell the server to move the shop's count the same way. */
  const toggle = useCallback((id: string): boolean => {
    const current = getSnapshot();
    const loved = current.includes(id);
    write(loved ? current.filter((x) => x !== id) : [...current, id]);
    return !loved;
  }, []);

  return { ids, ready, has, toggle };
}
