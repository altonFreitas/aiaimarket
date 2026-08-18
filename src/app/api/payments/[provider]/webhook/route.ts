import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/payments/registry";
import { applyProviderEvent } from "@/lib/payments/service";
import { reportError, reportWarning } from "@/lib/observability";

/** The authoritative payment outcome path.
 *
 * Everything about this route is shaped by one fact: its URL is not a
 * secret. Anyone can POST to it. The signature check is the only thing
 * standing between a stranger and "mark any order paid", so it runs before
 * the body is parsed, let alone acted on.
 */

// Payment state must never be served from a cache, and this route must not
// be statically analysed into one.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await ctx.params;

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  // The RAW bytes, read once. The signature is computed over exactly what
  // was sent -- re-serializing a parsed object would reorder keys and
  // change whitespace, and the HMAC would never match.
  const rawBody = await req.text();

  const verification = provider.verifyWebhook(rawBody, req.headers);
  if (!verification.ok) {
    reportWarning("Rejected payment webhook", {
      scope: "payment-webhook",
      provider: providerId,
      reason: verification.reason,
    });
    // 401, not 400: this is an authentication failure, and a provider
    // retrying will not fix it.
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  try {
    const event = provider.parseEvent(rawBody);
    const result = await applyProviderEvent(event);

    // 200 even when the event was ignored. A duplicate or out-of-order
    // delivery is normal, expected provider behaviour -- answering with an
    // error would make the gateway retry a message we have deliberately
    // chosen not to act on, forever.
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (err) {
    reportError(err, { scope: "payment-webhook", provider: providerId });
    // A 500 here DOES ask the provider to retry, which is what we want:
    // the signature was good, so this was our failure, and the event is
    // worth redelivering.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
