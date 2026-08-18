import "server-only";

/** Every upload in this app arrives as a base64 data URL produced by
 * compressImage() in the browser. That makes the browser the only thing
 * deciding what lands in Supabase Storage — which is fine for an honest
 * user and worthless as a control. These four upload actions previously
 * did:
 *
 *     const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
 *
 * with no length check (a 100 MB string is decoded into the function's
 * memory before anything else happens) and no content check (the bytes
 * were stored as image/webp whatever they actually were).
 *
 * This validates the envelope, caps the size, and sniffs the real format
 * from its magic bytes so the stored contentType matches reality. */

const MAGIC: Array<{ type: string; ext: string; test: (b: Buffer) => boolean }> = [
  {
    type: "image/webp", ext: "webp",
    test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    type: "image/jpeg", ext: "jpg",
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "image/png", ext: "png",
    test: (b) => b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG",
  },
];

export interface DecodedImage {
  bytes: Buffer;
  contentType: string;
  ext: string;
}

/**
 * @param dataUrl the `data:image/...;base64,...` string from the browser
 * @param maxKB   hard ceiling; compressImage() targets 200 KB, so 512 is
 *                generous headroom rather than a real constraint
 */
export function decodeImageDataUrl(dataUrl: string, maxKB = 512): DecodedImage {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid image upload");
  }

  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).includes(";base64")) {
    throw new Error("Invalid image upload");
  }

  const b64 = dataUrl.slice(comma + 1);
  // Check the ENCODED length first — decoding is what costs memory, so the
  // cap has to be applied before Buffer.from(), not after.
  if ((b64.length * 3) / 4 > maxKB * 1024) {
    throw new Error(`Image is too large (max ${maxKB} KB)`);
  }

  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) throw new Error("Invalid image upload");

  const match = MAGIC.find((m) => m.test(bytes));
  if (!match) throw new Error("Unsupported image format — use WebP, JPEG or PNG");

  return { bytes, contentType: match.type, ext: match.ext };
}

/** Filesystem-safe path segment. Storage keys are not a filesystem, but
 * "/" and ".." in a key still put the object somewhere you didn't intend. */
export function safeFileStem(hint: string): string {
  return (hint || "img")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "img";
}
