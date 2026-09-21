"use client";
import { useEffect, useState } from "react";
import { loadProductTypes, loadAttributes } from "@/lib/actions/taxonomy";
import AttributeField from "./AttributeField";
import type { ProductType, FormAttribute } from "@/lib/taxonomy/types";

/* PRODUCT TYPE -> THE FORM ITSELF.
 *
 * Sections 4 and 28 of the brief. There is no branch in this file on any
 * particular category: it asks what product types hang off the node it was
 * given and then hands each attribute row to AttributeField, which draws
 * the control the row names. Adding "Musical Instruments -> Guitars" is
 * INSERT statements.
 *
 * THE CATEGORY IS NOT ASKED FOR HERE, and used to be. This drew its own
 * Category and Subcategory dropdowns directly beneath the form's own pair,
 * over the same rows of the same table -- two controls for one fact, which
 * is how a product ends up filed in one place and typed from another. The
 * form owns that question now and hands the answer down as `node`.
 *
 * WHAT HAPPENS WHEN THE NODE CHANGES, and why it is not simply "reload the
 * next list". Changing the product type changes WHICH QUESTIONS EXIST, so
 * the answers to the old ones are no longer answers to anything -- a
 * sofa's Seat Height is not a smartphone's anything. Values are therefore
 * cleared when the type changes, deliberately and visibly, rather than
 * left to be written against attributes the new product type never asked
 * for. The server would refuse those anyway (lib/taxonomy/validate.ts);
 * this makes it not happen in the first place.
 */

export interface TaxonomySelection {
  productTypeId: string;
  /** attribute id -> its value(s). Always a list, even for single-valued
   * fields, so one shape covers both. */
  values: Record<string, string[]>;
}

export default function TaxonomyPicker({
  node, value, onChange, onAttributes, errors = {}, disabled, currentType,
  idPrefix = "", title,
}: {
  /** The category or subcategory the product is filed under -- whichever
   * of the two the form's pair settled on. Empty until one is chosen. */
  node: string;
  value: TaxonomySelection;
  onChange: (next: TaxonomySelection) => void;
  /** The attributes this product type asks for, handed up as they load, so
   * the variant editor beside this can offer the axes without fetching
   * the same rows again. */
  onAttributes?: (attrs: FormAttribute[]) => void;
  /** attribute id -> message, from the server's own validation. */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** THE TYPE THIS PRODUCT ALREADY HAS, even when it hangs off a different
   * node than the one the product is filed under.
   *
   * Those two genuinely disagree in this shop: /admin/migrate files a
   * Tetum category's products under an English product type, so a product
   * in "Sapatu" is typed "Shoes", which lives under "Footwear". Without
   * this the select would find no matching option, render blank, and the
   * first save would quietly strip the type and every answer under it.
   * Offered as an option until the category is changed, at which point the
   * type is cleared on purpose. */
  currentType?: { id: string; name: string } | null;
  /** Set when a page draws more than one of these -- a purchase order has
   * one per line. Everything below carries it, because two controls with
   * one id means every label points at the first of them. */
  idPrefix?: string;
  /** A heading and its explanation, drawn ONLY when there is something
   * under them.
   *
   * It belongs here rather than in the parent because only this component
   * knows whether the node has any product types -- and a shop that has
   * not pasted the taxonomy SQL has none anywhere. Left in the parent, the
   * product form showed a "PRODUCT TYPE" heading, a sentence about picking
   * one, and then nothing at all. */
  title?: React.ReactNode;
}) {
  /* EACH CACHE REMEMBERS WHAT IT IS FOR.
     Holding the parent id beside the list, and deriving what to render
     from it, does two jobs at once: nothing has to be cleared
     synchronously inside an effect (which triggers a cascading render),
     and a list belonging to the previous choice cannot flash on screen
     while the new one is still in flight -- it simply does not match, so
     it is not shown. */
  const [types, setTypes] = useState<{ parent: string; list: ProductType[] }>(
    { parent: "", list: [] });
  const [attrs, setAttrs] = useState<{ type: string; list: FormAttribute[] }>(
    { type: "", list: [] });

  // What this render is allowed to draw: only a list that belongs to the
  // node currently chosen.
  const loaded = types.parent === node ? types.list : [];
  const visibleAttrs = attrs.type === value.productTypeId ? attrs.list : [];

  /* The type the product already carries, kept in the list until it is
     replaced. Appended rather than merged in place so the node's own types
     stay in their configured order. */
  const visibleTypes = currentType
    && currentType.id === value.productTypeId
    && !loaded.some((p) => p.id === currentType.id)
    ? [...loaded, { ...currentType, category_id: "", slug: "", display_order: 0 }]
    : loaded;

  /* "Loading" is not a separate fact to store -- it is exactly "a type is
     chosen and its attributes have not arrived". Deriving it keeps the two
     from ever disagreeing, and avoids setting state inside the effect. */
  const busy = Boolean(value.productTypeId) && attrs.type !== value.productTypeId;

  /* Each level loads when the one above it changes. The `live` flag drops
     a response that arrives after the choice has moved on again, so a slow
     answer cannot overwrite a newer one. */

  useEffect(() => {
    let live = true;
    if (node) {
      loadProductTypes(node).then((list) => {
        if (live) setTypes({ parent: node, list });
      });
    }
    return () => { live = false; };
  }, [node]);

  useEffect(() => {
    let live = true;
    const id = value.productTypeId;
    if (!id) return;
    loadAttributes(id).then((list) => {
      if (!live) return;
      setAttrs({ type: id, list });
      onAttributes?.(list);
    });
    return () => { live = false; };
    // onAttributes is a callback the parent redefines each render; including
    // it would refetch the attributes on every keystroke in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.productTypeId]);

  function pickType(id: string) {
    onChange({ productTypeId: id, values: {} });
  }
  function setValue(attrId: string, next: string[]) {
    onChange({ ...value, values: { ...value.values, [attrId]: next } });
  }

  /* NOTHING TO DRAW IS NOTHING DRAWN.
     No product types under this node and none already chosen: the shop
     either has not installed the taxonomy or does not file anything here.
     Either way an empty control and a heading over it read as broken, and
     on a purchase order line an empty block would also take a row of its
     own in the flex layout. */
  if (!visibleTypes.length && !busy) return null;

  return (
    <div className="taxonomy">
      {title}
      {visibleTypes.length > 0 && (
        <div className="field">
          <label htmlFor={`${idPrefix}tx-type`}>Product type</label>
          <select id={`${idPrefix}tx-type`} value={value.productTypeId} disabled={disabled}
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
              idPrefix={idPrefix}
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
