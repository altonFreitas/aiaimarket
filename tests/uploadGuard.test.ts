import { describe, it, expect } from "vitest";
import { decodeImageDataUrl, safeFileStem } from "@/lib/uploadGuard";

/** Minimal valid headers for each format the guard accepts. */
function webp(payload = 32): Buffer {
  const b = Buffer.alloc(12 + payload);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  return b;
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG", "ascii"), Buffer.alloc(32)]);

const url = (b: Buffer, mime = "image/webp") => `data:${mime};base64,${b.toString("base64")}`;

describe("decodeImageDataUrl — envelope", () => {
  it("rejects anything that is not a base64 image data URL", () => {
    expect(() => decodeImageDataUrl("https://evil.example/x.webp")).toThrow(/Invalid image/);
    expect(() => decodeImageDataUrl("data:text/html;base64,AAAA")).toThrow(/Invalid image/);
    expect(() => decodeImageDataUrl("data:image/webp,notbase64")).toThrow(/Invalid image/);
    expect(() => decodeImageDataUrl("")).toThrow(/Invalid image/);
    // @ts-expect-error deliberately wrong type at the boundary
    expect(() => decodeImageDataUrl(null)).toThrow(/Invalid image/);
  });
});

describe("decodeImageDataUrl — content sniffing", () => {
  it("accepts genuine WebP, JPEG and PNG", () => {
    expect(decodeImageDataUrl(url(webp())).contentType).toBe("image/webp");
    expect(decodeImageDataUrl(url(JPEG)).contentType).toBe("image/jpeg");
    expect(decodeImageDataUrl(url(PNG)).contentType).toBe("image/png");
  });

  it("reports the REAL format, not the one the client declared", () => {
    // A PNG announced as WebP must be stored as image/png. Trusting the
    // declared type is how a bucket ends up serving mislabelled content.
    const decoded = decodeImageDataUrl(url(PNG, "image/webp"));
    expect(decoded.contentType).toBe("image/png");
    expect(decoded.ext).toBe("png");
  });

  it("rejects a non-image wearing an image mime type", () => {
    const evil = Buffer.from("<?php system($_GET[0]); ?>");
    expect(() => decodeImageDataUrl(url(evil, "image/webp"))).toThrow(/Unsupported image format/);
  });

  it("rejects an empty payload", () => {
    expect(() => decodeImageDataUrl("data:image/webp;base64,")).toThrow(/Invalid image/);
  });
});

describe("decodeImageDataUrl — size cap", () => {
  it("rejects a payload over the ceiling", () => {
    const big = webp(600 * 1024);
    expect(() => decodeImageDataUrl(url(big), 512)).toThrow(/too large/i);
  });

  it("accepts one under it", () => {
    expect(() => decodeImageDataUrl(url(webp(1024)), 512)).not.toThrow();
  });
});

describe("safeFileStem", () => {
  it("cannot produce a path separator or traversal", () => {
    expect(safeFileStem("../../etc/passwd")).not.toContain("/");
    expect(safeFileStem("../../etc/passwd")).not.toContain("..");
    expect(safeFileStem("a/b\\c")).toBe("a-b-c");
  });
  it("strips accents and collapses junk", () => {
    expect(safeFileStem("Fotografía  Bòdik!!")).toBe("fotografia-bodik");
  });
  it("always returns something usable", () => {
    expect(safeFileStem("")).toBe("img");
    expect(safeFileStem("!!!")).toBe("img");
  });
  it("bounds the length", () => {
    expect(safeFileStem("x".repeat(500)).length).toBeLessThanOrEqual(60);
  });
});
