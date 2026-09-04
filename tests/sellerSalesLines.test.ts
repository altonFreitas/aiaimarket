import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSalesLines, type SalesLine } from "@/lib/sales";
import { packSalesLines, unpackSalesLines } from "@/lib/salesWire";
import type { Category, Order, OrderItem, Product, Seller } from "@/lib/types";

/* THE RULE: what the marketplace paid for goods never reaches a seller.
 *
 * lib/data/sellerSales.ts builds the seller's dashboard on the owner's own
 * SalesLine engine, which is the right thing to do -- and the engine
 * carries unitCost, cost, grossProfit and margin, which are the platform's
 * buying prices.
 *
 * These tests are the proof that the stripping works, written against the
 * SAME builder the real code calls, with orders that DO carry costs. The
 * dangerous version of this test would use cost-free fixtures and pass
 * while proving nothing.
 */

const seller: Seller = { id: "s1", store_name: "AITA STORE" } as Seller;
const other = "s2";

const product = (id: string, price: number): Product =>
  ({ id, name: "P" + id, price, category_id: "c1", archived: false } as Product);

const item = (
  productId: string, price: number, qty: number, sellerId: string | null, cost?: number
): OrderItem => ({
  product_id: productId, seller_id: sellerId, name: "P" + productId,
  size: "", price, qty, ...(cost != null ? { cost } : {}),
} as OrderItem);

const order = (id: string, items: OrderItem[], extra: Partial<Order> = {}): Order => ({
  id, ref: "ORD-" + id, status: "completed", created_at: "2026-09-04T10:00:00Z",
  buyer_name: "Ana", buyer_phone: "7712345", mode: "delivery", municipality: "Dili",
  pay_method: "cod", pay_status: "paid", items, ...extra,
} as Order);

/** What lib/data/sellerSales.ts does to an item before building lines. */
function withoutCost(i: OrderItem): OrderItem {
  if (i.cost == null) return i;
  const { cost: _c, ...rest } = i;
  return rest as OrderItem;
}

/** The seller pipeline, exactly as the real module composes it. */
function sellerLines(orders: Order[], products: Product[]): SalesLine[] {
  const scoped = orders
    .map((o) => ({ ...o, items: (o.items || []).filter((i) => i.seller_id === seller.id) }))
    .filter((o) => o.items.length)
    .map((o) => ({ ...o, items: o.items.map(withoutCost) }));
  return buildSalesLines(scoped as Order[], {
    products,
    categories: [{ id: "c1", name: "Shoes" } as Category],
    sellers: [seller],
    costs: new Map(),
  });
}

describe("the platform's buying prices never reach a seller", () => {
  const products = [product("p1", 20), product("p2", 12)];

  it("returns no cost even when the order line carries the snapshot", () => {
    // THE CASE THAT MATTERS. Every order placed after supabase/sales.sql
    // ran has item.cost written onto it, and buildSalesLines PREFERS that
    // snapshot over the costs map -- so an empty map alone proves nothing.
    const lines = sellerLines(
      [order("o1", [item("p1", 20, 2, seller.id, 7.5)])], products);

    expect(lines).toHaveLength(1);
    expect(lines[0].unitCost).toBeNull();
    expect(lines[0].cost).toBeNull();
    expect(lines[0].grossProfit).toBeNull();
    expect(lines[0].margin).toBeNull();
  });

  it("still reports everything that IS the seller's", () => {
    // Stripping the cost must not cost them the rest of the line.
    const lines = sellerLines(
      [order("o1", [item("p1", 20, 2, seller.id, 7.5)])], products);
    expect(lines[0]).toMatchObject({
      ref: "ORD-o1", qty: 2, unitPrice: 20, netSales: 40,
      productName: "Pp1", categoryName: "Shoes", municipality: "Dili",
      customerName: "Ana", status: "completed",
    });
  });

  it("sends no cost over the wire either", () => {
    // lib/salesWire.ts carries unitCost as one of five numeric columns, so
    // a cost that survived to here would arrive in the browser and sit in
    // the network tab whether or not any component drew it. -1 is the
    // wire's null.
    const lines = sellerLines(
      [order("o1", [item("p1", 20, 2, seller.id, 7.5)])], products);
    const packed = packSalesLines(lines);

    const asText = JSON.stringify(packed);
    expect(asText).not.toContain("7.5");
    for (const l of unpackSalesLines(packed)) expect(l.unitCost).toBeNull();
  });

  it("leaks nothing through a mixed-seller order", () => {
    // The buyer's cart held two stores' goods. This store gets its own
    // line and learns nothing about the other -- not the item, not its
    // price, not its cost.
    const lines = sellerLines([order("o1", [
      item("p1", 20, 1, seller.id, 7.5),
      item("pX", 99, 3, other, 40),
    ])], products);

    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBe("p1");
    expect(JSON.stringify(lines)).not.toContain("pX");
    expect(JSON.stringify(lines)).not.toContain("99");
  });

  it("gives a store nothing at all from an order it has no part in", () => {
    const lines = sellerLines([order("o1", [item("pX", 99, 1, other, 40)])], products);
    expect(lines).toEqual([]);
  });
});

describe("the module that does it", () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "data", "sellerSales.ts"), "utf8");
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("strips the cost before building lines, not after", () => {
    // After is too late: the line would already hold it, and anything that
    // forgot to strip a copy would ship it.
    expect(code).toMatch(/items:\s*mine\.map\(withoutCost\)/);
    const stripAt = code.indexOf("withoutCost)");
    const buildAt = code.indexOf("buildSalesLines(");
    expect(stripAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(stripAt);
  });

  it("passes an empty costs map as the second door", () => {
    expect(code).toMatch(/costs:\s*new Map\(\)/);
  });

  it("filters to the seller's own items", () => {
    expect(code).toMatch(/i\.seller_id === seller\.id/);
  });

  it("deletes the cost key rather than zeroing it", () => {
    // Zero is a cost, and a zero cost reads as 100% margin.
    expect(code).toMatch(/const \{ cost: _cost, \.\.\.rest \} = item/);
    expect(code).not.toMatch(/cost:\s*0/);
  });
});

describe("the seller's screen never asks for cost either", () => {
  const ROOT = path.join(__dirname, "..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  const SCREEN = read("src/components/seller/SellerSales.tsx");
  const PAGE = read("src/app/seller/sales/page.tsx");

  it("renders the shared table with the cost columns off", () => {
    // The lines carry no cost, so flipping this would print an em dash
    // rather than leak a number -- but three columns of dashes headed
    // "gross profit" and "margin" tell a seller their figures are missing
    // when they were never theirs.
    expect(SCREEN).toMatch(/showCost=\{false\}/);
  });

  it("names no cost field of its own", () => {
    // The stronger guard, and the one that survives someone adding a
    // panel: the seller's screen must not reference these at all.
    for (const field of ["grossProfit", "unitCost", "costCoverage", "moneyOrDash"]) {
      expect([field, SCREEN.includes(field)]).toEqual([field, false]);
    }
    // "margin" only as the CSS property, never as the SalesLine field.
    expect(/\bl\.margin|\bc\.margin|\bkpis\.margin|t\("margin"/.test(SCREEN)).toBe(false);
  });

  it("reads its lines from the seller module, not the owner's", () => {
    // adminSalesData() builds lines WITH costs. Pointing this page at it
    // would hand every store the platform's buying prices in one import.
    expect(PAGE).toMatch(/sellerSalesData/);
    expect(PAGE).not.toMatch(/adminSalesData/);
    expect(PAGE).not.toMatch(/costMap/);
  });

  it("guards itself with the sales feature", () => {
    expect(PAGE).toMatch(/requireSellerFeature\(\s*["']sales["']\s*\)/);
  });
});
