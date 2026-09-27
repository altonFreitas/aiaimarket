# Loja AIAI — Marketplace for Timor-Leste

Real, database-backed implementation of **Part A** (Epics A–J) of
*Marketplace Platform for Timor-Leste v1.0*. One shared catalog every visitor sees,
built on the stack the spec's §5 specifies.

**→ See [DEPLOY.md](./DEPLOY.md) to put this on your domain**, on Vercel or on a server of your own.

## Stack

| Layer | Choice | Why (per §5) |
|---|---|---|
| Framework | Next.js 16, App Router | Catalog + admin + order machine in one codebase |
| Database | PostgreSQL (Supabase) | Orders and stock are inherently relational |
| Auth | Signed HTTP-only cookie, server-verified | Single owner role — exactly what A1 asks for |
| Images | Supabase Storage + CDN | Compressed to WebP ≤200KB client-side first (B6) |
| Styling | Hand-written CSS, **no web fonts** | Data frugality is a feature, not a preference |
| Region | Singapore `ap-southeast-1` | Physical distance can't be optimised away in code |

## What's implemented

| ID | Feature |
|---|---|
| A1–A3 | Owner login, server-side protected admin, store settings driving the deep links |
| B1–B7 | Product CRUD, soft-delete archive, duplicate, one-tap stock cycle, WebP compression, filtered list |
| C1–C6 | Inline category creation, live-count sidebar, auto-hide empty, rename/reorder/merge, mobile rail, one subcategory level |
| D1–D6 | Catalog grid, addressable category URLs, **Auto-Answer Block**, search, 360px-first, sort/filter |
| E1–E4 | Pre-filled WhatsApp deep link with size injected, share, view + click counters |
| F1–F6 | Guest orders, `ORD-YYYY-NNNN` refs, admin list, status machine, stock sync, internal notes |
| G1–G5 | Per-product payment methods incl. *fiar*, conditional bank reveal, proof upload, manual payment status, USD centavos |
| H1–H5 | Municipality→Posto→Suku→Aldeia + mandatory landmark, fee zones, pickup |
| I1–I7 | Customer dashboard by ref+phone: timeline, summary, payment panel, editable address, contact, cancellation |
| J1–J4 | Tetun default + PT/EN, performance budget, graceful degradation |

Part B (K–N) and the Won't-Have list (O1–O5) are deliberately not built.

## Running it

Two ways. [DEPLOY.md](./DEPLOY.md) has the walkthrough for both; the
database is hosted Supabase either way, and `supabase/run-all.sql` is
pasted into its SQL editor by hand.

**Vercel** — import the repo, paste the environment variables, done. The
four scheduled jobs come from `vercel.json`.

**Your own server, in Docker** — the shop and its scheduler, two
containers, restarting themselves:

```sh
cp .env.example .env     # the same values; fill it in
docker compose up -d --build
curl -s localhost:3000/api/health
# {"ok":true,"revision":"local","uptime":3}
```

| File | What it is |
|---|---|
| `Dockerfile` | Four stages. The server is built from Next's standalone output — a `server.js` plus only the modules it imports, ~200MB rather than the gigabyte a normal `.next` needs beside it — and runs as a non-root user. The last stage is the scheduler. |
| `docker-compose.yml` | `app` and `cron`. The scheduler waits for the shop's health check before its first run. |
| `docker/` | The scheduler itself: busybox cron, four lines of shell, calling the same endpoints on the same clocks as `vercel.json`. |
| `/api/health` | Liveness, and the commit the image was built from — which is how you tell whether the deploy you just pushed is the one answering. It deliberately does not call Supabase: a check that does restarts the app when the *database* is unwell. |

Two things worth knowing before the first rebuild:

- **`NEXT_PUBLIC_*` is compiled into the browser bundle.** Setting it on
  the container afterwards changes nothing — the old string is already in
  the JavaScript. Change one and rebuild; change anything else and
  `docker compose up -d` is enough. An image is therefore specific to one
  shop and one domain.
- **`.env`, not `.env.local`.** Compose reads `.env` twice — for the
  `${...}` values in `docker-compose.yml` and as the containers'
  environment — and never looks at `.env.local`, which is Next's own
  convention for `npm run dev`.

**The scheduler is not optional.** Without it nothing errors: stock
reservations never expire, queued messages are never sent, payments are
never reconciled and the dashboard's figures quietly go stale. It refuses
to start without `CRON_SECRET` rather than be refused four times an hour
for ever.

`CRON_SECRET` is not issued by anybody — you invent it (`openssl rand
-base64 32`) and put it in `.env`. It is what stops somebody who finds the
URL making your shop send every queued message, which costs money per SMS.

### Continuous delivery

Pushing to `main` runs the full gate — typecheck, lint, 2,600 tests, a
production build, and a job that applies `run-all.sql` twice to a real
Postgres (`.github/workflows/verify.yml`). Only if that passes does
`deploy.yml` build the images, publish them to this repository's own
registry, and — once `DEPLOY_HOST` and a deploy key are set — pull and
restart them over SSH. It deploys the commit rather than `:latest`, waits
for `/api/health` to report that revision, and puts the previous one back
if it never does.

## Security model

- The browser only ever holds the **anon** key. Every read it can make is constrained by the
  RLS policies in `supabase/schema.sql`: live products, categories and settings — nothing else.
- The **service_role** key exists only in server actions marked `"use server"`, each of which
  calls `requireAdmin()` first. It is never bundled into client code.
- Customers reading their own order go through `lookupOrder()`, which returns data only when
  the phone number matches the order. There is no public SELECT policy on `orders` at all.
- Completed orders are made immutable by a Postgres trigger, not by UI convention.
- `seller_id` is on `products` and `orders` from the first migration (Decision 2), so Epic K
  is a UI change later, not a data rewrite.

## Before launch

- Confirm the live list of banks and mobile wallets that can actually receive money (the spec's
  open assumption — it blocks nothing else, but it blocks Epic G being correct).
- Check the address hierarchy against how buyers in your municipalities really describe location.
- **Have a native Tetun speaker review the strings in `src/lib/i18n.ts`** — they're a solid
  first draft, not verified copy.
- Move to the Supabase paid tier so the project never auto-pauses.

## Project layout

```
src/
  app/                 routes: catalog, product, checkout, dashboard, admin
  components/          UI, incl. ProductInteractive (the Auto-Answer Block)
  lib/
    actions/           server actions — every write goes through here
    data/              read helpers (public = RLS-gated, admin = service role)
      search.ts        catalog search: Postgres FTS, with an in-memory fallback
    payments/          card gateway orchestration (see supabase/payments.sql)
    supabase/          three clients: browser, server, admin
    i18n.ts            Tetun / Portuguese / English strings
    session.ts         signed admin cookie
  proxy.ts             /admin route guard
supabase/
  schema.sql           tables, indexes, RLS, triggers, storage buckets
  procurement.sql      suppliers, purchase orders, line items
  marketplace-v2.sql   search index, product reviews, seller payouts
  notifications.sql    buyer message outbox + order language
  payments.sql         card payment attempts
  promotions.sql       homepage promo tiles
  seed.sql             optional sample data
  run-all.sql          every file above, in order — what you paste
Dockerfile             the server image, and the scheduler's
docker-compose.yml     the two containers
docker/                the scheduler: crontab + two shell scripts
.github/workflows/
  verify.yml           the gate: tests, build, and run-all.sql on real Postgres
  deploy.yml           build, publish, and roll out over SSH
```

## Marketplace layer (v2)

Three things a marketplace needs that a single-seller catalog does not. All of it
lives in `supabase/marketplace-v2.sql`, and all of it degrades gracefully: run the
code without the SQL and the site behaves exactly as it did before.

| Area | What changed |
|---|---|
| **Search** | Accent-folded, prefix-matching, relevance-ranked Postgres full-text search with a trigram "did you mean" for typos. Filters on price range, stock, category and seller; paginated in the database. Replaces a JavaScript substring scan over the whole catalog. |
| **Product reviews** | Verified-purchase only — the reviewer must hold the order's reference and the phone it was placed with, and the order must be completed and have contained that product. Star averages are denormalised onto `products` by trigger, so a grid of cards costs no extra queries, and feed `aggregateRating` in the product page's JSON-LD. |
| **Seller payouts** | A single-entry ledger of money actually transferred to sellers. What is *owed* is derived (net earnings on completed orders minus recorded payouts), never stored, so two numbers can't disagree. `/admin/payouts` records transfers; the seller dashboard shows their own balance and history. |
| **Order notifications** | The buyer gets an SMS when their order is placed and at each status change, with a signed one-tap link to their order — no phone number to retype. An outbox (queue first, send second) means a message is never lost to a failed API call. Works with zero setup via one-tap `sms:` links in `/admin/notifications`, and sends itself once a local gateway or Twilio is configured. Segment cost is shown per message, because Tetun and Portuguese accents halve what fits in one. See [DEPLOY.md](./DEPLOY.md#order-notifications). |

The catalog's `search_products()` runs as the caller, so the `products_public_read`
RLS policy — not the function's own `WHERE` clause — is still what decides which rows
a visitor can see.

## Where the reasoning lives

This codebase argues with itself in comments rather than in a wiki: the
why sits beside the what, where somebody changing it will read it.
[`docs/DECISIONS.md`](docs/DECISIONS.md) is the index — one line per
decision and a pointer to the comment holding the argument.
