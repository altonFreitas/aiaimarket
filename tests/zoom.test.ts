import { describe, it, expect } from "vitest";
import {
  ZOOM_STEPS, MIN_ZOOM, MAX_ZOOM, zoomIn, zoomOut,
  panLimit, clampPan, panAfterZoom, shouldStartDrag,
} from "@/lib/zoom";

describe("zoomIn / zoomOut", () => {
  it("walks up and down the steps", () => {
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomIn(1.5)).toBe(2);
    expect(zoomIn(2.5)).toBe(3);
    expect(zoomOut(3)).toBe(2.5);
    expect(zoomOut(1.5)).toBe(1);
  });

  it("stops at the ends instead of running off them", () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it("returns to a real step from a value between them", () => {
    // Floating point, or a value from an older version of this code.
    expect(zoomIn(1.7)).toBe(2);
    expect(zoomOut(1.7)).toBe(1.5);
  });

  it("survives the rounding that comes of adding 0.5 repeatedly", () => {
    let z: number = MIN_ZOOM;
    for (let i = 0; i < ZOOM_STEPS.length - 1; i++) z = zoomIn(z);
    expect(z).toBe(MAX_ZOOM);
    for (let i = 0; i < ZOOM_STEPS.length - 1; i++) z = zoomOut(z);
    expect(z).toBe(MIN_ZOOM);
  });
});

describe("panLimit", () => {
  it("is nothing at all when the picture fits the frame", () => {
    expect(panLimit(400, 400, 1)).toEqual({ x: 0, y: 0 });
  });

  it("is half the hidden overflow on each side", () => {
    // At 2x a 400px frame holds an 800px picture: 400 hidden, 200 a side.
    expect(panLimit(400, 400, 2)).toEqual({ x: 200, y: 200 });
    expect(panLimit(400, 300, 3)).toEqual({ x: 400, y: 300 });
  });

  it("never goes negative on a zero-sized or un-measured frame", () => {
    expect(panLimit(0, 0, 3)).toEqual({ x: 0, y: 0 });
    expect(panLimit(400, 400, 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe("clampPan", () => {
  it("leaves a drag inside the limit alone", () => {
    expect(clampPan({ x: 50, y: -30 }, 400, 400, 2)).toEqual({ x: 50, y: -30 });
  });

  it("holds a drag at the edge", () => {
    // Past this the shopper is dragging empty space into view.
    expect(clampPan({ x: 9999, y: -9999 }, 400, 400, 2)).toEqual({ x: 200, y: -200 });
  });

  it("pins everything to centre at 1x", () => {
    expect(clampPan({ x: 100, y: 100 }, 400, 400, 1)).toEqual({ x: 0, y: 0 });
  });

  it("treats a missing or broken value as centred", () => {
    expect(clampPan({ x: NaN, y: 0 }, 400, 400, 2)).toEqual({ x: 0, y: 0 });
  });
});

describe("panAfterZoom", () => {
  it("re-clamps on the way down", () => {
    // The bug this prevents: a pan legal at 3x is off the edge at 2x, and
    // the picture would be left hanging with a blank band beside it.
    const at3 = { x: 400, y: 0 };
    expect(panAfterZoom(at3, 400, 400, 2)).toEqual({ x: 200, y: 0 });
  });

  it("recentres on the way back to 1x", () => {
    expect(panAfterZoom({ x: 180, y: -90 }, 400, 400, 1)).toEqual({ x: 0, y: 0 });
  });

  it("keeps the position when zooming in, since the limit only grows", () => {
    expect(panAfterZoom({ x: 150, y: 0 }, 400, 400, 3)).toEqual({ x: 150, y: 0 });
  });
});

describe("shouldStartDrag", () => {
  it("does not drag at all when the picture fits the frame", () => {
    expect(shouldStartDrag(MIN_ZOOM, false)).toBe(false);
  });

  it("drags when the picture is bigger than its frame", () => {
    expect(shouldStartDrag(2, false)).toBe(true);
  });

  it("NEVER drags from the zoom buttons, at any scale", () => {
    // The bug this exists to prevent. The + and - sit inside the frame that
    // listens for the drag; starting one calls setPointerCapture, and a
    // captured pointer hands its click to the capturing element instead of
    // to the button. Zoom then worked exactly once -- 100% to 150%, where
    // the early return had kept capture off -- and both buttons went dead.
    for (const scale of [...ZOOM_STEPS, MAX_ZOOM]) {
      expect([scale, shouldStartDrag(scale, true)]).toEqual([scale, false]);
    }
  });
});
