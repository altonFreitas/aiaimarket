import { describe, it, expect } from "vitest";
import { smsEncoding, smsCost, toGsm7 } from "@/lib/sms";

describe("smsEncoding", () => {
  it("keeps plain ASCII in GSM-7", () => {
    expect(smsEncoding("Order CD2026 confirmed. Track it: https://loja.tl/o/x")).toBe("GSM-7");
  });

  it("keeps the accents GSM-7 actually has", () => {
    // é à ì ò ù ñ ü ç are all in the basic alphabet -- flattening them would
    // cost the store nothing and lose the spelling for free.
    expect(smsEncoding("Encomenda confirmada é à ì ò ù ñ ü Ç")).toBe("GSM-7");
  });

  it("drops to UCS-2 on the accents it does not", () => {
    // These are the ones that actually cost money in Tetun and Portuguese.
    for (const ch of ["ó", "í", "ã", "õ", "â", "ê", "á", "ú"]) {
      expect(smsEncoding(`Encomenda ${ch}`), ch).toBe("UCS-2");
    }
  });

  it("treats a curly apostrophe as UCS-2 but a straight one as GSM-7", () => {
    // A phone keyboard or a CMS inserts ’ silently, and it halves capacity.
    expect(smsEncoding("ita'nia")).toBe("GSM-7");
    expect(smsEncoding("ita’nia")).toBe("UCS-2");
  });
});

describe("smsCost", () => {
  it("counts one segment up to 160 GSM-7 characters", () => {
    expect(smsCost("a".repeat(160)).segments).toBe(1);
    expect(smsCost("a".repeat(161)).segments).toBe(2);
  });

  it("counts one segment up to only 70 UCS-2 characters", () => {
    expect(smsCost("ó".repeat(70)).segments).toBe(1);
    expect(smsCost("ó".repeat(71)).segments).toBe(2);
  });

  it("uses the smaller per-segment capacity once a message splits", () => {
    // 153 not 160, because concatenated parts spend room on a header.
    expect(smsCost("a".repeat(306)).segments).toBe(2);
    expect(smsCost("a".repeat(307)).segments).toBe(3);
  });

  it("bills GSM-7 escape characters as two", () => {
    expect(smsCost("€").units).toBe(2);
    expect(smsCost("[]{}").units).toBe(8);
    expect(smsCost("a".repeat(159) + "€").segments).toBe(2);
  });

  it("never reports zero segments for an empty message", () => {
    expect(smsCost("").segments).toBe(1);
  });

  it("reports the room left in the current segment", () => {
    expect(smsCost("a".repeat(100)).remaining).toBe(60);
    expect(smsCost("a".repeat(160)).remaining).toBe(0);
  });

  it("shows the real cost of one stray accent", () => {
    // The whole reason the admin UI shows this: same visible length, twice
    // the price.
    const plain = "a".repeat(150);
    expect(smsCost(plain).segments).toBe(1);
    expect(smsCost(plain + "ó").segments).toBe(3);
  });
});

describe("toGsm7", () => {
  it("strips the accents GSM-7 lacks", () => {
    expect(toGsm7("Telemóvel")).toBe("Telemovel");
    expect(toGsm7("avaliação")).toBe("avaliacao");
    expect(toGsm7("Está confirmada")).toBe("Esta confirmada");
  });

  it("keeps the accents GSM-7 has, rather than flattening for no gain", () => {
    expect(toGsm7("café à noite")).toBe("café à noite");
    expect(toGsm7("Ñ ü ö ä Ç")).toBe("Ñ ü ö ä Ç");
  });

  it("normalises typographic punctuation a keyboard inserts silently", () => {
    expect(toGsm7("ita’nia")).toBe("ita'nia");
    expect(toGsm7("“x” – y…")).toBe('"x" - y...');
  });

  it("actually brings a mixed string back into GSM-7", () => {
    const before = "Enkomenda konfirmadu — haree ita-nia avaliação iha ne’e";
    expect(smsEncoding(before)).toBe("UCS-2");
    expect(smsEncoding(toGsm7(before))).toBe("GSM-7");
  });

  it("leaves plain ASCII untouched", () => {
    const plain = "Order CD2026 confirmed. Track it: https://loja.tl/o/abc?t=x.y";
    expect(toGsm7(plain)).toBe(plain);
  });
});
