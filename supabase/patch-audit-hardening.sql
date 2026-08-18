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
-- decrement_stock_on_confirm() reads and writes products.qty without a lock,
-- so two admins confirming two orders for the last unit at the same moment
-- both see qty=1. `greatest(0, ...)` keeps the number non-negative but the
-- store has still promised stock it does not have. An explicit row lock
-- serializes the two updates.
-- ---------------------------------------------------------------------------
create or replace function decrement_stock_on_confirm() returns trigger as $$
declare
  item jsonb;
  new_qty int;
begin
  if new.status = 'confirmed' and old.status = 'new' then
    for item in select * from jsonb_array_elements(new.items) loop
      -- Lock the product row first: without this, two concurrent confirms
      -- read the same qty and one decrement is silently lost.
      select greatest(0, p.qty - (item->>'qty')::int) into new_qty
        from products p
        where p.id = (item->>'product_id')::uuid
        for update;

      if found then
        update products
          set qty = new_qty,
              stock_status = case
                when new_qty = 0 then 'out'
                when new_qty <= 2 then 'low'
                else stock_status end
          where id = (item->>'product_id')::uuid;
      end if;
    end loop;
  end if;
  return new;
end;
$$ language plpgsql;

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
