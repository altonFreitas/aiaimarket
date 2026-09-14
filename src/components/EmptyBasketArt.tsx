/* NOTHING IN THE BASKET, AND SOMETHING TO LOOK AT ABOUT IT.
 *
 * DRAWN, NOT PHOTOGRAPHED. The obvious way to do this is a PNG of a 3D
 * emoji, and it is the wrong way for this shop: that is 50-200 KB fetched
 * over mobile data in Dili to say something the page already says in three
 * words, it cannot follow the dark theme, and it goes soft on a retina
 * screen unless you ship it twice. This is about two kilobytes of markup,
 * inlined with the page so it costs no request at all, sharp at any size,
 * and it reads correctly on both grounds. The audit that praised this shop
 * for deleting 6 MB of dead PNGs would not have thanked us for a new one.
 *
 * DECORATIVE, and marked so. The sentence above it is what a screen reader
 * should read; a crying face adds nothing to it and interrupting with
 * "image" would be noise.
 */
export default function EmptyBasketArt() {
  return (
    <svg className="empty-art" viewBox="0 0 260 190" aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Lit from the top left, like the reference: the highlight is what
            stops a flat circle reading as a sticker. */}
        <radialGradient id="eb-face" cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#ffd95c" />
          <stop offset="62%" stopColor="#f7c221" />
          <stop offset="100%" stopColor="#e5a908" />
        </radialGradient>
        <linearGradient id="eb-tear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7cc4f2" />
          <stop offset="100%" stopColor="#3f9fe0" />
        </linearGradient>
      </defs>

      {/* ---- the face ---- */}
      <g className="eb-face">
        <circle cx="86" cy="96" r="62" fill="url(#eb-face)" />

        {/* Brows angled up and in. This one pair of lines is what makes the
            face sad rather than merely closed-eyed -- without them the
            tears read as laughing. */}
        <path d="M52 66q13-9 26-2" className="eb-ink" strokeWidth="5" />
        <path d="M120 66q-13-9-26-2" className="eb-ink" strokeWidth="5" />

        {/* Eyes, with the white kept high and small: a big catchlight low in
            the eye reads as cheerful. */}
        <ellipse cx="64" cy="88" rx="10" ry="12" className="eb-eye" />
        <ellipse cx="108" cy="88" rx="10" ry="12" className="eb-eye" />
        <circle cx="60" cy="82" r="3.4" className="eb-glint" />
        <circle cx="104" cy="82" r="3.4" className="eb-glint" />

        {/* Tears, falling from the outer corner of each eye. */}
        <path d="M56 100c0 0-9 12-9 17a9 9 0 0 0 18 0c0-5-9-17-9-17z"
          fill="url(#eb-tear)" />
        <path d="M116 100c0 0-9 12-9 17a9 9 0 0 0 18 0c0-5-9-17-9-17z"
          fill="url(#eb-tear)" />

        {/* Mouth: a shallow downturn. Deeper than this and it stops being
            disappointed and starts being distraught, which an empty basket
            is not. */}
        <path d="M70 128q16-14 32 0" className="eb-ink" strokeWidth="5.5" />
      </g>

      {/* ---- the cart, standing there with nothing in it ---- */}
      <g className="eb-cart">
        {/* The startle lines from the reference: three short strokes that
            give the empty cart a beat of its own. */}
        <path d="M196 26v-14M176 34l-7-11M216 34l7-11" strokeWidth="5" />
        <path d="M168 60h10l14 52h40" strokeWidth="6" />
        <path d="M182 72h54l-7 28h-39z" strokeWidth="5" />
        {/* The bars, which are what say EMPTY -- a solid basket would just
            be a box and you could not see through it. */}
        <path d="M196 72v28M212 72v28M186 86h46" strokeWidth="3.4" />
        <circle cx="200" cy="126" r="8" strokeWidth="5" />
        <circle cx="228" cy="126" r="8" strokeWidth="5" />
      </g>
    </svg>
  );
}
