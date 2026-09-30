-- ===========================================================================
-- THE SHOP'S OWN LINE, IN INDONESIAN
-- ===========================================================================
-- The shop has four languages (src/lib/locale.ts) and three tagline
-- columns, so a reader who chose Indonesian was shown the headline in
-- Tetun -- on /id/shop, under an Indonesian kicker and an Indonesian
-- description, which reads as a half-translated shop rather than as a
-- missing setting.
--
-- The tagline is the one piece of storefront prose that is the shop's own
-- words rather than a translated interface string, so it cannot come from
-- lib/i18n.ts. It needs a column.
--
-- WHY THIS WAS NOT ADDED WITH THE OTHER THREE. Nothing wrote them. They
-- were seeded by SQL and no screen in Settings offered a box, so a fourth
-- would have been a column nobody could fill. That is fixed in the same
-- change as this file: Settings now edits all four.
-- ---------------------------------------------------------------------------

alter table settings
  add column if not exists tagline_id text default '';

comment on column settings.tagline_id is
  'The shop''s one-line description in Indonesian. Blank falls back to '
  'Tetum -- see taglineOf() in src/lib/tagline.ts.';

-- ---------------------------------------------------------------------------
-- THE DEMO SHOP'S LINE, AND ONLY THE DEMO SHOP'S
-- ---------------------------------------------------------------------------
-- A shop still carrying the seed's Tetun tagline is a shop that has not
-- written its own, and leaving it blank would mean pasting this file
-- changes nothing visible -- the headline stays Tetun until somebody finds
-- the new box. So the demo line gets its Indonesian counterpart, matched
-- on the exact string supabase/seed.sql writes.
--
-- MATCHED ON THE TETUN, NOT JUST ON A BLANK tagline_id. Every shop's
-- tagline_id is blank the moment this file adds the column; only the ones
-- whose Tetun line is still the seed's have said nothing of their own. A
-- shop that wrote its own tagline keeps an empty box to fill in its own
-- words, rather than being handed a sentence about Dili it never wrote.
--
-- Idempotent: the second run finds tagline_id already set and the
-- `= ''` guard excludes it.
update settings
   set tagline_id = 'Stok nyata, harga jelas, diantar di Dili.'
 where coalesce(tagline_id, '') = ''
   and tagline_tet = 'Sasán loos, folin klaru, entrega iha Dili.';

-- ---------------------------------------------------------------------------
-- THE STOREFRONT HAS TO BE ABLE TO READ IT
-- ---------------------------------------------------------------------------
-- settings is read with the browser's anon key and its grants are
-- column-by-column (see legal-currency-tax.sql). A column added without a
-- grant is a column the storefront asks for and is refused -- and that
-- fails the WHOLE select, not just the one column. Guarded, so a
-- partially-migrated database grants what it has rather than failing the
-- file.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'tagline_id') then
    execute 'grant select (tagline_id) on settings to anon, authenticated';
  end if;
end $$;
