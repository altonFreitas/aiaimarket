-- ===========================================================================
-- Loja AIAI -- a seller's own buying
--
-- The marketplace's purchasing screens (supabase/procurement.sql) are the
-- OWNER'S buying operation: their suppliers, their orders, their landed
-- costs. A store renting a shop inside the marketplace buys too, and until
-- now had nowhere to record it -- so a seller granted "stock control" could
-- see what was running out and had no way to say what they had ordered
-- about it.
--
-- ONE COLUMN ON EACH OF TWO TABLES, and it is nullable on purpose:
--
--   null      the marketplace's own. Every supplier and every purchase
--             order that exists today, unchanged, still the owner's.
--   a seller  that store's own, visible to that store and to the owner,
--             and to nobody else.
--
-- Backfilling would have been the other choice and would have been wrong:
-- there is no seller to attribute an existing order to, and inventing one
-- would put the owner's supplier prices on somebody else's screen.
--
-- WHAT THIS IS NOT. It is not a shared supplier book. Two stores buying
-- from the same factory each keep their own row for it, because a supplier
-- row carries contact names, lead times and notes that are commercial
-- information -- and one seller editing another's supplier, or reading the
-- price the owner pays, is the failure this whole column exists to avoid.
--
-- Safe to re-run.
-- ===========================================================================

alter table suppliers
  add column if not exists seller_id uuid references sellers(id) on delete cascade;
alter table purchase_orders
  add column if not exists seller_id uuid references sellers(id) on delete cascade;

-- on delete cascade, not set null: a store leaving the marketplace must not
-- leave its purchase orders behind reading as the owner's own buying, which
-- is what "set null" would have meant here.

comment on column suppliers.seller_id is
  'Which store''s supplier. Null is the marketplace''s own. See supabase/seller-procurement.sql.';
comment on column purchase_orders.seller_id is
  'Which store placed this order. Null is the marketplace''s own.';

-- Partial, like products_loves_idx: every query that uses these asks for one
-- seller's rows, and the owner's own -- much the larger set on a young
-- marketplace -- is asked for by "is null" instead.
create index if not exists idx_suppliers_seller
  on suppliers(seller_id) where seller_id is not null;
create index if not exists idx_purchase_orders_seller
  on purchase_orders(seller_id) where seller_id is not null;

-- ---------------------------------------------------------------------------
-- The third thing a seller can be given.
--
-- supabase/seller-features.sql says, in its own comments, that adding a
-- feature means editing its constraint too -- and that the constraint is
-- dropped and recreated rather than guarded by an existence check, so that
-- re-running actually applies the new list. This is that edit. Running
-- either file after the other leaves the same three keys.
-- ---------------------------------------------------------------------------
--
-- GUARDED, LIKE THE ONE IN seller-features.sql, because seller-areas.sql
-- later replaces this constraint with sellers_area_keys_check and rewrites
-- every row to the two-level keys. Re-adding the narrow list over those rows
-- fails outright, which is what running run-all.sql a second time did.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname in ('sellers_features_check', 'sellers_area_keys_check')
  ) then
    alter table sellers
      add constraint sellers_features_check check (
        features <@ array['sales','stock','procurement','today']::text[]
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security is unchanged, and that is the point.
--
-- suppliers and purchase_orders have RLS on with no policy for anon or
-- authenticated (see procurement.sql), so neither table is readable by a
-- logged-in seller through the Supabase client at all. Every read and write
-- on these screens goes through the service role in a server action that has
-- already resolved WHICH seller is asking and filters on this column --
-- lib/actions/seller-procurement.ts, and the ownership check it shares with
-- the admin actions (lib/procurementScope.ts).
--
-- Stated rather than assumed: a later file that adds a blanket
-- "authenticated can read suppliers" policy would hand every seller the
-- owner's supplier list and every other seller's, and the column above
-- would not stop it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Done. Nothing changes for anyone until "Purchases" is ticked for a store
-- on Sellers -> that store -> Access.
-- ---------------------------------------------------------------------------
