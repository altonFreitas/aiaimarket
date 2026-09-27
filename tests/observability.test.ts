import { describe, it, expect, vi, afterEach } from "vitest";
import { reportError, reportWarning } from "@/lib/observability";

/* AN ALERT THAT SAYS NOTHING IS WORSE THAN NO ALERT.
 *
 * reportError writes one line of JSON to stderr and, when
 * ERROR_WEBHOOK_URL is set, posts the same thing somewhere a person
 * actually reads. The line said:
 *
 *     {"level":"error","message":"[object Object]","scope":"reconcile-payments"}
 *
 * because it took `err.message` only when `err instanceof Error` -- and
 * this shop's commonest failure is the one thing that is not an Error:
 * supabase-js does not throw, it RETURNS a PostgrestError, a plain object
 * with message, code, details and hint. Somebody had been told there was a
 * problem and given no way to find it.
 *
 * Caught by running the four scheduled jobs against an unreachable
 * database -- which is exactly the state a badly configured container is
 * in, and the state the person reading the alert most needs described.
 */

const capture = () => vi.spyOn(console, "error").mockImplementation(() => {});
const line = (spy: ReturnType<typeof capture>) =>
  JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;

afterEach(() => { vi.restoreAllMocks(); });

describe("an error says what went wrong", () => {
  it("reads the message off a Supabase error, which is not an Error", () => {
    const spy = capture();
    reportError(
      { message: "relation \"orders\" does not exist", code: "42P01",
        details: null, hint: null },
      { scope: "reconcile-payments" },
    );
    expect(line(spy).message).toBe('relation "orders" does not exist');
    expect(line(spy).code).toBe("42P01");
  });

  it("still reads a real Error, with its stack", () => {
    const spy = capture();
    reportError(new Error("boom"), { scope: "test" });
    expect(line(spy).message).toBe("boom");
    expect(String(line(spy).stack)).toContain("boom");
  });

  it("carries no stack for something that is not an Error", () => {
    // There is none to carry, and "undefined" in a log line is noise.
    const spy = capture();
    reportError({ message: "nope" }, { scope: "test" });
    expect(line(spy).stack).toBeUndefined();
  });

  it("leaves out the fields Postgres fills with the offending row", () => {
    /* details and hint quote the value that broke the constraint --
       "Key (phone)=(+670 7712 3456) already exists" -- and a log line is
       not a place to put a customer's phone number. */
    const spy = capture();
    reportError(
      { message: "duplicate key value", code: "23505",
        details: "Key (phone)=(+670 77123456) already exists.",
        hint: "use a different phone" },
      { scope: "checkout" },
    );
    const out = line(spy);
    expect(out.details).toBeUndefined();
    expect(out.hint).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("77123456");
  });

  it("falls back to String for anything else", () => {
    const spy = capture();
    reportError("just a string", { scope: "test" });
    expect(line(spy).message).toBe("just a string");
    reportError(null, { scope: "test" });
    expect(JSON.parse(String(spy.mock.calls[1][0])).message).toBe("null");
  });

  it("does not mistake an object with no message for a described error", () => {
    const spy = capture();
    reportError({ code: "X" }, { scope: "test" });
    expect(line(spy).message).toBe("[object Object]");
    // ...but the code is still there, which is more than there was.
    expect(line(spy).code).toBe("X");
  });

  it("still redacts the context it is given", () => {
    const spy = capture();
    reportError(new Error("x"), { scope: "pay", password: "hunter2" });
    expect(line(spy).password).toBe("[redacted]");
  });
});

describe("a warning is unchanged", () => {
  it("prints the message it was handed", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportWarning("Rejected unauthenticated cron request", { scope: "send-queued" });
    const out = JSON.parse(String(spy.mock.calls[0][0]));
    expect(out.message).toBe("Rejected unauthenticated cron request");
    expect(out.level).toBe("warn");
  });
});
