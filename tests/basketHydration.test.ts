import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import BasketView from "@/components/BasketView";
import { t } from "@/lib/i18n";

/* What the browser paints before React hydrates.
 *
 * The server cannot see localStorage, so the basket is empty in this
 * render no matter what the shopper has in it. That is fine; announcing it
 * is not.
 *
 * The bug this pins: Cancel on the checkout form was a plain
 * <a href="/list">, so returning to the cart was a real page load. The
 * server rendered "your cart is empty" over the shopper's actual order,
 * the browser painted it, and hydration then replaced it a beat later.
 *
 * createElement rather than JSX only because this suite includes .ts. */
describe("the cart as the server renders it", () => {
  const html = renderToString(
    createElement(BasketView, { lang: "en" as const, storeName: "Loja" }));

  it("does not claim the basket is empty", () => {
    expect(html).not.toContain(t("emptyList", "en"));
  });

  it("still renders the heading, so the page does not jump on hydration", () => {
    expect(html).toContain(t("list", "en"));
  });

  it("marks itself as still working", () => {
    expect(html).toContain('aria-busy="true"');
  });
});
