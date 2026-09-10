/* One shopper, one name, however they typed it.
 *
 * THE PROBLEM THIS SOLVES. The customer analysis groups by phone number,
 * which is correct and is not what this is about -- two people called Zita
 * Felicia with different phones are two customers, and the screens already
 * treat them that way. The trouble is the other direction: ONE phone,
 * ordering three times, typed as "Zita Felicia", "Zita fElicia" and
 * "zita  felicia". The rows group correctly and then print whichever
 * spelling happened to arrive first, so the owner reading the list cannot
 * tell whether they are looking at one customer or a bug.
 *
 * Upper case, single-spaced, is the smallest rule that removes the whole
 * class of it: the shop is written in Tetun, Portuguese and English, and
 * capitalisation conventions differ across all three (da Silva, De Jesus,
 * do Carmo), so "title case it properly" is a rule nobody can state. There
 * is no correct capitalisation to restore, only a consistent one to
 * choose -- which is exactly how a delivery label is printed anyway.
 *
 * toUpperCase, not toLocaleUpperCase. The special cases the locale form
 * exists for -- Turkish dotless i, Lithuanian retained dots -- are not
 * languages this shop is written in, and a server whose locale differs
 * from the browser's would otherwise normalise the same name two ways.
 * Portuguese and Tetun diacritics upper-case identically either way
 * (é -> É, ú -> Ú, ñ -> Ñ).
 */

/** Upper case, trimmed, runs of whitespace collapsed to one space.
 *
 * Safe to call on a name that is already normalised, and on an empty
 * string -- which is what an order placed before this existed has, and
 * what the screens render as an em dash. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

/** The two checkout fields, joined.
 *
 * Either half may be empty and the join still reads correctly: a shopper
 * with one name types it in the first box and the result is that one name,
 * not a name with a trailing space. */
export function personName(first: string, last: string): string {
  return normalizeName(`${first} ${last}`);
}
