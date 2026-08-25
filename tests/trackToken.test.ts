import { describe, it, expect, beforeAll } from "vitest";
import { issueTrackToken, verifyTrackToken, trackingUrl } from "@/lib/trackToken";

const REF = "CD20261234567890";
const PHONE = "+67077123456";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-value-not-used-anywhere-real";
});

describe("issueTrackToken / verifyTrackToken", () => {
  it("accepts a token it just issued", () => {
    const token = issueTrackToken(REF, PHONE);
    expect(verifyTrackToken(REF, PHONE, token)).toEqual({ ok: true });
  });

  it("rejects a token issued for a different order", () => {
    // The whole point of binding the MAC to the reference: a buyer cannot
    // edit their own link into someone else's order.
    const token = issueTrackToken(REF, PHONE);
    expect(verifyTrackToken("CD20269999999999", PHONE, token).ok).toBe(false);
  });

  it("rejects a token issued for a different phone", () => {
    const token = issueTrackToken(REF, PHONE);
    expect(verifyTrackToken(REF, "+67077999999", token).ok).toBe(false);
  });

  it("rejects a tampered MAC", () => {
    const token = issueTrackToken(REF, PHONE);
    const [iat, mac] = token.split(".");
    const flipped = mac[0] === "a" ? "b" : "a";
    expect(verifyTrackToken(REF, PHONE, `${iat}.${flipped}${mac.slice(1)}`).ok).toBe(false);
  });

  it("rejects a token whose timestamp was moved to extend its life", () => {
    // The timestamp is inside the MAC, so re-dating a token invalidates it.
    const token = issueTrackToken(REF, PHONE, 1_000_000);
    const mac = token.split(".")[1];
    expect(verifyTrackToken(REF, PHONE, `${(9_000_000).toString(36)}.${mac}`).ok).toBe(false);
  });

  it("expires after 120 days", () => {
    const issued = Date.now();
    const token = issueTrackToken(REF, PHONE, issued);
    const day = 24 * 60 * 60 * 1000;
    expect(verifyTrackToken(REF, PHONE, token, issued + 119 * day)).toEqual({ ok: true });
    expect(verifyTrackToken(REF, PHONE, token, issued + 121 * day))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token dated in the future beyond clock skew", () => {
    const now = Date.now();
    const token = issueTrackToken(REF, PHONE, now + 10 * 60_000);
    expect(verifyTrackToken(REF, PHONE, token, now).ok).toBe(false);
  });

  it("tolerates small clock skew rather than rejecting a fresh link", () => {
    const now = Date.now();
    const token = issueTrackToken(REF, PHONE, now + 5_000);
    expect(verifyTrackToken(REF, PHONE, token, now)).toEqual({ ok: true });
  });

  it("rejects malformed tokens without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so short input has to be
    // length-checked first -- a crash here would be a 500 on a real link.
    for (const bad of ["", ".", "abc", "abc.", ".abc", "abc.def", "....", "a".repeat(500)]) {
      expect(() => verifyTrackToken(REF, PHONE, bad)).not.toThrow();
      expect(verifyTrackToken(REF, PHONE, bad).ok).toBe(false);
    }
  });

  it("issues a different token each time, but all of them verify", () => {
    const a = issueTrackToken(REF, PHONE, 1_700_000_000_000);
    const b = issueTrackToken(REF, PHONE, 1_700_000_001_000);
    expect(a).not.toBe(b);
    expect(verifyTrackToken(REF, PHONE, a, 1_700_000_002_000).ok).toBe(true);
    expect(verifyTrackToken(REF, PHONE, b, 1_700_000_002_000).ok).toBe(true);
  });
});

describe("trackingUrl", () => {
  it("builds an absolute link with the token attached", () => {
    const url = trackingUrl(REF, PHONE, "https://loja.tl");
    expect(url.startsWith("https://loja.tl/o/" + REF + "?t=")).toBe(true);
  });

  it("never puts the phone number in the URL", () => {
    // It would otherwise leak into WhatsApp previews, browser history and
    // any Referer header the tracking page emits.
    const url = trackingUrl(REF, PHONE, "https://loja.tl");
    expect(url).not.toContain("77123456");
    expect(url).not.toContain(encodeURIComponent(PHONE));
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(trackingUrl(REF, PHONE, "https://loja.tl/")).toContain("https://loja.tl/o/");
    expect(trackingUrl(REF, PHONE, "https://loja.tl/")).not.toContain("//o/");
  });
});
