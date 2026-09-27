import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { contrast } from "./helpers/contrast";

/* THE WHATSAPP BUTTON'S LABEL, IN THE FOOTER.
 *
 * Reported from the shop: "Order via WhatsApp" was not white, on a button
 * that is already WhatsApp green.
 *
 * .btn sets color:#fff. But `.ft a` is (0,1,1) and `.btn` is (0,1,0), so
 * inside the footer the link rule won and painted the label muted grey.
 * Measured in a browser: rgb(75,84,99) on rgb(25,136,69) -- two mid-tones
 * on top of each other. The green landed when the button was restyled;
 * the label quietly did not.
 */

const CSS = fs.readFileSync(
  path.join(process.cwd(), "src/app/globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function token(name: string): string {
  const m = new RegExp("--" + name + "\\s*:\\s*(#[0-9a-fA-F]{3,6})").exec(CSS);
  if (!m) throw new Error("no token --" + name);
  return m[1];
}

describe("a button in the footer is a button", () => {
  it("keeps its own label colour against the footer's link rule", () => {
    expect(CSS).toMatch(/\.ft a\.btn\{color:#fff\}/);
  });

  it("is written after the rule it has to beat", () => {
    /* Same specificity would not be enough on its own; this one is more
       specific AND later, so neither ordering nor a future reshuffle of
       the file can quietly undo it. */
    expect(CSS.indexOf(".ft a.btn{")).toBeGreaterThan(CSS.indexOf(".ft a{"));
  });

  it("still lets the footer's ordinary links be muted", () => {
    // The fix must not turn every footer link white.
    expect(CSS).toMatch(/\.ft a\{color:var\(--muted\)/);
  });

  it("leaves white legible on the green it sits on", () => {
    // The same bar tests/contrast holds --wa to; restated here because
    // this is the button that made it matter.
    expect(contrast("#ffffff", token("wa"))).toBeGreaterThanOrEqual(4.5);
  });

  it("would have failed the bar it was actually rendering at", () => {
    /* The measured grey on the measured green. Not a hypothetical: this
       is what the shop was looking at. */
    expect(contrast("#4b5463", token("wa"))).toBeLessThan(3);
  });
});
