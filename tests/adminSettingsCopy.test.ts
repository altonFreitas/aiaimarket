import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STR } from "@/lib/i18n";

const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const TOTP = read("src", "components", "admin", "AdminTotpSettings.tsx");
const SELLER_TOTP = read("src", "components", "seller", "SellerTotpSettings.tsx");
const SCHEMA = read("src", "components", "admin", "SchemaHealth.tsx");
const SETTINGS = read("src", "components", "admin", "SettingsAdmin.tsx");
const OPEN_READY = read("src", "components", "admin", "OpenReadiness.tsx");
const PAY_READY = read("src", "components", "admin", "PaymentReadiness.tsx");
const SETTINGS_PAGE = read("src", "app", "admin", "settings", "page.tsx");

/* The owner asked for six standing explanations to go from /admin/settings.
 * They are read once and then sit there forever, and the screen is long
 * enough that what is left has to be worth the scroll. */

describe("the explanations removed from /admin/settings", () => {
  it("no longer defines the strings that were only ever those lines", () => {
    // Deleted outright rather than orphaned in the table: a string nothing
    // renders is one a translator still has to carry in three languages.
    for (const key of [
      "legalFactsHint", "readyIntro", "adminTotpHint",
      "sessionLengthHint", "sessionLength", "payGatewaysHint",
      "schemaAllApplied",
    ]) {
      expect(STR, `${key} should be gone from the string table`)
        .not.toHaveProperty(key);
    }
  });

  it("renders none of them back", () => {
    expect(SETTINGS).not.toContain("legalFactsHint");
    expect(OPEN_READY).not.toContain("readyIntro");
    expect(PAY_READY).not.toContain("payGatewaysHint");
    expect(TOTP).not.toContain("adminTotpHint");
    expect(TOTP).not.toContain("sessionLengthHint");
    expect(SCHEMA).not.toContain("schemaAllApplied");
  });

  it("drops the 2FA explanation and status sentence from the owner's panel", () => {
    expect(TOTP).not.toContain("twoFactorAuthHint");
    expect(TOTP).not.toContain("totpStatusOn");
    expect(TOTP).not.toContain("totpStatusOff");
  });
});

describe("what the removals must not cost", () => {
  it("still says whether the owner's 2FA is on, through the button", () => {
    // The removed sentence was the only place that said "On". It is not
    // missed because the control underneath reads Enable or Disable
    // according to the same flag -- but only while BOTH branches are
    // there. Losing that would leave a switch with no state.
    //
    // Scoped to the status view and matched on the whole rendered
    // expression, because a bare toContain("totpEnable") is satisfied by
    // the toast key totpEnabledToast further up the file -- it would pass
    // with both buttons deleted.
    const status = TOTP.slice(
      TOTP.indexOf('{view.name === "status" && ('),
      TOTP.indexOf('{view.name === "setup" && ('));
    expect(status).not.toBe("");
    expect(status).toContain("{enabled ? (");
    expect(status).toContain('{t("totpDisable", lang)}');
    expect(status).toContain('{busy ? "…" : t("totpEnable", lang)}');
  });

  it("leaves the seller's own 2FA screen exactly as it was", () => {
    // The request was about /admin/settings. The hint and the status line
    // are shared strings, so removing the KEYS would have silently
    // stripped a screen nobody asked about.
    expect(SELLER_TOTP).toContain("twoFactorAuthHint");
    expect(SELLER_TOTP).toContain("totpStatusOn");
    expect(SELLER_TOTP).toContain("totpStatusOff");
    for (const key of ["twoFactorAuthHint", "totpStatusOn", "totpStatusOff"]) {
      expect(STR).toHaveProperty(key);
    }
  });

  it("still reports outstanding and unchecked SQL files", () => {
    // Only the all-clear line went. The three that report a problem are
    // the reason the panel exists.
    expect(SCHEMA).toContain("schemaOutstandingOne");
    expect(SCHEMA).toContain("schemaOutstanding");
    expect(SCHEMA).toContain("schemaSomeUnchecked");
  });

  it("puts the schema line behind a condition rather than leaving it empty", () => {
    // Deleting just the final branch of the ternary would have rendered an
    // empty <p> on the happy path -- a blank gap above the rows.
    const guard = SCHEMA.indexOf("{(outstanding.length > 0 || unchecked.length > 0) && (");
    const para = SCHEMA.indexOf('<p className="hint" style={{ marginTop: 0 }}>');
    expect(guard).toBeGreaterThan(-1);
    expect(para).toBeGreaterThan(guard);
  });

  it("stops threading a session length nothing displays any more", () => {
    // The prop existed only to fill the removed sentence.
    expect(TOTP).not.toContain("sessionMinutes");
    expect(SETTINGS_PAGE).not.toContain("sessionMinutes");
  });
});
