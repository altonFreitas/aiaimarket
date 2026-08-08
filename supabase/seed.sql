-- ============================================================
-- Optional demo seed data. Run after schema.sql if you want sample
-- products to look at before adding your own. Safe to skip entirely.
-- ============================================================

update settings set
  store_name = 'Loja AIAI',
  tagline_tet = 'Sasán loos, folin klaru, entrega iha Dili.',
  tagline_pt  = 'Produtos reais, preços claros, entrega em Díli.',
  tagline_en  = 'Real stock, clear prices, delivered in Dili.',
  wa_number = '+67077123456',
  hours = 'Segunda–Sábadu · 08:00–18:00',
  municipality = 'Dili', post = 'Vera Cruz', suku = 'Caicoli',
  landmark = 'besik igreja Balide, uma kór mutin',
  pickup = true,
  banks = '[{"label":"BNCTL","account":"0012 3456 7890","holder":"Loja AIAI Unipessoal"}]',
  wallets = '[{"label":"Telemor Mosan","number":"+670 7712 3456"}]',
  zones = '[{"id":"z1","name":"Dili sentru","fee":1,"quote":false},
            {"id":"z2","name":"Dili liur","fee":2,"quote":false},
            {"id":"z3","name":"Munisípiu seluk","fee":0,"quote":true}]'
where id = 1;

insert into categories (name, slug, sort_order) values
  ('Sapatu','sapatu',1), ('Roupa','roupa',2), ('Telemóvel & asesóriu','telemovel',3)
on conflict (seller_id, slug) do nothing;

insert into products (ref, name, slug, category_id, price, sizes, tags, stock_status, qty, description,
  pay_cod, pay_cop, pay_bank)
select
  'PRD-0001', 'Nike Air Max 90', 'nike-air-max-90',
  (select id from categories where slug = 'sapatu'),
  45.00, array['40','41','42','43'], array['viajen','servisu'],
  'in', 6, 'Sapatu importadu, kualidade orijinál. Sola konfortavel ba la''o dook.',
  true, true, true
where not exists (select 1 from products where ref = 'PRD-0001');
