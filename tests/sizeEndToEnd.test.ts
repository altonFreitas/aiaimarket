import { describe, it, expect } from "vitest";
import { mergeAxisValues } from "@/lib/procurement";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const RECEIVING = read("src/lib/receiving.ts");
const PRICES = read("src/lib/data/sizePrices.ts");
const INTERACTIVE = read("src/components/ProductInteractive.tsx");
const PAGE = read("src/app/p/[slug]/page.tsx");
const COSTS = read("src/components/admin/sales/CostsAdmin.tsx");
const VCOSTS = read("src/lib/data/variantCosts.ts");
const ATTRS = read("src/lib/actions/product-attributes.ts");

/* ONE SIZE, FROM THE PURCHASE ORDER TO THE SHELF.
 *
 * A shirt is bought on three rows -- XS, S, M -- each with its own price.
 * That one fact has to arrive in four places and they must all agree:
 *
 *   the product form's Size box      "XS, S, M"
 *   products.sizes                    the storefront's picker
 *   the product page's Size row       each size, with what is left of it
 *   the price beside it               the price THAT size was bought at
 *
 * Each of the four used to be written by something that did not know
 * about the other three. */

describe("the sizes bought become the product's Size answer", () => {
  it("collects the axes across every line before writing", () => {
    /* One product's sizes are spread over several lines. Writing inside
       the loop would save "XS", then overwrite it with "S", then with
       "M" -- each line's single value replacing the last. */
    expect(RECEIVING).toContain("const axisAnswers = new Map<string, Map<string, Set<string>>>()");
    const collect = RECEIVING.indexOf("axisAnswers.set(productId, forProduct)");
    const write = RECEIVING.indexOf("await writeAxisAnswers(");
    expect(collect).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(collect);
  });

  it("writes only the variant axes, not every answer", () => {
    // The composition and the brand are true of the whole product and are
    // applyTaxonomy's job; Size and Colour differ per line.
    expect(RECEIVING).toContain(".filter((a) => a.is_variant)");
  });

  /* THE MERGE ITSELF, run rather than read. Everything above is the
     wiring; this is the rule, and it is the part that is easy to get
     silently wrong. */
  it("is the union, in the order the sizes were first seen", () => {
    expect(mergeAxisValues([], ["XS", "S", "M"])).toBe("XS, S, M");
  });

  it("keeps what was already there and appends what is new", () => {
    // A restock buying L must not erase the XS, S and M already sold.
    expect(mergeAxisValues(["XS", "S", "M"], ["L"])).toBe("XS, S, M, L");
  });

  it("does not sort", () => {
    /* Alphabetically, a size run becomes L, M, S, XL, XS -- an anagram of
       a size run. First seen, first shown. */
    expect(mergeAxisValues([], ["XL", "S", "M"])).toBe("XL, S, M");
    expect(mergeAxisValues(["M"], ["L", "S"])).toBe("M, L, S");
  });

  it("adds a size the receipt already holds only once", () => {
    expect(mergeAxisValues(["S", "M"], ["M", "L", "M"])).toBe("S, M, L");
  });

  it("treats one size spelled two ways as one size", () => {
    /* "41,5" and "41.5" are the same shoe, and two spellings on one
       product split its stock into two piles that each look half empty.
       The first spelling is the one kept. */
    expect(mergeAxisValues(["41,5"], ["41.5"])).toBe("41,5");
    expect(mergeAxisValues(["S"], ["s"])).toBe("S");
  });

  it("keeps a decimal size whole rather than splitting it on its comma", () => {
    expect(mergeAxisValues([], ["41,5", "42"])).toBe("41,5, 42");
    expect(mergeAxisValues(["41,5, 42"], ["43"])).toBe("41,5, 42, 43");
  });

  it("reads a stored row back apart, which is how a second receipt merges", () => {
    // What is in the box is one string; what it means is three sizes.
    const first = mergeAxisValues([], ["XS", "S"]);
    expect(mergeAxisValues([first], ["M"])).toBe("XS, S, M");
  });

  it("is nothing for nothing, not an empty-looking comma", () => {
    expect(mergeAxisValues([], [])).toBe("");
    expect(mergeAxisValues([""], [""])).toBe("");
  });

  it("reads what the product already had before merging onto it", () => {
    expect(RECEIVING).toMatch(/\.from\("product_attribute_values"\)\s*\n\s*\.select\("attribute_id,value"\)/);
    expect(RECEIVING).toContain("mergeAxisValues(had, values)");
  });

  it("joins them into one row, because Size draws as a text box", () => {
    /* Size has no options seeded -- they differ per product, S/M/L
       against 38-45 -- so the form renders a free-text field, and a text
       field shows value[0]. Three rows would show one size. */
    expect(RECEIVING).toContain("value: mergeAxisValues(had, values),");
  });

  it("is read back apart again by the same reading everything else uses", () => {
    // parseSizes, so "41,5" stays one size and "M, L" is two.
    expect(ATTRS).toContain("parseSizes(answered.join(\", \"))");
  });

  it("never fails a receipt over a specification", () => {
    // The goods are on the shelf by the time this runs.
    const fn = RECEIVING.slice(RECEIVING.indexOf("async function writeAxisAnswers"));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain("catch { /* the stock is counted either way */ }");
  });
});

describe("the price follows the size", () => {
  it("reads each size's price from its variant, by slug", () => {
    expect(PRICES).toContain('.eq("variant_attribute_values.attributes.slug", "size")');
  });

  it("never sends a cost price to the storefront", () => {
    /* product_variants.cost_price is the shop's margin. Checked on the
       SELECT rather than on the file, because the file says the word in
       a comment explaining why it is absent -- and an assertion that a
       comment cannot mention the thing it warns about is an assertion
       that punishes the explanation. */
    const select = PRICES.slice(PRICES.indexOf(".select("));
    expect(select.slice(0, select.indexOf(")"))).not.toContain("cost_price");
  });

  it("leaves a hidden variant out", () => {
    // Quoting its price would be quoting a price nobody can pay.
    expect(PRICES).toContain('if (row.status === "hidden") continue');
  });

  it("takes the lowest when one size has two variants", () => {
    /* The same size in two colours at two prices. Wrong in the cheap
       direction is a discount; wrong in the dear direction is a bait. */
    expect(PRICES).toContain("if (had == null || price < had) out.set(size, price)");
  });

  it("charges the chosen size's price, in the basket and on WhatsApp too", () => {
    expect(INTERACTIVE).toContain("const sizePrice = size != null ? sizePrices?.[size] : undefined;");
    expect(INTERACTIVE).toContain("const effectivePrice = p.discount_price ?? basePrice;");
    // Both of these read effectivePrice, so neither can drift from it.
    expect(INTERACTIVE).toContain("price: Number(effectivePrice)");
    expect(INTERACTIVE).toContain("waProductMsg({ ...p, price: effectivePrice }");
  });

  it("lets a discount win over a per-size price", () => {
    /* discount_price is the shop saying "this product is on offer";
       honouring the size price over it would cancel the offer for anyone
       who picked a size. */
    expect(INTERACTIVE).toContain("p.discount_price ?? basePrice");
  });

  it("says FROM the cheapest, not one number that is wrong for two sizes", () => {
    expect(INTERACTIVE).toContain("priceVaries && size == null");
    expect(INTERACTIVE).toContain("return vals.length ? Math.min(...vals) : Number(p.price);");
  });

  it("strikes through what THIS size would have cost", () => {
    // Crossing out the product's price on a size that costs more would
    // show a saving the shopper is not getting.
    expect(INTERACTIVE).toContain('<span className="aab-price-original">{money(basePrice)}</span>');
  });

  it("crosses the server boundary as an object, not a Map", () => {
    expect(PAGE).toContain("sizePrices={Object.fromEntries(sizePrices)}");
  });
});

describe("the cost table shows the SKUs behind the average", () => {
  it("names colour, size, cost and selling price", () => {
    for (const k of ["color", "size", "sku", "unitCost", "sellingPrice", "margin"]) {
      expect(COSTS, k).toContain(`t("${k}", lang)`);
    }
  });

  it("reads the axes from the answers, not by splitting the label", () => {
    // "Black / XL" and "XL / Black" are the same SKU written two ways.
    expect(VCOSTS).toContain("axes[slug] = String(v.value ?? \"\")");
  });

  it("shows a variant's own price, or the product's when it has none", () => {
    // Null on a variant means "same as the product", which is what the
    // storefront charges for it.
    expect(COSTS).toContain("const sell = v.price ?? price;");
  });

  it("tells nothing-landed-yet apart from costs-nothing", () => {
    expect(COSTS).toContain('{v.costPrice == null ? "—" : money(v.costPrice)}');
  });

  it("opens by product id, not by row position", () => {
    // Filtering the list would otherwise leave the chevron open on
    // whatever slid into that slot.
    expect(COSTS).toContain("setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))");
  });

  it("offers no chevron where there is nothing behind it", () => {
    // A fridge is one thing, and a control that reveals nothing is
    // furniture.
    expect(COSTS).toContain("skus.length > 0 && (");
  });

  it("says whether it is open to a screen reader", () => {
    expect(COSTS).toContain("aria-expanded={isOpen}");
  });
});
