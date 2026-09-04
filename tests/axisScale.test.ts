import { describe, it, expect } from "vitest";
import { niceScale } from "@/components/admin/Charts";
import fs from "node:fs";
import path from "node:path";
import { money, moneyAxis } from "@/lib/utils";

/* The y axis used to carry ONE figure, at the top, and every other point
 * was measured off it by eye. These are the two pieces that replaced it:
 * a scale whose gridlines land on round numbers, and a compact format so
 * four or five of them fit in a narrow gutter. */

describe("niceScale", () => {
  it("turns takings of 160 into 0 / 50 / 100 / 150 / 200", () => {
    // The case this was asked for.
    const { max, ticks } = niceScale(160);
    expect(max).toBe(200);
    expect(ticks).toEqual([0, 50, 100, 150, 200]);
  });

  it("steps by a number a person reads without thinking", () => {
    /* THE TEST THAT WAS MISSING, and the bug it lets through is subtle.
     *
     * Checking only that the ticks are EVENLY SPACED passes the very
     * implementation this function exists to replace: round the top up to
     * 50 and cut it into four, and you get 0 / 12.5 / 25 / 37.5 / 50 --
     * perfectly even, and nobody wants to read 37.5 off an axis. Even
     * spacing is not the property being asked for; a round STEP is.
     *
     * So the step itself has to be one of the numbers axes are made of. */
    const NICE = [1, 2, 2.5, 5, 10];
    for (let peak = 1; peak < 5000; peak += 3) {
      const { ticks } = niceScale(peak);
      const step = ticks[1];
      const mag = Math.pow(10, Math.floor(Math.log10(step)));
      const mantissa = Math.round((step / mag) * 100) / 100;
      expect([peak, step, NICE.includes(mantissa)]).toEqual([peak, step, true]);
    }
  });

  it("never produces a tick that is not a multiple of the step", () => {
    // THE BUG THE OLD niceMax WOULD HAVE HAD. Rounding the top up first and
    // dividing it into four gives 12.5 and 37.5 for a peak of 45.
    for (const peak of [
      1, 3, 7, 12, 45, 99, 160, 249, 500, 900, 1234, 1720, 9999, 45000, 1e6,
    ]) {
      const { ticks } = niceScale(peak);
      const step = ticks[1];
      for (const t of ticks) {
        const multiple = Math.round(t / step);
        expect([peak, t, Math.abs(multiple * step - t) < 1e-9]).toEqual([peak, t, true]);
      }
    }
  });

  it("always starts at zero and covers the peak", () => {
    for (const peak of [1, 45, 160, 900, 1720, 45000]) {
      const { max, ticks } = niceScale(peak);
      expect([peak, ticks[0]]).toEqual([peak, 0]);
      expect([peak, max >= peak]).toEqual([peak, true]);
      expect([peak, ticks[ticks.length - 1]]).toEqual([peak, max]);
    }
  });

  it("gives a readable number of lines, never one and never twenty", () => {
    // One line is the axis it replaced; twenty is a grid with a chart
    // hidden behind it.
    for (let peak = 1; peak < 3000; peak += 7) {
      const { ticks } = niceScale(peak);
      expect([peak, ticks.length >= 3 && ticks.length <= 7])
        .toEqual([peak, true]);
    }
  });

  it("uses a quarter step where money divides into quarters", () => {
    // 900 with halves only would jump to a step of 500 and draw three
    // lines. 250 gives four.
    expect(niceScale(900).ticks).toEqual([0, 250, 500, 750, 1000]);
  });

  it("draws nothing for a period with no activity", () => {
    // The scale is nominal there; figures would invent numbers.
    expect(niceScale(0)).toEqual({ max: 1, ticks: [] });
    expect(niceScale(-5)).toEqual({ max: 1, ticks: [] });
  });

  it("survives a huge value without hanging", () => {
    const { ticks } = niceScale(9.9e12);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });
});

describe("the gutter the figures sit in", () => {
  it("keeps the measured character width, or the figures clip", () => {
    /* TICK_CHAR_W sizes the left gutter from the longest label. It is a
     * MEASUREMENT, not a guess: ui-monospace at 9px renders every
     * character at 5.40 viewBox units. The first version used 5.1 and the
     * figures ran into the plot.
     *
     * A unit test cannot measure text, so this pins the number and says
     * why. If the tick font or its size ever changes, measure the new
     * advance in a browser and change this with it -- do not nudge it
     * until the screenshot looks right. */
    const SRC = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "admin", "Charts.tsx"), "utf8");
    const m = /const TICK_CHAR_W = ([\d.]+);/.exec(SRC);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(5.4);
  });
});

describe("moneyAxis", () => {
  it("drops the cents nobody reads at nine pixels", () => {
    expect(moneyAxis(0)).toBe("$0");
    expect(moneyAxis(50)).toBe("$50");
    expect(moneyAxis(200)).toBe("$200");
    expect(moneyAxis(999.4)).toBe("$999");
  });

  it("uses k above a thousand", () => {
    expect(moneyAxis(1000)).toBe("$1k");
    expect(moneyAxis(2000)).toBe("$2k");
    expect(moneyAxis(12500)).toBe("$12.5k");
  });

  it("keeps a decimal only where it says something", () => {
    // 1.5k against a real 2k tick has to stay apart; 2.0k is noise.
    expect(moneyAxis(1500)).toBe("$1.5k");
    expect(moneyAxis(2000)).not.toBe("$2.0k");
  });

  it("stops using decimals once the number is big enough not to need them", () => {
    expect(moneyAxis(250000)).toBe("$250k");
  });

  it("handles a negative, which a difference column can produce", () => {
    expect(moneyAxis(-1500)).toBe("-$1.5k");
  });

  it("stays short, which is the whole point", () => {
    // The gutter is sized from the widest label, and every character of it
    // is width the plot gives up.
    for (const v of [0, 50, 160, 999, 1500, 12500, 250000, 9999999]) {
      expect([v, moneyAxis(v).length <= 8]).toEqual([v, true]);
    }
  });

  it("agrees with money() about the amount", () => {
    // Compact, not different: a reader glancing between the axis and the
    // tooltip must not find two numbers.
    for (const v of [50, 200, 1500]) {
      const exact = Number(money(v).replace(/[$,]/g, ""));
      expect(exact).toBe(v);
    }
  });
});

describe("the two series colours", () => {
  const CSS = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "globals.css"), "utf8");
  const token = (name: string) =>
    (new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS)?.[1] ?? "").toLowerCase();

  /* Rec. 709 luminance, the same weighting a contrast ratio uses. Enough to
   * tell whether two colours differ in LIGHTNESS, which is the property
   * that survives colour blindness when hue does not. */
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };

  it("uses green for money in and red for money out", () => {
    const sales = token("series-sales");
    const purchases = token("series-purchases");
    expect(sales).toMatch(/^#[0-9a-f]{6}$/);
    expect(purchases).toMatch(/^#[0-9a-f]{6}$/);
    // Green channel dominant on one, red channel dominant on the other.
    const g = (h: string) => parseInt(h.slice(3, 5), 16);
    const r = (h: string) => parseInt(h.slice(1, 3), 16);
    expect(g(sales)).toBeGreaterThan(r(sales));
    expect(r(purchases)).toBeGreaterThan(g(purchases));
  });

  it("keeps them far enough apart in lightness to survive colour blindness", () => {
    /* THE POINT OF THIS WHOLE TEST.
     *
     * Red against green is the axis protanopia and deuteranopia collapse --
     * roughly one man in twelve. The shop's own --green and --red are only
     * 7.9 Delta-E apart under protanopia, below the floor of 8, so the two
     * lines merge into one for those readers.
     *
     * What rescues the pair is a LIGHTNESS difference, which survives when
     * the hue does not. If somebody later "corrects" these back to the
     * status tokens for tidiness, the hues will still look right and the
     * chart will quietly stop working for those readers. This is what
     * notices. */
    const l1 = luminance(token("series-sales"));
    const l2 = luminance(token("series-purchases"));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    expect(ratio).toBeGreaterThan(2.5);
  });

  it("does not simply reuse the status tokens", () => {
    // --green and --red are what .pill.ok and .up/.down wear. Reusing them
    // here is the specific regression above.
    expect(token("series-sales")).not.toBe(token("green"));
    expect(token("series-purchases")).not.toBe(token("red"));
  });

  it("stays readable against the card it is drawn on", () => {
    for (const name of ["series-sales", "series-purchases"]) {
      const ratio = (1.0 + 0.05) / (luminance(token(name)) + 0.05);
      expect([name, ratio >= 3]).toEqual([name, true]);
    }
  });
});
