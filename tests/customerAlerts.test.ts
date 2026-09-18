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
    expect(ANNOUNCE).toMatch(/if \(!provider \|\| !queued\) return queued;/);
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
    expect(ANNOUNCE).toMatch(/if \(!origin\) return 0;/);
  });

  it("never stops a product being saved", () => {
    // A broken message queue must not stop a shop adding stock.
    expect(ANNOUNCE).toMatch(/catch \(err\) \{[\s\S]*return 0;/);
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
