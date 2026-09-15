import "server-only";
import nodemailer from "nodemailer";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { storeStamp, STORE_TZ } from "@/lib/tz";

/** Emails the admin (ADMIN_EMAIL, same account used to log into
 * /admin) whenever someone applies to become a seller, so review
 * doesn't require checking the admin panel proactively.
 *
 * Uses Gmail SMTP with an App Password rather than a new third-party
 * email service — no new account to sign up for, since ADMIN_EMAIL is
 * already a Gmail address. Requires a one-time setup step: generate an
 * App Password at https://myaccount.google.com/apppasswords for that
 * Gmail account, then set GMAIL_APP_PASSWORD in .env.local.
 *
 * Deliberately never throws: a notification failing to send must never
 * block or break the seller's registration. */
export async function notifyAdminNewSeller(seller: {
  full_name: string;
  store_name: string;
  email: string;
  phone: string;
}) {
  const user = process.env.ADMIN_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn(
      "GMAIL_APP_PASSWORD is not set — skipping the admin seller-application notification email. " +
      "See lib/actions/notify.ts for setup."
    );
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `"Loja AIAI" <${user}>`,
      to: user,
      subject: `New seller application: ${seller.store_name}`,
      text: [
        `${seller.full_name} applied to become a seller.`,
        "",
        `Store name: ${seller.store_name}`,
        `Email: ${seller.email}`,
        `Phone: ${seller.phone}`,
        "",
        "Review it in your admin panel: /admin/sellers",
      ].join("\n"),
    });
  } catch (e) {
    console.error("Failed to send admin seller-application notification email:", e);
  }
}

/** Sent to the seller's OWN address, not the admin — every time a
 * seller completes a 2FA-verified login. This is the point of 2FA
 * notifications generally: if it wasn't really them, they'd see this
 * and know to act, even if their password was compromised. Same Gmail
 * SMTP setup as notifyAdminNewSeller() above — no separate
 * configuration needed. Deliberately never throws, same reasoning: a
 * notification email failing to send must never block a real login. */
export async function notifySellerLogin(seller: { store_name: string; email: string }) {
  const user = process.env.ADMIN_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn(
      "GMAIL_APP_PASSWORD is not set — skipping the seller 2FA login notification email. " +
      "See lib/actions/notify.ts for setup."
    );
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `"Loja AIAI" <${user}>`,
      to: seller.email,
      subject: `New login to your ${seller.store_name} account`,
      text: [
        `Someone just logged into your Loja AIAI seller account (${seller.store_name}) and verified it with your two-factor code.`,
        "",
        // The SHOP's clock, and named, because this is the line the
        // seller reads to decide whether the login was theirs. Rendered
        // with the server's own timezone it said UTC -- nine hours off
        // Dili -- which is exactly enough to make a login they made
        // themselves look like one they did not.
        `Time: ${storeStamp(Date.now())} (${STORE_TZ})`,
        "",
        "If this wasn't you, contact us right away and change your password.",
      ].join("\n"),
    });
  } catch (e) {
    console.error("Failed to send seller 2FA login notification email:", e);
  }
}

/** Told to the seller when the owner approves their store.
 *
 * BOTH CHANNELS, because a marketplace in Timor-Leste reaches people on
 * WhatsApp and not always by email -- the registration form asks for both
 * for exactly this moment. Each is attempted independently: an unset
 * Gmail app password must not cost them the SMS, and no SMS gateway must
 * not cost them the email.
 *
 * Never throws, and never blocks the approval. The owner has pressed
 * Approve; the store IS approved whether or not the good news got through,
 * and a failed message must not make the button look broken. What goes
 * wrong goes to the server log, which is where the rest of this file puts
 * it too.
 *
 * THE LANGUAGE is the one the owner is reading the admin in. There is no
 * language on a seller row to do better with -- the checkout captures
 * orders.lang for exactly this reason and registration has no equivalent
 * -- and owner and seller are in the same country. Worth revisiting the
 * day a seller writes in asking why the message was in Portuguese.
 */
export async function notifySellerApproved(seller: {
  store_name: string;
  email: string;
  phone: string;
  lang: Lang;
}) {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  const subject = t("sellerApprovedSubject", seller.lang);
  const body = t("sellerApprovedBody", seller.lang)
    .replace("{store}", seller.store_name)
    .replace("{url}", `${origin}/account`);

  await Promise.allSettled([sendApprovalEmail(seller.email, subject, body), sendApprovalSms(seller.phone, body)]);
}

async function sendApprovalEmail(to: string, subject: string, body: string) {
  const user = process.env.ADMIN_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass || !to.trim()) {
    console.warn("GMAIL_APP_PASSWORD or the seller's email is missing — skipping the approval email.");
    return;
  }
  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transporter.sendMail({
      from: `"Loja AIAI" <${user}>`, to, subject, text: body,
    });
  } catch (e) {
    console.error("Failed to send the seller approval email:", e);
  }
}

async function sendApprovalSms(phone: string, body: string) {
  if (!phone.trim()) return;
  try {
    const { activeProvider } = await import("@/lib/notify/registry");
    const provider = activeProvider();
    // No gateway configured is a supported state, not a failure -- the
    // same contract the order notifications work under. The email above
    // still went, and the owner can always message them directly.
    if (!provider) return;
    const result = await provider.send(phone, body);
    if (!result.ok) console.error("Failed to send the seller approval SMS:", result.error);
  } catch (e) {
    console.error("Failed to send the seller approval SMS:", e);
  }
}
