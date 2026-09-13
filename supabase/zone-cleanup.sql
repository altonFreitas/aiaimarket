-- ===========================================================================
-- Loja AIAI -- delivery zones the shop has a name for
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
--
-- WHAT WAS ON THE CHECKOUT. Four delivery options, three of them called
-- "zone_z1", "zone_z2" and "zone_z3" -- raw i18n keys, shown to shoppers as
-- if they were places, with real prices beside them.
--
-- HOW. The application names a zone by looking up t("zone_" + id), and t()
-- returns the key when it does not recognise it. supabase/seed.sql wrote
-- zones with the ids z1, z2 and z3, so every shop that ran the seed had
-- three entries nothing could name. The checkout iterated settings.zones
-- and offered all of them; the admin editor iterated a hardcoded list of
-- the three REAL ids, so it could not see the junk -- and, worse, it
-- patched the stored array rather than replacing it, so every save carried
-- the junk forward. There was no sequence of clicks that fixed it.
--
-- The code half is lib/zones.ts: one canonical list, read by the checkout,
-- the settings screen and the save action alike. This is the data half --
-- for a shop that will not have its settings touched today, and so that a
-- database is correct the moment the migration runs rather than the next
-- time somebody happens to open a form.
--
-- ONLY THE THREE THE APPLICATION CAN NAME. An id outside that set has no
-- label in any of the three languages, so it cannot be offered; keeping it
-- would be keeping the bug.
-- ---------------------------------------------------------------------------

do $$
declare
  before_ids text;
  after_ids  text;
begin
  select string_agg(z->>'id', ', ' order by z->>'id')
    into before_ids
    from settings s, jsonb_array_elements(s.zones) z
   where s.id = 1;

  update settings s set zones = (
    select coalesce(jsonb_agg(zone order by zone.ord), '[]'::jsonb)
      from (
        select
          -- Rebuilt rather than filtered, so the shape is right even for a
          -- row that was missing a zone entirely: three entries, in order,
          -- carrying whatever fee and quote flag was already recorded.
          jsonb_build_object(
            'id', want.id,
            'fee', coalesce((have.z->>'fee')::numeric, 0),
            'quote', coalesce((have.z->>'quote')::boolean, false)
          ) as zone,
          want.ord
        from (values
                ('dili_center', 1),
                ('dili_outskirts', 2),
                ('other_municipality', 3)
             ) as want(id, ord)
        left join lateral (
          select z from jsonb_array_elements(s.zones) z
           where z->>'id' = want.id
           limit 1
        ) have on true
      ) zone
  )
  where s.id = 1;

  select string_agg(z->>'id', ', ' order by z->>'id')
    into after_ids
    from settings s, jsonb_array_elements(s.zones) z
   where s.id = 1;

  if before_ids is distinct from after_ids then
    raise notice 'zones: % -> %', coalesce(before_ids, '(none)'), coalesce(after_ids, '(none)');
  else
    raise notice 'zones: already correct (%)', coalesce(after_ids, '(none)');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Done. Verify with:
--
--   select jsonb_pretty(zones) from settings where id = 1;
--
-- Exactly three entries, ids dili_center / dili_outskirts /
-- other_municipality, and no "name" field -- the label comes from the
-- application's own translations, which is why an id it does not know
-- cannot be displayed.
-- ---------------------------------------------------------------------------
