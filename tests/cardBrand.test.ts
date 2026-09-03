import { describe, it, expect } from "vitest";
import {
  detectCardBrand, luhnValid, digitsOnly, formatCardNumber, describeCard,
} from "@/lib/cardBrand";

/* The numbers below are the schemes' own published test numbers. They are
 * not real cards and cannot be charged. */
const TEST_CARDS: Array<[string, string, string]> = [
  ["4242424242424242", "visa", "Visa"],
  ["4000056655665556", "visa", "Visa"],
  ["4111111111111111", "visa", "Visa"],
  ["5555555555554444", "mastercard", "Mastercard"],
  ["5200828282828210", "mastercard", "Mastercard"],
  ["2223003122003222", "mastercard", "Mastercard"],   // the 2-series range
  ["378282246310005", "amex", "American Express"],
  ["371449635398431", "amex", "American Express"],
  ["6011111111111117", "discover", "Discover"],
  ["6011000990139424", "discover", "Discover"],
  ["3566002020360505", "jcb", "JCB"],
  ["3056930009020004", "diners", "Diners Club"],
  ["36227206271667", "diners", "Diners Club"],
  ["6200000000000005", "unionpay", "UnionPay"],
  ["6759649826438453", "maestro", "Maestro"],
];

describe("detectCardBrand", () => {
  it.each(TEST_CARDS)("reads %s as %s", (number, brand, label) => {
    const info = detectCardBrand(number);
    expect(info?.brand).toBe(brand);
    expect(info?.label).toBe(label);
  });

  it("recognises a brand from the opening digits alone", () => {
    // What a hosted field reports while somebody is still typing.
    expect(detectCardBrand("4")?.brand).toBe("visa");
    expect(detectCardBrand("51")?.brand).toBe("mastercard");
    expect(detectCardBrand("34")?.brand).toBe("amex");
  });

  it("waits until it can actually tell", () => {
    // "2" alone is not yet Mastercard's 2221-2720. Claiming it and then
    // changing the icon under the shopper's fingers is worse than waiting.
    expect(detectCardBrand("2")).toBeNull();
    expect(detectCardBrand("22")).toBeNull();
    expect(detectCardBrand("222")).toBeNull();
    expect(detectCardBrand("2221")?.brand).toBe("mastercard");
    expect(detectCardBrand("2220")).toBeNull();   // just below the range
    expect(detectCardBrand("2720")?.brand).toBe("mastercard");
    expect(detectCardBrand("2721")).toBeNull();   // just above it
  });

  it("puts the overlapping ranges on the right side of the line", () => {
    // Every one of these sits inside a broader rule that would have
    // swallowed it had the order been different.
    expect(detectCardBrand("3528")?.brand).toBe("jcb");      // inside 3x
    expect(detectCardBrand("3589")?.brand).toBe("jcb");
    // 3590-3599 belongs to nobody: JCB stops at 3589 and Diners is
    // 300-305, 3095, 36 and 38-39. Reporting a brand here would be
    // inventing one.
    expect(detectCardBrand("3590")).toBeNull();
    expect(detectCardBrand("36")?.brand).toBe("diners");
    expect(detectCardBrand("38")?.brand).toBe("diners");
    expect(detectCardBrand("305")?.brand).toBe("diners");
    expect(detectCardBrand("306")).toBeNull();               // 300-305 only
    expect(detectCardBrand("6011")?.brand).toBe("discover"); // inside 6x
    expect(detectCardBrand("644")?.brand).toBe("discover");
    expect(detectCardBrand("649")?.brand).toBe("discover");
    expect(detectCardBrand("650")?.brand).toBe("discover");  // 65
    expect(detectCardBrand("62")?.brand).toBe("unionpay");
    expect(detectCardBrand("6759")?.brand).toBe("maestro");  // inside 67
  });

  it("ignores the spaces and dashes people and gateways send", () => {
    expect(detectCardBrand("4242 4242 4242 4242")?.brand).toBe("visa");
    expect(detectCardBrand("3782-822463-10005")?.brand).toBe("amex");
  });

  it("returns nothing for what is not a card number", () => {
    for (const junk of ["", "   ", "abcd", "0000", "1234", "9999999999999999"]) {
      expect(detectCardBrand(junk)).toBeNull();
    }
  });

  it("knows Amex takes a four-digit code and groups differently", () => {
    const amex = detectCardBrand("378282246310005")!;
    expect(amex.cvcLength).toBe(4);
    expect(amex.lengths).toEqual([15]);
    const visa = detectCardBrand("4242424242424242")!;
    expect(visa.cvcLength).toBe(3);
  });
});

describe("luhnValid", () => {
  it.each(TEST_CARDS)("accepts the published test number %s", (number) => {
    expect(luhnValid(number)).toBe(true);
  });

  it("rejects a number with one digit mistyped", () => {
    // The entire point: a transposed or wrong digit is caught before the
    // shopper is sent to the gateway to be told no.
    expect(luhnValid("4242424242424243")).toBe(false);
    expect(luhnValid("5555555555554445")).toBe(false);
    expect(luhnValid("378282246310006")).toBe(false);
  });

  it("rejects two transposed digits", () => {
    expect(luhnValid("4000056655665565")).toBe(false);
  });

  it("rejects something too short to be a card at all", () => {
    for (const s of ["", "4", "42424242", "40000566556"]) {
      expect(luhnValid(s)).toBe(false);
    }
  });

  it("does not treat all-zeroes as valid", () => {
    // Sums to zero, which is divisible by ten. A naive implementation says
    // yes; a card number of sixteen zeroes is not a card.
    expect(luhnValid("0000000000000000")).toBe(false);
  });
});

describe("formatCardNumber", () => {
  it("groups most schemes in fours", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
  });

  it("groups Amex the way Amex prints it", () => {
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
  });

  it("groups Diners the same way", () => {
    expect(formatCardNumber("36227206271667")).toBe("3622 720627 1667");
  });

  it("groups as it goes, without waiting for a full number", () => {
    expect(formatCardNumber("424242")).toBe("4242 42");
    expect(formatCardNumber("4242")).toBe("4242");
  });

  it("survives an empty string", () => {
    expect(formatCardNumber("")).toBe("");
  });
});

describe("describeCard", () => {
  it("names a card by scheme and last four", () => {
    expect(describeCard("visa", "4242")).toBe("Visa ···· 4242");
    expect(describeCard("amex", "0005")).toBe("American Express ···· 0005");
  });

  it("takes only the last four even if handed more", () => {
    // Belt and braces. If a full number ever reaches this by mistake, it
    // must not be what gets printed on the page.
    expect(describeCard("visa", "4242424242424242")).toBe("Visa ···· 4242");
  });

  it("falls back to something readable with no brand or no digits", () => {
    expect(describeCard(null, "4242")).toBe("Card ···· 4242");
    expect(describeCard("visa", "")).toBe("Visa");
  });
});

describe("digitsOnly", () => {
  it("keeps only digits", () => {
    expect(digitsOnly("4242-4242 4242.4242")).toBe("4242424242424242");
    expect(digitsOnly("no digits here")).toBe("");
  });
});
