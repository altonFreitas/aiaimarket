import { describe, it, expect } from "vitest";
import { PermissionError, isPermissionError } from "@/lib/permissionError";

describe("PermissionError", () => {
  it("carries the message a person should read", () => {
    const e = new PermissionError("Your account has read-only access, so nothing was saved.");
    expect(e.message).toContain("read-only");
  });

  it("has a one-line stack, so no code frame is printed for it", () => {
    // This is the whole point: Next resolves the topmost stack frame back
    // to source and prints the surrounding lines. No frames, no code frame.
    const e = new PermissionError("nope", "Zita (read-only) tried to change something");
    expect(e.stack).toBe("NotAllowed: Zita (read-only) tried to change something");
    expect(e.stack!.split("\n")).toHaveLength(1);
    expect(e.stack).not.toContain("    at ");
  });

  it("names who was refused, not just what happened", () => {
    const e = new PermissionError("nope", "Zita (read-only) tried to change something");
    expect(e.stack).toContain("Zita");
  });

  it("falls back to the message when no context is given", () => {
    expect(new PermissionError("nope").stack).toBe("NotAllowed: nope");
  });

  it("is recognisable as a refusal rather than a fault", () => {
    expect(isPermissionError(new PermissionError("x"))).toBe(true);
    expect(isPermissionError(new Error("database is on fire"))).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError("read-only")).toBe(false);
    expect(isPermissionError({})).toBe(false);
  });

  it("survives the structured clone a server action response goes through", () => {
    // The class does not cross the wire; the marker property is what a
    // caller on the other side can still see.
    expect(isPermissionError({ permission: true, message: "x" })).toBe(true);
    expect(isPermissionError({ permission: false })).toBe(false);
  });

  it("is still an Error, so every existing catch keeps working", () => {
    expect(new PermissionError("x")).toBeInstanceOf(Error);
  });
});
