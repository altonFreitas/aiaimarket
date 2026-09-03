/* The arithmetic behind the + and − on a product photo.
 *
 * Kept out of the component because the interesting part is not the
 * buttons, it is what happens to the part of the picture you were looking
 * at when the scale changes -- and that is a calculation with edges worth
 * testing rather than something to eyeball once and hope about. */

export const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** The next step up, or the same value at the top. Never past the end. */
export function zoomIn(current: number): number {
  const next = ZOOM_STEPS.find((s) => s > current + 1e-9);
  return next ?? MAX_ZOOM;
}

/** The next step down, or the same value at the bottom. */
export function zoomOut(current: number): number {
  const lower = ZOOM_STEPS.filter((s) => s < current - 1e-9);
  return lower.length ? lower[lower.length - 1] : MIN_ZOOM;
}

export interface Pan { x: number; y: number }

/** How far the picture may be dragged before its edge comes inside the
 * frame.
 *
 * At scale s the image is s times the frame, so there is (s-1) of a frame
 * hidden, half of it on each side. Beyond that the shopper is dragging
 * empty space into view, which reads as the picture being broken. */
export function panLimit(frameW: number, frameH: number, scale: number): Pan {
  if (!(scale > 1)) return { x: 0, y: 0 };
  return {
    x: Math.max(0, (frameW * (scale - 1)) / 2),
    y: Math.max(0, (frameH * (scale - 1)) / 2),
  };
}

/** A drag, held inside those limits. */
export function clampPan(pan: Pan, frameW: number, frameH: number, scale: number): Pan {
  const lim = panLimit(frameW, frameH, scale);
  return {
    x: Math.min(lim.x, Math.max(-lim.x, pan.x || 0)),
    y: Math.min(lim.y, Math.max(-lim.y, pan.y || 0)),
  };
}

/** Where the picture should sit after the scale changes.
 *
 * Zooming out has to re-clamp: a pan that was legal at 3× is off the edge
 * at 2×, and without this the picture would be left hanging with a band of
 * blank beside it. Returning to 1× recentres, because at 1× there is only
 * one place it can be.
 */
export function panAfterZoom(
  pan: Pan, frameW: number, frameH: number, nextScale: number
): Pan {
  if (nextScale <= 1) return { x: 0, y: 0 };
  return clampPan(pan, frameW, frameH, nextScale);
}

/** Should a pointer going down begin a drag?
 *
 * Two conditions, and the second one is the whole reason this is a named
 * function rather than an `if` in the component.
 *
 * The + and − sit INSIDE the picture's frame, and the frame is what listens
 * for the drag. Starting a drag calls setPointerCapture, and a captured
 * pointer delivers its click to the CAPTURING element rather than to
 * whatever is under the finger -- so the button never hears the press.
 *
 * That produced a bug worth remembering the shape of: zoom worked exactly
 * once. At 100% the handler returned early, no capture happened, and the
 * button got its click. From 150% onward every press was swallowed, so
 * both buttons went dead and the picture sat at 150% forever. Nothing was
 * wrong with the stepping, which is why the unit tests for it all passed.
 */
export function shouldStartDrag(scale: number, onControl: boolean): boolean {
  return scale > MIN_ZOOM && !onControl;
}
