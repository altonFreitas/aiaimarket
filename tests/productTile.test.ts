import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE PHOTO TILE ON A CATALOGUE CARD SHOWS THE FILE, AND NOTHING ELSE.
 *
 * Two attempts at keeping the goods clear of the wishlist heart have been
 * taken back out, and this is the record of why, so neither returns.
 *
 * The first pulled the picture in from the tile's edges. That left a
 * margin, and the margin was the tile's flat grey -- fine only while every
 * seller photographs on that exact grey, which they do not. A green
 * photograph arrived in a grey frame: two colours in one tile.
 *
 * The second filled the margin with a blurred, over-sized print of the
 * same photograph, so it took its colour from the file. The seam did go
 * (0-1 of 255, measured across five grounds) and it still looked wrong --
 * a soft halo around every product, which is a thing nobody uploaded.
 *
 * The shop's answer is the photographer's, not the stylesheet's: leave
 * room round the goods when shooting. So the picture fills its tile corner
 * to corner, the heart sits over it, and a photograph framed to the edge
 * may touch it. That is accepted, on purpose.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const CARD = read("src/components/ProductCard.tsx");

const rule = (sel: string) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(esc + "\\{([^}]*)\\}").exec(CSS);
  expect(m, `no rule for ${sel}`).not.toBeNull();
  return m![1];
};

describe("the catalogue card's photograph", () => {
  it("fills its tile corner to corner", () => {
    const img = rule(".card .ph img");
    expect(img).toMatch(/width:100%/);
    expect(img).toMatch(/height:100%/);
    expect(img).toMatch(/object-fit:cover/);
  });

  it("is not inset, which is what put a frame of our colour round it", () => {
    const img = rule(".card .ph img");
    expect(img).not.toMatch(/padding/);
    expect(img).not.toMatch(/inset:/);
  });

  it("is drawn once, with no second print behind it", () => {
    // The blurred wash was a second <Image> of the same file.
    expect(CSS).not.toMatch(/ph-wash|ph-goods/);
    expect(CARD).not.toMatch(/ph-wash|ph-goods/);
    expect(CARD.match(/<Image\b/g)?.length ?? 0).toBe(1);
  });

  it("leaves the badges and the heart where they were", () => {
    // They belong to the card, not to the goods, and they stay put whatever
    // the photograph does.
    expect(CSS).toMatch(/\.card-badges\{position:absolute;top:8px;left:8px;right:8px/);
  });
});
