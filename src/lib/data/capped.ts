import "server-only";

/* Every admin read is capped so one busy year cannot time out the page that
 * reports on it. That is the right call. What was wrong is that the cap was
 * SILENT: the reads are ordered newest first, so once a shop passes the cap
 * the OLDEST orders quietly stop being counted, and the first casualty is
 * the year-on-year comparison -- the one figure whose whole purpose is to
 * reach back a year.
 *
 * A dashboard that quietly changes what it measures is worse than one that
 * refuses to load. These helpers do not raise the caps; they make the page
 * able to say it is standing on one. */

export interface Capped<T> {
  rows: T[];
  /** True when rows were left behind. Exact, not a guess: the query asks for
   * one more row than the cap, so a full page means there is genuinely more
   * rather than the shop happening to have exactly `cap` orders. */
  truncated: boolean;
  cap: number;
  /** created_at of the oldest row that DID come back, so the page can say
   * from when its figures are complete. Null when nothing was returned. */
  oldestKept: string | null;
}

/** Wraps a newest-first read so the caller learns whether it saw everything.
 *
 * `run` is handed a limit and must apply it to an ORDER BY created_at DESC
 * query; the extra row is trimmed here. */
export async function readCapped<T extends { created_at?: string }>(
  cap: number,
  run: (limit: number) => Promise<T[] | null>
): Promise<Capped<T>> {
  const raw = (await run(cap + 1)) || [];
  const truncated = raw.length > cap;
  const rows = truncated ? raw.slice(0, cap) : raw;
  const last = rows.length ? rows[rows.length - 1] : null;
  return {
    rows, truncated, cap,
    oldestKept: truncated && last?.created_at ? last.created_at : null,
  };
}

/** The same fact, for a read whose rows carry no date. */
export function cappedPlain<T>(cap: number, raw: T[] | null): Capped<T> {
  const all = raw || [];
  const truncated = all.length > cap;
  return { rows: truncated ? all.slice(0, cap) : all, truncated, cap, oldestKept: null };
}
