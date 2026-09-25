-- ============================================================
-- Optional demo seed data. Run after schema.sql if you want sample
-- products to look at before adding your own. Safe to skip entirely.
-- ============================================================

update settings set
  store_name = 'AIAI STORE TIMOR-LESTE',
  tagline_tet = 'Sasán loos, folin klaru, entrega iha Dili.',
  tagline_pt  = 'Produtos reais, preços claros, entrega em Díli.',
  tagline_en  = 'Real stock, clear prices, delivered in Dili.',
  wa_number = '+67077123456',
  hours = 'Segunda–Sábadu · 08:00–18:00',
  municipality = 'Dili', post = 'Vera Cruz', suku = 'Caicoli',
  landmark = 'besik igreja Balide, uma kór mutin',
  pickup = true,
  banks = '[{"label":"BNCTL","account":"0012 3456 7890","holder":"AIAI STORE TIMOR-LESTE Unipessoal"}]',
  wallets = '[{"label":"Telemor Mosan","number":"+670 7712 3456"}]',
  -- THE REAL ZONE IDS, and no "name" field.
  --
  -- This used to write z1, z2 and z3 with names in Tetun. Neither half was
  -- right: the application labels a zone by looking up t("zone_" + id), so
  -- an id it does not recognise was shown to shoppers as the literal string
  -- "zone_z1", and the "name" here was read by nothing at all -- it made
  -- the row LOOK correct while the checkout offered three untranslated keys
  -- as if they were places. The ids below are the ones lib/zones.ts knows.
  zones = '[{"id":"dili_center","fee":1,"quote":false},
            {"id":"dili_outskirts","fee":2,"quote":false},
            {"id":"other_municipality","fee":0,"quote":true}]'
where id = 1;

-- NO CATEGORIES OF ITS OWN ANY MORE.
--
-- This file used to create Sapatu, Roupa and Telemóvel & asesóriu. They were
-- sample aisles from before the shop had a real taxonomy, and once
-- focus-taxonomy.sql existed they were worse than redundant: that file
-- clears away the aisles this shop does not stock, this one runs AFTER it
-- in run-all.sql, and the three came straight back on every single run.
-- A category list that regrows what you just removed is one nobody can
-- curate.
--
-- The sample product files itself under the real tree instead.

-- THE SAMPLE PRODUCT ARRIVES THROUGH THE LEDGER, like every real one.
--
-- It used to be inserted with qty 6 written straight onto the row. This file
-- runs LAST, after stock-ledger.sql has already backfilled opening balances,
-- so those six units had no movement behind them -- and stock_reconciliation
-- reported drift 6 on the demo shoe of every fresh install, for ever.
--
-- Drift is the alarm that means "something wrote products.qty without a
-- movement". It is the alarm that would have caught two real bugs in this
-- schema, and it was ringing on day one about a sample shoe. An alarm that
-- is always on is an alarm nobody reads, which is the whole cost.
--
-- So: the row goes in empty, and a movement puts the stock on the shelf. The
-- trigger sets qty AND stock_status from it, exactly as a purchase receipt
-- does, and the ledger balances.
insert into products (ref, name, slug, category_id, price, sizes, tags, stock_status, qty, description,
  pay_cod, pay_cop, pay_bank)
select
  'PRD-0001', 'Nike Air Max 90', 'nike-air-max-90',
  -- Sports Shoes, under Shoes & Footwear -- a real aisle in the real
  -- tree, so the demo product is filed where a demo shoe belongs.
  (select id from categories where slug = 'sports_shoes'),
  45.00, array['40','41','42','43'], array['viajen','servisu'],
  'out', 0, 'Sapatu importadu, kualidade orijinál. Sola konfortavel ba la''o dook.',
  true, true, true
where not exists (select 1 from products where ref = 'PRD-0001');

-- Guarded on the movement, not on the product: re-running this file must not
-- stock the shelf a second time.
insert into stock_movements (product_id, delta, reason, note)
select p.id, 6, 'correction', 'sample data'
  from products p
 where p.ref = 'PRD-0001'
   and not exists (
     select 1 from stock_movements m
      where m.product_id = p.id and m.note = 'sample data');
