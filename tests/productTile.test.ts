import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE PHOTO TILE ON A CATALOGUE CARD.
 *
 * The goods are held off the tile's edges so they stop running under the
 * wishlist heart, and that leaves a margin. The margin used to be a colour
 * of ours -- a flat grey plate -- which is fine only while every seller
 * photographs on that exact grey. They do not: one shop shoots on green,
 * the next on white, the next hands us a cut-out with no background at
 * all. A green photograph in a grey frame is two colours in one tile, and
 * that is what these guards exist to keep out.
 *
 * The margin is now a blurred, slightly over-sized print of the same
 * photograph lying behind the sharp one, so it IS the photograph's own
 * ground. Everything below measures the one thing that matters: the colour
 * at the edge of the goods and the colour in the margin beside them have
 * to be the same number.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const CARD = read("src/components/ProductCard.tsx");

/** A rule's body, by its exact selector. */
function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(esc + "\\{([^}]*)\\}").exec(CSS);
  expect(m, `no rule for ${sel}`).not.toBeNull();
  return m![1];
}

/* ---------------------------------------------------------------- *
 * A pixel, through a CSS filter chain and onto what is behind it.
 * Enough of the spec to answer the only question asked here: does the
 * same ground come out as the same number under the goods and beside
 * them? blur is deliberately the identity -- a flat ground blurs to
 * itself, which is exactly why the wash can stand in for it.
 * ---------------------------------------------------------------- */
type Px = [number, number, number];

function applyFilter(c: Px, chain: string): { rgb: Px; alpha: number } {
  let rgb: Px = [...c] as Px;
  let alpha = 1;
  for (const m of chain.matchAll(/([a-z]+)\(([^)]*)\)/g)) {
    const fn = m[1];
    const n = parseFloat(m[2]);
    if (fn === "grayscale") {
      const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      rgb = rgb.map((v) => v + (l - v) * n) as Px;
    } else if (fn === "contrast") {
      rgb = rgb.map((v) => (v - 127.5) * n + 127.5) as Px;
    } else if (fn === "brightness") {
      rgb = rgb.map((v) => v * n) as Px;
    } else if (fn === "opacity") {
      alpha *= n;
    } else if (fn === "blur") {
      /* identity on a flat colour */
    } else {
      throw new Error(`unmodelled filter: ${fn}`);
    }
  }
  return { rgb: rgb.map((v) => Math.max(0, Math.min(255, v))) as Px, alpha };
}

function over(top: { rgb: Px; alpha: number }, back: Px): Px {
  return top.rgb.map((v, i) => v * top.alpha + back[i] * (1 - top.alpha)) as Px;
}

const filterOf = (sel: string) => (/filter:([^;}]*)/.exec(rule(sel))?.[1] ?? "").trim();

/** The two numbers the shopper actually compares: the margin around the
 *  goods, and the goods' own edge. Both start from the same ground,
 *  because a product is photographed on one. */
function seam(ground: Px, washFilter: string, goodsFilter: string): number {
  const TILE: Px = [255, 255, 255];                 // .card .ph, the card's white
  const margin = over(applyFilter(ground, washFilter), TILE);
  const goods = over(applyFilter(ground, goodsFilter), margin);
  return Math.max(...margin.map((v, i) => Math.abs(v - goods[i])));
}

/* Four real grounds: a green studio sheet, white, the navy the generated
   placeholder draws, and the pale grey a phone camera gives a table. */
const GROUNDS: Record<string, Px> = {
  green: [31, 138, 76], white: [255, 255, 255],
  navy: [22, 36, 66], pale: [233, 238, 244],
};

describe("the tile's margin is the photograph's own ground", () => {
  it("leaves no seam at rest, on any ground", () => {
    const wash = filterOf(".card .ph .ph-wash");
    const goods = filterOf(".card .ph .ph-goods");
    for (const [name, g] of Object.entries(GROUNDS)) {
      expect(seam(g, wash, goods), `${name} ground`).toBeLessThanOrEqual(1);
    }
  });

  it("leaves no seam on a sold-out card either", () => {
    /* The fade used to be opacity(.65) on each print. opacity fades a
       layer by letting what is BEHIND it through, and the two prints have
       different things behind them -- the goods have the wash, the wash
       has the tile -- so one grey came out at 128 and the other at 161.
       A 33-step ring around every sold-out photograph. */
    const wash = filterOf(".card.is-out .ph .ph-wash");
    const goods = filterOf(".card.is-out .ph .ph-goods");
    for (const [name, g] of Object.entries(GROUNDS)) {
      expect(seam(g, wash, goods), `${name} ground, sold out`).toBeLessThanOrEqual(1);
    }
  });

  it("proves the measurement by failing the fade it replaced", () => {
    // The guard above is only worth having if opacity(.65) would trip it.
    expect(seam(GROUNDS.green, "grayscale(1) blur(8px) opacity(.65)",
      "grayscale(1) opacity(.65)")).toBeGreaterThan(20);
  });

  it("still dims a sold-out photograph rather than leaving it be", () => {
    const f = filterOf(".card.is-out .ph .ph-goods");
    const out = applyFilter(GROUNDS.green, f);
    expect(Math.max(...out.rgb) - Math.min(...out.rgb), "colour left in it")
      .toBeLessThanOrEqual(1);
    expect(out.rgb[0], "and lifted away from the live one").toBeGreaterThan(140);
  });
});

describe("the two prints of the photograph", () => {
  it("are both laid over the whole tile, cropped to fill it", () => {
    const img = rule(".card .ph img");
    expect(img).toMatch(/position:absolute/);
    expect(img).toMatch(/inset:0/);
    expect(img).toMatch(/object-fit:cover/);
  });

  it("are the one file, so the browser fetches it once", () => {
    const wash = /<Image\s+className="ph-wash"([\s\S]*?)\/>/.exec(CARD);
    const goods = /<Image\s+className="ph-goods"([\s\S]*?)\/>/.exec(CARD);
    expect(wash, "the wash print").not.toBeNull();
    expect(goods, "the goods print").not.toBeNull();
    for (const attr of ["src={img}", "width={400}", "height={400}",
      'sizes="(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 240px"']) {
      expect(wash![1], `wash ${attr}`).toContain(attr);
      expect(goods![1], `goods ${attr}`).toContain(attr);
    }
  });

  it("names the product once, not twice", () => {
    // Two <img> for one product would otherwise be read out twice.
    const wash = /<Image\s+className="ph-wash"([\s\S]*?)\/>/.exec(CARD)![1];
    expect(wash).toMatch(/alt=""/);
    expect(wash).toMatch(/aria-hidden="true"/);
    expect(/<Image\s+className="ph-goods"([\s\S]*?)\/>/.exec(CARD)![1])
      .toMatch(/alt=\{p\.name\}/);
  });

  it("puts the wash under the goods", () => {
    expect(CARD.indexOf('className="ph-wash"')).toBeLessThan(
      CARD.indexOf('className="ph-goods"'));
  });
});

describe("the wash", () => {
  it("is over-sized by enough to keep its own blurred rim off the tile", () => {
    /* A blur samples past the edge of what it is blurring, where there is
       nothing, so a print sized exactly to the tile fades out around its
       rim and lets the tile's colour back in. The smallest tile in the
       app is the 172px one a 390px phone draws. */
    const r = rule(".card .ph .ph-wash");
    const blur = Number(/blur\((\d+(?:\.\d+)?)px\)/.exec(r)![1]);
    const scale = Number(/scale\((\d+(?:\.\d+)?)\)/.exec(r)![1]);
    const cover = ((scale - 1) / 2) * 172;
    expect(cover).toBeGreaterThanOrEqual(3 * blur);
  });

  it("is blurred little enough not to drag the goods into the margin", () => {
    // Measured in a browser across five grounds: 0-5 of 255 at 8px,
    // 15-33 at 20px. The blur is there to smooth a busy ground, not to
    // repaint it.
    const blur = Number(/blur\((\d+(?:\.\d+)?)px\)/
      .exec(rule(".card .ph .ph-wash"))![1]);
    expect(blur).toBeGreaterThan(0);
    expect(blur).toBeLessThanOrEqual(10);
  });

  it("does not lean in when the card is hovered", () => {
    /* Hover used to scale ".card .ph img", which is now both prints --
       and 1.07 on the wash replaces the over-scale it needs, so a hairline
       of the tile appeared around every hovered card. */
    expect(CSS).not.toMatch(/\.card:hover \.ph img\{/);
    expect(CSS).toMatch(/\.card:hover \.ph \.ph-goods\{transform:scale\(/);
    expect(CSS).not.toMatch(/\.card \.ph img\{[^}]*transition:transform/);
  });
});

describe("what shows through a cut-out", () => {
  it("is the card's own colour, both behind the goods and beside them", () => {
    /* A file with a transparent background has no ground to wash out of,
       so both the tile and the goods' own backing must be the one colour
       -- and it has to be the card's, because the body below is already
       that and a cut-out then reads as floating on the card. */
    expect(rule(".card .ph")).toMatch(/background:var\(--card\)/);
    expect(rule(".card .ph .ph-goods")).toMatch(/background:var\(--card\)/);
  });

  it("does not paint that colour over the margin", () => {
    // Without content-box the backing fills the border box, covers the
    // wash, and the flat plate is back.
    expect(rule(".card .ph .ph-goods")).toMatch(/background-clip:content-box/);
  });
});

describe("the goods are still held off the heart", () => {
  it("is inset on every side", () => {
    const g = rule(".card .ph .ph-goods");
    expect(g).toMatch(/padding:\d+px \d+px \d+px/);
    expect(g).toMatch(/box-sizing:border-box/);
  });

  it("gives the top more room than the sides, where the badges are", () => {
    const pad = /padding:(\d+)px (\d+)px (\d+)px/
      .exec(rule(".card .ph .ph-goods"))!;
    const [, top, side] = pad.map(Number);
    expect(top).toBeGreaterThanOrEqual(side);
  });

  it("leaves the badges themselves where they were", () => {
    // They belong to the card, not to the goods.
    expect(CSS).toMatch(/\.card-badges\{position:absolute;top:8px;left:8px;right:8px/);
  });
});
