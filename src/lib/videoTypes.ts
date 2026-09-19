/** WHICH VIDEO FILES THE HERO CAROUSEL TAKES, and what each is stored as.
 *
 * Its own module rather than a helper inside lib/actions/hero.ts, because
 * that file is "use server": every export of a Server Action module has to
 * be an async function, so a plain synchronous lookup cannot live there.
 * Out here it is also directly testable, which the thing deciding what the
 * shop will and will not accept ought to be.
 */

/** MP4 AND WEBM play everywhere this shop is opened. QUICKTIME IS HERE FOR
 * THE PHONE THE SHOP IS RUN FROM: a video recorded on an iPhone and sent
 * to a Mac arrives as .MOV, and refusing it meant the owner had to find a
 * converter before they could put their own footage on their own
 * homepage. The container is almost always H.264/AAC, which every current
 * browser plays out of a .mov perfectly well.
 *
 * The exception, and it is worth knowing: an iPhone set to "High
 * Efficiency" records HEVC (H.265), which Safari plays and Chrome and
 * Firefox generally do not. Nothing here can tell the two apart -- the
 * container is identical and only the codec inside differs -- so the hint
 * under the upload button says to check the slide afterwards, which is the
 * honest version of a guarantee this cannot make. Recording in "Most
 * Compatible" on the phone avoids it entirely. */
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** The same list by file extension, for the browsers that hand over an
 * empty or invented type. Some send "" for a .mov; some send "video/mov",
 * which is not a registered media type at all. Falling back to the name is
 * not a security decision -- the upload is scoped to a single path the
 * server chose either way -- it just stops a legitimate file being refused
 * over a header the browser guessed wrong. */
const VIDEO_EXTS: Record<string, string> = {
  mp4: "mp4", webm: "webm", mov: "mov", qt: "mov",
};

/** What this upload will be stored as, or null if it is not a video this
 * shop takes. The declared type first, then the filename. */
export function videoExtFor(contentType: string, filename: string): string | null {
  const byType = VIDEO_TYPES[(contentType || "").toLowerCase().trim()];
  if (byType) return byType;
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  return VIDEO_EXTS[ext] ?? null;
}
