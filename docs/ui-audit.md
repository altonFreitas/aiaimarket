# UI/UX audit — AIAI / Loja

Measured against the codebase on this branch, not eyeballed. Every number
below came from counting the source or from a browser at a stated width;
where I could not measure something, it says so.

## What this app already gets right

Worth stating first, because a redesign that discards these would be a
downgrade dressed as an upgrade.

- **Colour contrast is measured, not guessed.** `:root` carries a comment
  naming four tokens that were below 4.5:1 and are not any more, and
  `tests/contrast.test.ts` does the arithmetic on every build. Most
  projects this size have no idea what their contrast ratios are.
- **No horizontal overflow** at 375, 768 or 1440px on any page I could
  render. Checked with `scrollWidth - clientWidth`.
- **Toasts are already accessible**: `role="alert"` for failures,
  `role="status"` for the rest, with a comment explaining why a failed save
  should interrupt a screen reader and a "Copied" should not.
- **`prefers-reduced-motion`, `prefers-contrast` and `prefers-color-scheme`
  are all honoured**, which is three more than most shops honour.
- **Error and 404 pages exist** (`error.tsx`, `not-found.tsx`,
  `global-error.tsx`).
- The checkout form already wires `aria-invalid` and `aria-describedby` to
  its error messages.

## Problems found

### 1. No scales — the systemic one

| | before |
|---|---|
| distinct font sizes | **28** (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 29, 34, 36) |
| distinct spacing values | **31** (including 3, 5, 7, 9, 11, 13, 22, 26) |
| border radii | 2 tokens + **10 ad-hoc values** |
| shadows | 1 token + **9 one-offs** |
| breakpoints | **13 widths**, mixing min- and max-width |

This is not visible as a bug on any one screen. It is visible across
screens: two cards a page apart on 13px and 13.5px type read as sloppiness
without the reader being able to say why. The cause is structural — the
stylesheet is 2,547 lines in **50 feature-appended sections**, each written
when a screen was built, with no shared primitive layer above them.

Half-pixel sizes are worth singling out: 12.5px is not reliably between 12
and 13. It rounds per browser and per zoom level, so it renders as one or
the other anyway, while looking in the source like a decision.

### 2. Form fields made mobile Safari zoom — a real bug, now fixed

`.field input` was **15px**. iOS Safari zooms the page in when a focused
field is under 16px and does not zoom back out when focus leaves. Tapping
the first box of the checkout enlarged the page and left the shopper
finishing the order scrolling sideways through a form whose edges they
could no longer see. Nobody reports that; they abandon the basket.

The same fields were 39px tall, under the 44px WCAG target size.

### 3. No loading states at all

**55 routes, zero `loading.tsx`, zero skeletons.** Every navigation that
touches the database held the *previous* page on screen, motionless, until
the new one was ready. On the shop's fibre that is a blink; on a phone in
Dili it is several seconds of a page that looks like it ignored the tap —
so it gets tapped again.

### 4. Heading hierarchy skips a level

70 `<h1>`, **13 `<h2>`**, **135 `<h3>`**. Sections jump from h1 straight to
h3. Screen-reader users navigate by heading level, and search engines read
the outline; both are being told a structure the page does not have.

### 5. Accessibility wiring is inconsistent rather than absent

`aria-invalid` and `aria-describedby` appear **twice each** in the whole
app — both in `CheckoutForm`. Every other form (login, register, seller
settings, admin) shows errors as a red border and a red line, which is
colour alone. `aria-live` appears once (the toast).

### 6. Mixed image strategy

10 files use `next/image`; **15 raw `<img>`** elsewhere, two of them with
no `alt`. Raw tags skip the resizing, format negotiation and intrinsic
sizing that prevent layout shift.

### 7. No shared UI primitives

No `Button`, `Input`, `Card`, `Modal`, `Skeleton`, `EmptyState` component
existed. **Note:** buttons are in fact consistent — a `.btn` CSS system
carries 263 usages across 12 variants — so this is a CSS-first
architecture, not chaos, and I am *not* proposing to replace it with a
React component layer. That would be a large rewrite with a real
regression surface and little user-visible gain. What was missing is the
handful of things CSS alone cannot express: skeletons, empty states, and
error/field wiring.

## Fixed in this pass

1. **A token layer** — ten type steps, a 4px spacing scale, five radii,
   four elevation levels, two durations, five documented breakpoints. Added
   additively: defining them changed nothing on screen.
2. **The Safari zoom bug** — fields are 16px and 44px tall, with a focus
   ring and a transition. Guarded by `tests/designTokens.test.ts`, checked
   by putting 15px back and watching it fail.
3. **Error messages no longer rely on colour** — each carries a round `!`
   mark before the sentence.
4. **Loading states** — a skeleton system whose shapes match the real
   product card and product page (so nothing shifts when content lands),
   wired into `/shop`, `/search`, `/c/[slug]`, `/store/[slug]` and
   `/p/[slug]`. One polite `aria-live` announcement per page rather than
   one per box, and the sweep animation disappears entirely under
   `prefers-reduced-motion`.
5. The forms section of the stylesheet migrated onto the scale.

## Deliberately not changed

- **The `.btn` CSS system.** See above.
- **The colour palette.** It is measured for contrast and it is the shop's
  identity. Replacing it with a generic neutral-plus-accent palette would
  make the site look like every other template.
- **The tais-cloth background.** It is the one thing on the page that says
  where this shop is. It is already tuned by a single opacity knob.
- **Global font-size snapping.** Mapping all 28 sizes onto the scale in one
  pass would restyle 50 sections I cannot see rendered — the admin and
  seller screens need a live database, and this environment has none. Doing
  it blind risks breaking tables somebody runs their shop from. The scale
  exists; surfaces move onto it one at a time, verified.

## Second pass — the admin and seller screens

Verified against a replica of those screens built from their real class
names, since rendering them needs a database this environment does not
have. Measured at 390, 768 and 1440px.

- **A table that scrolled with nothing saying so.** On a 390px phone,
  **281px of the admin-users table sat outside its box** — the last column
  shown was "Access", so the 2FA state, last login, status and the Edit
  button were not clipped-and-inviting-a-swipe, they were absent. Now a
  shadow appears at whichever edge has content behind it, painted in pure
  CSS with `background-attachment: local` so it slides away as you reach
  the end. No scroll listener.
- **Those tables could not be scrolled from a keyboard at all** — a
  scrolling div with no focusable child is unreachable. All **32**
  `.scroll-x` boxes are now focusable, with a visible ring.
- **Admin nav links were 35px tall**, now 44. The small buttons inside
  tables stay at 47×32: that clears WCAG 2.5.8 (24px), and 44 each would
  add most of a row's height to every line of every table — fewer orders
  per screen, on screens whose job is showing many rows.
- **138 font sizes and 332 spacing values** across those sections moved
  onto the scale. Chart tick labels and the nav counter bump are exempt and
  named in the test: they are not prose, and enlarging them reflows a
  chart.
- **Loading states** for every `/admin/*` and `/seller/*` route, from one
  file per segment.

Eight more tests, three mutation-checked.

## Still outstanding

Honest list, in the order I would take it.

1. Migrate the remaining stylesheet sections onto the scales (catalog,
   product, homepage) — the admin and seller sections are done.
2. Heading hierarchy: h1 → h2 → h3 per page.
3. Extend `aria-invalid` / `aria-describedby` from checkout to every form.
4. Replace the 15 raw `<img>` with `next/image`; add the two missing alts.
5. Skeletons for the homepage rails.
7. Search: no autocomplete, no recent or popular searches.
8. Filters: no active-filter chips and no "clear all" on mobile.
9. Consolidate the 13 breakpoints onto the documented five.
10. A real Lighthouse and axe pass, which needs a deployed instance with
    data — neither exists here.

## How to verify what was claimed

```
npm run verify                  # 1,466 tests
npx vitest run tests/designTokens.test.ts
npx next build
```
