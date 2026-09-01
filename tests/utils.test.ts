import { describe, it, expect } from "vitest";
import { money, discountPercent, slugify, phoneOk, phoneNorm, addrLine, waLink, sum, orderRef } from "@/lib/utils";

describe("money", () => {
  it("always renders two decimals", () => {
    expect(money(5)).toBe("$5.00");
    expect(money(19.99)).toBe("$19.99");
    expect(money("12.5")).toBe("$12.50");
  });
  it("degrades to $0.00 rather than NaN", () => {
    expect(money("banana")).toBe("$0.00");
  });
  it("groups thousands, so six-figure totals can be read not counted", () => {
    expect(money(284610.05)).toBe("$284,610.05");
    expect(money(1000)).toBe("$1,000.00");
    expect(money(999.99)).toBe("$999.99");
  });
  it("groups negatives too, sign first", () => {
    expect(money(-1234.5)).toBe("$-1,234.50");
  });
});

describe("discountPercent", () => {
  it("computes a whole-number percentage off", () => {
    expect(discountPercent(100, 75)).toBe(25);
    expect(discountPercent(19.99, 9.99)).toBe(50);
  });
  it("returns null when there is no real discount", () => {
    expect(discountPercent(100, null)).toBeNull();
    expect(discountPercent(100, 0)).toBeNull();
    expect(discountPercent(100, 100)).toBeNull();  // not lower
    expect(discountPercent(100, 150)).toBeNull();  // higher
    expect(discountPercent(0, 10)).toBeNull();     // no base price
  });
});

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Kamiza Bòdik")).toBe("kamiza-bodik");
    expect(slugify("Men's Shoes!")).toBe("mens-shoes");
  });
  it("never leaves leading or trailing dashes", () => {
    expect(slugify("  hello  ")).toBe("hello");
    expect(slugify("---x---")).toBe("x");
  });
  it("caps length so a slug cannot grow unbounded", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("phoneOk / phoneNorm", () => {
  it("accepts a bare 8-digit Timor local number", () => {
    expect(phoneOk("77123456")).toBe(true);
    expect(phoneNorm("77123456")).toBe("+67077123456");
  });
  it("accepts full international numbers", () => {
    expect(phoneOk("+670 7712 3456")).toBe(true);
    expect(phoneOk("+61412345678")).toBe(true);
  });
  it("rejects too short and too long", () => {
    expect(phoneOk("1234")).toBe(false);
    expect(phoneOk("1".repeat(16))).toBe(false);
    expect(phoneOk("")).toBe(false);
  });
  it("normalizes identically regardless of formatting", () => {
    expect(phoneNorm("+670 7712-3456")).toBe(phoneNorm("67077123456"));
  });
});

describe("addrLine", () => {
  it("prefers a street address when present", () => {
    expect(addrLine({ address_line: "Rua X", landmark: "near church", suku: "S" }))
      .toBe("Rua X, near church");
  });
  it("falls back to the rural hierarchy", () => {
    expect(addrLine({ landmark: "L", aldeia: "A", suku: "S", post: "P", municipality: "M" }))
      .toBe("L, A, S, P, M");
  });
  it("skips empty parts instead of leaving stray commas", () => {
    expect(addrLine({ landmark: "L", municipality: "M" })).toBe("L, M");
  });
});

describe("waLink", () => {
  it("percent-encodes the message so it survives the URL", () => {
    const link = waLink("670771", "a b&c?d");
    expect(link).toContain("https://wa.me/670771?text=");
    expect(link).not.toContain(" ");
    expect(link).toContain("%26");
  });
});

describe("sum", () => {
  it("adds a projection over a list", () => {
    expect(sum([{ n: 1 }, { n: 2 }], (x) => x.n)).toBe(3);
    expect(sum([], (x: { n: number }) => x.n)).toBe(0);
  });
});

describe("orderRef", () => {
  it("is prefix + year + last 4 phone digits + 6 random digits", () => {
    //          CD  2026  5678  041932
    expect(orderRef("CD", "+67077125678", 2026, 41932)).toBe("CD20265678041932");
  });

  it("builds a pre-order reference", () => {
    expect(orderRef("PRO", "+67077125678", 2026, 119004)).toBe("PRO20265678119004");
  });

  it("builds delivery and pickup references from the same parts", () => {
    expect(orderRef("CD", "+67077125678", 2026, 41932)).toBe("CD20265678041932");
    expect(orderRef("PP", "+67077125678", 2026, 887201)).toBe("PP20265678887201");
  });

  it("pads the random tail to six digits", () => {
    expect(orderRef("PRO", "+6707712345678", 2026, 7)).toBe("PRO20265678000007");
  });

  it("pads a short phone rather than failing to make a reference", () => {
    expect(orderRef("PRO", "12", 2026, 123456)).toBe("PRO20260012123456");
  });

  it("ignores non-digits in the phone", () => {
    expect(orderRef("PP", "+670 7712-5678", 2026, 1)).toBe("PP20265678000001");
  });

  it("keeps the tail six digits even when handed a larger number", () => {
    // A caller passing an unbounded value must not stretch the reference.
    expect(orderRef("PRO", "+67077125678", 2026, 7_654_321)).toHaveLength("PRO".length + 4 + 4 + 6);
  });

  it("varies in length only by the prefix", () => {
    const pro = orderRef("PRO", "+67077125678", 2026, 1);
    const cd = orderRef("CD", "+67077125678", 2026, 1);
    expect(pro).toHaveLength(3 + 4 + 4 + 6);   // PRO 2026 5678 000001
    expect(cd).toHaveLength(2 + 4 + 4 + 6);
    expect(pro.slice(3)).toBe(cd.slice(2));    // everything after differs not at all
  });
});
