"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerSeller } from "@/lib/actions/seller-auth";
import PasswordField from "@/components/PasswordField";
import { checkRegistration, authErrorKey, MIN_PASSWORD, type FieldProblem } from "@/lib/sellerRegistration";
import { t } from "@/lib/i18n";
import type { Lang, SellerType } from "@/lib/types";

/** How long the green notice stays before the shop takes over. Long
 * enough to read two sentences, short enough not to feel stuck. */
const HOME_AFTER_MS = 6000;

/** The label each box carries, so a problem names the field the way the
 * form does rather than by its variable name. */
const LABEL: Record<string, string> = {
  fullName: "fullName", storeName: "storeName", email: "email",
  phone: "phone", password: "password",
};

export default function RegisterForm({
  lang, inviteToken,
}: {
  lang: Lang;
  /** The token from the link that got them here. Carried through rather
   * than re-read from the URL in the action: a server action has no
   * address bar. */
  inviteToken: string;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    fullName: "", storeName: "", email: "", phone: "", password: "",
    description: "", address: "", city: "", country: "",
  });
  const [sellerType, setSellerType] = useState<SellerType>("individual");
  const [pending, setPending] = useState(false);
  /* Two shapes of failure, kept apart because they are answered
     differently. `problems` are the boxes the person can go and fix, each
     one named; `error` is the single sentence for something only the
     server knew -- an address already registered, an invitation just
     used. Both render as one red notice. */
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  /* The notice says WHAT is wrong; this says WHERE. A list of problems
     above a form of nine identical boxes still leaves the reader counting
     down from the top. */
  const bad = (k: string) => problems.some((p) => p.field === k);
  const fieldClass = (k: string) => "field" + (bad(k) ? " err" : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Everything the browser already knows, before a round trip. The email
    // that started this -- "aaaa" -- used to reach Supabase Auth and come
    // back as its own English sentence about an invalid format.
    const found = checkRegistration(f);
    setProblems(found);
    if (found.length) {
      document.getElementById(found[0].field)?.focus();
      return;
    }

    setPending(true);
    try {
      await registerSeller({ ...f, sellerType, inviteToken });
      setDone(true);
    } catch (err) {
      // Translated, never shown raw: a registration form is not the place
      // to print another system's internals at somebody.
      setError(t(authErrorKey((err as Error).message || ""), lang)
        .replace("{n}", String(MIN_PASSWORD)));
    }
    setPending(false);
  }

  /* Back to the shop on its own, once the good news has been on screen
     long enough to read. Somebody who has just registered has nothing
     more to do here and cannot sign in yet -- their store is pending --
     so leaving them on a finished form is leaving them nowhere. The link
     below is for whoever does not want to wait. */
  useEffect(() => {
    if (!done) return;
    const go = setTimeout(() => router.push("/"), HOME_AFTER_MS);
    return () => clearTimeout(go);
  }, [done, router]);

  if (done) {
    return (
      <div className="panel">
        <h1>{t("sellerRegisterTitle", lang)}</h1>
        {/* Green, and it says what happens next rather than only that
            something happened. The old screen offered a dashboard button,
            which took a pending seller to a page that could not let them
            do anything. */}
        <div className="note ok" role="status">
          <b>✓ {t("regDoneTitle", lang)}</b>
          {t("regDoneBody", lang)}
        </div>
        <p className="hint">{t("regGoingHome", lang)}</p>
        <Link className="btn btn-amber" href="/">{t("regGoHomeNow", lang)}</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="panel">
        <h1>{t("sellerRegisterTitle", lang)}</h1>
        <p className="sub">{t("sellerRegisterSub", lang)}</p>

        <div className={fieldClass("fullName")}>
          <label htmlFor="fullName">{t("fullName", lang)}</label>
          <input id="fullName" required value={f.fullName} onChange={set("fullName")} />
        </div>
        <div className={fieldClass("storeName")}>
          <label htmlFor="storeName">{t("storeName", lang)}</label>
          <input id="storeName" required value={f.storeName} onChange={set("storeName")} />
        </div>
        <div className="two">
          <div className={fieldClass("email")}>
            <label htmlFor="email">{t("email", lang)}</label>
            <input id="email" type="email" required value={f.email} onChange={set("email")} />
          </div>
          <div className={fieldClass("phone")}>
            <label htmlFor="phone">{t("phone", lang)}</label>
            <input id="phone" required value={f.phone} onChange={set("phone")} />
          </div>
        </div>
        <PasswordField id="password" label={t("password", lang)} value={f.password}
          onChange={(v) => setF((s) => ({ ...s, password: v }))}
          autoComplete="new-password" minLength={MIN_PASSWORD} required invalid={bad("password")} />
        <div className="field">
          <label htmlFor="description">{t("description", lang)}</label>
          <textarea id="description" value={f.description} onChange={set("description")} />
        </div>
        <div className="field">
          <label htmlFor="address">{t("sellerAddress", lang)}</label>
          <input id="address" value={f.address} onChange={set("address")} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="city">{t("city", lang)}</label>
            <input id="city" value={f.city} onChange={set("city")} />
          </div>
          <div className="field">
            <label htmlFor="country">{t("country", lang)}</label>
            <input id="country" value={f.country} onChange={set("country")} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sellerType">{t("sellerTypeLabel", lang)}</label>
          <select id="sellerType" value={sellerType} onChange={(e) => setSellerType(e.target.value as SellerType)}>
            <option value="individual">{t("sellerTypeIndividual", lang)}</option>
            <option value="business">{t("sellerTypeBusiness", lang)}</option>
          </select>
        </div>

        {/* One red notice for both shapes of failure. role="alert" so a
            screen reader is told, and the list names the boxes -- the old
            version printed one grey line that said neither which field nor
            what to do about it. */}
        {(problems.length > 0 || error) && (
          // A div, not a p: a <ul> inside a <p> closes the paragraph early
          // and the list escapes the notice it belongs to.
          <div className="note bad" role="alert">
            <b>✕ {error || t("regCheckForm", lang)}</b>
            {!error && (
              <ul>
                {problems.map((p) => (
                  <li key={p.field}>{t(LABEL[p.field], lang)}: {t(p.key, lang).replace("{n}", String(MIN_PASSWORD))}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={pending}>
            {pending ? "…" : t("createAccount", lang)}
          </button>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          {t("alreadyHaveSellerAccount", lang)} <Link href="/account">{t("logIn", lang)}</Link>
        </p>
      </div>
    </form>
  );
}
