import { describe, it, expect } from "vitest";
import {
  inviteState, inviteExpiry, INVITE_DAYS, INVITE_MESSAGE, type InviteRow,
} from "@/lib/sellerInvites";
import { STR } from "@/lib/i18n";

const NOW = new Date("2026-09-10T12:00:00Z");
const live = (over: Partial<InviteRow> = {}): InviteRow => ({
  expires_at: "2026-09-24T12:00:00Z", used_at: null, revoked_at: null, ...over,
});

describe("inviteState", () => {
  it("opens the door for a fresh link", () => {
    expect(inviteState(live(), NOW)).toBe("ok");
  });

  it("has nothing to say about a link that was never minted", () => {
    // A typo'd or truncated token reads as no row at all.
    expect(inviteState(null, NOW)).toBe("missing");
    expect(inviteState(undefined, NOW)).toBe("missing");
  });

  it("closes once a store has registered through it", () => {
    expect(inviteState(live({ used_at: "2026-09-11T09:00:00Z" }), NOW)).toBe("used");
  });

  it("closes when the owner withdraws it", () => {
    expect(inviteState(live({ revoked_at: "2026-09-11T09:00:00Z" }), NOW)).toBe("revoked");
  });

  it("closes at its expiry, not a moment after", () => {
    const at = live({ expires_at: NOW.toISOString() });
    expect(inviteState(at, NOW)).toBe("expired");
    expect(inviteState(live({ expires_at: "2026-09-10T12:00:01Z" }), NOW)).toBe("ok");
  });

  it("says USED, not EXPIRED, for a link that was used and then lapsed", () => {
    // The one that matters. Both are true of the row; only one is useful.
    // "Expired" sends somebody back to ask for another link when they
    // already have a store and simply need to sign in.
    expect(inviteState(
      live({ expires_at: "2026-08-01T00:00:00Z", used_at: "2026-07-20T00:00:00Z" }), NOW
    )).toBe("used");
  });

  it("says REVOKED, not EXPIRED, for one the owner withdrew and then let lapse", () => {
    expect(inviteState(
      live({ expires_at: "2026-08-01T00:00:00Z", revoked_at: "2026-07-20T00:00:00Z" }), NOW
    )).toBe("revoked");
  });
});

describe("inviteExpiry", () => {
  it("lasts a fortnight from when it was made", () => {
    expect(inviteExpiry(NOW)).toBe("2026-09-24T12:00:00.000Z");
  });

  it("produces a link that is immediately valid and later is not", () => {
    const row = { expires_at: inviteExpiry(NOW), used_at: null, revoked_at: null };
    expect(inviteState(row, NOW)).toBe("ok");
    expect(inviteState(row, new Date(NOW.getTime() + (INVITE_DAYS + 1) * 864e5))).toBe("expired");
  });
});

describe("INVITE_MESSAGE", () => {
  it("explains every closed state in words that exist", () => {
    // A link that stops working with no sentence attached is a person
    // messaging the owner to ask what happened.
    for (const [state, key] of Object.entries(INVITE_MESSAGE)) {
      expect([state, key in STR]).toEqual([state, true]);
    }
  });

  it("covers every state except the one that needs no explaining", () => {
    expect(Object.keys(INVITE_MESSAGE).sort())
      .toEqual(["expired", "missing", "revoked", "used"]);
  });
});
