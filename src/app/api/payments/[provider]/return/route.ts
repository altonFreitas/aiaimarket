import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { confirmPaymentFromProvider } from "@/lib/payments/service";
import { reportError } from "@/lib/observability";

/** Where the gateway sends the buyer's browser when they are done.
 *
 * This route decides NOTHING about whether the payment succeeded. The query
 * string it receives arrives via the buyer's own browser and can say
 * anything at all -- "?status=paid" included. All it does is take the
 * payment id as a hint that it is worth asking the gateway directly
 * (confirmPaymentFromProvider does a server-to-server call), then send the
 * buyer to their order page to see whatever the truth turned out to be.
 *
 * If the webhook already arrived, that call is a no-op duplicate and gets
 * ignored by the state machine. If the webhook is delayed or lost, this is
 * what stops the buyer staring at "unpaid" after a successful payment.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const paymentId = req.nextUrl.searchParams.get("p") || "";

  const home = new URL("/", req.nextUrl.origin);
  if (!paymentId) return NextResponse.redirect(home);

  let orderRef: string | null = null;

  try {
    // Resolve which order to send them to BEFORE confirming, so a gateway
    // timeout still lands the buyer somewhere useful rather than on the
    // homepage wondering what happened to their money.
    const sb = supabaseAdmin();
    const { data: payment } = await sb
      .from("payments")
      .select("id, order_id, orders(ref)")
      .eq("id", paymentId)
      .maybeSingle();

    const joined = payment?.orders as { ref?: string } | { ref?: string }[] | null | undefined;
    orderRef = Array.isArray(joined) ? joined[0]?.ref ?? null : joined?.ref ?? null;

    if (payment) {
      await confirmPaymentFromProvider(paymentId);
    }
  } catch (err) {
    // Never surface a gateway error to the buyer here. The webhook is the
    // authoritative path and will settle this regardless.
    reportError(err, { scope: "payment-return", provider, paymentId });
  }

  const dest = orderRef ? new URL(`/o/${encodeURIComponent(orderRef)}`, req.nextUrl.origin) : home;
  return NextResponse.redirect(dest);
}
