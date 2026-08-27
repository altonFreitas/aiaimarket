import { describe, it, expect } from "vitest";
import {
  countClearableNotifications, canClearOrderNotifications,
} from "@/lib/notify/clearability";
import type { NotifyStatus, Order } from "@/lib/types";

describe("countClearableNotifications", () => {
  it("counts sent and skipped, nothing else", () => {
    const statuses: NotifyStatus[] = ["sent", "skipped", "queued", "failed", "sent"];
    expect(countClearableNotifications(statuses)).toBe(3);
  });

  it("returns 0 for an empty history", () => {
    expect(countClearableNotifications([])).toBe(0);
  });

  it("returns 0 when nothing has actually gone out yet", () => {
    expect(countClearableNotifications(["queued", "failed"])).toBe(0);
  });
});

describe("canClearOrderNotifications", () => {
  const ALL_STATUSES: Order["status"][] = [
    "new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled",
  ];

  it("refuses every non-terminal status, even with sent messages sitting there", () => {
    // The order can still change; a message row is evidence of what the
    // buyer was told about a state that has not been decided yet.
    for (const status of ALL_STATUSES) {
      if (status === "completed" || status === "cancelled") continue;
      expect(canClearOrderNotifications(status, ["sent", "sent"]), status).toBe(false);
    }
  });

  it("allows completed and cancelled, but only once something is clearable", () => {
    for (const status of ["completed", "cancelled"] as const) {
      expect(canClearOrderNotifications(status, []), status).toBe(false);
      expect(canClearOrderNotifications(status, ["queued"]), status).toBe(false);
      expect(canClearOrderNotifications(status, ["failed"]), status).toBe(false);
      expect(canClearOrderNotifications(status, ["sent"]), status).toBe(true);
      expect(canClearOrderNotifications(status, ["skipped"]), status).toBe(true);
    }
  });

  it("stays true even when an unrelated queued/failed row is also present", () => {
    // A leftover 'failed' row is left in place by the delete, but its
    // presence must not hide the button for the sent rows sitting next to it.
    expect(canClearOrderNotifications("completed", ["sent", "failed"])).toBe(true);
    expect(canClearOrderNotifications("cancelled", ["queued", "skipped"])).toBe(true);
  });
});
