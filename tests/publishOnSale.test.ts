import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const RECEIVING = read("src/lib/receiving.ts");
const PRODUCTS = read("src/lib/actions/products.ts");
const SELLER_ACTION = read("src/lib/actions/seller-products.ts");
const FORM = read("src/components/admin/ProductForm.tsx");
const SELLER_FORM = read("src/components/seller/SellerProductForm.tsx");
const LIST = read("src/components/admin/ProductList.tsx");

/* A DELIVERY IS THE START OF A LISTING, NOT THE WHOLE OF IT.
 *
 * Receiving a purchase order created the product approved, which put it
 * straight onto the homepage: no photograph, the supplier's name for it,
 * whatever description was typed on the order months earlier. The shop
 * found out it was live by seeing it there.
 *
 * products.status already gated the storefront, so there is no new
 * column: the receipt lands "pending" and a box on the product form is
 * what offers it. */

describe("a received product waits to be put on sale", () => {
  it("lands not on sale", () => {
    const create = RECEIVING.slice(RECEIVING.indexOf("stock_status: \"out\","));
    expect(create.slice(0, 900)).toContain('status: "pending"');
    expect(RECEIVING).not.toContain('status: "approved"');
  });

  it("still counts the stock, which was never the question", () => {
    // The movement is what puts units on the shelf, and it is unchanged.
    expect(RECEIVING).toContain('reason: "purchase_receipt"');
  });

  it("says so when the receipt finishes", () => {
    const I18N = read("src/lib/i18n.ts");
    expect(I18N).toContain("waiting to be put on sale");
  });
});

describe("the box that puts it on sale", () => {
  it.each([
    ["the owner's form", () => FORM],
    ["the seller's form", () => SELLER_FORM],
  ])("is on %s, above Save", (_n, get) => {
    const src = get();
    expect(src).toContain('const [onSale, setOnSale] = useState(');
    expect(src).toContain('t("onSale", lang)');
    // Above the Save button, because it is part of the same decision.
    expect(src.indexOf('className="panel on-sale"'))
      .toBeLessThan(src.indexOf('type="submit"'));
    // And it reaches the server.
    expect(src).toContain("        onSale,");
  });

  it("starts ticked for a product being typed in, not for one being edited", () => {
    /* Somebody filling in this form is making a listing on purpose; a
       product that arrived on a delivery is whatever it already is. */
    for (const src of [FORM, SELLER_FORM]) {
      expect(src).toContain('product ? product.status === "approved" : true');
    }
  });

  it("hides the storefront link while the product is not on sale", () => {
    // The storefront serves approved products only, so that link on an
    // unpublished one opens a 404 -- which reads as a broken shop.
    expect(FORM).toContain("{product && onSale && (");
  });
});

describe("what the server does with it", () => {
  it.each([
    ["the owner's action", () => PRODUCTS],
    ["the seller's action", () => SELLER_ACTION],
  ])("maps the tick onto the status in %s", (_n, get) => {
    expect(get()).toContain('{ status: input.onSale ? "approved" : "pending" }');
  });

  it.each([
    ["the owner's action", () => PRODUCTS],
    ["the seller's action", () => SELLER_ACTION],
  ])("leaves the status alone when %s is not told", (_n, get) => {
    /* Absent must not mean false. A caller that predates this field would
       otherwise unpublish every product it saved. */
    expect(get()).toContain("input.onSale === undefined");
    expect(get()).toContain("? {} :");
  });

  it.each([
    ["the owner's action", () => PRODUCTS],
    ["the seller's action", () => SELLER_ACTION],
  ])("creates approved unless told otherwise in %s", (_n, get) => {
    expect(get()).toContain('status: input.onSale === false ? "pending" : "approved"');
  });
});

describe("finding what is waiting", () => {
  it("counts them and offers the filter only when there are any", () => {
    // A filter that can only ever return nothing teaches people the
    // screen is broken.
    expect(LIST).toContain('const waitingCount = live.filter((p) => p.status === "pending").length;');
    expect(LIST).toContain("{waitingCount > 0 && (");
    expect(LIST).toContain('a.filter((p) => p.status === "pending")');
  });

  it("says what the state means rather than naming a workflow", () => {
    const I18N = read("src/lib/i18n.ts");
    /* "Pending review" was moderation language from when this only meant
       a seller's listing waiting on the marketplace. Checked on the KEY's
       own line rather than on the file, because the file explains the
       change in a comment -- and an assertion that a comment may not
       mention what it is explaining is one that punishes the
       explanation. */
    const line = I18N.split("\n").find((l) => l.trim().startsWith("productStatus_pending:"));
    expect(line).toBeTruthy();
    expect(line).toContain("Seidauk iha venda");
    expect(line).not.toContain("Pending review");
  });
});
