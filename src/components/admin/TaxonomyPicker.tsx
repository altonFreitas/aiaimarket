"use client";
import { useEffect, useState } from "react";
import { loadSubcategories, loadProductTypes, loadAttributes } from "@/lib/actions/taxonomy";
import AttributeField from "./AttributeField";
import type {
  TaxonomyNode, ProductType, FormAttribute,
} from "@/lib/taxonomy/types";

/* CATEGORY -> SUBCATEGORY -> PRODUCT TYPE -> THE FORM ITSELF.
 *
 * Sections 4 and 28 of the brief. There is no branch in this file on any
 * particular category: it walks whatever tree the database holds and then
 * hands each attribute row to AttributeField, which draws the control the
 * row names. Adding "Musical Instruments -> Guitars" is INSERT statements.
 *
 * WHAT HAPPENS WHEN A CHOICE CHANGES, and why it is not simply "reload the
 * next list". Changing the product type changes WHICH QUESTIONS EXIST, so
 * the answers to the old ones are no longer answers to anything -- a
 * sofa's Seat Height is not a smartphone's anything. Values are therefore
 * cleared when the type changes, deliberately and visibly, rather than
 * left to be written against attributes the new product type never asked
 * for. The server would refuse those anyway (lib/taxonomy/validate.ts);
 * this makes it not happen in the first place.
 *
 * A LEVEL WITH NOTHING IN IT DISAPPEARS. The specification gives every
 * category exactly one subcategory, but a shop is free to file product
 * types directly under a category. When a category has no children the
 * subcategory control is not drawn at all, rather than shown empty and
 * unusable.
 */

export interface TaxonomySelection {
  categoryId: string;
  subcategoryId: string;
  productTypeId: string;
  /** attribute id -> its value(s). Always a list, even for single-valued
   * fields, so one shape covers both. */
  values: Record<string, string[]>;
}

export default function TaxonomyPicker({
  roots, value, onChange, errors = {}, disabled,
}: {
  /** The top-level categories, loaded with the page. */
  roots: TaxonomyNode[];
  value: TaxonomySelection;
  onChange: (next: TaxonomySelection) => void;
  /** attribute id -> message, from the server's own validation. */
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  /* EACH CACHE REMEMBERS WHAT IT IS FOR.
     Holding the parent id beside the list, and deriving what to render
     from it, does two jobs at once: nothing has to be cleared
     synchronously inside an effect (which triggers a cascading render),
     and a list belonging to the previous choice cannot flash on screen
     while the new one is still in flight -- it simply does not match, so
     it is not shown. */
  const [subs, setSubs] = useState<{ parent: string; list: TaxonomyNode[] }>(
    { parent: "", list: [] });
  const [types, setTypes] = useState<{ parent: string; list: ProductType[] }>(
    { parent: "", list: [] });
  const [attrs, setAttrs] = useState<{ type: string; list: FormAttribute[] }>(
    { type: "", list: [] });

  // Product types hang off whichever node is actually selected -- the
  // subcategory when there is one, the category when there is not.
  const typeParent = value.subcategoryId || value.categoryId;

  // What this render is allowed to draw: only a list that belongs to the
  // choice currently made.
  const visibleSubs = subs.parent === value.categoryId ? subs.list : [];
  const visibleTypes = types.parent === typeParent ? types.list : [];
  const visibleAttrs = attrs.type === value.productTypeId ? attrs.list : [];

  /* "Loading" is not a separate fact to store -- it is exactly "a type is
     chosen and its attributes have not arrived". Deriving it keeps the two
     from ever disagreeing, and avoids setting state inside the effect. */
  const busy = Boolean(value.productTypeId) && attrs.type !== value.productTypeId;

  /* Each level loads when the one above it changes. The `live` flag drops
     a response that arrives after the choice has moved on again, so a slow
     answer cannot overwrite a newer one. */

  useEffect(() => {
    let live = true;
    const id = value.categoryId;
    if (id) {
      loadSubcategories(id).then((list) => {
        if (live) setSubs({ parent: id, list });
      });
    }
    return () => { live = false; };
  }, [value.categoryId]);

  useEffect(() => {
    let live = true;
    const id = typeParent;
    if (id) {
      loadProductTypes(id).then((list) => {
        if (live) setTypes({ parent: id, list });
      });
    }
    return () => { live = false; };
  }, [typeParent]);

  useEffect(() => {
    let live = true;
    const id = value.productTypeId;
    if (!id) return;
    loadAttributes(id).then((list) => {
      if (live) setAttrs({ type: id, list });
    });
    return () => { live = false; };
  }, [value.productTypeId]);

  function pickCategory(id: string) {
    // Everything below is about to mean something else.
    onChange({ categoryId: id, subcategoryId: "", productTypeId: "", values: {} });
  }
  function pickSubcategory(id: string) {
    onChange({ ...value, subcategoryId: id, productTypeId: "", values: {} });
  }
  function pickType(id: string) {
    onChange({ ...value, productTypeId: id, values: {} });
  }
  function setValue(attrId: string, next: string[]) {
    onChange({ ...value, values: { ...value.values, [attrId]: next } });
  }

  return (
    <div className="taxonomy">
      <div className="two">
        <div className="field">
          <label htmlFor="tx-cat">Category</label>
          <select id="tx-cat" value={value.categoryId} disabled={disabled}
            onChange={(e) => pickCategory(e.target.value)}>
            <option value="">Select a category</option>
            {roots.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Only drawn when there is something in it. */}
        {visibleSubs.length > 0 && (
          <div className="field">
            <label htmlFor="tx-sub">Subcategory</label>
            <select id="tx-sub" value={value.subcategoryId} disabled={disabled}
              onChange={(e) => pickSubcategory(e.target.value)}>
              <option value="">Select a subcategory</option>
              {visibleSubs.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {visibleTypes.length > 0 && (
        <div className="field">
          <label htmlFor="tx-type">Product type</label>
          <select id="tx-type" value={value.productTypeId} disabled={disabled}
            onChange={(e) => pickType(e.target.value)}>
            <option value="">Select a product type</option>
            {visibleTypes.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* THE DYNAMIC PART. Nothing below this line knows what a sofa is. */}
      {busy && <p className="hint">Loading fields…</p>}

      {!busy && visibleAttrs.length > 0 && (
        <div className="attr-grid">
          {visibleAttrs.map((a) => (
            <AttributeField
              key={a.id}
              attr={a}
              value={value.values[a.id] ?? []}
              onChange={(next) => setValue(a.id, next)}
              error={errors[a.id]}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {/* A product type whose attributes nobody has configured yet is a
          real state, not an error -- the shop can still save the universal
          fields. Saying so beats an empty space that looks broken. */}
      {!busy && value.productTypeId && visibleAttrs.length === 0 && (
        <p className="hint">This product type has no extra fields yet.</p>
      )}
    </div>
  );
}
