import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_GRANT_KEYS } from "@/lib/adminSections";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const ATTRS = read("src/lib/actions/attributes.ts");
const TYPES = read("src/lib/actions/product-types.ts");
const SEED_GEN = read("scripts/build-taxonomy-seed.mjs");
const TAXONOMY_SQL = read("supabase/taxonomy.sql");
const SUBSECTIONS_SQL = read("supabase/admin-subsections.sql");

describe("the agreement between the builder and the seed", () => {
  /* taxonomy-seed.sql corrects the field types it inferred every time it
     is pasted, EXCEPT on rows a human has touched. admin_edited is the
     whole mechanism. An action that writes an attribute without setting it
     silently hands the row back to the generator, and the owner's
     correction vanishes the next time the SQL is run -- weeks later, with
     nothing to connect cause to effect. */

  it("sets admin_edited on every write to an attribute", () => {
    // Each .update( or .insert( against `attributes` must carry the flag.
    const writes = [...ATTRS.matchAll(
      /from\("attributes"\)\s*\n?\s*\.(update|insert)\(([\s\S]*?)\)\s*\n/g)];
    expect(writes.length).toBeGreaterThan(0);
    for (const [, verb, body] of writes) {
      expect(body, `${verb} to attributes without admin_edited`)
        .toContain("admin_edited: true");
    }
  });

  it("is the same flag the seed refuses to write over", () => {
    expect(SEED_GEN).toContain("where not attributes.admin_edited");
    expect(TAXONOMY_SQL).toContain("admin_edited  boolean not null default false");
  });
});

describe("deleting something that is in use", () => {
  /* attribute_options and product_attribute_values both cascade from
     `attributes`. Deleting "Material" would take the material of every
     product with it -- no warning, no copy, nothing to restore from. */

  it("counts what a delete would destroy before doing it", () => {
    expect(ATTRS).toContain("const usage = await attributeUsage(id)");
    const del = ATTRS.slice(ATTRS.indexOf("export async function deleteAttribute"));
    const check = del.indexOf("usage.values > 0");
    const doIt = del.indexOf('.from("attributes").delete()');
    expect(check).toBeGreaterThan(-1);
    expect(doIt).toBeGreaterThan(check);   // refuses BEFORE it deletes
  });

  it("refuses on recorded values and on assignments alike", () => {
    expect(ATTRS).toContain("usage.values > 0");
    expect(ATTRS).toContain("usage.productTypes > 0");
  });

  it("refuses to delete a product type that products still use", () => {
    const del = TYPES.slice(TYPES.indexOf("export async function deleteProductType"));
    const check = del.indexOf('.eq("product_type_id", id)');
    const doIt = del.indexOf('.from("product_types").delete()');
    expect(check).toBeGreaterThan(-1);
    expect(doIt).toBeGreaterThan(check);
    expect(del).toContain("Hide it instead");
  });
});

describe("what must NOT be destroyed", () => {
  it("leaves recorded values alone when an attribute is unassigned", () => {
    /* A product that recorded a Seat Height still has one; it simply stops
       being asked for. Deleting the values here would make a layout change
       into a data loss. */
    const fn = TYPES.slice(
      TYPES.indexOf("export async function unassignAttribute"),
      TYPES.indexOf("export async function moveAssignment"));
    expect(fn).toContain('.from("product_type_attributes").delete()');
    expect(fn).not.toContain("product_attribute_values");
  });

  it("keeps the slug when a product type is renamed", () => {
    // The slug is what the seed and any bookmark key on. Regenerating it
    // would orphan every product filed under the old one.
    const fn = TYPES.slice(
      TYPES.indexOf("export async function renameProductType"),
      TYPES.indexOf("export async function setProductTypeStatus"));
    expect(fn).toContain("update({ name: text })");
    // The CODE must not write a slug. Matching on the bare word would hit
    // the comment above it that explains exactly why it does not.
    expect(fn).not.toMatch(/slug\s*:/);
  });

  it("renames an option without touching what is stored", () => {
    // label and value are separate columns precisely so "Black" can become
    // "Jet Black" on every page without rewriting ten thousand rows.
    const fn = ATTRS.slice(
      ATTRS.indexOf("export async function renameOption"),
      ATTRS.indexOf("export async function deleteOption"));
    expect(fn).toContain("update({ label: text })");
    expect(fn).not.toContain("value:");
  });
});

describe("access", () => {
  it("guards every exported action", () => {
    for (const [file, src] of [["attributes.ts", ATTRS], ["product-types.ts", TYPES]] as const) {
      const fns = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(fns.length).toBeGreaterThan(3);
      for (const fn of fns) {
        const body = src.slice(src.indexOf(`export async function ${fn}`));
        const next = body.indexOf("\nexport async function", 1);
        const slice = next === -1 ? body : body.slice(0, next);
        expect(slice, `${file}:${fn} is unguarded`).toContain("await requireSection(");
      }
    }
  });

  it("uses keys the app and the database both recognise", () => {
    /* A key the app grants and the database refuses is a save that fails
       with a constraint error; one the database allows and the app does
       not know is a row that reads as a permission and grants nothing. */
    for (const key of ["catalog.attributes", "catalog.types"]) {
      expect(ALL_GRANT_KEYS, `${key} missing from adminSections`).toContain(key);
      expect(SUBSECTIONS_SQL, `${key} missing from the check constraint`)
        .toContain(`'${key}'`);
    }
  });
});
