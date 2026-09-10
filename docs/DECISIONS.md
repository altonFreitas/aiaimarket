# The decisions, and where they are written down

This project's reasoning lives in comments, next to the code it explains —
deliberately, because a decision recorded in a separate document is a
decision nobody reads while changing the thing it is about. The cost of
that choice is discoverability: there is no way to ask "why is the cart in
localStorage" without knowing which file to open.

This is the index that fixes that. It is a **map, not a copy**: each entry
says what was decided, in one line, and points at the comment that holds
the argument. When the two disagree, the comment is right — it is the one
sitting beside the code.

Add a line here when a decision costs more than five minutes to
re-derive. Do not paste the reasoning; move the pointer.

---

## Money and orders

| Decision | Where |
| --- | --- |
| Prices are re-read from the database at checkout; the basket's prices are never trusted | `src/lib/actions/orders.ts` — `placeOrder()` |
| One checkout submission is one order, enforced by an idempotency key and a partial unique index | `src/lib/actions/orders.ts` (`MAX_IDEM_LEN`, `findByIdempotencyKey`), `supabase/order-idempotency.sql` |
| Commission is snapshotted onto each order line at sale time; renegotiating a rate never rewrites history | `src/lib/actions/orders.ts` (`rateBySeller`), `src/lib/data/seller.ts` — `lineCommission()` |
| Unit cost is snapshotted the same way, for the same reason | `src/lib/types.ts` — `OrderItem.cost` |
| A purchase order captures its FX rate at order date | `src/lib/types.ts` — `PurchaseOrder.fx_rate` |
| Seller balances are derived from completed orders minus payouts; no stored balance can disagree | `src/lib/data/admin.ts` — `adminSellerLedgers()` |
| A payout is the marketplace's only writable money fact; deleting one copies the row into the audit trail first | `src/lib/actions/payouts.ts` |
| `pay_status` only reaches `refunded` when the money has actually moved; a card refund waits for the gateway | `src/lib/actions/returns.ts` (`needsGateway`), `supabase/refund-settlement.sql` |
| Cancelling an order does nothing at the acquirer, so the shop is told to go and void it | `src/lib/actions/orders.ts` — `setOrderStatus()`, `src/lib/attention.ts` (`cards_to_void`) |

## Stock

| Decision | Where |
| --- | --- |
| `products.qty` has exactly one writer — a stock movement — and a view that reports when something else moved it | `supabase/stock-ledger.sql` — `stock_reconciliation` |
| Stock is decremented on confirmation, not placement, and the ledger is allowed to go negative rather than lie | `supabase/stock-ledger.sql` — `apply_stock_movement()` |
| A pre-order line is exempt from the quantity ceiling; every other line in the same basket is not | `src/lib/actions/orders.ts` — `linePreorder` |

## Identity and access

| Decision | Where |
| --- | --- |
| A buyer's identity is their phone number: guest checkout, no account, ref + phone proves the order | `src/lib/actions/orders.ts` — `lookupOrder()` |
| The admin session is a hand-rolled HMAC cookie, not Supabase Auth — the owner has no `auth.users` row | `src/lib/session.ts` |
| Sellers and customers are real Supabase Auth accounts; sellers carry a second signed TOTP cookie | `src/lib/sellerTotpSession.ts`, `src/lib/actions/guard.ts` |
| Role and section are two separate questions: what you may do, and where you may go | `src/lib/adminSections.ts` |
| Every admin page's lock is checked by a meta-test that walks the route tree | `tests/adminSections.test.ts` |
| A TOTP code works once: the accepted time step is stored and anything not strictly newer is a replay | `src/lib/totp.ts` — `counterFor()`, `supabase/totp-replay.sql` |
| Login throttling uses two keys — tight per IP, loose per account — so it cannot be used to lock somebody out | `src/lib/loginThrottle.ts` |
| One password minimum for staff, sellers and customers alike | `src/lib/passwordRules.ts` |
| Email lookups use `.eq()`, never `.ilike()`: `%` and `_` are wildcards and turn a lookup into a directory | `src/lib/actions/customer-auth.ts` — `isAdminEmail()` |
| Rate limiting counts in Postgres as well as in memory, and fails open | `src/lib/rateLimit.ts`, `supabase/rate-limits.sql` |

## Data and privacy

| Decision | Where |
| --- | --- |
| Payment proofs are stored as a path; a signed URL is minted per view and lives fifteen minutes | `src/lib/paymentProof.ts`, `supabase/proof-path.sql` |
| Retention is redaction, not deletion — an order is a financial record and the totals must keep adding up | `supabase/pii-retention.sql` |
| The audit trail copies the actor's name onto every row rather than joining, and never throws | `src/lib/audit.ts` |
| Reviews are deleted rather than hidden; the aggregate trigger repairs the stars on DELETE | `src/lib/actions/moderation.ts`, `supabase/marketplace-v2.sql` |

## The storefront

| Decision | Where |
| --- | --- |
| The cart is `localStorage`, never a cookie — it belongs to the browser, not to the account | `src/lib/useBasket.ts` |
| "Not yet known" and "empty" are different cart states, so the cart never flashes empty mid-purchase | `src/lib/useBasket.ts` — `useSyncExternalStore` |
| No web fonts on the storefront; the system stack, for data frugality | `src/app/globals.css` |
| Language is a cookie, and one URL serves all three | `src/lib/lang.ts` |
| The bare listing is canonical; every sorted, filtered or paged view is `noindex,follow` | `src/lib/listingMeta.ts` |
| Search result pages are never indexed | `src/lib/listingMeta.ts` — `searchMetadata()` |
| Every JSON-LD payload is escaped through one function, because `JSON.stringify` does not escape `<` | `src/lib/jsonLd.ts` |
| Colour tokens are measured, not eyeballed, and a test does the arithmetic | `tests/contrast.test.ts` |
| View and click counters are deduplicated per caller per product; they decide what the homepage shows | `src/lib/counterGuard.ts` |

## Deployment

| Decision | Where |
| --- | --- |
| SQL files have a dependency order, expressed as data so a test can check it | `src/lib/schemaHealth.ts` — `SCHEMA_ORDER`, `tests/schemaOrder.test.ts` |
| `supabase/run-all.sql` is generated, never edited | `scripts/build-run-all.mjs` |
| The admin panel probes the live database for unapplied migrations, and says "not checked" rather than guessing | `src/lib/schemaHealth.ts` |
| A missing column degrades the write rather than failing it | `src/lib/missingColumn.ts` |
| A cap that truncates must announce it | `src/lib/data/capped.ts` |
