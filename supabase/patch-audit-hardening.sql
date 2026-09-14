-- ===========================================================================
-- patch-audit-hardening.sql
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run.
-- Apply-aiaimarket-hardening.js never touches your database; it only writes
-- this file for you to read and run yourself.
--
-- Safe to re-run. Every statement is idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. [CRITICAL] Unapproved products are publicly readable.
--
-- The app filters status='approved' in its QUERIES (getLiveProducts,
-- getProductBySlug), but the RLS policy only checks `archived`. Anyone with
-- the anon key -- which is, by design, visible in every browser's network
-- tab -- can call the REST API directly:
--
--     GET /rest/v1/products?status=eq.pending
--
-- and read every listing awaiting moderation, plus every one an admin has
-- already REJECTED. The moderation workflow is enforced in application code
-- only; the database happily serves around it. Move the rule into the policy,
-- where it cannot be bypassed.
--
-- Admin and seller pages are unaffected: they read through the service-role
-- client, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------
drop policy if exists products_public_read on products;
create policy products_public_read on products
  for select using (archived = false and status = 'approved');

-- ---------------------------------------------------------------------------
-- 2. [HIGH] schema.sql cannot run on a fresh database.
--
-- `seller_ratings` is defined ABOVE `orders` in schema.sql but declares
--     order_id uuid references orders(id) on delete set null
-- so on a brand-new project the script aborts with
--     ERROR: relation "orders" does not exist
-- and every table after that point is never created. It only appears to work
-- on databases that grew incrementally through earlier versions of the file.
--
-- The fix in schema.sql drops the inline reference and adds the constraint
-- at the end, once both tables exist. This block does the same for a
-- database that is already live and missing the constraint.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_ratings_order_id_fkey'
  ) then
    alter table seller_ratings
      add constraint seller_ratings_order_id_fkey
      foreign key (order_id) references orders(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. [HIGH] Bank account numbers are readable without placing an order.
--
-- settings.banks / settings.wallets are granted to anon so the checkout page
-- can reveal them after a buyer picks "bank transfer". But a grant is not a
-- condition -- anyone can read them straight from the REST API without ever
-- touching the store:
--
--     GET /rest/v1/settings?select=banks,wallets
--
-- That is your real account numbers and holder names, published. This is a
-- judgement call, not an automatic fix, so it is left COMMENTED OUT:
--
--   * If those details are already on your public shopfront, WhatsApp
--     status or business card, leave this alone -- nothing is being leaked.
--   * If they are not, uncomment the two lines below. Payment details then
--     come only from the server (getSettings runs server-side), and nothing
--     in the UI changes.
-- ---------------------------------------------------------------------------
-- revoke select (banks, wallets) on settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. [MEDIUM] Stock can go negative under concurrent confirmations.
--
-- SUPERSEDED, AND THE REPLACEMENT HAS BEEN DELETED FROM THIS FILE. Read
-- this before adding anything like it back.
--
-- This section used to `create or replace decrement_stock_on_confirm()`
-- with a row lock added. That was the right fix when it was written. It has
-- since become the single most damaging line in the schema, because
-- supabase/stock-reservation.sql replaced the same function with one that
-- moves stock THROUGH THE LEDGER -- and this file runs last, so it put the
-- old direct-write version back every single time the schema was applied.
--
-- What that cost, on a database where run-all.sql had been run:
--
--   * confirming an order wrote products.qty directly and recorded no
--     movement, so stock_reconciliation drifted by the size of the order
--     and the ledger stopped being the history of the shelf;
--   * no reservation was ever written, so the hold placed at checkout did
--     not exist, release_stale_reservations swept nothing, and the whole
--     of stock-reservation.sql was inert;
--   * two orders could still take the last unit, which is the very thing
--     this section was added to prevent -- the lock it takes is per
--     confirmation, and the race moved to placement.
--
-- The locking this was for now happens in reserve_order_stock(), which
-- takes the row lock at PLACEMENT, where the race actually is. Nothing here
-- needs to redefine the trigger, so nothing here does.
--
-- Found by applying run-all.sql to an empty Postgres and confirming one
-- order: products.qty went 30 -> 27 with no ledger row behind it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. [MEDIUM] Missing indexes on the marketplace's hottest lookups.
--
-- Every product page resolves a slug; every seller dashboard scans by
-- seller_id; the ratings widget groups by seller. None of those had an index.
-- ---------------------------------------------------------------------------
create index if not exists idx_products_slug       on products(slug);
create index if not exists idx_products_seller     on products(seller_id);
create index if not exists idx_categories_slug     on categories(slug);
create index if not exists idx_sellers_slug        on sellers(slug);
create index if not exists idx_sellers_user        on sellers(user_id);
create index if not exists idx_sellers_status      on sellers(status);
create index if not exists idx_hero_slides_sort    on hero_slides(sort_order);

-- Partial index matching the exact predicate the catalog queries use.
create index if not exists idx_products_live
  on products(created_at desc)
  where archived = false and status = 'approved';

-- ---------------------------------------------------------------------------
-- 6. [LOW] order_log has RLS enabled but no policy, which is correct
--    (default deny). Stated here so a future reader doesn't "fix" it.
-- ---------------------------------------------------------------------------
