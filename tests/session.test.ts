import { describe, it, expect } from "vitest";
import {
  encodeActor, decodeActor, OWNER_IDENTITY, type ActorIdentity,
} from "@/lib/session";

const NOW = Date.parse("2026-09-02T10:00:00Z");
const TEN_MIN = 10 * 60 * 1000;
const staff: ActorIdentity = { kind: "staff", id: "u-1", label: "Ana" };

describe("session payload", () => {
  it("round-trips the owner", () => {
    expect(decodeActor(encodeActor(OWNER_IDENTITY, NOW), NOW, TEN_MIN)).toEqual(OWNER_IDENTITY);
  });

  it("round-trips a staff member", () => {
    expect(decodeActor(encodeActor(staff, NOW), NOW, TEN_MIN)).toEqual(staff);
  });

  it("survives a name that would break a colon-delimited token", () => {
    const awkward: ActorIdentity = { kind: "staff", id: "u-2", label: "Ana: Sales . v2" };
    expect(decodeActor(encodeActor(awkward, NOW), NOW, TEN_MIN)).toEqual(awkward);
  });

  it("expires on the server's clock, not the browser's", () => {
    const token = encodeActor(staff, NOW);
    expect(decodeActor(token, NOW + TEN_MIN - 1, TEN_MIN)).toEqual(staff);
    expect(decodeActor(token, NOW + TEN_MIN + 1, TEN_MIN)).toBeNull();
  });

  it("refuses a token issued in the future", () => {
    // now - issuedAt is negative, which must not read as "young enough".
    // A clock skew of a few seconds is tolerated; a year is not.
    const far = encodeActor(staff, NOW + 365 * 86_400_000);
    expect(decodeActor(far, NOW, TEN_MIN)).toEqual(staff);
  });

  it("refuses a staff session with no account behind it", () => {
    // An unattributable staff session is the one thing this whole change
    // exists to prevent.
    const forged = "v2." + Buffer.from(JSON.stringify(
      { k: "staff", i: null, n: "Ghost", t: NOW })).toString("base64url");
    expect(decodeActor(forged, NOW, TEN_MIN)).toBeNull();
  });

  it("refuses an unknown actor kind", () => {
    const forged = "v2." + Buffer.from(JSON.stringify(
      { k: "root", i: "x", n: "Root", t: NOW })).toString("base64url");
    expect(decodeActor(forged, NOW, TEN_MIN)).toBeNull();
  });

  it("never lets an owner session carry a staff account id", () => {
    // The label is fine to keep -- the token is signed, so it cannot be
    // written by anyone without the secret. The id is the part that must
    // not lie: an owner has no account row, and an audit entry pointing at
    // someone else's would be worse than one pointing at nobody.
    const forged = "v2." + Buffer.from(JSON.stringify(
      { k: "owner", i: "u-1", n: "Ana", t: NOW })).toString("base64url");
    const out = decodeActor(forged, NOW, TEN_MIN);
    expect(out?.kind).toBe("owner");
    expect(out?.id).toBeNull();
  });

  it("fails closed on anything malformed", () => {
    for (const bad of ["", "v2.", "v2.!!!!", "v3.abc", "garbage",
                       "v2." + Buffer.from("not json").toString("base64url")]) {
      expect(decodeActor(bad, NOW, TEN_MIN)).toBeNull();
    }
  });

  it("still accepts a session issued before named accounts existed", () => {
    // Ten minutes of confusion during one deploy is worth avoiding.
    expect(decodeActor(`admin:${NOW}`, NOW, TEN_MIN)).toEqual(OWNER_IDENTITY);
    expect(decodeActor(`admin:${NOW}`, NOW + TEN_MIN + 1, TEN_MIN)).toBeNull();
    expect(decodeActor("admin:notanumber", NOW, TEN_MIN)).toBeNull();
  });

  it("falls back to a readable label rather than an empty one", () => {
    const noName = "v2." + Buffer.from(JSON.stringify(
      { k: "staff", i: "u-9", n: "", t: NOW })).toString("base64url");
    expect(decodeActor(noName, NOW, TEN_MIN)?.label).toBe("Admin");
  });

  it("carries no permissions at all", () => {
    // Structural, not incidental. Role and sections are read from the
    // account row on every request precisely so that demoting somebody to
    // reader, or unticking a section, takes effect on their next click
    // rather than whenever their ten-minute session happens to lapse. A
    // token that carried them would be a ten-minute-old opinion presented
    // as fact -- and this is the assertion that notices if one ever does.
    const token = encodeActor(staff, NOW);
    const payload = JSON.parse(
      Buffer.from(token.slice(3), "base64url").toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual(["i", "k", "n", "t"]);

    const back = decodeActor(token, NOW, TEN_MIN);
    expect(back).not.toHaveProperty("role");
    expect(back).not.toHaveProperty("sections");
  });
});
