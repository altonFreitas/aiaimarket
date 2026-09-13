import type { Zone } from "./types";

/* THE DELIVERY ZONES, DEFINED ONCE.
 *
 * WHAT WENT WRONG. There were two lists. The checkout iterated whatever
 * settings.zones happened to contain and labelled each one with
 * t("zone_" + id) -- and t() returns the KEY when it does not recognise it.
 * The admin editor iterated a hardcoded array of the three real ids.
 *
 * supabase/seed.sql writes zones with the ids z1, z2 and z3. A shop that
 * ran the seed therefore had four entries in settings.zones, and:
 *
 *   - the checkout offered "zone_z1 — $1.00", "zone_z2 — $2.00",
 *     "zone_z3 — Quote on request" and "Central Dili — $0.50", which is
 *     three untranslated keys shown to a shopper as if they were places;
 *   - the admin editor showed three tidy rows and could not see the junk,
 *     because it only ever looked for the ids it already knew;
 *   - and every save PRESERVED the junk, because the editor patched the
 *     existing array rather than replacing it. There was no way to fix it
 *     from the UI, ever.
 *
 * So the list lives here now, both screens read it, and anything that is
 * not in it is not a zone. A shop cannot end up offering a delivery option
 * it has no name for.
 *
 * No server-only import: the checkout is a client component, the admin
 * editor is a client component, and the action that saves is a server one.
 * Nothing here reads anything.
 */

/** The three zones this shop delivers to, in the order they are offered --
 * nearest first, which is also cheapest first. */
export const ZONE_IDS = ["dili_center", "dili_outskirts", "other_municipality"] as const;

export type ZoneId = (typeof ZONE_IDS)[number];

/** The i18n key naming a zone. Every id above has one; that is what makes
 * it an id rather than a string somebody typed. */
export function zoneLabelKey(id: string): string {
  return "zone_" + id;
}

export function isZoneId(id: string | undefined | null): id is ZoneId {
  return !!id && (ZONE_IDS as readonly string[]).includes(id);
}

/** What a zone costs when nobody has said. Zero and not-a-quote: a shop
 * that has never opened the settings screen should deliver free rather
 * than refuse to quote, which is the friendlier of the two wrong answers
 * and the one that cannot lose an order silently. */
const BLANK: Omit<Zone, "id"> = { fee: 0, quote: false };

/* THE ONE FUNCTION EVERY READER GOES THROUGH.
 *
 * Returns exactly three zones, in order, every time -- whatever is in the
 * database. An unrecognised entry is dropped (it has no name, so it cannot
 * be offered); a missing one is filled in with BLANK (so the form has a row
 * to type into and the checkout has an option to pick).
 *
 * That the OUTPUT is always the canonical three is what makes this a fix
 * rather than a filter: saving what this returns is what finally removes
 * the junk from the database, because the junk is not in it. */
export function normalizeZones(stored: readonly Zone[] | null | undefined): Zone[] {
  const byId = new Map<string, Zone>();
  for (const z of stored || []) {
    if (!z || !isZoneId(z.id)) continue;
    // First wins. A duplicated id is somebody's bad import, and picking
    // the first is at least deterministic.
    if (!byId.has(z.id)) {
      byId.set(z.id, {
        id: z.id,
        fee: Number(z.fee) || 0,
        quote: !!z.quote,
      });
    }
  }
  return ZONE_IDS.map((id) => byId.get(id) ?? { id, ...BLANK });
}

/** True when the stored value would change on the way through -- which is
 * how the settings screen knows to tell the owner that saving will tidy
 * something up, rather than silently rewriting their data. */
export function zonesNeedCleaning(stored: readonly Zone[] | null | undefined): boolean {
  const list = stored || [];
  if (list.length !== ZONE_IDS.length) return true;
  return list.some((z, i) => !z || z.id !== ZONE_IDS[i]);
}
