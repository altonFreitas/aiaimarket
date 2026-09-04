import type { Lang } from "./types";

/** The chosen language, read in the browser.
 *
 * getLang() in lib/lang.ts is the server's version and reads the same
 * cookie. This exists for the two components that cannot await it: an
 * error boundary is a client component by definition, and the one thing it
 * must never do is throw while trying to explain that something threw.
 *
 * Hence the try/catch and the default. A page whose JavaScript is mid-
 * failure is exactly where document.cookie might be unavailable. */
export function clientLang(): Lang {
  try {
    const m = document.cookie.match(/(?:^|;\s*)lang=([^;]*)/);
    const v = m?.[1];
    return v === "pt" || v === "en" ? v : "tet";
  } catch {
    return "tet";
  }
}
