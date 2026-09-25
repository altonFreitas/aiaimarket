import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* TELLING CUSTOMERS WHAT IS NEW.
 *
 * customers.notify_new_products has existed since the account page did, and
 * nothing read it -- a customer ticking "tell me about new products" was
 * told nothing, ever. The shop was making a promise and not keeping it.
 *
 * The risk in keeping it is the opposite one: one message per opted-in
 * customer per product is real money, and the failure mode is a phone bill
 * rather than an error. Most of what is checked here is the brakes.
 */

const ROOT = process.cwd();
const raw = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (p: string) => raw(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const SQL = raw("supabase/customer-alerts.sql");
const ANNOUNCE = code("src/lib/notify/announce.ts");
const PRODUCTS = code("src/lib/actions/products.ts");
const SCREEN = code("src/app/admin/notifications/page.tsx");
const PANEL = code("src/components/admin/AnnounceState.tsx");
const I18N = raw("src/lib/i18n.ts");

/** The three strings behind one i18n key: Tetun, Portuguese, English.
 *
 * A helper because the loose version of these assertions -- one regex
 * spanning the whole entry -- passes when only ONE language still says the
 * thing. Two mutations proved it: emptying the Tetun fix-instruction left
 * the Portuguese and English copies for the regex to find, and the shop
 * whose own language it is would have been the one told nothing. */
function trio(key: string): [string, string, string] {
  const m = new RegExp(key + ':\\["((?:[^"\\\\]|\\\\.)*)","((?:[^"\\\\]|\\\\.)*)","((?:[^"\\\\]|\\\\.)*)"\\]')
    .exec(I18N);
  expect(m, "the i18n entry for " + key).not.toBeNull();
  return [m![1], m![2], m![3]];
}

/** The whole <p> element that mentions `needle`, opening tag included.
 *
 * Slicing forward FROM the needle starts after the tag's own attributes, so
 * a colour added to the tag sat outside the window and a mutation adding it
 * survived. */
function element(src: string, needle: string): string {
  const at = src.indexOf(needle);
  expect(at, needle).toBeGreaterThan(-1);
  const open = src.lastIndexOf("<p", at);
  return src.slice(open, src.indexOf("</p>", at) + 4);
}

describe("a customer cannot be told the same thing twice", () => {
  it("has a unique index on customer, product and kind", () => {
    /* THE BRAKE THAT MATTERS. A shop editing a product five times on the
       morning it goes live must announce it once. Everything else here is
       convenience; this is the line that stops a second blast. */
    expect(SQL).toMatch(
      /create unique index if not exists customer_alerts_once\s*\n?\s*on customer_alerts \(customer_id, product_id, kind\)/);
  });

  it("relies on it rather than checking first", () => {
    // Checking and then inserting is a race with the next save.
    expect(ANNOUNCE).toMatch(/onConflict: "customer_id,product_id,kind", ignoreDuplicates: true/);
  });
});

describe("what it will not do by itself", () => {
  it("sends nothing without a configured gateway", () => {
    /* With no provider the rows queue and the admin sends them, exactly as
       order notifications already behave -- so the feature cannot start
       spending money on its own the day it is deployed. */
    expect(ANNOUNCE).toMatch(/if \(!provider\) return \{ queued, blocked: null \};/);
  });

  it("has a ceiling on how many people one announcement reaches", () => {
    // Not a business rule -- a blast radius. A shop with more customers
    // than this should decide deliberately how to reach them all rather
    // than discovering the number on a phone bill.
    expect(ANNOUNCE).toMatch(/const MAX_RECIPIENTS = \d+/);
    expect(ANNOUNCE).toMatch(/\.limit\(MAX_RECIPIENTS\)/);
  });

  it("skips a customer with no number to reach", () => {
    // Queueing an empty recipient gives the admin a row they can only
    // delete.
    expect(ANNOUNCE).toMatch(/\.neq\("phone", ""\)/);
    expect(ANNOUNCE).toMatch(/\.eq\("notify_new_products", true\)/);
  });

  it("sends nothing when the link would not be tappable", () => {
    // A relative path is unclickable in a text message, and a message
    // nobody can act on still costs the same to send.
    expect(ANNOUNCE).toMatch(/if \(!origin\) return \{ queued: 0, blocked: "no_origin" \};/);
  });

  it("never stops a product being saved", () => {
    // A broken message queue must not stop a shop adding stock.
    expect(ANNOUNCE).toMatch(
      /catch \(err\) \{[\s\S]*reportError\(err[\s\S]*blocked: "unavailable"/);
  });
});

describe("when the shop announces", () => {
  it("announces a new product after it has stock", () => {
    /* Announcing before the stock movement would link to "out of stock" --
       a shop advertising its own empty shelf, which is worse than silence. */
    const i = PRODUCTS.indexOf('setStock(made.id, input.qty, "opening balance"');
    const j = PRODUCTS.indexOf('"new_product"');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("announces a discount only when there was not one before", () => {
    /* An existing sale price being adjusted is not news. A shop that tweaks
       a sale three times must not tell everybody three times -- the index
       would swallow it, but it should not even be attempted. */
    expect(PRODUCTS).toMatch(/const hadDiscount = was\?\.discount_price != null/);
    expect(PRODUCTS).toMatch(/if \(!hadDiscount && discount != null\)/);
  });
});

describe("the queue keeps customers' numbers private", () => {
  it("is not readable through the public key", () => {
    /* Every row holds a phone number beside what that person was told. A
       public read would be a list of the shop's customers. RLS on with NO
       policy: the service role bypasses it, the anon key sees nothing
       rather than whatever a policy forgot to exclude. */
    expect(SQL).toMatch(/alter table customer_alerts enable row level security/);
    expect(SQL).toMatch(/revoke all on customer_alerts from anon, authenticated/);
    expect(SQL).not.toMatch(/create policy[\s\S]*on customer_alerts/);
  });
});

describe("one send path, not two", () => {
  it("dispatches through the function the order queue uses", () => {
    /* A second copy of "send it, record what happened" would drift from the
       first -- and the drift would show up as a message the admin cannot
       retry. */
    expect(ANNOUNCE).toMatch(/dispatchNotification\(/);
    const service = code("src/lib/notify/service.ts");
    expect(service).toMatch(/table: "notifications" \| "customer_alerts" = "notifications"/);
    expect(service).toMatch(/sb\.from\(table\)/);
  });
});

/* ---------------------------------------------------------------------------
   WHY NOBODY HEARD, said out loud
   ---------------------------------------------------------------------------
   Reported from a live shop: "when I add a new product, there is no
   notification to the customer." Nothing was broken in the queue. Three
   separate conditions switch the feature off -- an unset
   NEXT_PUBLIC_SITE_URL, an unrun migration, and nobody having opted in --
   and each returned a bare 0 while the screen that should have reported it
   printed "every message has been sent".

   These guards are about the diagnosis, not the sending.
   ------------------------------------------------------------------------ */

describe("a product a customer cannot open is not announced", () => {
  it("refuses a draft or an archived product", () => {
    /* THE BUG. The create path announced whatever it had just saved, and it
       saves a draft when the form says "not on sale" -- so the message
       linked to a page the public cannot open. Checked inside
       queueProductAlerts rather than at each call site, because there are
       three callers and each would have had to remember. */
    expect(ANNOUNCE).toMatch(
      /if \(product\.status !== "approved" \|\| product\.archived\) \{\s*\n?\s*return \{ queued: 0, blocked: "not_public" \};/);
  });

  it("is told what the product will be, not what it was", () => {
    /* The same save can publish a draft and cut its price. Announcing
       against the row's old status would either skip a message that should
       go or send one about a page that is still hidden. */
    /* TWICE, and that is the assertion: once in the insert and once in what
       is announced about it. Asserting it merely appears passed with the
       announcement's copy deleted -- the insert's own was left to find. */
    expect((PRODUCTS.match(/status: input\.onSale === false \? "pending" : "approved",/g) ?? []).length)
      .toBe(2);
    expect(PRODUCTS).toMatch(/\.select\("name, price, discount_price, status, archived"\)/);
  });
});

describe("every reason nothing went out has a name", () => {
  it("leaves no silent zero anywhere in the file", () => {
    /* The whole point. A bare `return 0` is indistinguishable, from the
       outside, from "nobody wanted this" -- which is how a switched-off
       feature survived four audits and a live shop's report. */
    expect(ANNOUNCE).not.toMatch(/return 0;/);
    for (const reason of ["not_public", "no_origin", "not_migrated",
                          "no_recipients", "already_announced", "unavailable"]) {
      expect(ANNOUNCE, reason).toContain('blocked: "' + reason + '"');
    }
  });

  it("tells a failed read apart from an empty one", () => {
    /* "Nobody has asked" is the ordinary state of a new shop and nothing to
       fix. Reporting a failed read as that is how a fault hides for a
       month, so the failure is reported and named separately. */
    expect(ANNOUNCE).toMatch(
      /if \(error\) \{[\s\S]{0,240}?reportError\([\s\S]{0,120}?blocked: "unavailable"/);
    expect(ANNOUNCE).toMatch(/if \(!customers\.length\) return \{ queued: 0, blocked: "no_recipients" \};/);
  });

  it("does not call the brake working a failure", () => {
    /* Zero queued after a SUCCESSFUL upsert means customer_alerts_once
       swallowed every row: everybody who wanted this already has it. */
    expect(ANNOUNCE).toMatch(/if \(!queued\) return \{ queued: 0, blocked: "already_announced" \};/);
  });
});

describe("the shop can see whether the promise is being kept", () => {
  it("checks the two things that switch announcements off silently", () => {
    expect(ANNOUNCE).toMatch(/export async function announceHealth\(\)/);
    expect(ANNOUNCE).toMatch(/const origin = !!\(process\.env\.NEXT_PUBLIC_SITE_URL \|\| ""\)\.trim\(\)/);
    /* THE customer_alerts LINE ITSELF. The window version passed with this
       probe rewritten to select("*"), because the customers count two lines
       below still carried a head: true for the regex to reach. */
    expect(ANNOUNCE).toMatch(
      /from\("customer_alerts"\)\.select\("id", \{ count: "exact", head: true \}\)/);
  });

  it("counts who would be reached without reading their numbers", () => {
    // The question is "how many", and the phone numbers are none of a
    // diagnostic's business.
    expect(ANNOUNCE).toMatch(
      /from\("customers"\)\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\n?\s*\.eq\("notify_new_products", true\)\.neq\("phone", ""\)/);
  });

  it("never throws, because a diagnostic that breaks the page is not one", () => {
    const fn = ANNOUNCE.slice(ANNOUNCE.indexOf("export async function announceHealth"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/\} catch \{/);
  });

  it("is only ready when a message would actually arrive", () => {
    // All three, not any: an address with no recipients reaches nobody, and
    // recipients with no address get an unclickable link.
    expect(ANNOUNCE).toMatch(/ready: origin && migrated && recipients > 0/);
  });
});

describe("the screen stops saying every message has been sent", () => {
  it("says it about the order queue only", () => {
    /* It used to be printed whenever BOTH queues were empty, which included
       every shop where announcements had never been queued at all. */
    expect(SCREEN).toMatch(/\{!pending\.length \? \(/);
    expect(SCREEN).not.toMatch(/!pending\.length && !alerts\.length/);
  });

  it("states the announcement position whether or not anything is queued", () => {
    // The interesting case is the empty one, so the panel is not inside the
    // "something is waiting" branch.
    expect(SCREEN).toMatch(/<AnnounceState health=\{announce\} lang=\{lang\} \/>/);
    /* ONCE, and after the conditional closes. The ordering-only version
       passed with a second copy added inside the else branch, which is the
       same bug in a different shape: the panel's job is to speak for the
       case where nothing is queued. */
    expect((SCREEN.match(/<AnnounceState/g) ?? []).length).toBe(1);
    expect(SCREEN.indexOf("<AnnounceState"))
      .toBeGreaterThan(SCREEN.indexOf("      )}"));
  });

  it("names the fix rather than only the fault", () => {
    /* "Announcements are off" that does not say what to change is a second
       thing to investigate, not an answer. */
    expect(PANEL).toContain("announceNoOrigin");
    expect(PANEL).toContain("announceNoTable");
    /* IN ALL THREE LANGUAGES. One regex across the whole entry passed with
       the Tetun copy gutted, leaving the shop whose own language it is the
       only one not told what to change. */
    for (const one of trio("announceNoOrigin")) {
      expect(one).toContain("NEXT_PUBLIC_SITE_URL");
    }
    for (const one of trio("announceNoTable")) {
      expect(one).toContain("customer-alerts.sql");
    }
  });

  it("does not print an empty shop as a fault", () => {
    // Nobody having ticked the box is not something to fix.
    expect(PANEL).toMatch(/!faults\.length && health\.recipients === 0/);
    expect(element(PANEL, "t(key, lang)")).toContain("var(--red)");
    /* The WHOLE element, tag included: slicing forward from the key started
       after the opening tag's attributes, so a colour added to the tag sat
       outside the window and the mutation survived. */
    expect(element(PANEL, "announceNoRecipients")).not.toContain("var(--red)");
  });

  it("says the same thing in all three languages", () => {
    for (const key of ["announceTitle", "announceNoOrigin", "announceNoTable",
                       "announceNoRecipients", "announceReady", "announceDraftNote"]) {
      const [tet, pt, en] = trio(key);
      expect(tet.length, key + " tet").toBeGreaterThan(0);
      expect(pt.length, key + " pt").toBeGreaterThan(0);
      expect(en.length, key + " en").toBeGreaterThan(0);
    }
  });
});
