import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  NO_CONSENT, OPTIONAL_CATEGORIES, parseConsent, CONSENT_KEY,
} from "@/lib/cookieConsent";

/* THE CONSENT DIALOG, AND THE MECHANISM UNDER IT.
 *
 * This was a one-button notice, on the argument that a Reject with nothing
 * behind it is theatre: the shop sets no analytics and no advertising
 * cookies, only the language you picked and a staff sign-in session.
 *
 * That was right about the button and wrong about the mechanism. A shop
 * does not start tracking people by deciding to -- it starts because
 * somebody pastes a snippet into a layout months later, on a site where
 * nothing was built to stop them. The categories are real now, they
 * default to OFF, and hasConsent() is the gate such a snippet must pass.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const UI = code("src/components/CookieNotice.tsx");
const LIB = code("src/lib/cookieConsent.ts");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const I18N = read("src/lib/i18n.ts");

describe("what counts as consent", () => {
  it("treats never-answered and answered-no as different things", () => {
    /* Collapsing them is how a dialog comes back on every page load for
       somebody who already declined. */
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("")).toBeNull();
    expect(parseConsent(JSON.stringify(NO_CONSENT)))
      .toEqual({ analytics: false, marketing: false, at: undefined });
  });

  it("starts with every optional category off", () => {
    // A default of true would make the dialog a formality.
    for (const c of OPTIONAL_CATEGORIES) {
      expect([c, NO_CONSENT[c]]).toEqual([c, false]);
    }
  });

  it("accepts nothing but a literal true as a yes", () => {
    for (const v of ["1", 1, "yes", "true", {}, [], null]) {
      expect([v, parseConsent(JSON.stringify({ analytics: v }))!.analytics])
        .toEqual([v, false]);
    }
    expect(parseConsent(JSON.stringify({ analytics: true }))!.analytics).toBe(true);
  });

  it("asks again rather than inventing a permission from a corrupt record", () => {
    for (const bad of ["{", "not json", "[1,2]", "null", '"x"']) {
      expect([bad, parseConsent(bad)]).toEqual([bad, null]);
    }
  });

  it("answers no while the question is unanswered", () => {
    // Silence is not permission. hasConsent reads localStorage, which is
    // absent here, so this is the unanswered path.
    expect(LIB).toMatch(/return c \? c\[category\] === true : false;/);
  });

  it("remembers the answer outside a cookie", () => {
    /* Setting a cookie to record what somebody said about cookies is a
       joke the reader is not in on. */
    expect(CONSENT_KEY).toBe("loja:consent:v1");
    expect(LIB).toMatch(/localStorage\.setItem\(CONSENT_KEY/);
    expect(LIB).not.toMatch(/document\.cookie/);
  });
});

describe("the dialog", () => {
  it("shows every category's switch on load, not behind a Manage link", () => {
    // The point of the redesign: the choice is in front of somebody
    // before they answer it, not one click further on.
    expect(UI).toMatch(/OPTIONAL_CATEGORIES\.map/);
    expect(UI).toMatch(/className=\{"ck-sw"/);
    expect(UI).not.toMatch(/showDetails|setExpanded|"manage"/i);
  });

  it("shows the essential row as locked rather than hiding it", () => {
    /* "What does this site store about me" is answered by seeing the whole
       list, including the part nobody gets to turn off. */
    expect(UI).toMatch(/ck-sw is-on is-locked/);
    expect(UI).toMatch(/t\("cookieRequired", lang\)/);
  });

  it("treats closing as declining, never as consenting", () => {
    // The oldest dark pattern there is.
    /* EACH CLOSER CHECKED WHERE IT IS, not counted. "Reject optional" also
       calls decide(NO_CONSENT), so a count of three survived turning
       Escape into an accept-all. */
    const esc = /if \(e\.key === "Escape"\)([^;]*);/.exec(UI);
    expect(esc, "the Escape handler").not.toBeNull();
    expect(esc![1]).toContain("decide(NO_CONSENT)");

    /* A WINDOW, not a match ending at the first ">" -- the onClick arrow
       function contains one, so that stopped before the attributes it was
       supposed to be reading. */
    const at = UI.indexOf('className="ck-x"');
    expect(at, "the close button").toBeGreaterThan(-1);
    const x = UI.slice(at, at + 260);
    expect(x).toContain("decide(NO_CONSENT)");
    // ...and it says what it does, in the visitor's language.
    expect(x).toMatch(/aria-label=\{t\("cookieClose", lang\)\}/);

    // The backdrop.
    expect(UI).toMatch(/className="ck-scrim"[\s\S]{0,120}onClick=\{\(\) => decide\(NO_CONSENT\)\}/);
  });

  it("does not dismiss when the dialog itself is clicked", () => {
    // Without this every click inside falls through to the backdrop.
    expect(UI).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it("offers the three bulk actions the reference does", () => {
    expect(UI).toMatch(/decide\(\{ analytics: true, marketing: true \}\)/);
    expect(UI).toMatch(/decide\(choice\)/);
    for (const k of ["cookieRejectOptional", "cookieAcceptAll", "cookieSave"]) {
      expect([k, UI.includes(k)]).toEqual([k, true]);
    }
  });

  it("keeps a real checkbox behind each switch", () => {
    /* The switch is what it looks like; the control is an <input>, so it
       is focusable, keyboard-operable and announced as a checkbox. */
    expect(UI).toMatch(/type="checkbox"/);
    expect(CSS).toMatch(/\.ck-row input:focus-visible ~ \.ck-sw\{[^}]*outline/);
  });

  it("is announced as a modal dialog with its own title", () => {
    expect(UI).toMatch(/role="dialog"/);
    expect(UI).toMatch(/aria-modal="true"/);
    expect(UI).toMatch(/aria-labelledby="ck-title"/);
    expect(UI).toMatch(/panelRef\.current\?\.focus\(\)/);
  });

  it("says nothing when the answer cannot be kept", () => {
    /* Private browsing, or storage blocked: an undismissable dialog on
       every page is worse than an unasked question. */
    expect(UI).toMatch(/catch \{/);
    expect(UI).toMatch(/readConsent\(\) === null\) setShow\(true\)/);
  });
});

describe("the dialog does not describe tracking that is not there", () => {
  it("says so, in each optional category", () => {
    expect(UI).toMatch(/t\("cookieNoneYet", lang\)/);
    const m = /cookieNoneYet:\["([^"]*)","([^"]*)","([^"]*)","([^"]*)"\]/.exec(I18N);
    expect(m, "cookieNoneYet").not.toBeNull();
    for (const one of m!.slice(1)) expect(one.length).toBeGreaterThan(0);
  });

  it("still has nothing in those categories to consent to", () => {
    /* THE GUARD THAT KEEPS THE SENTENCE TRUE. The day somebody pastes a
       tag in, this fails and they have to route it through hasConsent()
       instead of beside it. */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const src = fs.readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
        if (/googletagmanager|google-analytics|gtag\(|\bfbq\(|connect\.facebook\.net|hotjar|mixpanel|cdn\.segment|posthog|plausible\.io/i.test(src)) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
