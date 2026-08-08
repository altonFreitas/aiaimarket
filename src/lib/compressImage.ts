"use client";

/** Resizes + converts to WebP client-side, targeting a 200KB ceiling
 * before anything reaches the network — mobile data is a direct cost to
 * both seller and buyer (Epic B6, non-negotiable per the spec). */
export function compressImage(
  file: File,
  maxPx = 1200,
  maxKB = 200
): Promise<{ data: string; kb: number }> {
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
    fr.readAsDataURL(file);
  });
}
