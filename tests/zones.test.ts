import { describe, it, expect } from "vitest";
import {
  ZONE_IDS, normalizeZones, isZoneId, zoneLabelKey, zonesNeedCleaning,
} from "@/lib/zones";
import { STR } from "@/lib/i18n";
import type { Zone } from "@/lib/types";

/* THE BUG THIS EXISTS TO STOP.
 *
 * The checkout offered four delivery options: "zone_z1 — $1.00",
 * "zone_z2 — $2.00", "zone_z3 — Quote on request" and "Central Dili —
 * $0.50". The first three are raw i18n keys, shown to shoppers as if they
 * were places, with real prices beside them.
 *
 * supabase/seed.sql wrote zones with the ids z1, z2 and z3; the checkout
 * labelled each entry with t("zone_" + id), and t() returns the KEY when it
 * does not recognise it. The admin editor iterated a hardcoded list of the
 * three real ids, so it could not see the junk -- and patched the stored
 * array rather than replacing it, so every save carried the junk forward.
 * There was no sequence of clicks that fixed it.
 */

const z = (id: string, fee = 0, quote = false) => ({ id, fee, quote }) as Zone;

describe("normalizeZones", () => {
  it("drops an id the shop has no name for", () => {
    // The whole finding. z1 has no translation in any of the three
    // languages, so it cannot be offered -- keeping it IS the bug.
    const out = normalizeZones([z("z1", 1), z("z2", 2), z("z3", 0, true)]);
    expect(out.map((x) => x.id)).toEqual([...ZONE_IDS]);
  });

  it("keeps the fee of a real zone that was mixed in with the junk", () => {
    // The exact shape of the reported bug: three junk entries plus one
    // genuine dili_center at $0.50. The 0.50 is the owner's real setting
    // and must survive.
    const out = normalizeZones([
      z("z1", 1), z("z2", 2), z("z3", 0, true), z("dili_center", 0.5),
    ]);
    expect(out.find((x) => x.id === "dili_center")?.fee).toBe(0.5);
  });

  it("always returns exactly the three, in order", () => {
    for (const input of [[], [z("dili_outskirts", 2)], [z("z9")]] as Zone[][]) {
      expect(normalizeZones(input).map((x) => x.id)).toEqual([...ZONE_IDS]);
    }
  });

  it("fills a missing zone with a free, non-quote default", () => {
    // The friendlier of the two wrong answers: a shop that has never opened
    // the settings screen delivers rather than refusing to quote, which is
    // the one that cannot lose an order silently.
    const out = normalizeZones([]);
    expect(out.every((x) => x.fee === 0 && x.quote === false)).toBe(true);
  });

  it("survives null, undefined and rubbish in the array", () => {
    // This value comes out of a JSONB column that has already been written
    // by a seed, by hand, and by two different versions of the editor.
    const out = normalizeZones(
      [null, undefined, {}, z("dili_center", 3)] as unknown as Zone[]);
    expect(out.map((x) => x.id)).toEqual([...ZONE_IDS]);
    expect(out[0].fee).toBe(3);
  });

  it("coerces a fee that arrived as a string", () => {
    const out = normalizeZones([{ id: "dili_center", fee: "2.5", quote: 1 }] as unknown as Zone[]);
    expect(out[0].fee).toBe(2.5);
    expect(out[0].quote).toBe(true);
  });

  it("takes the first of a duplicated id rather than guessing", () => {
    const out = normalizeZones([z("dili_center", 1), z("dili_center", 9)]);
    expect(out[0].fee).toBe(1);
  });

  it("is idempotent", () => {
    const once = normalizeZones([z("z1", 1), z("dili_center", 0.5)]);
    expect(normalizeZones(once)).toEqual(once);
  });
});

describe("every zone can actually be named", () => {
  it("has a translation for each id, in all three languages", () => {
    // This is the invariant the bug violated. If an id has no key here, the
    // checkout renders the key itself at a shopper.
    for (const id of ZONE_IDS) {
      const key = zoneLabelKey(id);
      expect([id, key in STR]).toEqual([id, true]);
      expect([id, STR[key].filter(Boolean).length]).toEqual([id, 3]);
    }
  });

  it("never returns a zone whose label would be the raw key", () => {
    const out = normalizeZones([z("z1"), z("z2"), z("z3")]);
    for (const zone of out) {
      expect([zone.id, zoneLabelKey(zone.id) in STR]).toEqual([zone.id, true]);
    }
  });
});

describe("isZoneId", () => {
  it("accepts only the three", () => {
    expect(ZONE_IDS.every(isZoneId)).toBe(true);
    for (const bad of ["z1", "z2", "z3", "", null, undefined, "DILI_CENTER"]) {
      expect([bad, isZoneId(bad as string)]).toEqual([bad, false]);
    }
  });
});

describe("zonesNeedCleaning", () => {
  it("says yes to the state the seed produced", () => {
    expect(zonesNeedCleaning([z("z1"), z("z2"), z("z3"), z("dili_center")])).toBe(true);
  });

  it("says no to a database that is already right", () => {
    expect(zonesNeedCleaning(normalizeZones([]))).toBe(false);
  });

  it("says yes to a zone missing entirely", () => {
    expect(zonesNeedCleaning([z("dili_center"), z("dili_outskirts")])).toBe(true);
  });
});
