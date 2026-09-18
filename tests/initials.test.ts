import { describe, it, expect } from "vitest";
import { emailInitials } from "@/lib/initials";

describe("the two letters in place of a face", () => {
  it("takes them from the name, not the domain", () => {
    /* Everyone at one company would otherwise share an avatar, and "GM"
       tells a person nothing about whether they are signed in as
       themselves. */
    expect(emailInitials("altonfreitas23@gmail.com")).toBe("AL");
    expect(emailInitials("zita@example.tl")).toBe("ZI");
  });

  it("skips punctuation a badge cannot show", () => {
    // An address may begin with a dot or a plus, and a badge reading "."
    // is not an identity.
    expect(emailInitials(".maria@x.com")).toBe("MA");
    expect(emailInitials("j+shop@x.com")).toBe("JS");
    expect(emailInitials("a_b@x.com")).toBe("AB");
  });

  it("copes with a single letter", () => {
    expect(emailInitials("z@x.com")).toBe("Z");
  });

  it("gives nothing back rather than an empty badge", () => {
    // The caller falls back to the person icon.
    for (const e of ["", null, undefined, "+++@x.com", "@x.com"]) {
      expect(emailInitials(e)).toBe("");
    }
  });
});
