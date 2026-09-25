import type { Category } from "./types";

/* WALKING THE CATEGORY TREE, ALL THE WAY DOWN.
 *
 * Four places each had their own version of this and every one of them
 * stopped after one level:
 *
 *   [id, ...cats.filter((c) => c.parent_id === id).map((c) => c.id)]
 *
 * which was right while the tree was two deep and silently wrong the
 * moment it was not. The shop's tree now has Fitness & Wellness Lifestyle
 * -> Sports Nutrition -> Protein in it, and under that rule a tub of
 * protein counted towards Sports Nutrition and not towards the aisle above
 * it: browsing Fitness & Wellness showed a number that was missing most of
 * what is in it, and filtering to it returned products that were not.
 *
 * So there is one walk now, it recurses, and everything reads from it.
 *
 * THE VISITED SET IS NOT DEFENSIVE PROGRAMMING. parent_id is a plain
 * self-reference with no constraint against a cycle, and the admin's
 * "move" is a parent_id write -- so A parented to B parented to A is two
 * clicks away, and without this the storefront would hang rather than
 * render a wrong number. */

/** Every category id at or below `id`, parents before children. */
export function descendantIds(cats: readonly Category[], id: string): string[] {
  const byParent = new Map<string, Category[]>();
  for (const c of cats) {
    if (!c.parent_id) continue;
    const list = byParent.get(c.parent_id) ?? [];
    list.push(c);
    byParent.set(c.parent_id, list);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (at: string) => {
    if (seen.has(at)) return;
    seen.add(at);
    out.push(at);
    for (const kid of (byParent.get(at) ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
      walk(kid.id);
    }
  };
  walk(id);
  return out;
}

/** How deep a category sits: 0 for a root, 1 for its child, and so on.
 *
 * Bounded by the number of categories, which is what stops a cycle from
 * counting for ever. A category caught in one reports the depth it had
 * reached, which is wrong but finite -- and the tree it is in is broken in
 * a way no indentation could describe honestly anyway. */
export function depthOf(cats: readonly Category[], id: string): number {
  const byId = new Map(cats.map((c) => [c.id, c]));
  let depth = 0;
  let at = byId.get(id);
  const seen = new Set<string>([id]);
  while (at?.parent_id && !seen.has(at.parent_id) && depth < cats.length) {
    seen.add(at.parent_id);
    at = byId.get(at.parent_id);
    depth++;
  }
  return depth;
}

/** "Fitness & Wellness Lifestyle / Sports Nutrition / Protein" — the trail
 * to a category, for a screen that shows one category out of its tree. */
export function pathOf(cats: readonly Category[], id: string): Category[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: Category[] = [];
  const seen = new Set<string>();
  let at = byId.get(id);
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    out.unshift(at);
    at = at.parent_id ? byId.get(at.parent_id) : undefined;
  }
  return out;
}
