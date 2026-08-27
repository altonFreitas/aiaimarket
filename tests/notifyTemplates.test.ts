import { describe, it, expect } from "vitest";
import { renderNotification, eventForStatus, NOTIFY_EVENTS } from "@/lib/notify/templates";
import { smsCost } from "@/lib/sms";
import type { Lang } from "@/lib/types";

const vars = {
  ref: "CD20261234567890",
  storeName: "Loja AIAI",
  total: "$24.50",
  url: "https://loja.tl/o/CD20261234567890?t=abc.def",
};

describe("renderNotification", () => {
  it("substitutes every placeholder in every event and language", () => {
    for (const event of NOTIFY_EVENTS) {
      for (const lang of ["tet", "pt", "en"] as Lang[]) {
        const out = renderNotification(event, lang, vars);
        // A leftover {token} means a template was edited without its
        // substitution -- the buyer would literally read "{ref}".
        expect(out, `${event}/${lang}`).not.toMatch(/\{[a-z]+\}/);
        expect(out, `${event}/${lang}`).toContain(vars.ref);
        expect(out, `${event}/${lang}`).toContain(vars.url);
      }
    }
  });

  it("ends with the tracking link, so the tap target is last", () => {
    for (const event of NOTIFY_EVENTS) {
      for (const lang of ["tet", "pt", "en"] as Lang[]) {
        expect(renderNotification(event, lang, vars).trimEnd().endsWith(vars.url),
          `${event}/${lang}`).toBe(true);
      }
    }
  });

  it("writes a different message per language", () => {
    const tet = renderNotification("confirmed", "tet", vars);
    const pt = renderNotification("confirmed", "pt", vars);
    const en = renderNotification("confirmed", "en", vars);
    expect(new Set([tet, pt, en]).size).toBe(3);
  });

  it("falls back to Tetun for a language stored on an older order", () => {
    const out = renderNotification("confirmed", "xx" as Lang, vars);
    expect(out).toBe(renderNotification("confirmed", "tet", vars));
  });

  it("shows the total on the order-received message", () => {
    expect(renderNotification("placed", "en", vars)).toContain("$24.50");
  });

  it("names the store only on the first message", () => {
    // After that the buyer is in a thread they recognise; repeating it costs
    // segments and says nothing.
    expect(renderNotification("placed", "en", vars)).toContain("Loja AIAI");
    expect(renderNotification("confirmed", "en", vars)).not.toContain("Loja AIAI");
  });
});

describe("SMS cost of the default templates", () => {
  // These are the assertions that stop a well-meaning copy edit from
  // quietly doubling the store's messaging bill.
  it("fits a single segment in every event and language", () => {
    for (const event of NOTIFY_EVENTS) {
      for (const lang of ["tet", "pt", "en"] as Lang[]) {
        const cost = smsCost(renderNotification(event, lang, vars));
        expect(cost.segments, `${event}/${lang} = ${cost.units} ${cost.encoding} units`).toBe(1);
      }
    }
  });

  it("still fits one segment for a long store name and a large total", () => {
    const wide = { ...vars, storeName: "Loja Timor Oan Nakroman", total: "$1,234.56" };
    for (const event of NOTIFY_EVENTS) {
      for (const lang of ["tet", "pt", "en"] as Lang[]) {
        expect(smsCost(renderNotification(event, lang, wide)).segments,
          `${event}/${lang}`).toBe(1);
      }
    }
  });
});

describe("eventForStatus", () => {
  it("maps the statuses worth a message", () => {
    expect(eventForStatus("confirmed")).toBe("confirmed");
    expect(eventForStatus("out")).toBe("out");
    expect(eventForStatus("arrived")).toBe("arrived");
    expect(eventForStatus("completed")).toBe("completed");
    expect(eventForStatus("cancelled")).toBe("cancelled");
  });

  it("stays quiet for statuses that would be the same news twice", () => {
    // "new" is already covered by the 'placed' message sent at checkout, and
    // "preparing" tells a buyer nothing they did not learn from "confirmed".
    expect(eventForStatus("new")).toBeNull();
    expect(eventForStatus("preparing")).toBeNull();
  });

  it("returns null for an unknown status instead of inventing an event", () => {
    expect(eventForStatus("teleported")).toBeNull();
  });
});
