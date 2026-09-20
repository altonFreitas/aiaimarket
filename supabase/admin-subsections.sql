-- ---------------------------------------------------------------------------
-- Access down to the tab, not only the area
-- ---------------------------------------------------------------------------
-- admin_users.sections held one of six area keys. It now also holds TAB keys
-- -- "settings.finance", "sales.orders" -- so an account can be given the
-- Settings area and, inside it, only Finance and Activity.
--
-- NOTHING CHANGES FOR ANY EXISTING ROW. An area key still means the whole
-- area, exactly as it always did, and every account today holds area keys.
-- The two grants are deliberately different and stay so:
--
--   'settings'         the whole area, INCLUDING tabs added in a later
--                      version. Somebody trusted with Settings was trusted
--                      with Settings, not with a list.
--   'settings.finance' exactly that tab, and nothing that appears beside it
--                      afterwards.
--
-- Getting that the other way round is how a permission quietly widens
-- between releases, which is the failure nobody is watching for.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- WHY THE CONSTRAINT IS RENAMED AND NOT JUST REPLACED
-- ---------------------------------------------------------------------------
-- admin-roles.sql creates admin_users_sections_check, allowing the six area
-- keys and nothing else. This file needs a wider list.
--
-- Replacing it under the same name works, and is invisible. schema_inventory
-- reports NAMES, so a constraint replaced in place looks identical before and
-- after, and the Settings -> Database panel would report this file as applied
-- on a shop that had never run it. That panel exists because the shop has
-- twice been broken by an unrun file; a file it cannot see is the same bug
-- with a fresh coat of paint.
--
-- A new NAME is a thing the panel can see, using names alone. So the narrow
-- constraint is dropped and a differently named wide one takes its place --
-- and the panel can tell the two states apart.
--
-- The two must never coexist: the narrow one would go on rejecting every tab
-- key while the wide one permitted it, and a check constraint that is present
-- is enforced whatever sits beside it. Hence the drop, and hence the matching
-- guard in admin-roles.sql, which now declines to re-create the narrow
-- constraint when the wide one is already there. Without that guard, running
-- admin-roles.sql on its own AFTER this file would silently re-narrow the
-- column and every tab grant would start failing to save.
-- ---------------------------------------------------------------------------

alter table admin_users drop constraint if exists admin_users_sections_check;
alter table admin_users drop constraint if exists admin_users_section_keys_check;

-- KEPT IN STEP WITH src/lib/adminSections.ts BY A TEST. tests/adminSections
-- reads this file and fails if the list here and ALL_GRANT_KEYS disagree --
-- because a key the app grants and the database refuses is a save that fails
-- with a constraint error, and a key the database allows and the app does not
-- recognise is a row that reads as a permission and grants nothing.
alter table admin_users
  add constraint admin_users_section_keys_check check (
    sections <@ array[
      -- areas
      'sales','catalog','procurement','sellers','storefront','settings',
      -- tabs
      'sales.dashboard','sales.orders','sales.returns','sales.notifications',
      'catalog.products','catalog.stock','catalog.categories','catalog.demand',
      'catalog.costs','catalog.reviews',
      -- The dynamic taxonomy (supabase/taxonomy.sql): the tree of product
      -- types, and the library of attributes they ask for.
      'catalog.types','catalog.attributes',
      'procurement.orders','procurement.reorder','procurement.suppliers',
      'sellers.list','sellers.payouts',
      'storefront.hero','storefront.promotions',
      'settings.shop','settings.finance','settings.targets','settings.activity'
    ]::text[]
  );

comment on column admin_users.sections is
  'Which parts of the admin this account may open. An area key ("settings") grants the whole area including tabs added later; a tab key ("settings.finance") grants exactly that tab. Keys from src/lib/adminSections.ts; enforced in requireSection(), src/lib/actions/guard.ts.';

-- ---------------------------------------------------------------------------
-- Note on settings.users
-- ---------------------------------------------------------------------------
-- Admin users is NOT in the list above, deliberately. It is the owner's
-- alone: an account that could edit accounts could grant itself everything,
-- which is not a permission but the absence of one. The application refuses
-- it in two independent places (normalizeSections drops it on the way in,
-- canOpenSubsection refuses it on the way out) and the database will not
-- store it at all. Either alone would do; all three means a gap in one is
-- not a breach.
--
-- ---------------------------------------------------------------------------
-- Done. Nothing on any screen changes until somebody edits an account and
-- ticks a tab rather than an area.
-- ---------------------------------------------------------------------------
