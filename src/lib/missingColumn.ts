/* "That column is not there yet."
 *
 * Every migration in supabase/ adds columns to tables the application is
 * already writing to, and the two do not land at the same moment: the code
 * is deployed, the SQL is run by hand afterwards. In between, a save that
 * names a new column fails -- and Postgres fails the WHOLE statement over
 * one unknown name, so adding a "who is this for" field stops a shop being
 * able to edit any product at all.
 *
 * Reading was already tolerant of this throughout the codebase (a product
 * with no preorder_enabled reads as enabled). Writing was not, which is
 * how adding products.audience broke saving on a database that had the new
 * code and not yet the new SQL.
 *
 * Two shapes of error mean the same thing here:
 *
 *   PGRST204  PostgREST, from its schema cache, before the query is even
 *             sent: "Could not find the 'audience' column of 'products'".
 *   42703     Postgres itself: undefined_column. Reached when PostgREST's
 *             cache is stale in the other direction, or on a direct query.
 *
 * Deliberately narrow. It must not swallow a constraint violation, a
 * permission error or a network failure -- those are real and the save
 * should fail loudly.
 */

/** Does this error say the named column does not exist?
 *
 * Pass `column` to be sure it is the one you are prepared to drop. Without
 * it, any missing column matches, which is rarely what a caller wants. */
export function isMissingColumnError(err: unknown, column?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";

  const saysMissing =
    code === "PGRST204" ||
    code === "42703" ||
    // Some PostgREST versions report the schema-cache miss with no code.
    /could not find the .* column|column .* does not exist/i.test(message);
  if (!saysMissing) return false;

  // Named column asked for: the message has to actually mention it, or a
  // retry that drops it would be retrying the wrong thing and failing the
  // same way twice.
  if (column) return message.toLowerCase().includes(column.toLowerCase());
  return true;
}

/** Runs a write, and runs it again without the optional fields if the
 * database turns out not to have them yet.
 *
 * The retry is once and only for this. A second failure is returned as it
 * is, because whatever is wrong the second time is not a missing column.
 */
export async function writeTolerating<T>(
  optional: Record<string, unknown>,
  // `data: T | null` rather than optional, because that is the shape
  // Supabase returns: null alongside an error, the row alongside none.
  run: (extra: Record<string, unknown>) => PromiseLike<{ error: unknown; data?: T | null }>
): Promise<{ error: unknown; data?: T | null; degraded: boolean }> {
  const first = await run(optional);
  if (!first.error) return { ...first, degraded: false };

  const names = Object.keys(optional);
  const missing = names.some((n) => isMissingColumnError(first.error, n));
  if (!missing) return { ...first, degraded: false };

  // Without them. Everything the shop actually typed still saves; the one
  // field the database cannot hold yet is dropped, and starts being kept
  // the moment the migration runs.
  const second = await run({});
  return { ...second, degraded: !second.error };
}
