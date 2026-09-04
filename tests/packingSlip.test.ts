import { describe, it, expect } from "vitest";
import { amountToCollect, addressLines } from "@/lib/pdfPackingSlip";
import type { Order, Settings } from "@/lib/types";

const order = (o: Partial<Order>): Order => ({
  id: "o1", ref: "ORD-0001", buyer_name: "Ana", buyer_phone: "7712345",
  mode: "delivery", status: "confirmed", total: 32,
  pay_method: "cod", pay_status: "unpaid",
  address_line: "Rua de Caicoli 12", landmark: "beside the blue church",
  aldeia: "Aldeia A", suku: "Caicoli", post: "Vera Cruz", municipality: "Dili",
  items: [], ...o,
} as Order);

describe("what money appears on a delivery note", () => {
  /* A packing slip travels through several hands before it reaches the
   * buyer, and none of them need to know what anything cost. The exception
   * is cash on delivery, where the amount to collect IS the instruction. */

  it("prints the amount when the driver has to collect cash", () => {
    expect(amountToCollect(order({ pay_method: "cod", pay_status: "unpaid" }))).toBe(32);
    expect(amountToCollect(order({ pay_method: "cop", pay_status: "unpaid" }))).toBe(32);
  });

  it("prints nothing once the order is already paid", () => {
    // Same method, settled. Nothing to hand over, so no figures at all.
    expect(amountToCollect(order({ pay_method: "cod", pay_status: "paid" }))).toBeNull();
  });

  it("prints nothing for a method that never collects at the door", () => {
    for (const m of ["bank", "wallet", "card"] as const) {
      expect([m, amountToCollect(order({ pay_method: m, pay_status: "unpaid" }))])
        .toEqual([m, null]);
    }
  });

  it("treats a missing total as nothing owed rather than NaN", () => {
    expect(amountToCollect(order({ total: undefined as unknown as number }))).toBe(0);
  });
});

describe("the address a driver actually reads", () => {
  it("puts the street first and the landmark with it", () => {
    const lines = addressLines(order({}));
    expect(lines[0]).toBe("Rua de Caicoli 12");
    expect(lines[1]).toBe("Landmark: beside the blue church");
  });

  it("returns lines, not one comma-separated run", () => {
    // An address is read down a page. Joined into a sentence, the landmark
    // ends up buried in the middle of it.
    const lines = addressLines(order({}));
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l).not.toMatch(/^,|,$/);
  });

  it("drops the parts that are empty instead of leaving gaps", () => {
    const lines = addressLines(order({
      landmark: "", aldeia: "", post: "", suku: "Caicoli", municipality: "Dili",
    }));
    expect(lines).toEqual(["Rua de Caicoli 12", "Caicoli", "Dili"]);
    expect(lines.some((l) => l.trim() === "")).toBe(false);
  });

  it("says so plainly when the order is a collection", () => {
    // A driver holding this must not set off for the buyer's house.
    const s = { suku: "Caicoli", municipality: "Dili" } as Settings;
    const lines = addressLines(order({ mode: "pickup" }), s);
    expect(lines[0]).toMatch(/COLLECTION/);
    expect(lines.join(" ")).not.toContain("Rua de Caicoli 12");
  });

  it("still names the collection point with no settings to hand", () => {
    expect(addressLines(order({ mode: "pickup" }))).toEqual(["COLLECTION FROM THE SHOP"]);
  });
});
