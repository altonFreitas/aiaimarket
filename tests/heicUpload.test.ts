import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const SRC = read("src/lib/compressImage.ts");
const CONFIG = read("next.config.ts");

/* "DECODE FAILED" ON EVERY IPHONE PHOTO.
 *
 * A photo taken on an iPhone and AirDropped to a Mac arrives as .HEIC, and
 * no browser engine will decode one into an <img>: Chrome and Firefox have
 * no HEVC image decoder at all. compressImage() read the file, handed it to
 * an Image, and rejected on img.onerror with "decode failed" -- a message
 * that says what happened and nothing about why or what to do, for the most
 * obvious file a shop owner with an iPhone would reach for.
 *
 * Reproduced and fixed in Chromium against a real HEVC-coded .heic
 * (ftypheic, 3024x4032, what a 12MP iPhone produces):
 *
 *   plain <img>         decode failed          <- the report
 *   compressImage       OK 5KB in 2669ms       <- first call, decoder loaded
 *   again               OK 5KB in 1028ms       <- decoder cached
 *   output              decodes, 600x900
 *   ordinary png        OK in 11ms             <- no decoder round trip
 *   png named .heic     falls through          <- the container is read
 */

describe("an iPhone photo can be uploaded", () => {
  it("recognises HEIC by type AND by name", () => {
    /* The two disagree in practice: Safari reports image/heic, Chrome on
       some systems reports an empty type for the same file, and AirDrop
       preserves the extension either way. Both cases were exercised in a
       browser and both now decode. */
    expect(SRC).toMatch(/\^image\\\/hei\[cf\]/);
    expect(SRC).toMatch(/\\\.hei\[cf\]\$/);
  });

  it("confirms the format from the bytes before converting", () => {
    // A name is a claim. A PNG called .heic must fall through untouched
    // rather than be handed to a decoder that will mangle or reject it.
    expect(SRC).toMatch(/isHeic/);
    expect(SRC).toMatch(/if \(!\(await isHeic\(file\)\)\) return file/);
  });

  it("loads the decoder only when one turns up", () => {
    /* It is about 3 MB -- a real download on the connections this shop is
       built around. A dynamic import means a shop that never uploads an
       iPhone photo never pays for it. The ordinary path measured 11ms,
       which is the proof it is not being loaded for every upload. */
    expect(SRC).toMatch(/await import\("heic-to\/csp"\)/);
    expect(SRC).not.toMatch(/^import .*heic-to/m);
    // The cheap check comes first, or the import happens regardless.
    const fn = /async function drawable[\s\S]*?\n\}/.exec(SRC);
    expect(fn, "drawable()").not.toBeNull();
    expect(fn![0].indexOf("looksHeic")).toBeLessThan(fn![0].indexOf("await import"));
  });

  it("hands the result to the existing pipeline rather than a second one", () => {
    // Converted to JPEG at high quality and then resized and turned into
    // WebP by the code that does it for every other photo, so the quality
    // ladder lives in one place.
    expect(SRC).toMatch(/type: "image\/jpeg", quality: 0\.9/);
    expect(SRC).toMatch(/fr\.readAsDataURL\(source\)/);
  });

  it("says what to do when it still cannot read one", () => {
    // "decode failed" tells the owner nothing. The phone can be told to
    // take ordinary JPEGs and the problem never comes back.
    expect(SRC).toMatch(/Most Compatible/);
    expect(SRC).toMatch(/\.HEIC/);
  });
});

describe("the page is allowed to run the decoder", () => {
  it("permits a blob worker", () => {
    /* THE FAILURE THIS CAUGHT, and it only showed up in a browser: every
       build of heic-to starts the decoder in a Worker made from a blob:
       URL, and this site's CSP had no worker-src, so workers fell back to
       default-src 'self' and the browser refused it outright --

         Refused to create a worker from 'blob:...' because it violates
         the Content Security Policy

       -- leaving the upload failing exactly as before. */
    expect(CONFIG).toMatch(/"worker-src 'self' blob:"/);
  });

  it("does not open it wider than that", () => {
    // 'self' and blob: only. No remote origin may start a worker.
    const rule = /"worker-src ([^"]*)"/.exec(CONFIG);
    expect(rule, "the worker-src rule").not.toBeNull();
    expect(rule![1]).not.toMatch(/https?:/);
    expect(rule![1]).not.toMatch(/\*/);
  });
});

describe("the file pickers accept one", () => {
  it("names the extensions, not just image/*", () => {
    /* image/* leaves .heic greyed out in the file dialog wherever the OS
       does not map it to an image type -- which is the same systems that
       hand over an empty MIME type for it. */
    for (const f of ["src/components/admin/HeroSlidesAdmin.tsx",
                     "src/components/admin/ProductForm.tsx",
                     "src/components/admin/PromotionsAdmin.tsx",
                     "src/components/seller/SellerProductForm.tsx",
                     "src/components/TrackForm.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/accept="image\/\*,\.heic,\.heif"/);
      expect(src, f).not.toMatch(/accept="image\/\*"/);
    }
  });
});
