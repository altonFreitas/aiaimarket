/* A COLOUR SOMEBODY CAN READ.
 *
 * The colour attribute stores whatever was put in it: a name, because in a
 * clothing catalogue the shop's colours are names, or a hex, because the
 * swatch beside the box is how most people pick one. A product page that
 * prints "#db146b" under "Color" has told the shopper nothing -- it is a
 * number, and the one thing a colour should never need is decoding.
 *
 * So a hex is named, and the name is shown beside the colour itself.
 *
 * THE PALETTE IS DELIBERATELY SMALL. Naming a colour exactly is a problem
 * with no answer -- there is no agreed name for #db146b -- and a list of
 * six hundred names would return "Medium Violet Red", which is worse than
 * useless in a shop where the label has to mean something to a buyer in
 * Dili. Seventeen names that anybody would recognise, nearest match, and
 * the swatch beside the word carrying whatever the word left out.
 *
 * THE LIST WAS TUNED AGAINST ACTUAL COLOURS, not chosen and hoped for.
 * #db146b -- the colour on the shop's own test product -- first came out
 * "Red", because the only pink in the list was a pale one; a pale pink
 * came out "Beige"; and #800080 came out "Magenta". A wrong name on a
 * product page is the bug this file exists to fix, so Magenta was added
 * and the Pink, Purple and Beige anchors were moved until all eighteen
 * colours checked land where a person would put them. The test names
 * them, so a future edit to this list has to keep them landing there.
 *
 * AND THE SWATCH IS THE REAL ANSWER. The name is an approximation over a
 * short list; the square beside it is the exact colour, so nobody has to
 * trust the word. The hex itself is deliberately NOT printed on the
 * product page -- see components/SpecValue.tsx.
 */

export interface NamedColor {
  /** What to print. The typed word when there was one, else the nearest
   * name from the palette below. */
  name: string;
  /** A CSS colour for the swatch, or null when the value names nothing
   * this can draw -- then there is no swatch, rather than a black square
   * that means "we did not understand". */
  swatch: string | null;
  /** The exact value as stored, when it is a hex. Null for a value that
   * was already a word.
   *
   * NOT PRINTED on the product page -- a shopper cannot use a hex, and a
   * swatch with a number after it reads as a swatch that failed. It is
   * kept because it is the honest way to say "this came from a hex, and
   * here is the one it came from", which the admin side reads when it
   * needs to tell a typed word from a picked colour. */
  exact: string | null;
}

/** The names, with the colour each one means. Ordinary words on purpose. */
const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["Black", "#000000"], ["White", "#ffffff"], ["Grey", "#808080"],
  ["Silver", "#c0c0c0"], ["Red", "#e0162b"], ["Pink", "#f8bbd0"],
  ["Magenta", "#c2185b"],
  ["Orange", "#ff7f0e"], ["Brown", "#8b5a2b"], ["Beige", "#efe3c8"],
  ["Yellow", "#ffd400"], ["Green", "#1f9d55"], ["Teal", "#008080"],
  ["Blue", "#1f6feb"], ["Navy", "#10233f"], ["Purple", "#7b1fa2"],
  ["Gold", "#d4af37"],
];

const BY_NAME = new Map(PALETTE.map(([n, hex]) => [n.toLowerCase(), hex]));

/** #abc and #aabbcc, as three numbers. Null for anything else. */
function rgb(value: string): [number, number, number] | null {
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) {
    return [0, 1, 2].map((i) => parseInt(short[i + 1] + short[i + 1], 16)) as [number, number, number];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (long) {
    return [0, 1, 2].map((i) => parseInt(long[i + 1], 16)) as [number, number, number];
  }
  return null;
}

export function describeColor(value: string | null | undefined): NamedColor | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const asHex = rgb(raw);
  if (!asHex) {
    /* A WORD. Shown exactly as the shop wrote it -- "Navy Blue" is their
       word for it and this is not the place to correct them -- with a
       swatch only when the word is one we can actually draw. */
    const known = BY_NAME.get(raw.toLowerCase());
    return { name: raw, swatch: known ?? null, exact: null };
  }

  /* Nearest by the "redmean" weighting rather than by plain RGB distance.
     Straight distance treats one unit of red like one unit of green, which
     the eye does not: MEASURED, #ffc0cb -- a pink anybody would call pink
     -- came out "Beige", because beige happened to be closer in arithmetic
     while being nothing like it to look at. Weighting the channels the way
     redmean does fixes that case and the others tried, for three lines and
     no dependency. The genuinely correct answer is CIE Lab, which is a
     colour-science library for a label on a shop page. */
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const entry of PALETTE) {
    const p = rgb(entry[1])!;
    const rmean = (p[0] + asHex[0]) / 2;
    const dr = p[0] - asHex[0], dg = p[1] - asHex[1], db = p[2] - asHex[2];
    const d = (2 + rmean / 256) * dr * dr + 4 * dg * dg
      + (2 + (255 - rmean) / 256) * db * db;
    if (d < bestD) { bestD = d; best = entry; }
  }
  const hex = raw.toLowerCase();
  return { name: best[0], swatch: hex, exact: hex };
}
