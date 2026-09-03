/** Refusing somebody is not a crash.
 *
 * A read-only account reaching a write is an ANSWER -- "no" -- not a fault
 * in the program. It still has to throw, because the action must stop
 * before it touches the database and returning a value would let a
 * forgetful caller carry on regardless. But it should not be reported like
 * a bug.
 *
 * The stack is what makes the difference. Next resolves the topmost frame
 * back to source and prints the surrounding lines, so an ordinary Error
 * fills the terminal with a code frame pointing at the guard -- which is
 * working exactly as intended. With no frames there is nothing to resolve,
 * and the server logs one line saying who was refused and what they tried.
 *
 * WHY THERE IS STILL A LINE. The buttons that would call these actions are
 * hidden from a read-only account, so reaching one means either a page
 * left open from before their access changed, or a request that did not
 * come from the interface at all. The first is harmless and the person
 * sees a message; the second is worth knowing about. Silence would hide
 * both. */
export class PermissionError extends Error {
  readonly permission = true;

  constructor(message: string, context?: string) {
    super(message);
    this.name = "NotAllowed";
    // One line, no code frame: this is a decision, not a defect.
    this.stack = `NotAllowed: ${context || message}`;
  }
}

/** True for a refusal, so a caller can tell "you may not" apart from
 * "something broke" without matching on the message text. */
export function isPermissionError(e: unknown): boolean {
  return e instanceof PermissionError
    || (typeof e === "object" && e !== null && "permission" in e && !!(e as { permission?: unknown }).permission);
}
