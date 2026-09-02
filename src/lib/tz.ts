/* One definition of "a day", and it is the shop's.
 *
 * Before this the codebase had two, neither of them Timor-Leste's:
 * lib/sales.ts derived a date from the SERVER's local clock, while
 * attention, stats, procurement and replenishment used UTC. On a UTC host
 * they agree with each other and are both wrong for Dili; on any other host
 * they disagree with each other as well.
 *
 * Timor-Leste is UTC+9. A sale rung up at 07:15 in Dili is 22:15 the
 * PREVIOUS day in UTC, so on a UTC server every sale between midnight and
 * 9am -- about a third of trading hours -- was being filed under yesterday.
 * That moved daily and weekly revenue, "orders today", the statistics day
 * buckets, delivery-late detection and the reorder plan's stockout dates.
 *
 * Everything that asks "what day is it" or "which day did this happen on"
 * comes through here.
 */

/** The shop's timezone. An IANA name, so a zone with daylight saving would
 * be handled correctly too -- Timor-Leste has none, but a rule that is only
 * right for fixed-offset zones is a trap for whoever changes this later.
 *
 * NEXT_PUBLIC_, and read defensively, because this module is used on both
 * sides. A server-only variable would be inlined on the server and undefined
 * in the browser, so the dashboard's own filtering would disagree with the
 * figures it was given -- which is the class of bug this file exists to end.
 * Unset is the normal case; the default is the answer. */
const ENV_TZ = typeof process !== "undefined" && process.env
  ? process.env.NEXT_PUBLIC_STORE_TZ
  : undefined;

export const STORE_TZ = ENV_TZ || "Asia/Dili";

/** Built once. Constructing an Intl formatter is expensive enough to matter
 * when the sales dashboard maps it over every line of the order book. */
const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TZ,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The wall-clock reading in the shop's timezone at a given instant.
 *
 * Assembled from parts rather than by formatting to a string and parsing it
 * back: the output of toLocaleString depends on the locale's conventions and
 * on the ICU version, and neither is something to build a date on. */
function wallClock(ms: number): Wall {
  const out: Record<string, number> = {};
  for (const p of PARTS.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // Some ICU builds render midnight as hour 24 rather than 0.
  const hour = out.hour === 24 ? 0 : out.hour;
  return {
    year: out.year, month: out.month, day: out.day,
    hour, minute: out.minute, second: out.second,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day a moment falls on, in the shop's timezone, YYYY-MM-DD.
 *
 * This is the function that decides which day a sale belongs to. */
export function storeDay(at: Date | number = Date.now()): string {
  const ms = typeof at === "number" ? at : at.getTime();
  if (!Number.isFinite(ms)) return "";
  const w = wallClock(ms);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Today, in the shop's timezone. */
export function storeToday(now: Date | number = Date.now()): string {
  return storeDay(now);
}

/** How far the shop's clock is ahead of UTC at a given instant, in ms.
 * Positive east of Greenwich, so Dili returns +9h. */
function offsetMs(ms: number): number {
  const w = wallClock(ms);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Drop sub-second precision on both sides or the remainder shows up as
  // a few hundred milliseconds of phantom offset.
  return asIfUtc - (ms - ((ms % 1000) + 1000) % 1000);
}

/** The first millisecond of a store day, as a UTC timestamp.
 *
 * Used for bucketing: "everything that happened on the 28th in Dili" is the
 * half-open range [storeDayStart("2026-08-28"), storeDayStart("2026-08-29")).
 *
 * Solved rather than assumed, because in a zone with daylight saving the
 * offset at midnight is not always the offset at noon: the first guess uses
 * the offset in force at UTC midnight, and the second correction uses the
 * offset actually in force at the answer. */
export function storeDayStart(day: string): number {
  const guess = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(guess)) return NaN;
  const first = guess - offsetMs(guess);
  const second = guess - offsetMs(first);
  return second;
}

/** Midnight-to-midnight in the shop's timezone, for day n days back from
 * `from` (0 = today). Returns [start, end) as UTC timestamps. */
export function storeDayRange(daysAgo: number, from: Date | number = Date.now()): [number, number] {
  const ms = typeof from === "number" ? from : from.getTime();
  const day = storeDay(ms - daysAgo * 86_400_000);
  const start = storeDayStart(day);
  // Adding 24h then re-deriving the day handles a DST day that is 23 or 25
  // hours long, where a fixed +24h would land inside the wrong day.
  const end = storeDayStart(storeDay(start + 36 * 3_600_000));
  return [start, end];
}
