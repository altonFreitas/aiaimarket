/** Hands the browser a file the server built.
 *
 * A server action can only return data, so every export in this app comes
 * back as base64 and is turned into a download here. Written once because
 * it was written twice: the statistics button and the purchase order
 * button did the same eleven lines, and the second copy is where the
 * revoked object URL gets forgotten.
 *
 * Uint8Array.from over atob rather than fetch("data:…"): the file can be
 * several megabytes, and a data URL that size is refused outright by some
 * browsers.
 */
export function downloadBase64(base64: string, filename: string, mime: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
