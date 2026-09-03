"use client";
import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import {
  MIN_ZOOM, MAX_ZOOM, zoomIn, zoomOut, clampPan, panAfterZoom, shouldStartDrag,
  type Pan,
} from "@/lib/zoom";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* The product photo, with + and − to look closer.
 *
 * Buying cloth, a phone case or a pair of shoes from a photograph means
 * wanting to see the weave, the port, the stitching. The picture was
 * already there at 800px; there was just no way to look at any of it.
 *
 * Zoomed in, the picture can be dragged. That is the whole interaction --
 * no lightbox, no modal, no second layer to get out of. It stays inside
 * the frame it already occupied, so nothing on the page moves when it is
 * used, and it works the same on a phone, where the drag is a finger.
 */
export default function ProductGallery(
  { images, name, lang = "tet" }: { images: string[]; name: string; lang?: Lang }
) {
  const list = images?.length ? images : [placeholder(name)];
  const [i, setI] = useState(0);
  const [scale, setScale] = useState<number>(MIN_ZOOM);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  // State, not a ref: the transition below is decided during render, and a
  // ref read there would be a value React has not been told about.
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: Pan } | null>(null);

  const frame = () => {
    const el = frameRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  };

  const setZoom = useCallback((next: number) => {
    const { w, h } = frame();
    setScale(next);
    setPan((p) => panAfterZoom(p, w, h, next));
  }, []);

  // A new picture starts where every picture starts. Carrying a 3x pan
  // across to the next photo would open it on a corner of something the
  // shopper has not seen whole yet.
  //
  // Done here rather than in an effect watching `i`. An effect would set
  // state during the render that follows the click, which renders the new
  // photo at the old zoom for one frame and then corrects it -- a visible
  // flash, and a cascading render React rightly complains about.
  const selectImage = useCallback((ix: number) => {
    setI(ix);
    setScale(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  /* Pointer events rather than mouse and touch separately: one code path
     for a mouse, a finger and a stylus, and setPointerCapture means a drag
     that leaves the frame still ends properly instead of sticking. */
  function onPointerDown(e: React.PointerEvent) {
    // The + and - live inside this frame. Capturing the pointer for a drag
    // would take their click away -- see shouldStartDrag in lib/zoom.ts.
    const onControl = !!(e.target as Element).closest?.(".zoom-ctl");
    if (!shouldStartDrag(scale, onControl)) return;
    drag.current = { x: e.clientX, y: e.clientY, from: pan };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const { w, h } = frame();
    setPan(clampPan(
      { x: d.from.x + (e.clientX - d.x), y: d.from.y + (e.clientY - d.y) }, w, h, scale
    ));
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    setDragging(false);
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  const src = list[i] || list[0];
  const zoomed = scale > MIN_ZOOM;

  return (
    <div className="gal">
      <div
        className={"main" + (zoomed ? " zoomed" : "")}
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* priority: this is the product page's Largest Contentful Paint
            element, so it must not wait behind lazy-loading heuristics. */}
        <Image
          src={src}
          alt={name}
          width={800}
          height={800}
          priority
          sizes="(max-width: 700px) 100vw, 520px"
          unoptimized={src.startsWith("data:")}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            // No animation while a finger is down, or the picture lags
            // behind the drag and feels broken.
            transition: dragging ? "none" : "transform .18s ease-out",
          }}
        />

        <div className="zoom-ctl">
          <button
            type="button"
            onClick={() => setZoom(zoomOut(scale))}
            disabled={scale <= MIN_ZOOM}
            aria-label={t("zoomOut", lang)}
            title={t("zoomOut", lang)}
          >
            {/* A minus and a plus drawn rather than typed: a hyphen and a
                "+" in the page font are different weights and sit at
                different heights, which looks like a mistake at this size. */}
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="11" width="16" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>
          {/* Announced politely so a screen reader hears the new scale after
              a press without it interrupting anything. */}
          <span className="zoom-lvl" aria-live="polite">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom(zoomIn(scale))}
            disabled={scale >= MAX_ZOOM}
            aria-label={t("zoomIn", lang)}
            title={t("zoomIn", lang)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="11" width="16" height="2" rx="1" fill="currentColor" />
              <rect x="11" y="4" width="2" height="16" rx="1" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {list.length > 1 && (
        <div className="thumbs">
          {list.map((s, ix) => (
            <button key={ix} type="button" aria-current={ix === i} onClick={() => selectImage(ix)}>
              <Image
                src={s}
                alt=""
                width={96}
                height={96}
                loading="lazy"
                sizes="96px"
                unoptimized={s.startsWith("data:")}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
