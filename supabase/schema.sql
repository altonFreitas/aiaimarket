-- ============================================================
-- Loja AIAI — schema for "Marketplace Platform for Timor-Leste v1.0"
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- settings (Epic A3, single row for the single seller) ----------
create table if not exists settings (
  id            int primary key default 1,
  seller_id     uuid not null default gen_random_uuid(),   -- Decision 2: present from day one
  store_name    text not null default 'Loja AIAI',
  tagline_tet   text default '',
  tagline_pt    text default '',
  tagline_en    text default '',
  wa_number     text not null default '',                  -- +670 format
  hours         text default '',
  municipality  text default '',
  post          text default '',
  suku          text default '',
  landmark      text default '',
  pickup        boolean not null default true,
  -- Marketplace commission (Phase 2): the platform's default cut of a
  -- sale, as a percentage (10 = 10%). A seller can have their own
  -- commission_rate (see the sellers table) which overrides this when
  -- set; this is just the fallback used for everyone else.
  commission_rate numeric(5,2) not null default 10,
  -- Marketplace on/off switch: when false, /seller/register shows a
  -- "not accepting sellers right now" message instead of the form, the
  -- action itself refuses to create new accounts (never just hidden in
  -- the UI), and the footer's "Become a Seller" link disappears.
  -- Existing approved sellers keep working either way -- this only
  -- gates new applications.
  seller_registration_enabled boolean not null default true,
  banks         jsonb not null default '[]',   -- [{label,account,holder}]
  wallets       jsonb not null default '[]',   -- [{label,number}]
  zones         jsonb not null default '[{"id":"dili_center","fee":1,"quote":false},{"id":"dili_outskirts","fee":2,"quote":false},{"id":"other_municipality","fee":0,"quote":true}]',
  -- Two-factor auth (TOTP, authenticator-app based). totp_secret is only
  -- ever read/written server-side via the service-role client — never
  -- exposed to the browser. If you lose your authenticator device, reset
  -- 2FA by running: update settings set totp_secret=null, totp_enabled=false where id=1;
  totp_secret          text,
  totp_enabled         boolean not null default false,
  totp_failed_attempts int not null default 0,
  totp_locked_until    timestamptz,
                -- [{id,fee,quote}] — id is one of the 3 fixed zones; the
                -- display name is translated client-side from id (i18n.ts),
                -- not stored here, so it renders correctly in every language
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;
-- ALTER form for the existing settings row (see the products.status
-- comment above for why this is needed alongside the column in the
-- CREATE TABLE above).
alter table settings add column if not exists commission_rate numeric(5,2) not null default 10;
alter table settings add column if not exists seller_registration_enabled boolean not null default true;

-- Function-based default, not a raw subquery: Postgres allows a function
-- call in DEFAULT (evaluated per-row at insert time), just not inline SELECT.
create or replace function current_seller_id() returns uuid
  language sql stable as $$
  select seller_id from settings where id = 1;
$$;

-- ---------- sellers (Phase 2: multi-vendor marketplace) ----------
-- Phase 0 foundation only: real accounts (via Supabase Auth) + admin
-- approval workflow. Products/orders are NOT yet connected to sellers --
-- that's a deliberately separate, later step, so this can ship and be
-- tested on its own without touching anything that already works.
--
-- The platform owner (the store this app already runs) does not need a
-- row here in Phase 0 -- they keep managing everything through /admin
-- exactly as before. This table is for *additional* sellers joining the
-- marketplace.
create table if not exists sellers (
  id           uuid primary key default gen_random_uuid(),
  -- Nullable + ON DELETE SET NULL: if a seller's auth account is ever
  -- deleted, their seller row (and history) isn't silently destroyed
  -- with it.
  user_id      uuid unique references auth.users(id) on delete set null,
  full_name    text not null default '',
  store_name   text not null,
  slug         text not null unique,
  email        text not null,
  phone        text not null default '',
  description  text not null default '',
  address      text not null default '',
  city         text not null default '',
  country      text not null default '',
  seller_type  text not null default 'individual' check (seller_type in ('individual','business')),
  status       text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  -- Per-seller commission override (Phase 2 earnings). NULL means "use
  -- the platform default" (settings.commission_rate) -- most sellers
  -- should have no override; this is only for a negotiated rate.
  commission_rate numeric(5,2),
  -- Per-seller shipping (kept intentionally simple, per the original
  -- spec: "do not build a complicated logistics system"). delivery_area
  -- is a free-text description ("Dili only", "Same-day in Baucau"), not
  -- a zone system -- checkout doesn't read these yet (it still uses the
  -- platform's own delivery zones for fee calculation); this is the
  -- data model ready for when a seller-aware checkout is built.
  delivery_available boolean not null default true,
  pickup_available    boolean not null default true,
  delivery_fee        numeric(10,2),
  delivery_area       text not null default '',
  -- Optional two-factor login (mirrors settings.totp_* on the admin
  -- account — see lib/totp.ts, which both share). Opt-in: a seller
  -- turns this on themselves from their settings, it's never forced.
  totp_secret          text,
  totp_enabled         boolean not null default false,
  totp_failed_attempts int not null default 0,
  totp_locked_until    timestamptz,
  created_at   timestamptz not null default now()
);
-- ALTER form for an existing sellers table (created before these columns
-- existed, e.g. by apply-update-22.js / apply-update-26.js).
alter table sellers add column if not exists commission_rate numeric(5,2);
alter table sellers add column if not exists delivery_available boolean not null default true;
alter table sellers add column if not exists pickup_available boolean not null default true;
alter table sellers add column if not exists delivery_fee numeric(10,2);
alter table sellers add column if not exists delivery_area text not null default '';
alter table sellers add column if not exists totp_secret text;
alter table sellers add column if not exists totp_enabled boolean not null default false;
alter table sellers add column if not exists totp_failed_attempts int not null default 0;
alter table sellers add column if not exists totp_locked_until timestamptz;

alter table sellers enable row level security;

-- ---------- seller_ratings ----------
-- Customers rate a seller after a completed order (see
-- submitSellerRating). One rating per buyer per seller per order --
-- resubmitting updates it rather than creating a duplicate. Ratings are
-- public (that's the point), but buyer_phone stays private -- see the
-- column grant below.
create table if not exists seller_ratings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references sellers(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  buyer_phone text not null,
  rating      int not null check (rating between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  unique (order_id, seller_id)
);
create index if not exists idx_seller_ratings_seller on seller_ratings(seller_id);
alter table seller_ratings enable row level security;

-- ALTER form for an existing seller_ratings table (created by an earlier
-- run of this script before the unique constraint existed). One rating
-- per buyer per seller per order -- resubmitting updates it (see
-- submitSellerRating's upsert) rather than creating a duplicate.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_ratings_order_id_seller_id_key'
  ) then
    alter table seller_ratings add constraint seller_ratings_order_id_seller_id_key unique (order_id, seller_id);
  end if;
end $$;

-- Ratings are public by design (that's the point of a review system),
-- but buyer_phone is not -- column grants (same pattern as settings and
-- sellers above) keep it out of what a browser's anon key can read even
-- though the row itself is visible.
drop policy if exists seller_ratings_public_read on seller_ratings;
create policy seller_ratings_public_read on seller_ratings for select using (true);
revoke select on seller_ratings from anon, authenticated;
grant select (id, seller_id, order_id, rating, comment, created_at) on seller_ratings to anon, authenticated;
-- No public insert/update policy: writing a rating goes through
-- submitSellerRating (service role), which verifies ref+phone match a
-- genuinely completed order containing that seller — the same trust
-- model as every other write in this app.

-- ---------- customers (optional accounts) ----------
-- A real Supabase Auth account for anyone who isn't a seller or the
-- admin. Deliberately minimal for now -- there's no functional
-- difference yet between having one and browsing as a guest; this is
-- groundwork for things like "email registered customers when a new
-- product goes up." One row per auth user, created on their first
-- login/signup (see lib/actions/customer-auth.ts).
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  email       text not null,
  phone       text not null default '',
  notify_new_products boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table customers enable row level security;

-- A customer may read/update only their own row -- never another
-- customer's, and never through the anon key (writes go through
-- customer-auth.ts's service-role client on first login, same trust
-- model as sellers).
drop policy if exists customers_self_read on customers;
create policy customers_self_read on customers for select using (auth.uid() = user_id);

-- A seller may read their own row (dashboard: "your application is
-- pending"). No public read policy yet -- that arrives with public
-- seller store pages in a later phase. No update policy yet either --
-- there's no "edit my profile" UI in Phase 0, and granting blanket
-- UPDATE would let a seller set their own status to 'approved'; that
-- needs a carefully column-scoped grant (see how settings.totp_secret
-- is protected above) added deliberately when that UI is built, not by
-- accident now.
drop policy if exists sellers_self_read on sellers;
create policy sellers_self_read on sellers for select using (auth.uid() = user_id);

-- Phase 2: public storefronts ("Sold by X", /store/[slug]). Approved
-- sellers only -- a pending/rejected/suspended seller's application
-- details stay private. Column grants (like settings.totp_secret above)
-- keep email/phone out of what a random visitor's anon key can read,
-- even though the row itself is visible -- only the self-read policy
-- above (an authenticated seller reading their OWN row via the admin
-- client, which bypasses grants) ever needs those fields.
drop policy if exists sellers_public_read on sellers;
create policy sellers_public_read on sellers for select using (status = 'approved');

revoke select on sellers from anon, authenticated;
grant select (id, store_name, slug, description, city, country, seller_type, created_at)
  on sellers to anon, authenticated;

-- ---------- categories (Epic C) ----------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  name        text not null,
  slug        text not null,
  parent_id   uuid references categories(id) on delete set null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (seller_id, slug)
);
create index if not exists idx_categories_parent on categories(parent_id);

-- ---------- hero_slides (homepage carousel) ----------
create table if not exists hero_slides (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  image_url   text not null,
  headline    text not null default '',
  subtext     text not null default '',
  cta_label   text not null default '',
  cta_href    text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- products (Epic B) ----------
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null default current_seller_id(),
  ref           text not null unique,             -- PRD-0001
  name          text not null,
  slug          text not null,
  category_id   uuid references categories(id) on delete set null,
  price         numeric(10,2) not null check (price >= 0),
  -- Sale price (optional). NULL = no discount running. Only the dollar
  -- amount is stored -- the percentage shown in admin/seller forms and
  -- on product cards is always derived from price vs discount_price,
  -- never stored separately, so the two can never drift out of sync.
  discount_price numeric(10,2) check (discount_price is null or discount_price > 0),
  sizes         text[] not null default '{}',
  tags          text[] not null default '{}',
  stock_status  text not null default 'in' check (stock_status in ('in','low','out')),
  qty           int not null default 0,
  description   text default '',
  images        text[] not null default '{}',     -- public Storage URLs
  -- pickup location override; falls back to settings row when null
  municipality  text,
  post          text,
  suku          text,
  landmark      text,
  -- payment methods accepted for this product (Epic G1)
  pay_cod       boolean not null default true,
  pay_cop       boolean not null default true,
  pay_bank      boolean not null default false,
  pay_wallet    boolean not null default false,
  pay_fiar      boolean not null default false,
  archived      boolean not null default false,    -- B3: soft delete only
  -- Marketplace product moderation (Phase 1): a seller's own new listing
  -- starts "pending" until admin approves it (see /admin, approve/reject
  -- actions). Products created by the platform owner default straight to
  -- "approved" -- they don't need to self-moderate. Distinct from
  -- `archived` above: archived is "hide this again later"; status is
  -- "was this ever allowed to go live at all".
  status        text not null default 'approved' check (status in ('pending','approved','rejected')),
  views         int not null default 0,
  wa_clicks     int not null default 0,
  created_at    timestamptz not null default now(),
  unique (seller_id, slug)
);
-- ALTER form for databases where `products` already existed before this
-- column was added (CREATE TABLE IF NOT EXISTS above is a no-op on an
-- existing table, so the column list change alone wouldn't reach it).
alter table products add column if not exists status text not null default 'approved'
  check (status in ('pending','approved','rejected'));
alter table products add column if not exists discount_price numeric(10,2)
  check (discount_price is null or discount_price > 0);
create index if not exists idx_products_status on products(status);
create index if not exists idx_products_category    on products(category_id);
create index if not exists idx_products_stock       on products(stock_status);
create index if not exists idx_products_created     on products(created_at desc);
create index if not exists idx_products_archived    on products(archived);

-- ---------- orders (Epic F) ----------
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null default current_seller_id(),
  ref            text not null unique,             -- ORD-2026-0001
  buyer_name     text not null,
  buyer_phone    text not null,                     -- +670XXXXXXXX, identity for the dashboard
  items          jsonb not null,                    -- [{product_id,name,size,price,qty}]
  mode           text not null check (mode in ('delivery','pickup')),
  zone_id        text,
  fee            numeric(10,2) not null default 0,
  quote_requested boolean not null default false,
  subtotal       numeric(10,2) not null,
  total          numeric(10,2) not null,
  -- Central Dili orders use address_line (a plain street address); orders
  -- to Dili's outskirts or another municipality use the full hierarchy.
  address_line   text,
  municipality   text, post text, suku text, aldeia text, landmark text,
  pay_method     text not null check (pay_method in ('cod','cop','bank','wallet','fiar')),
  pay_status     text not null default 'unpaid' check (pay_status in ('unpaid','deposit','paid','refunded')),
  proof_url      text,
  note           text default '',
  status         text not null default 'new'
                 check (status in ('new','confirmed','preparing','out','arrived','completed','cancelled')),
  cancel_reason  text,
  cancel_requested_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_orders_phone   on orders(buyer_phone);
create index if not exists idx_orders_status  on orders(status);
create index if not exists idx_orders_created on orders(created_at desc);

-- internal order log (Epic F6) — append-only
create table if not exists order_log (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_order_log_order on order_log(order_id);

-- Immutability guard (NFR: "order records are immutable once completed")
create or replace function block_edit_completed_order() returns trigger as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'Order % is completed and cannot be reopened', old.ref;
  end if;
  if old.status = 'completed' and new.status = 'completed' then
    -- allow pay_status/proof updates only, block item/address edits
    if new.items is distinct from old.items
       or new.total is distinct from old.total
       or new.municipality is distinct from old.municipality then
      raise exception 'Order % is completed and its contents cannot change', old.ref;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_block_edit_completed on orders;
create trigger trg_block_edit_completed
  before update on orders
  for each row execute function block_edit_completed_order();

-- Stock sync on confirm (Epic F5) — decrement qty, auto-flag out of stock
create or replace function decrement_stock_on_confirm() returns trigger as $$
declare item jsonb;
begin
  if new.status = 'confirmed' and old.status = 'new' then
    for item in select * from jsonb_array_elements(new.items) loop
      update products
        set qty = greatest(0, qty - (item->>'qty')::int),
            stock_status = case
              when greatest(0, qty - (item->>'qty')::int) = 0 then 'out'
              when greatest(0, qty - (item->>'qty')::int) <= 2 then 'low'
              else stock_status end
        where id = (item->>'product_id')::uuid;
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_decrement_stock on orders;
create trigger trg_decrement_stock
  after update on orders
  for each row execute function decrement_stock_on_confirm();

-- Atomic counters for view / WhatsApp-click tracking (Epic E4).
-- security definer: lets an anonymous visitor bump a counter without
-- granting them general UPDATE rights on the products table.
create or replace function increment_views(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set views = views + 1 where id = p_id;
$$;

create or replace function increment_wa_clicks(p_id uuid) returns void
  language sql security definer set search_path = public as $$
  update products set wa_clicks = wa_clicks + 1 where id = p_id;
$$;

revoke all on function increment_views(uuid) from public;
revoke all on function increment_wa_clicks(uuid) from public;
grant execute on function increment_views(uuid) to anon, authenticated;
grant execute on function increment_wa_clicks(uuid) to anon, authenticated;

-- ============================================================
-- Row Level Security
-- Public (anon) visitors: read live products/categories/settings,
-- create orders and read only the order they can prove (ref + phone
-- match, enforced in the app layer via a server route — RLS still
-- blocks blind SELECT * by anon on orders).
-- Admin writes go through the server using the service-role key,
-- which bypasses RLS — never expose that key to the browser.
-- ============================================================
alter table settings   enable row level security;
alter table categories enable row level security;
alter table hero_slides enable row level security;
alter table products   enable row level security;
alter table orders     enable row level security;
alter table order_log  enable row level security;

drop policy if exists settings_public_read on settings;
create policy settings_public_read on settings for select using (true);

-- Row-level security alone is not enough here: RLS controls which ROWS
-- are visible, not which COLUMNS. Without this, the public anon key
-- (embedded in the browser) could read totp_secret straight off the
-- settings row via the REST API despite the row policy above. Column
-- privileges are a second, independent layer that Postgres also enforces.
revoke select on settings from anon, authenticated;
grant select (
  id, seller_id, store_name, tagline_tet, tagline_pt, tagline_en, wa_number,
  hours, municipality, post, suku, landmark, pickup, banks, wallets, zones, updated_at,
  seller_registration_enabled
) on settings to anon, authenticated;
-- commission_rate is deliberately NOT in this list -- customers never
-- need to see it directly, and the seller-facing pages that do
-- (dashboard, orders) are already authenticated and read the full row
-- via the service-role client (adminSettings()), not this public path.
-- totp_secret, totp_enabled, totp_failed_attempts, totp_locked_until are
-- deliberately excluded — readable only via the service-role client
-- (supabaseAdmin()), which bypasses these grants entirely.

drop policy if exists categories_public_read on categories;
create policy categories_public_read on categories for select using (true);

-- No public insert/update/delete policy on hero_slides -- same as
-- categories and products, all writes go through the server using the
-- service-role key (supabaseAdmin()), which bypasses RLS entirely.
drop policy if exists hero_slides_public_read on hero_slides;
create policy hero_slides_public_read on hero_slides for select using (true);

drop policy if exists products_public_read on products;
create policy products_public_read on products for select using (archived = false);

-- Orders: no public SELECT policy at all — order lookup by ref+phone is
-- done through a server route using the service-role key, never straight
-- from the browser. No public INSERT policy either — placeOrder() has
-- always inserted via the service-role client (supabaseAdmin()), so an
-- anon-key insert policy was never actually needed by the app; it only
-- ever existed as an unused open door for anyone holding the public key
-- (visible in any browser's network tab) to insert directly via the
-- Supabase REST API, bypassing all of placeOrder()'s validation and
-- price/stock checks. The drop below is defensive cleanup for a
-- database that still has it from an earlier version of this file.
drop policy if exists orders_public_insert on orders;

-- ============================================================
-- Storage bucket for product images + payment proofs
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('payment-proofs', 'payment-proofs', false)
  on conflict (id) do nothing;

drop policy if exists "product images public read" on storage.objects;
create policy "product images public read" on storage.objects
  for select using (bucket_id = 'product-images');

-- No public upload policy for either bucket, for the same reason as
-- orders above — every upload path in this app (products.ts, hero.ts,
-- seller-products.ts, orders.ts) already uploads via the service-role
-- client. A public insert policy here would only ever be an unused
-- door letting anyone with the anon key upload arbitrary files
-- directly to storage, bypassing the app's own image compression and
-- validation. Both drops below are defensive cleanup for a database
-- that still has these from an earlier version of this file.
drop policy if exists "product images public upload" on storage.objects;
drop policy if exists "payment proofs public upload" on storage.objects;
