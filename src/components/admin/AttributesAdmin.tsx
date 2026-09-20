"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  createAttribute, updateAttribute, deleteAttribute,
  addOption, renameOption, deleteOption, type AttributeInput,
} from "@/lib/actions/attributes";
import WriteOnly, { useCanWrite } from "./Access";
import type { FieldType } from "@/lib/taxonomy/fieldTypes";

/* THE LIBRARY OF QUESTIONS THE CATALOGUE CAN ASK.
 *
 * Section 29 of the brief. One "Material" row, shared by the 174 product
 * types that need it -- not 174 copies. Editing it here changes the field
 * on every one of their forms at once, which is the point of the
 * attribute being a row rather than a column.
 *
 * WHY THE FIELD TYPE MATTERS MOST ON THIS SCREEN. The seed inferred all
 * 546 of them from their names, and the inference is good but not
 * perfect -- it cannot know that a particular shop's "Finish" is a short
 * list rather than free text. This is where that gets corrected, and the
 * correction is permanent: saving anything here marks the row as
 * hand-edited, and the seed stops overwriting it for good.
 */

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "richtext", label: "Rich text" },
  { value: "number", label: "Number" },
  { value: "decimal", label: "Decimal" },
  { value: "currency", label: "Money" },
  { value: "select", label: "Choice (one)" },
  { value: "multiselect", label: "Choice (several)" },
  { value: "boolean", label: "Yes / No" },
  { value: "color", label: "Colour" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "range", label: "Range" },
  { value: "dimensions", label: "Dimensions" },
  { value: "tags", label: "Tags" },
  { value: "image", label: "Image" },
  { value: "file", label: "File" },
];

/** Which types offer a fixed list of values. */
const HAS_OPTIONS = new Set<FieldType>(["select", "multiselect"]);

export interface AttributeRow {
  id: string;
  name: string;
  slug: string;
  field_type: FieldType;
  unit: string | null;
  is_variant: boolean;
  filterable: boolean;
  searchable: boolean;
  sortable: boolean;
  admin_only: boolean;
  admin_edited: boolean;
  /** How many product types ask for it -- the thing that says whether
   * editing this is a small change or a large one. */
  usedBy: number;
  options: { id: string; label: string; value: string }[];
}

export default function AttributesAdmin({ attributes }: { attributes: AttributeRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const canWrite = useCanWrite();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AttributeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const [newOption, setNewOption] = useState("");

  /* 546 rows is far too many to scroll, and the one somebody wants is
     always a name they already know. Matching the slug too means "seat
     height" finds it whichever way they type it. */
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? attributes.filter((a) =>
        a.name.toLowerCase().includes(needle) || a.slug.includes(needle))
    : attributes;

  async function run(job: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await job(); toast(done); refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  return (
    <div className="panel">
      {/* The count goes in the head, which the stylesheet keeps on one
          line; the sentence goes under it. Putting the sentence inside
          .page-head made it 464px wide on a 390px phone -- that rule is
          white-space:nowrap, for a short count and nothing else. */}
      <div className="page-head">
        <h1>Attributes</h1>
        <p className="hint">
          {attributes.length} question{attributes.length === 1 ? "" : "s"}
        </p>
      </div>
      <p className="hint">
        What the catalogue can ask about a product. Editing one changes every
        product type that uses it.
      </p>

      <div className="two">
        <div className="field">
          <label htmlFor="attr-search">Find</label>
          <input id="attr-search" type="search" value={q}
            placeholder="Name, or part of one"
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <WriteOnly>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-amber" disabled={busy}
              onClick={() => { setCreating(true); setEditing(null); }}>
              New attribute
            </button>
          </div>
        </WriteOnly>
      </div>

      {(creating || editing) && (
        <AttributeEditor
          row={editing}
          busy={busy}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSave={async (input) => {
            await run(
              () => editing
                ? updateAttribute(editing.id, input)
                : createAttribute(input),
              editing ? "Saved" : "Created");
            setCreating(false); setEditing(null);
          }}
        />
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Unit</th>
            <th>Used by</th><th>Flags</th><th />
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <tr key={a.id}>
              <td>
                <b>{a.name}</b>
                <br />
                <code className="hint">{a.slug}</code>
              </td>
              <td>
                {TYPES.find((t) => t.value === a.field_type)?.label ?? a.field_type}
                {HAS_OPTIONS.has(a.field_type) && (
                  <>
                    <br />
                    <button type="button" className="btn-link"
                      onClick={() => setOpenOptions(openOptions === a.id ? null : a.id)}>
                      {a.options.length
                        ? `${a.options.length} option${a.options.length === 1 ? "" : "s"}`
                        : "no options — shows as text"}
                    </button>
                  </>
                )}
              </td>
              <td>{a.unit ?? "—"}</td>
              <td>
                {a.usedBy} type{a.usedBy === 1 ? "" : "s"}
              </td>
              <td className="hint">
                {[
                  a.is_variant && "variant",
                  a.filterable && "filter",
                  a.searchable && "search",
                  a.sortable && "sort",
                  a.admin_only && "admin only",
                ].filter(Boolean).join(", ") || "—"}
                {/* Says whose row this is: the seed stops correcting one
                    that has been edited by hand. */}
                {a.admin_edited && <><br /><span className="pill muted">edited</span></>}
              </td>
              <td>
                <WriteOnly>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => { setEditing(a); setCreating(false); }}>
                    Edit
                  </button>{" "}
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                    onClick={() => run(() => deleteAttribute(a.id), "Deleted")}>
                    Delete
                  </button>
                </WriteOnly>
              </td>
            </tr>
          ))}

          {/* The options list, opened under its own row. */}
          {shown.filter((a) => a.id === openOptions).map((a) => (
            <tr key={a.id + "-opts"}>
              <td colSpan={6}>
                <div className="opt-editor">
                  <p className="hint" style={{ marginTop: 0 }}>
                    {a.options.length === 0
                      ? "With no options this renders as a text box. Add some to turn it into a dropdown everywhere it appears."
                      : "Renaming an option changes what shoppers see without touching what is stored against any product."}
                  </p>
                  <ul className="opt-list">
                    {a.options.map((o) => (
                      <li key={o.id}>
                        <input type="text" defaultValue={o.label} disabled={!canWrite || busy}
                          onBlur={(e) => e.target.value.trim() !== o.label
                            && run(() => renameOption(o.id, e.target.value), "Renamed")} />
                        <WriteOnly>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                            onClick={() => run(async () => {
                              const { stillUsing } = await deleteOption(o.id);
                              if (stillUsing > 0) {
                                toast(`${stillUsing} product${stillUsing === 1 ? "" : "s"} still record "${o.label}".`, true);
                              }
                            }, "Removed")}>
                            Remove
                          </button>
                        </WriteOnly>
                      </li>
                    ))}
                  </ul>
                  <WriteOnly>
                    <div className="opt-add">
                      <input type="text" value={newOption} placeholder="Add an option"
                        disabled={busy}
                        onChange={(e) => setNewOption(e.target.value)} />
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !newOption.trim()}
                        onClick={() => run(async () => {
                          await addOption(a.id, newOption);
                          setNewOption("");
                        }, "Added")}>
                        Add
                      </button>
                    </div>
                  </WriteOnly>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown.length === 0 && (
        <p className="hint">Nothing matches “{q}”.</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function AttributeEditor({
  row, busy, onSave, onCancel,
}: {
  row: AttributeRow | null;
  busy: boolean;
  onSave: (input: AttributeInput) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<AttributeInput>({
    name: row?.name ?? "",
    field_type: row?.field_type ?? "text",
    unit: row?.unit ?? "",
    is_variant: row?.is_variant ?? false,
    filterable: row?.filterable ?? false,
    searchable: row?.searchable ?? false,
    sortable: row?.sortable ?? false,
    admin_only: row?.admin_only ?? false,
  });

  return (
    <div className="panel attr-editor">
      <h3>{row ? `Edit “${row.name}”` : "New attribute"}</h3>
      {row && row.usedBy > 0 && (
        <p className="hint">
          Used by {row.usedBy} product type{row.usedBy === 1 ? "" : "s"}. Changes
          reach all of them.
        </p>
      )}

      <div className="two">
        <div className="field">
          <label htmlFor="ae-name">Name</label>
          <input id="ae-name" value={f.name} disabled={busy}
            onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ae-type">Field type</label>
          <select id="ae-type" value={f.field_type} disabled={busy}
            onChange={(e) => setF({ ...f, field_type: e.target.value as FieldType })}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="ae-unit">Unit</label>
        <input id="ae-unit" value={f.unit ?? ""} disabled={busy}
          placeholder="cm, kg, W — leave empty if it has none"
          onChange={(e) => setF({ ...f, unit: e.target.value })} />
      </div>

      <div className="attr-flags">
        {([
          ["is_variant", "Tells variants apart", "Size and colour can; brand cannot — a product has one brand whatever sizes it comes in."],
          ["filterable", "Offer as a filter", "Only useful where there is a set of values to offer."],
          ["searchable", "Include in search", ""],
          ["sortable", "Allow sorting", "Worth it for numbers; rarely for a dropdown."],
          ["admin_only", "Admin only", "Never shown on a product page."],
        ] as const).map(([key, label, hint]) => (
          <label key={key} className="attr-check">
            <input type="checkbox" checked={!!f[key]} disabled={busy}
              onChange={(e) => setF({ ...f, [key]: e.target.checked })} />
            <span>
              {label}
              {hint && <><br /><span className="hint">{hint}</span></>}
            </span>
          </label>
        ))}
      </div>

      <div className="row-actions">
        <button type="button" className="btn btn-amber" disabled={busy || !f.name.trim()}
          onClick={() => onSave(f)}>
          {busy ? "…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
