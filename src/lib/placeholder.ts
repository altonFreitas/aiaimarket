const PAL = [
  ["#152341", "#3d5a99"], ["#0f5b63", "#4fa3ab"], ["#8a4b0f", "#d8933f"],
  ["#5a2350", "#a7629c"], ["#123f57", "#4c93b5"], ["#6b1f2a", "#c06a72"],
];

/** Inline SVG placeholder for products with no photo yet. Costs ~0 bytes
 * over the wire (no request at all), keeping J2's page-weight budget
 * intact even before a seller has uploaded real images. */
export function placeholder(name: string): string {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) % 9973;
  const c = PAL[seed % PAL.length];
  const initials = (name.match(/\b[\w]/g) || ["?"]).slice(0, 2).join("").toUpperCase();
  const r1 = 30 + (seed % 40), r2 = 60 + (seed % 30);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" fill="${c[0]}"/>` +
    `<circle cx="${120 + (seed % 160)}" cy="${300 - (seed % 120)}" r="${r2}" fill="${c[1]}" opacity=".55"/>` +
    `<circle cx="${300 - (seed % 140)}" cy="${110 + (seed % 90)}" r="${r1}" fill="#fff" opacity=".1"/>` +
    `<path d="M0 400 L400 260 L400 400 Z" fill="#fff" opacity=".07"/>` +
    `<text x="200" y="215" font-family="ui-monospace,monospace" font-size="86" font-weight="700" ` +
    `fill="#fff" fill-opacity=".92" text-anchor="middle">${initials}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
