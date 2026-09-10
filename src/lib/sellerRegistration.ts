/* What is wrong with this registration, said before it is sent.
 *
 * The form used to post whatever was typed and print whatever came back.
 * What came back was Supabase Auth's own sentence -- "Unable to validate
 * email address: invalid format" -- in grey, in English, under a field
 * that was nowhere near the email box, after a round trip. Three separate
 * failures in one line: it is not in the shopper's language, it does not
 * say which box, and it took a server call to discover something the
 * browser knew before the button was pressed.
 *
 * So the checks that can be made here are made here, in i18n keys rather
 * than sentences, and the ones only the server can make (is this address
 * already registered) are TRANSLATED on the way back instead of shown raw.
 *
 * Pure and free of I/O, so every rule below is testable without a network.
 */

export interface RegistrationFields {
  fullName: string;
  storeName: string;
  email: string;
  phone: string;
  password: string;
}

/** Which box is wrong, and the i18n key saying why. */
export interface FieldProblem {
  field: keyof RegistrationFields;
  key: string;
}

/** The shortest password the server will take. Stated here as well so the
 * form can say so before asking. */
export const MIN_PASSWORD = 8;

/** Deliberately permissive: something, an @, something, a dot, and at
 * least two more characters. It is not this function's job to decide
 * whether a domain exists -- only to catch "aaaa", which is what a person
 * types when they are testing a form and then wonders why the shop broke.
 * Anything subtler is the mail server's answer to give, later. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** At least six digits somewhere in it, and no rule about WHICH digits.
 *
 * The checkout can insist on +670 and eight digits because its buyers are
 * in Timor-Leste. A seller need not be: the form has a Country field, and
 * a store shipping in from Portugal or Indonesia has a Portuguese or
 * Indonesian number. So the checkout's badPhone message, which names +670,
 * is the wrong sentence here -- regBadPhone asks for a country code
 * instead. The shop's buyers already type their own number in half a dozen
 * shapes (+670 7712 3456, 77123456, 670-7712-3456) and every one of them
 * is real, which is why this counts digits rather than matching a shape. */
function phoneDigits(raw: string): number {
  return (raw.match(/\d/g) || []).length;
}

/** Everything wrong with the form, in the order the fields appear -- so
 * the first problem named is the first one the eye reaches. */
export function checkRegistration(f: RegistrationFields): FieldProblem[] {
  const out: FieldProblem[] = [];
  if (!f.fullName.trim()) out.push({ field: "fullName", key: "required" });
  if (!f.storeName.trim()) out.push({ field: "storeName", key: "required" });

  if (!f.email.trim()) out.push({ field: "email", key: "required" });
  else if (!EMAIL.test(f.email.trim())) out.push({ field: "email", key: "regBadEmail" });

  if (!f.phone.trim()) out.push({ field: "phone", key: "required" });
  else if (phoneDigits(f.phone) < 6) out.push({ field: "phone", key: "regBadPhone" });

  if (!f.password) out.push({ field: "password", key: "required" });
  else if (f.password.length < MIN_PASSWORD) out.push({ field: "password", key: "regShortPassword" });

  return out;
}

/** Turns what the server said into something the person can act on.
 *
 * Supabase Auth answers in English with its own wording, and that wording
 * changes between releases -- so this matches on the recognisable part
 * rather than the whole sentence, and falls through to a general "that did
 * not work" rather than inventing a reason. Never returns the raw message:
 * a registration form is not the place to show somebody another system's
 * internals. */
export function authErrorKey(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")
      || m.includes("user already exists")) return "regEmailTaken";
  if (m.includes("invalid format") || m.includes("validate email")
      || m.includes("invalid email")) return "regBadEmail";
  if (m.includes("password")) return "regShortPassword";
  if (m.includes("invitation")) return "inviteMissing";
  if (m.includes("rate") || m.includes("too many")) return "tooManyTries";
  return "regFailed";
}
