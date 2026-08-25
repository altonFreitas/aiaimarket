# Deploying — Supabase + Vercel + your domain

Follow in order. Total time: about 20 minutes.

---

## Step 1 — Create the database (Supabase)

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Name it anything. **Set the region to Singapore (`ap-southeast-1`)** — this is the single
   highest-value infrastructure decision in the spec (§5.4). A US or EU region adds roughly
   200–300 ms to *every* query, permanently, for buyers in Timor-Leste. It cannot be fixed
   in code later without migrating the database.
3. Set a database password and save it somewhere.
4. Wait for the project to finish provisioning (~2 min).

### Run the schema

1. In your project: **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this project, paste the whole file in, press **Run**.
   This creates every table, index, RLS policy, storage bucket and trigger.
3. Do the same with `supabase/marketplace-v2.sql`. This adds catalog search
   (accent-folded, ranked, paginated), product reviews and the seller payout ledger.
   The site runs without it — search falls back to the old in-memory filter, ratings
   render as "no reviews yet", and the payouts screen stays empty — so deploying the
   code first and running this after is safe. Both files are safe to re-run.
4. Do the same with `supabase/notifications.sql`. This adds the buyer message
   outbox, so each order update reaches the buyer's WhatsApp with a one-tap
   tracking link. Without it order status changes work exactly as before, they
   just don't message anyone. See **Order notifications** below.
5. *(Optional)* Do the same with `supabase/seed.sql` to get one sample product to look at.
   Skip it if you'd rather start empty.

You should see "Success. No rows returned."

### Grab your keys

**Project Settings → API**. You need three values:

| Where it's shown | Goes into |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

⚠️ The **service_role** key bypasses all security rules. It is only ever used in server-side
code here (never sent to the browser). Never paste it into a client file, never commit it to
a public repo, and never give it the `NEXT_PUBLIC_` prefix.

---

## Step 2 — Put the code on GitHub

```bash
cd loja
git init
git add .
git commit -m "Loja AIAI — marketplace for Timor-Leste"
```

Create an empty repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git branch -M main
git push -u origin main
```

`.env.local` is already in `.gitignore`, so your keys stay out of the repo.

---

## Step 3 — Deploy to Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import your GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Don't change the build settings.
3. Before clicking Deploy, open **Environment Variables** and add all six:

```
NEXT_PUBLIC_SUPABASE_URL      = https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
SUPABASE_SERVICE_ROLE_KEY     = eyJ...
ADMIN_EMAIL                   = you@yourdomain.tl
ADMIN_PASSWORD                = <at least 12 characters>
SESSION_SECRET                = <long random string>
NEXT_PUBLIC_SITE_URL          = https://yourdomain.tl
```

`NEXT_PUBLIC_SITE_URL` is not optional in production. `sitemap.xml`,
`robots.txt`, canonical tags and every OpenGraph URL are built from it — leave
it unset and your live site publishes a sitemap pointing at
`http://localhost:3000`, which search engines discard. Set it to your real
domain (no trailing slash) and redeploy. On the first deploy, before your
domain is attached, use the `.vercel.app` URL and update it afterwards.

Generate `SESSION_SECRET` with `openssl rand -base64 32`, or any 32+ character random string.

4. **Deploy.** You'll get a `something.vercel.app` URL in about a minute.

---

## Step 4 — Point your domain at it

1. Vercel → your project → **Settings → Domains** → add `yourdomain.tl` (and `www`).
2. Vercel shows you the exact DNS records to create.
3. Go to wherever you bought the domain and add those records:
   - Apex domain (`yourdomain.tl`) → usually an **A record** to Vercel's IP
   - `www` → usually a **CNAME** to `cname.vercel-dns.com`
4. Wait for DNS to propagate (minutes to a few hours). HTTPS is issued automatically.

---

## Step 5 — First login and setup

1. Visit `yourdomain.tl/admin` → you'll be redirected to the login page.
2. Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in Vercel.
3. Go to **Konfigurasaun (Settings)** and fill in:
   - Store name, **WhatsApp number in +670 format** (this drives every order link)
   - Opening hours and your location (municipality, posto, suku, landmark)
   - Bank accounts and mobile wallets — these are revealed to buyers only after they
     select transfer as the payment method
   - Delivery zones and fees
4. **Kategoria** → create your categories. They appear in the storefront sidebar
   automatically, with live product counts, and hide themselves when empty.
5. **Produtu → + Novo produto** → add your first real product.

---

## Adding products (the everyday workflow)

**New product:** Admin → Produtu → **+ Novo produto**

- **Name, price, quantity, stock status** — price and stock are what buyers ask about most,
  so they're rendered above the fold on the product page.
- **Description** — free text, line breaks preserved.
- **Category** — pick one, or type a new name in "Create category" and press Add. No need
  to leave the form.
- **Sizes** — comma separated (`40, 41, 42` or `S, M, L`). The size a buyer picks is written
  straight into the WhatsApp message.
- **What it's for (tags)** — comma separated (`viajen, servisu, eskola`). These feed search.
- **Images** — press **+**, pick up to 5 photos. Each is resized and converted to WebP under
  200 KB *in your browser* before it uploads, then stored in Supabase Storage and served
  over their CDN. You'll see a toast like `photo.jpg → 84 KB`.
- **Payment methods** — per product, including *fiar* (deposit now, balance on delivery).

**Edit:** Produtu list → **Edita**.
**Quick stock change:** tap the coloured stock pill in the list — cycles In → Low → Out with
no page reload. This is the button you'll press most.
**Duplicate:** copies a product into a new draft for near-identical items.
**Delete:** there is no hard delete, by design — order history must never break. Use
**Arkiva**; archived products leave the catalog and can be restored from the "Archived" filter.

Everything you change is live for every visitor immediately.

---

## Handling orders

Orders arrive two ways, both ending in the same place:

1. **WhatsApp** — buyer taps *Enkomenda liu WhatsApp* and the message arrives pre-written
   with product, size, price and reference.
2. **On-site** — buyer fills the checkout form; the order appears in Admin → Enkomenda.

In an order you can move it through the status flow — including **"To'o ona — bolu hela ita"**
(arrived, calling the customer), which matches how you actually deliver — set payment status
by hand, view the buyer's uploaded payment screenshot, and keep internal notes.

Confirming an order automatically decrements stock and flags the product out of stock at zero.
Completed orders are locked by a database trigger and can't be silently rewritten.

Customers check their own status at `/track` with their order reference and phone number —
no account, no password.

---

## Costs

- **Vercel Hobby** — free, fine for this traffic.
- **Supabase Free** — works, *but* projects pause after one week without requests, and there
  are no backups. For a live shop this is disqualifying: your store would go dark during its
  first quiet week. Budget the **Pro plan (~$25/month)** from launch, as §5.5 of the spec
  says, and turn backups on.

---

## Changing the admin password

Change `ADMIN_PASSWORD` in Vercel → Settings → Environment Variables, then **Redeploy**.
Changing `SESSION_SECRET` immediately signs everyone out.

---

## Local development

```bash
npm install
cp .env.example .env.local     # fill in your real Supabase keys
npm run dev                    # http://localhost:3000
```

---

## Card payments (BNCTL / Mastercard)

Card payment is **off** until configured. With nothing set, checkout offers
only the manual methods (cash, bank transfer, mobile wallet, fiar) exactly as
before — the card option is not rendered at all.

### Step 1 — get a merchant account

This is a banking process, not a technical one. Contact BNCTL's business
banking desk and ask for **online card acquiring (e-commerce / card-not-
present)** and their **merchant integration pack**. Expect to provide business
registration, tax ID, an account with them, and your live domain. There is a
per-transaction fee — negotiate it, it is the real running cost of this
feature.

Ask these four questions explicitly. They decide whether the adapter in
`src/lib/payments/providers/mpgs.ts` works as written:

1. Is the gateway Mastercard Payment Gateway Services (MPGS), or something else?
2. **Hosted Checkout, or a JavaScript embed on our own page?**
   If they propose collecting card details on your page, push back. Hosted
   redirect keeps you in PCI-DSS **SAQ A** (a short self-assessment). Taking a
   card number on your own domain moves you to **SAQ D** — a full audit,
   quarterly scanning, and an ongoing compliance programme.
3. How are webhooks authenticated — HMAC signature, static header secret, or
   IP allow-list?
4. Is the merchant profile **PURCHASE** (captured immediately) or
   **AUTHORIZE** (a hold you capture later)?

They will also issue **sandbox credentials**. Use those first. Never test
against a live merchant ID.

### Step 2 — configure

Set the `MPGS_*` and `PAYMENT_GATEWAY_ORIGIN` variables (see `.env.example`)
in Vercel, then redeploy. `PAYMENT_GATEWAY_ORIGIN` is easy to forget and its
failure mode is silent: without it the Content-Security-Policy blocks the
payment page and the only clue is a browser console message your buyer will
never read.

Give BNCTL your webhook URL:

    https://yourdomain.tl/api/payments/bnctl/webhook

### Step 3 — turn on reconciliation

Set `CRON_SECRET` and `ALERT_WEBHOOK_URL`. `vercel.json` already schedules
`/api/cron/reconcile-payments` hourly.

This is not optional polish. Webhooks get lost — a gateway outage, a deploy
mid-flight, a network blip — and the result is an order sitting at "unpaid"
while the buyer's money is gone. Nothing detects that on its own, because the
missing signal is the thing that would have told you. The cron asks the
gateway directly about anything unresolved for more than 15 minutes, and
escalates whatever it still cannot settle.

### Step 4 — test in sandbox before going live

- [ ] Place an order, choose **Credit / debit card**, complete payment on the
      gateway's page → order shows **paid**
- [ ] Place an order and **abandon** at the gateway → stays unpaid, and the
      buyer can retry from `/o/<ref>` with the **Pay now** button
- [ ] Use the gateway's **declined-card** test number → payment fails, order
      stays unpaid, buyer can retry
- [ ] Double-click **Pay now** → only ONE payment row is created
      (`select * from payments where order_id = ...`)
- [ ] Replay a webhook (or ask BNCTL to redeliver) → order is not
      double-credited; the event is journaled in `payment_events` as ignored
- [ ] POST to the webhook URL with a wrong/absent signature → **401**, and the
      order is untouched
- [ ] Run the cron by hand and confirm it reports sensibly:

      curl -H "Authorization: Bearer $CRON_SECRET" \
        https://yourdomain.tl/api/cron/reconcile-payments

### Day-to-day

Anything that started and never settled:

```sql
select * from payments_needing_review;
```

An **authorized but never captured** row is the one to act on first: the
buyer's funds are on hold and the store has not taken them.


## Order notifications

When an order is placed, and each time it is confirmed / sent out / delivered /
completed / cancelled, the buyer gets a message on the phone number they gave at
checkout. The message ends with a link straight to their order — signed, so
tapping it opens the tracking page already unlocked, with no phone number to
retype.

**It works with no setup at all.** With no messaging API configured, every
message is queued and the admin gets a one-tap **Send on WhatsApp** button — on
the order page, and as a queue at `/admin/notifications`. WhatsApp opens with
the buyer's number and the full message already filled in; press send, then
press **Mark as sent**. No Meta business account, no cost, no approval wait.

**To make it automatic**, fill in `WHATSAPP_PHONE_NUMBER_ID` and
`WHATSAPP_ACCESS_TOKEN` (see `.env.example`). The same messages then send
themselves. One constraint decides whether that is enough on its own:

> WhatsApp does not deliver free-form text to someone who has not messaged your
> business in the last 24 hours. Outside that window only a **pre-approved
> template** is delivered.

So the order-confirmation minutes after checkout usually lands as plain text;
an "out for delivery" the next morning usually will not. Set
`WHATSAPP_TEMPLATE_NAME` to a Meta-approved template whose body is a single
`{{1}}` parameter to cover both. Either way nothing is lost — a refused message
is recorded with Meta's reason and stays in the admin queue to be sent by hand.

Two things to know about the links:

- `NEXT_PUBLIC_SITE_URL` **must** be set. A tracking link is going into a chat
  message, where a relative path is just text; without it notifications are
  skipped rather than sent broken.
- The links are signed with `SESSION_SECRET`. Rotating that secret invalidates
  every tracking link already sitting in buyers' phones — they fall back to the
  normal "enter your phone number" gate rather than breaking, but they stop
  being one-tap.
