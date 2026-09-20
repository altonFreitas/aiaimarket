"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { generateVariants, updateVariant, deleteVariant } from "@/lib/actions/variants";
import { matrixSize, MAX_VARIANTS, type VariantAxis } from "@/lib/taxonomy/variantMatrix";
import WriteOnly from "./Access";
import type { FormAttribute } from "@/lib/taxonomy/types";

/* THE COMBINATIONS A PRODUCT IS SOLD IN.
 *
 * The axes offered are exactly the attributes this product type marks as
 * variant-enabled -- Colour and Size on a shirt, Storage and Colour on a
 * phone. Nothing here decides that; it reads is_variant off the same rows
 * the form draws from, so a shop that makes "Finish" a variant axis in the
 * attribute builder gets it here without anybody touching this file.
 *
 * GENERATING IS ADDITIVE AND SAYS SO. Adding a fourth size to a shirt
 * already selling three creates one variant, not twelve: the existing
 * three carry SKUs, prices and stock, and stock is ledger history that
 * cannot be recreated. Anything the axes no longer cover is NAMED rather
 * than removed -- "White / XL" may be six units on a shelf, and somebody
 * has to be told rather than have the row that says so quietly erased.
 */

export interface VariantRow {
  id: string;
  label: string;
  sku: string | null;
  price: number | null;
  cost_price: number | null;
  status: string;
  /** What the ledger says is on the shelf for this one. Read-only here:
   * stock moves through receipts and sales, never by typing. */
  onHand: number;
}

export default function VariantEditor({
  productId, attributes, variants,
}: {
  productId: string;
  /** This product type's attributes; only the variant axes are offered. */
  attributes: FormAttribute[];
  variants: VariantRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  const axes = useMemo(() => attributes.filter((a) => a.is_variant), [attributes]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [orphans, setOrphans] = useState<string[]>([]);

  const chosen: VariantAxis[] = axes.map((a) => ({
    attributeId: a.id, name: a.name, values: picked[a.id] ?? [],
  }));
  const size = matrixSize(chosen);
  const tooMany = size > MAX_VARIANTS;

  function toggle(attrId: string, value: string) {
    setPicked((p) => {
      const have = p[attrId] ?? [];
      return {
        ...p,
        [attrId]: have.includes(value)
          ? have.filter((v) => v !== value)
          : [...have, value],
      };
    });
  }

  async function run(job: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await job(); toast(done); refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  if (!axes.length) {
    return (
      <p className="hint">
        This product type has no fields that can vary, so it is sold as one
        thing. Mark an attribute as a variant axis to change that.
      </p>
    );
  }

  return (
    <div className="variants">
      <WriteOnly>
        <div className="var-axes">
          {axes.map((a) => (
            <div key={a.id} className="field">
              <label>{a.name}</label>
              {a.options.length ? (
                <div className="attr-checks">
                  {a.options.map((o) => (
                    <label key={o.value} className="attr-check">
                      <input type="checkbox" disabled={busy}
                        checked={(picked[a.id] ?? []).includes(o.value)}
                        onChange={() => toggle(a.id, o.value)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              ) : (
                /* An axis whose options nobody has filled in yet. Typed
                   as a list rather than left unusable -- the same decision
                   the form makes for a select with no options. */
                <input type="text" disabled={busy}
                  placeholder="Black, White, Navy"
                  value={(picked[a.id] ?? []).join(", ")}
                  onChange={(e) => setPicked((p) => ({
                    ...p,
                    [a.id]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  }))} />
              )}
            </div>
          ))}
        </div>

        <div className="row-actions">
          <button type="button" className="btn btn-amber"
            disabled={busy || size === 0 || tooMany}
            onClick={() => run(async () => {
              const r = await generateVariants({ productId, axes: chosen });
              setOrphans(r.orphaned);
              if (r.error) throw new Error(r.error);
              toast(r.created
                ? `${r.created} new option${r.created === 1 ? "" : "s"}`
                : "Nothing new to add");
            }, "Done")}>
            {size > 0 ? `Create ${size} option${size === 1 ? "" : "s"}` : "Choose some values"}
          </button>
          {tooMany && (
            <span className="msg" style={{ display: "block" }}>
              {size} is more than the limit of {MAX_VARIANTS}. Use fewer values,
              or split this into more than one product.
            </span>
          )}
        </div>

        {orphans.length > 0 && (
          /* Named, not removed: these may be units on a shelf. */
          <p className="hint">
            Still here but no longer covered by those values:{" "}
            <b>{orphans.join(", ")}</b>. They keep selling until you hide them.
          </p>
        )}
      </WriteOnly>

      {variants.length > 0 && (
        /* THE TABLE SCROLLS RATHER THAN SHRINKING. Six columns of option,
           SKU, price, stock and two buttons come to about 500px, and a
           phone is 390. Squeezing them would make every one unusable; the
           house .scroll-x wrapper slides them sideways instead, with the
           fade at the edge that says there is more. */
        /* tabIndex, because a div that scrolls and contains nothing
           focusable cannot be scrolled from a keyboard at all -- everything
           past the fade would be unreachable without a mouse. */
        <div className="scroll-x" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th>Option</th><th>SKU</th><th>Price</th>
              <th>On hand</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id}>
                <td><b>{v.label}</b></td>
                <td>
                  <WriteOnly>
                    <input type="text" defaultValue={v.sku ?? ""} disabled={busy}
                      placeholder="—"
                      onBlur={(e) => e.target.value.trim() !== (v.sku ?? "")
                        && run(() => updateVariant(v.id, { sku: e.target.value }), "Saved")} />
                  </WriteOnly>
                </td>
                <td>
                  <WriteOnly>
                    <input type="number" step="0.01" min="0" disabled={busy}
                      defaultValue={v.price ?? ""}
                      placeholder="as product"
                      onBlur={(e) => run(() => updateVariant(v.id, {
                        price: e.target.value === "" ? null : Number(e.target.value),
                      }), "Saved")} />
                  </WriteOnly>
                </td>
                {/* Read-only, deliberately: stock arrives through receipts
                    and leaves through sales. A box to type it in would be a
                    second way to move the shelf, and the ledger would stop
                    being the one account of how it got there. */}
                <td>{v.onHand}</td>
                <td>
                  {v.status === "hidden"
                    ? <span className="pill muted">hidden</span>
                    : <span className="pill ok">on sale</span>}
                </td>
                <td>
                  <WriteOnly>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                      onClick={() => run(() => updateVariant(v.id, {
                        status: v.status === "hidden" ? "active" : "hidden",
                      }), v.status === "hidden" ? "On sale" : "Hidden")}>
                      {v.status === "hidden" ? "Show" : "Hide"}
                    </button>{" "}
                    <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                      onClick={() => run(() => deleteVariant(v.id), "Deleted")}>
                      Delete
                    </button>
                  </WriteOnly>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
