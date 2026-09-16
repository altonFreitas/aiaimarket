-- ---------------------------------------------------------------------------
-- A store's access, down to the tab
-- ---------------------------------------------------------------------------
-- sellers.features held four flat keys -- 'sales', 'stock', 'procurement',
-- 'today' -- one per screen the owner could sell. It now holds the same
-- two-level keys the staff side uses: AREA keys and TAB keys.
--
--   'selling'       the whole area, INCLUDING tabs added in a later version
--                   of the app. A store trusted with Sales was trusted with
--                   Sales, not with a list.
--   'selling.today' exactly that tab, and nothing that appears beside it
--                   afterwards.
--
-- Getting that the other way round is how a permission quietly widens
-- between releases, which is the failure nobody is watching for.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- THE MIGRATION IS THE CAREFUL PART, AND IT MUST NOT WIDEN ANYTHING
-- ---------------------------------------------------------------------------
-- Every old key becomes a TAB key, never an area key.
--
-- THE SALES AREA IS KEYED 'selling' FOR EXACTLY THIS REASON. Had it been
-- keyed 'sales', the old flat key and the new area key would be one string
-- with two meanings and no way to tell them apart: a row reading ['sales']
-- would be either a store that bought one report before this ran or a store
-- granted the whole area after it. Old 'sales' named the My
-- sales PAGE; the Sales AREA did not exist. Mapping it to the area would
-- hand every store that had bought one report the whole of Sales, plus
-- every tab added to Sales afterwards, and nothing on any screen would say
-- it had happened.
--
--   today       -> selling.today
--   sales       -> selling.report
--   stock       -> catalog.stock
--   procurement -> purchasing.purchases
--
-- Each store ends up able to open exactly the screens it could open before.
--
-- The constraint is dropped first so the rewrite cannot fail against the
-- old list, and the new one is added after, so it validates the rewritten
-- rows rather than the ones on their way out.
-- ---------------------------------------------------------------------------

alter table sellers drop constraint if exists sellers_features_check;
alter table sellers drop constraint if exists sellers_area_keys_check;

update sellers
   set features = (
     select coalesce(array_agg(distinct new_key order by new_key), '{}')
       from unnest(features) as old_key
       cross join lateral (
         select case old_key
           when 'today'       then 'selling.today'
           when 'sales'       then 'selling.report'
           when 'stock'       then 'catalog.stock'
           when 'procurement' then 'purchasing.purchases'
           -- Already migrated, or a key from a feature since removed. Kept
           -- as-is here and dropped by normalizeFeatures() on the way out,
           -- so a second run of this file is a no-op rather than a mangling.
           else old_key
         end as new_key
       ) as mapped
   )
 where exists (
   select 1 from unnest(features) as k
    where k in ('today', 'sales', 'stock', 'procurement')
 );

-- ---------------------------------------------------------------------------
-- The new list, under a new NAME
-- ---------------------------------------------------------------------------
-- Renamed rather than replaced in place, for the same reason
-- admin_users_section_keys_check was: schema_inventory reports NAMES, so a
-- constraint swapped under its own name is invisible to the Settings ->
-- Database panel and this file would read as applied on a shop that had
-- never run it. A new name is something the panel can see.
--
-- KEPT IN STEP WITH src/lib/sellerFeatures.ts BY A TEST. tests/sellerFeatures
-- reads this file and fails if the list here and ALL_GRANT_KEYS disagree --
-- because a key the app offers and the database refuses is a save that
-- fails in the owner's face while they are trying to sell something, and a
-- key the database allows and the app does not recognise is a row that
-- reads as a paid feature and opens nothing.
-- ---------------------------------------------------------------------------
alter table sellers
  add constraint sellers_area_keys_check check (
    features <@ array[
      -- areas
      'selling','catalog','purchasing',
      -- tabs
      'selling.today','selling.report',
      'catalog.stock',
      'purchasing.purchases'
    ]::text[]
  );

comment on column sellers.features is
  'Which of the owner''s tools this store may open, beyond the screens every seller has. An area key ("selling") grants the whole area including tabs added later; a tab key ("selling.today") grants exactly that tab. Keys from src/lib/sellerFeatures.ts; enforced in requireSellerFeature(), src/lib/actions/guard.ts.';

-- ---------------------------------------------------------------------------
-- Note on what is NOT in the list
-- ---------------------------------------------------------------------------
-- The dashboard, My products, My orders and Store settings are not here,
-- deliberately. They are what makes an account a seller at all: a store
-- that could not list a product or see an order would not be a cheaper
-- store, it would be a broken one. They are held by every approved store
-- and are not a checkbox, so a key naming one would be a permission
-- nothing reads -- the screen and the database disagreeing about what was
-- sold.
--
-- 'settings' is absent for the same reason: its only tab comes free, so
-- offering the area would be offering nothing.
-- ---------------------------------------------------------------------------
