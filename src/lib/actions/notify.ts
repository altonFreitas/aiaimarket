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
