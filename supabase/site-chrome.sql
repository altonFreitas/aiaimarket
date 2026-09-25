-- ===========================================================================
-- SITE CHROME -- the two things above the fold the shop can now choose
-- ===========================================================================
-- The heading face and the incentive strip were both decisions made in the
-- code. Both are presentation, both are things the shop has an opinion
-- about, and neither is a reason to open an editor. They move into the
-- settings row.
--
-- WHAT DOES NOT MOVE: which lines the strip is ALLOWED to say. Those are
-- still derived from the settings that make them true -- a shop cannot
-- switch on "free delivery" here, only switch OFF a line it has earned.
-- Turning a promise on from a checkbox is exactly the bug the strip was
-- written to avoid (see src/lib/incentives.ts).
-- ---------------------------------------------------------------------------

-- THE HEADING FACE, by name rather than by file.
-- An allowlist, because this value ends up selecting a font that has to
-- have been loaded: a free-text column would let somebody type "Comic
-- Sans" and get the fallback with no way to tell it had failed. The list
-- is the same one src/app/layout.tsx loads, and the two have to move
-- together -- tests/chromeLook.test.ts holds them to it.
alter table settings
  add column if not exists heading_font text not null default 'jakarta';

alter table settings drop constraint if exists settings_heading_font_known;
alter table settings add constraint settings_heading_font_known
  check (heading_font in ('jakarta', 'inter', 'grotesk', 'system'));

comment on column settings.heading_font is
  'Which loaded face sets the headings. See HEADING_FONTS in src/lib/headingFont.ts.';

-- WHICH INCENTIVES ARE SWITCHED OFF.
-- Off rather than on, and the direction is the whole design. A list of
-- what to SHOW would have to be filled in before anything appeared, so a
-- shop that ran this migration and went to lunch would lose the strip; a
-- list of what to HIDE starts empty and means "show everything true",
-- which is what it did yesterday.
alter table settings
  add column if not exists incentives_off text[] not null default '{}';

comment on column settings.incentives_off is
  'Incentive keys the shop has hidden. Empty means show every line the '
  'other settings make true.';

-- THE SHOP'S OWN WORDING, where it wants its own.
-- key -> {"title": "...", "body": "..."}. Absent or blank falls back to
-- the translated default, so this is an override and never a requirement.
--
-- NOT PER LANGUAGE. The shop writes one line in whichever language it
-- trades in, and a reader in another gets that line rather than an empty
-- one. Three boxes per item for a shop with one person in it is three
-- boxes that stay empty.
alter table settings
  add column if not exists incentive_text jsonb not null default '{}'::jsonb;

comment on column settings.incentive_text is
  'Per-incentive wording overrides, key -> {title, body}. Absent falls '
  'back to the translated default.';

-- Bounded, for the same reason products.highlights is: this is a text box
-- and a text box gets pasted into. An object of at most 40 keys, which is
-- five times more incentives than exist.
--
-- THROUGH A FUNCTION, and this is the second time: a CHECK constraint may
-- not contain a subquery, and counting the keys of a jsonb object needs
-- one. Written inline it read "cannot use subquery in check constraint",
-- which aborts run-all.sql at this line and takes every migration after
-- it down -- exactly what product-highlights.sql did, fixed the same way,
-- and repeated here anyway. Caught by applying the file to real Postgres
-- rather than by reading it.
create or replace function settings_incentive_text_ok(j jsonb)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select jsonb_typeof(j) = 'object'
     and (select count(*) from jsonb_object_keys(j)) <= 40;
$fn$;

comment on function settings_incentive_text_ok(jsonb) is
  'Shape check for settings.incentive_text: an object of at most 40 keys.';

alter table settings drop constraint if exists settings_incentive_text_sane;
alter table settings add constraint settings_incentive_text_sane
  check (settings_incentive_text_ok(incentive_text));

-- ---------------------------------------------------------------------------
-- THE STOREFRONT HAS TO BE ABLE TO READ THEM
-- ---------------------------------------------------------------------------
-- settings is read with the browser's anon key and its grants are
-- column-by-column (see legal-currency-tax.sql). A column added without a
-- grant is a column the storefront asks for and is refused -- which fails
-- the WHOLE select, so the shop loses its name and its bank details over
-- a font. Guarded per column so a partially-migrated database grants what
-- it has rather than failing the file.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'heading_font') then
    execute 'grant select (heading_font) on settings to anon, authenticated';
  end if;

  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'incentives_off') then
    execute 'grant select (incentives_off, incentive_text)
             on settings to anon, authenticated';
  end if;
end $$;
