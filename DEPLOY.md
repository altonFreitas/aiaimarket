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
3. *(Optional)* Do the same with `supabase/seed.sql` to get one sample product to look at.
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
ADMIN_PASSWORD                = <pick a strong one>
SESSION_SECRET                = <long random string>
```

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
