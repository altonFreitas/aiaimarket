import TrackForm from "@/components/TrackForm";
import { getLang } from "@/lib/lang";
import { getSettings, getApprovedSellersById } from "@/lib/data/public";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTrackToken } from "@/lib/trackToken";
import { lookupOrder } from "@/lib/actions/orders";

/** Resolves the `?t=` token on a link the store sent to the buyer's phone.
 *
 * The token does not carry the phone number -- it is a MAC over it (see
 * lib/trackToken.ts) -- so verifying means reading the order first and
 * checking the MAC against the phone stored on it. Service-role, because
 * `orders` has no public read policy at all and must not gain one.
 *
 * Returns null for every failure, including an expired or tampered token.
 * The page then shows its normal phone-entry gate, which is a mild
 * inconvenience rather than a dead end -- the buyer still knows their own
 * number. */
async function phoneFromToken(ref: string, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("orders")
      .select("buyer_phone")
      .eq("ref", ref.trim().toUpperCase())
      .maybeSingle();
    if (!data?.buyer_phone) return null;
    const verdict = verifyTrackToken(ref.trim().toUpperCase(), data.buyer_phone, token);
    return verdict.ok ? (data.buyer_phone as string) : null;
  } catch {
    return null;
  }
}

/** The dashboard itself is gated: the page renders the ref+phone form,
 * and only after lookupOrder() verifies the phone does the order appear.
 * Nothing about the order is ever sent to the browser before that.
 *
 * A signed `?t=` link from the store's own notification skips the typing --
 * receiving that message on that phone is the same proof the form asks for. */
export default async function OrderPage({
  params, searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const [lang, settings, sellersById, unlockedPhone] = await Promise.all([
    getLang(), getSettings(), getApprovedSellersById(), phoneFromToken(ref, sp.t),
  ]);

  /* THE ORDER ITSELF, FETCHED HERE RATHER THAN BY THE BROWSER.
   *
   * The token above already proved this phone owns this order, so there is
   * nothing left to ask and nothing left to wait for -- and the page used to
   * do both. TrackForm rendered its "enter your phone" gate on the first
   * paint and only then, in an effect, went back to the server for the
   * order. Anyone arriving from checkout or from the shop's own SMS watched
   * a gate they had already passed, for as long as a second round trip
   * takes on a phone in Dili.
   *
   * Resolved on the server, the order is in the HTML that arrives. The gate
   * still exists, and is still exactly right, for somebody arriving cold at
   * /o/<ref> with no token. */
  const initialOrder = unlockedPhone ? await lookupOrder(ref, unlockedPhone) : null;

  return (
    <TrackForm
      lang={lang}
      initialRef={ref}
      settings={settings}
      sellersById={sellersById}
      unlockedPhone={unlockedPhone}
      initialOrder={initialOrder}
    />
  );
}
