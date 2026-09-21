"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { migrateCategory } from "@/lib/actions/migrate";
import WriteOnly from "./Access";
import type { CategoryGroup, TypeCandidate } from "@/lib/taxonomy/migrate";

/* FINISHING THE PRODUCTS THAT PREDATE THE TAXONOMY.
 *
 * BY CATEGORY, because that is what makes it finishable. A shop with two
 * hundred products does not have two hundred decisions to make; it has as
 * many as it has categories. Saying once that "Sapatu" means Running
 * Shoes moves all of them.
 *
 * WHY THE SUGGESTIONS ARE MOSTLY EMPTY, and the screen says so rather than
 * looking broken: a shop's categories are in the language it trades in --
 * Sapatu, Roupa, Telemóvel -- and the taxonomy is in English. Almost
 * nothing matches by name, which is why this screen is the main road and
 * not a fallback. Guessing would be worse: a product filed under the wrong
 * type gets the wrong questions and the wrong filters, and looks finished
 * while being wrong.
 *
 * NOTHING HERE STOPS A PRODUCT SELLING. Setting a type adds the questions
 * that type asks. Price, stock, images and status are untouched, and a
 * product nobody ever gets to keeps working exactly as it does today.
 */

export default function MigrateAdmin({
  groups, types, done, total,
}: {
  groups: CategoryGroup[];
  types: TypeCandidate[];
  /** How many products already have a type. */
  done: number;
  total: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const pending = groups.reduce((n, g) => n + g.pending, 0);

  async function run(job: () => Promise<{ moved: number; error?: string }>) {
    setBusy(true);
    try {
      const r = await job();
      if (r.error) toast(r.error, true);
      else toast(`${r.moved} product${r.moved === 1 ? "" : "s"} filed`);
      refresh();
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  if (!pending) {
    return (
      <div className="panel">
        <h1>Finish the catalogue</h1>
        <p className="hint">
          Every product has a product type. Nothing left to do.
        </p>
        <Link className="btn btn-ghost" href="/admin/products">Back to products</Link>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="page-head">
        <h1>Finish the catalogue</h1>
        <p className="hint">{done} of {total}</p>
      </div>
      <p className="hint">
        These products were created before the catalogue had product types,
        so they have no extra fields and no filters. They are selling
        normally — this only adds the questions their type asks.
      </p>

      {/* Said once, plainly, rather than leaving somebody to wonder why
          the suggestions are blank. */}
      <p className="hint">
        Suggestions appear only where a category name matches a product type
        exactly. Your categories are in Tetum and the product types are in
        English, so most will be blank — pick them yourself below. Anything
        a category-wide answer gets wrong can be changed on that product&rsquo;s
        own page afterwards.
      </p>

      <div className="field">
        <label htmlFor="mg-find">Find a product type</label>
        <input id="mg-find" type="search" value={q} placeholder="Shoes, Sofas, Smartphones"
          onChange={(e) => setQ(e.target.value)} />
      </div>

      {groups.map((g) => {
        const chosen = picked[g.categoryId] ?? g.suggestion.typeId ?? "";
        const needle = q.trim().toLowerCase();
        const offered = needle
          ? types.filter((t) =>
              t.name.toLowerCase().includes(needle) ||
              t.path.toLowerCase().includes(needle))
          : types;

        return (
          <div key={g.categoryId} className="panel mg-row">
            <div className="pt-head">
              <div>
                <b>{g.categoryName}</b>
                <br />
                <span className="hint">
                  {g.pending} product{g.pending === 1 ? "" : "s"} to file
                  {g.suggestion.reason === "ambiguous" && (
                    <> · {g.suggestion.candidates.length} product types share this name</>
                  )}
                </span>
              </div>
            </div>

            <WriteOnly>
              <div className="opt-add">
                <select value={chosen} disabled={busy}
                  aria-label={`Product type for ${g.categoryName}`}
                  onChange={(e) => setPicked((p) => ({ ...p, [g.categoryId]: e.target.value }))}>
                  <option value="">Choose a product type…</option>
                  {offered.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {t.path}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-amber btn-sm"
                  disabled={busy || !chosen}
                  onClick={() => run(() => migrateCategory(g.categoryId, chosen))}>
                  File {g.pending}
                </button>
              </div>
              {g.suggestion.reason === "matched" && !picked[g.categoryId] && (
                <p className="hint">
                  Suggested from the name — check it before filing.
                </p>
              )}
            </WriteOnly>
          </div>
        );
      })}
    </div>
  );
}
