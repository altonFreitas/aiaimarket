import "server-only";
import nodemailer from "nodemailer";

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
        `Time: ${new Date().toLocaleString()}`,
        "",
        "If this wasn't you, contact us right away and change your password.",
      ].join("\n"),
    });
  } catch (e) {
    console.error("Failed to send seller 2FA login notification email:", e);
  }
}
