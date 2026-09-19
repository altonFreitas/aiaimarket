"use client";

/** Does this file look like an iPhone photo the browser cannot open?
 *
 * A photo taken on an iPhone and AirDropped to a Mac arrives as .HEIC,
 * and no browser engine will decode one into an <img>: Chrome and Firefox
 * have no HEVC image decoder at all. So every such upload failed on
 * img.onerror with "decode failed" -- an error that says what happened and
 * nothing about why or what to do, for the most obvious file a shop owner
 * with an iPhone would reach for.
 *
 * Checked by type AND by name, because the two disagree in practice:
 * Safari reports image/heic, Chrome on some systems reports an empty type
 * for the same file, and AirDrop preserves the .HEIC extension either way.
 * Getting this wrong only costs a wasted check -- the decoder confirms the
 * format from the bytes before it does anything. */
function looksHeic(file: File): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** The file, as something a canvas can draw.
 *
 * HEIC goes through a decoder loaded ONLY when one turns up. It is about
 * 3 MB -- a real download on the connections this shop is built around --
 * so it is a dynamic import rather than part of the bundle: a shop that
 * never uploads an iPhone photo never pays for it, and one that does pays
 * once, on an admin screen, from the machine the photos are on.
 *
 * Converted to JPEG at high quality rather than straight to the final
 * size: this hands the existing pipeline below an ordinary image and lets
 * it do the resizing and the WebP conversion exactly as it does for every
 * other photo, so there is one place where the quality ladder lives. */
async function drawable(file: File): Promise<Blob> {
  if (!looksHeic(file)) return file;
  /* THE /csp BUILD, NOT THE DEFAULT ONE. The default spins the decoder up
     in a Worker created from a blob: URL, and this site sends a Content
     Security Policy with no worker-src -- so workers fall back to
     default-src 'self' and the browser refuses the blob outright:

       Refused to create a worker from 'blob:...' because it violates the
       Content Security Policy

     which is what the first attempt at this actually did, caught by
     running it in a browser. The alternative was adding
     `worker-src 'self' blob:` to the CSP of a shop that takes card
     payments, to decode a photograph. This build does not need it. */
  const { heicTo, isHeic } = await import("heic-to/csp");
  // The name and the type are both claims; this reads the container.
  if (!(await isHeic(file))) return file;
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
}

/** Resizes + converts to WebP client-side, targeting a 200KB ceiling
 * before anything reaches the network — mobile data is a direct cost to
 * both seller and buyer (Epic B6, non-negotiable per the spec). */
export async function compressImage(
  file: File,
  maxPx = 1200,
  maxKB = 200
): Promise<{ data: string; kb: number }> {
  let source: Blob;
  try {
    source = await drawable(file);
  } catch {
    /* The decoder is the only thing that can open this, and it did not.
       Said plainly, with the way out: the phone can be told to take
       ordinary JPEGs and the problem never comes back. */
    throw new Error(
      "This iPhone photo (.HEIC) could not be read. On the phone: " +
      "Settings > Camera > Formats > Most Compatible, or export it as " +
      "JPEG first.");
  }

  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read failed"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        let cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);

        let type = "image/webp";
        if (cv.toDataURL(type, 0.5).indexOf("data:image/webp") !== 0) type = "image/jpeg";
        let q = 0.82;
        let out = "";
        for (let i = 0; i < 8; i++) {
          out = cv.toDataURL(type, q);
          if ((out.length * 0.75) / 1024 <= maxKB) break;
          q -= 0.09;
          if (q < 0.35) {
            const c2 = document.createElement("canvas");
            c2.width = Math.round(cv.width * 0.8);
            c2.height = Math.round(cv.height * 0.8);
            c2.getContext("2d")!.drawImage(cv, 0, 0, c2.width, c2.height);
            cv = c2;
            q = 0.72;
          }
        }
        resolve({ data: out, kb: Math.round((out.length * 0.75) / 1024) });
      };
      img.src = fr.result as string;
    };
    fr.readAsDataURL(source);
  });
}
