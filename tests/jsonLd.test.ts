import { describe, it, expect } from "vitest";
import { serializeJsonLd, breadcrumbLd, siteLd } from "@/lib/jsonLd";

describe("serializeJsonLd", () => {
  it("makes a product name inert inside a script tag", () => {
    // JSON.stringify does not escape "<", so a seller who names a product
    // "</script><script>alert(1)</script>" would otherwise break out of the
    // tag and run on every visitor's page.
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });

  it("escapes the two separators that are newlines in JavaScript", () => {
    const out = serializeJsonLd({ name: "a\u2028b\u2029c" });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toMatch(/[\u2028\u2029]/);
  });

  it("leaves ordinary text alone", () => {
    expect(serializeJsonLd({ name: "Sapatu Merah" })).toBe('{"name":"Sapatu Merah"}');
  });
});

describe("breadcrumbLd", () => {
  it("numbers the trail from one", () => {
    const ld = breadcrumbLd("https://loja.tl", [
      { name: "Sapatu", path: "/c/sapatu" },
      { name: "Sneakers", path: "/c/sneakers" },
    ])!;
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(ld.itemListElement[0].item).toBe("https://loja.tl/c/sapatu");
  });

  it("emits nothing without an absolute origin", () => {
    // schema.org positions are URLs. A relative one is not a URL, and a
    // half-formed graph is reported as an error against the page rather
    // than ignored -- which is worse than having no breadcrumb at all.
    expect(breadcrumbLd("", [{ name: "x", path: "/c/x" }])).toBeNull();
  });

  it("emits nothing for a page with no trail", () => {
    expect(breadcrumbLd("https://loja.tl", [])).toBeNull();
  });
});

describe("siteLd", () => {
  const base = { origin: "https://loja.tl", storeName: "Loja AIAI" };

  it("links the website to the organisation that publishes it", () => {
    const ld = siteLd(base)!;
    const [org, site] = ld["@graph"] as Array<Record<string, unknown>>;
    expect(org["@type"]).toBe("Organization");
    expect((site.publisher as { "@id": string })["@id"]).toBe(org["@id"]);
  });

  it("declares a search box that really exists", () => {
    const site = (siteLd(base)!["@graph"] as Array<Record<string, unknown>>)[1];
    const action = site.potentialAction as { target: { urlTemplate: string } };
    expect(action.target.urlTemplate).toBe("https://loja.tl/search?q={search_term_string}");
  });

  it("leaves out an address the shop has not filled in", () => {
    // A postalAddress of empty strings is worse than no address.
    const org = (siteLd(base)!["@graph"] as Array<Record<string, unknown>>)[0];
    expect(org.address).toBeUndefined();
    const withAddr = (siteLd({ ...base, locality: "Caicoli", region: "Dili" })!["@graph"] as Array<Record<string, unknown>>)[0];
    expect(withAddr.address).toMatchObject({ addressLocality: "Caicoli", addressCountry: "TL" });
  });

  it("emits nothing without an origin or a name", () => {
    expect(siteLd({ origin: "", storeName: "Loja" })).toBeNull();
    expect(siteLd({ origin: "https://loja.tl", storeName: "" })).toBeNull();
  });
});
