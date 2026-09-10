import { describe, it, expect } from "vitest";
import {
  checkRegistration, authErrorKey, MIN_PASSWORD, type RegistrationFields,
} from "@/lib/sellerRegistration";
import { STR } from "@/lib/i18n";

const ok = (over: Partial<RegistrationFields> = {}): RegistrationFields => ({
  fullName: "Jorge Freitas", storeName: "AITA Store",
  email: "jorge@example.com", phone: "+670 7712 3456", password: "12345678",
  ...over,
});

describe("checkRegistration", () => {
  it("passes a filled-in form", () => {
    expect(checkRegistration(ok())).toEqual([]);
  });

  it("catches the email that started this", () => {
    // "aaaa" typed into the email box. It used to reach Supabase, come back
    // as "Unable to validate email address: invalid format" in English, and
    // print in grey under the wrong field.
    expect(checkRegistration(ok({ email: "aaaa" }))).toEqual([
      { field: "email", key: "regBadEmail" },
    ]);
  });

  it("wants an @ and a domain with a dot in it", () => {
    for (const bad of ["a@b", "a@b.c", "@example.com", "jorge@", "jorge example@x.com"]) {
      expect([bad, checkRegistration(ok({ email: bad })).length]).toEqual([bad, 1]);
    }
  });

  it("accepts the ordinary addresses people actually have", () => {
    for (const good of [
      "alton.freitas@icloud.com", "a@b.co", "jorge+shop@gmail.com",
      "loja_aiai@mail.tl", "JORGE@EXAMPLE.COM",
    ]) {
      expect([good, checkRegistration(ok({ email: good }))]).toEqual([good, []]);
    }
  });

  it("takes a phone number in whatever shape it was typed", () => {
    for (const good of ["+670 7712 3456", "77123456", "670-7712-3456", "(+670) 77 12 34 56"]) {
      expect([good, checkRegistration(ok({ phone: good }))]).toEqual([good, []]);
    }
  });

  it("takes a foreign number, because a seller need not be in Timor-Leste", () => {
    // The form has a Country field and the owner's own test data was
    // Portugal. The checkout's +670 rule is the wrong rule here.
    for (const good of ["+351 912 345 678", "+62 811 2233 44", "+61 400 000 000"]) {
      expect([good, checkRegistration(ok({ phone: good }))]).toEqual([good, []]);
    }
  });

  it("refuses something that is not a phone number", () => {
    expect(checkRegistration(ok({ phone: "aaaa" }))).toEqual([
      { field: "phone", key: "regBadPhone" },
    ]);
  });

  it("says the password is short rather than letting the server say it", () => {
    expect(checkRegistration(ok({ password: "1234567" }))).toEqual([
      { field: "password", key: "regShortPassword" },
    ]);
    expect(checkRegistration(ok({ password: "1".repeat(MIN_PASSWORD) }))).toEqual([]);
  });

  it("names an empty field as required rather than as badly formatted", () => {
    // "This is required" and "this is not an email address" are different
    // problems and lead to different actions.
    expect(checkRegistration(ok({ email: "" }))).toEqual([{ field: "email", key: "required" }]);
    expect(checkRegistration(ok({ phone: "  " }))).toEqual([{ field: "phone", key: "required" }]);
  });

  it("reports every problem at once, in the order the fields appear", () => {
    // Fixing one thing, pressing the button, and being told about the next
    // is how a five-field form takes five round trips.
    const problems = checkRegistration({
      fullName: "", storeName: "", email: "aaaa", phone: "aaaa", password: "1",
    });
    expect(problems.map((p) => p.field)).toEqual([
      "fullName", "storeName", "email", "phone", "password",
    ]);
  });

  it("names only keys the app can actually say", () => {
    const problems = checkRegistration({
      fullName: "", storeName: "", email: "x", phone: "x", password: "x",
    });
    for (const p of problems) expect([p.key, p.key in STR]).toEqual([p.key, true]);
  });
});

describe("authErrorKey", () => {
  it("recognises the address that is already registered", () => {
    expect(authErrorKey("User already registered")).toBe("regEmailTaken");
    expect(authErrorKey("A user with this email address has already been registered"))
      .toBe("regEmailTaken");
  });

  it("recognises Supabase's own wording for a bad address", () => {
    expect(authErrorKey("Unable to validate email address: invalid format"))
      .toBe("regBadEmail");
  });

  it("falls through rather than inventing a reason", () => {
    // The wording changes between releases. An unrecognised failure is
    // "that did not work", never the raw sentence -- a registration form
    // is not the place to show somebody another system's internals.
    expect(authErrorKey("upstream connect error or disconnect")).toBe("regFailed");
    expect(authErrorKey("")).toBe("regFailed");
  });

  it("only returns keys the app can say", () => {
    const messages = [
      "User already registered", "Unable to validate email address: invalid format",
      "Password should be at least 6 characters", "This invitation link is not valid",
      "Too many requests", "something else entirely", "",
    ];
    for (const m of messages) {
      const key = authErrorKey(m);
      expect([m, key in STR]).toEqual([m, true]);
    }
  });
});
