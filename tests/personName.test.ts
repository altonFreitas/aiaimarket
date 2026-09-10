import { describe, it, expect } from "vitest";
import { normalizeName, personName } from "@/lib/personName";

describe("normalizeName", () => {
  it("makes one customer out of three spellings of one name", () => {
    // The whole point. Same phone, three orders, three ways of typing it.
    const spellings = ["Zita Felicia", "Zita fElicia", "zita  felicia", " ZITA FELICIA "];
    expect(new Set(spellings.map(normalizeName)).size).toBe(1);
    expect(normalizeName(spellings[0])).toBe("ZITA FELICIA");
  });

  it("collapses whatever whitespace was typed", () => {
    expect(normalizeName("Zita\t\n  Maia")).toBe("ZITA MAIA");
  });

  it("upper-cases Portuguese and Tetun diacritics", () => {
    expect(normalizeName("joão da conceição")).toBe("JOÃO DA CONCEIÇÃO");
    expect(normalizeName("Ná'ak Loron")).toBe("NÁ'AK LORON");
  });

  it("is unchanged by running twice", () => {
    // It is applied at checkout AND again when the sales screens read an
    // older order, so it has to be safe to apply to its own output.
    const once = normalizeName("Zita Felicia");
    expect(normalizeName(once)).toBe(once);
  });

  it("leaves an empty name empty rather than inventing one", () => {
    // Orders placed before this existed have no name at all; the screens
    // render that as an em dash, which a "—" invented here would break.
    expect(normalizeName("")).toBe("");
    expect(normalizeName("   ")).toBe("");
  });
});

describe("personName", () => {
  it("joins the two boxes", () => {
    expect(personName("Zita", "Felicia")).toBe("ZITA FELICIA");
  });

  it("does not leave a hanging space when somebody has one name", () => {
    expect(personName("Zita", "")).toBe("ZITA");
    expect(personName("", "Felicia")).toBe("FELICIA");
  });

  it("keeps a two-part surname as typed", () => {
    expect(personName("Maria", "da Silva Pereira")).toBe("MARIA DA SILVA PEREIRA");
  });
});
