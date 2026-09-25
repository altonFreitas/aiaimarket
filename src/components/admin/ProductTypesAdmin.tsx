"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  createProductType, renameProductType, setProductTypeStatus,
  deleteProductType, assignAttribute, unassignAttribute,
  setAssignmentRequired, moveAssignment,
} from "@/lib/actions/product-types";
import WriteOnly from "./Access";

/* WHICH QUESTIONS EACH PRODUCT TYPE ASKS.
 *
 * This is where the dynamic form is actually composed. Adding a row to the
 * list on the right puts a field on every future form for that type;
 * removing one takes it away. Nothing else changes anywhere.
 *
 * `required` sits on the assignment rather than on the attribute, and the
 * tick box here is why: Storage is required on a smartphone and
 * meaningless on a sofa, and it is the same attribute row in both.
 *
 * UNASSIGNING KEEPS THE VALUES. A product that recorded a Seat Height
 * still has one; it simply stops being asked for and stops being shown.
 * Putting the attribute back brings every value straight back into view.
 * Deleting them here would make a layout change into a data loss.
 */

export interface TypeRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  categoryId: string;
  categoryPath: string;
  productCount: number;
  attributes: {
    assignmentId: string;
    attributeId: string;
    name: string;
    fieldType: string;
    required: boolean;
  }[];
}

export interface AttrOption { id: string; name: string; fieldType: string }

export default function ProductTypesAdmin({
  types, categories, allAttributes,
}: {
  types: TypeRow[];
  categories: { id: string; path: string }[];
  allAttributes: AttrOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("");
  const [adding, setAdding] = useState("");

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? types.filter((t) =>
        t.name.toLowerCase().includes(needle) ||
        t.categoryPath.toLowerCase().includes(needle))
    : types;

  async function run(job: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await job(); toast(done); refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="page-head">
        <h1>Product types</h1>
        <p className="hint">
          {types.length} type{types.length === 1 ? "" : "s"}
        </p>
      </div>
      <p className="hint">
        What each one asks for is what its product form shows.
      </p>

      <div className="field">
        <label htmlFor="pt-search">Find</label>
        <input id="pt-search" type="search" value={q}
          placeholder="Type or category name"
          onChange={(e) => setQ(e.target.value)} />
      </div>

      <WriteOnly>
        <div className="panel">
          <h3>New product type</h3>
          <div className="two">
            <div className="field">
              <label htmlFor="pt-cat">Under</label>
              <select id="pt-cat" value={newCat} disabled={busy}
                onChange={(e) => setNewCat(e.target.value)}>
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pt-name">Name</label>
              <input id="pt-name" value={newName} disabled={busy}
                placeholder="Guitars"
                onChange={(e) => setNewName(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn btn-amber"
            disabled={busy || !newName.trim() || !newCat}
            onClick={() => run(async () => {
              await createProductType(newCat, newName);
              setNewName("");
            }, "Created")}>
            Add
          </button>
        </div>
      </WriteOnly>

      {/* Bounded past eight, like the attribute table. These are cards
          rather than rows and each opens to show its attributes, so the
          height allowed per card is larger -- but the rule is the same one
          and it is stated the same way. */}
      <div className={shown.length > 8 ? "rows-cap rows-cap-cards" : undefined}
        tabIndex={shown.length > 8 ? 0 : undefined}>
      {shown.map((t) => (
        <div key={t.id} className="panel pt-row">
          <div className="pt-head">
            <div>
              <b>{t.name}</b>
              {t.status === "hidden" && <> <span className="pill muted">hidden</span></>}
              <br />
              <span className="hint">
                {t.categoryPath} · {t.attributes.length} field
                {t.attributes.length === 1 ? "" : "s"} ·{" "}
                {t.productCount} product{t.productCount === 1 ? "" : "s"}
              </span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setOpen(open === t.id ? null : t.id)}>
              {open === t.id ? "Close" : "Fields"}
            </button>
          </div>

          {open === t.id && (
            <>
              <ol className="pt-attrs">
                {t.attributes.map((a, i) => (
                  <li key={a.assignmentId}>
                    <span className="pt-attr-name">
                      {a.name} <span className="hint">({a.fieldType})</span>
                    </span>
                    <WriteOnly>
                      <label className="attr-check">
                        <input type="checkbox" checked={a.required} disabled={busy}
                          onChange={(e) => run(
                            () => setAssignmentRequired(a.assignmentId, e.target.checked),
                            e.target.checked ? "Now required" : "Now optional")} />
                        required
                      </label>
                      <button type="button" className="btn btn-ghost btn-sm"
                        disabled={busy || i === 0}
                        onClick={() => run(() => moveAssignment(a.assignmentId, "up"), "Moved")}>
                        ↑
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm"
                        disabled={busy || i === t.attributes.length - 1}
                        onClick={() => run(() => moveAssignment(a.assignmentId, "down"), "Moved")}>
                        ↓
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => run(() => unassignAttribute(a.assignmentId), "Removed")}>
                        Remove
                      </button>
                    </WriteOnly>
                  </li>
                ))}
                {t.attributes.length === 0 && (
                  <li className="hint">
                    No fields yet — this type only asks the universal questions.
                  </li>
                )}
              </ol>

              <WriteOnly>
                <div className="opt-add">
                  <select value={adding} disabled={busy}
                    onChange={(e) => setAdding(e.target.value)}
                    aria-label="Attribute to add">
                    <option value="">Add a field…</option>
                    {allAttributes
                      .filter((a) => !t.attributes.some((x) => x.attributeId === a.id))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.fieldType})
                        </option>
                      ))}
                  </select>
                  <button type="button" className="btn btn-ghost btn-sm"
                    disabled={busy || !adding}
                    onClick={() => run(async () => {
                      await assignAttribute(t.id, adding);
                      setAdding("");
                    }, "Added")}>
                    Add
                  </button>
                </div>

                <div className="row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => {
                      const name = prompt("Rename this product type", t.name);
                      if (name && name.trim() !== t.name) {
                        run(() => renameProductType(t.id, name), "Renamed");
                      }
                    }}>
                    Rename
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => run(
                      () => setProductTypeStatus(t.id, t.status === "hidden" ? "active" : "hidden"),
                      t.status === "hidden" ? "Shown" : "Hidden")}>
                    {t.status === "hidden" ? "Show" : "Hide"}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                    onClick={() => run(() => deleteProductType(t.id), "Deleted")}>
                    Delete
                  </button>
                </div>
              </WriteOnly>
            </>
          )}
        </div>
      ))}
      </div>

      {shown.length === 0 && <p className="hint">Nothing matches “{q}”.</p>}
    </div>
  );
}
