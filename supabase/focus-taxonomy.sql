-- ===========================================================================
-- The catalogue this shop actually sells: fashion, footwear, accessories,
-- and the fitness and wellness range
-- ===========================================================================
-- taxonomy-seed.sql builds 25 top-level categories generated from a
-- specification -- electronics, gaming, automotive, musical instruments.
-- This shop sells clothes, shoes, accessories and supplements, and a
-- category list naming twenty aisles it does not stock is a list nobody
-- can file anything in: every product form opens on a menu of mostly
-- wrong answers, and the shop's own navigation advertises departments
-- that will always be empty.
--
-- So: four roots, their subcategories, and -- under Fitness & Wellness
-- Lifestyle -- a third level, because Protein and Creatine are kinds of
-- Sports Nutrition rather than things that sit beside it.
--
-- THREE LEVELS IS NEW AND THE CODE HAD TO LEARN IT. Four places walked
-- the tree exactly one level deep, which was right while it was two deep
-- and silently wrong the moment it was not -- a tub of protein counted
-- towards Sports Nutrition and not towards the aisle above it. They all
-- read one recursive walk now: src/lib/categoryTree.ts.
--
-- WHAT HAPPENS TO WHAT IS ALREADY FILED. Nothing is deleted while it
-- holds anything:
--   * a category that maps onto one of the new ones hands over its
--     product types, its products and its purchase order lines, then goes;
--   * a category that maps onto nothing and holds nothing goes;
--   * a category that maps onto nothing and HOLDS something stays, with
--     everything in it. Deleting it would cascade its product types away
--     and set its products' category to null -- a product that disappears
--     from every listing while still being live, buyable stock. A shop
--     that wants those gone can empty them and run this again.
--
-- Safe to re-run: the inserts are upserts on the slug, and the second
-- pass finds nothing left to move.
-- ===========================================================================

do $focus$
declare
  v_seller uuid;
  v_pass   int;
begin
  select seller_id into v_seller from settings limit 1;
  if v_seller is null then
    raise exception 'No settings row: run supabase/schema.sql first.';
  end if;

  -- ---- 1. the tree ----------------------------------------------------
  -- Three statements, not one: each level joins to the level above by
  -- slug, so the parent has to be there before its child can point at it.
  --
  -- UPSERT rather than "do nothing", because two of these slugs already
  -- exist as top-level categories -- accessories and gym_accessories --
  -- and gym_accessories has to MOVE under Fitness & Wellness. Skipping
  -- the conflict would leave it where it was.

  -- roots
  insert into categories (seller_id, name, slug, parent_id, sort_order)
  select v_seller, v.name, v.slug, null, v.ord
    from (values

    ('Fashion & Apparel', 'fashion_apparel', 0),
    ('Shoes & Footwear', 'shoes_footwear', 1),
    ('Accessories', 'accessories', 2),
    ('Fitness & Wellness Lifestyle', 'fitness_wellness', 3)
    ) as v(name, slug, ord)
  on conflict (seller_id, slug) do update
     set name = excluded.name, parent_id = null, sort_order = excluded.sort_order;

  -- subcategories
  insert into categories (seller_id, name, slug, parent_id, sort_order)
  select v_seller, v.name, v.slug, c.id, v.ord
    from (values

    ('Men''s Clothing', 'mens_clothing', 'fashion_apparel', 0),
    ('Women''s Clothing', 'womens_clothing', 'fashion_apparel', 1),
    ('Unisex Clothing', 'unisex_clothing', 'fashion_apparel', 2),
    ('Activewear', 'activewear', 'fashion_apparel', 3),
    ('Sportswear', 'sportswear', 'fashion_apparel', 4),
    ('Underwear & Lingerie', 'underwear_lingerie', 'fashion_apparel', 5),
    ('Swimwear', 'swimwear', 'fashion_apparel', 6),
    ('Sports Shoes', 'sports_shoes', 'shoes_footwear', 0),
    ('Running', 'running', 'shoes_footwear', 1),
    ('Training & Gym', 'training_gym', 'shoes_footwear', 2),
    ('Football', 'football', 'shoes_footwear', 3),
    ('Basketball', 'basketball', 'shoes_footwear', 4),
    ('Hiking & Outdoor', 'hiking_outdoor', 'shoes_footwear', 5),
    ('Casual', 'casual', 'shoes_footwear', 6),
    ('Formal', 'formal', 'shoes_footwear', 7),
    ('Headwear', 'headwear', 'accessories', 0),
    ('Bags', 'bags', 'accessories', 1),
    ('Jewelry', 'jewelry', 'accessories', 2),
    ('Watches', 'watches', 'accessories', 3),
    ('Sunglasses', 'sunglasses', 'accessories', 4),
    ('Belts', 'belts', 'accessories', 5),
    ('Wallets', 'wallets', 'accessories', 6),
    ('Gym Accessories', 'gym_accessories', 'fitness_wellness', 0),
    ('Sports Nutrition', 'sports_nutrition', 'fitness_wellness', 1),
    ('Dietary Supplements', 'dietary_supplements', 'fitness_wellness', 2),
    ('Superfoods & Health Food', 'superfoods_health_food', 'fitness_wellness', 3)
    ) as v(name, slug, parent_slug, ord)
    join categories c on c.seller_id = v_seller and c.slug = v.parent_slug
  on conflict (seller_id, slug) do update
     set name = excluded.name, parent_id = excluded.parent_id,
         sort_order = excluded.sort_order;

  -- the third level
  insert into categories (seller_id, name, slug, parent_id, sort_order)
  select v_seller, v.name, v.slug, c.id, v.ord
    from (values

    ('Protein', 'protein', 'sports_nutrition', 0),
    ('Creatine', 'creatine', 'sports_nutrition', 1),
    ('Pre-Workout', 'pre_workout', 'sports_nutrition', 2),
    ('Amino Acids', 'amino_acids', 'sports_nutrition', 3),
    ('Electrolytes', 'electrolytes', 'sports_nutrition', 4),
    ('Recovery', 'recovery', 'sports_nutrition', 5),
    ('Vitamins', 'vitamins', 'dietary_supplements', 0),
    ('Minerals', 'minerals', 'dietary_supplements', 1),
    ('Omega & Essential Fatty Acids', 'omega_fatty_acids', 'dietary_supplements', 2),
    ('Digestive Health', 'digestive_health', 'dietary_supplements', 3),
    ('Joint Health', 'joint_health', 'dietary_supplements', 4),
    ('Immune Support', 'immune_support', 'dietary_supplements', 5),
    ('Sleep & Relaxation', 'sleep_relaxation', 'dietary_supplements', 6),
    ('Energy & Focus', 'energy_focus', 'dietary_supplements', 7),
    ('Women''s Health', 'womens_health', 'dietary_supplements', 8),
    ('Men''s Health', 'mens_health', 'dietary_supplements', 9),
    ('Superfoods', 'superfoods', 'superfoods_health_food', 0),
    ('Healthy Snacks', 'healthy_snacks', 'superfoods_health_food', 1),
    ('Healthy Beverages', 'healthy_beverages', 'superfoods_health_food', 2),
    ('Nuts & Seeds', 'nuts_seeds', 'superfoods_health_food', 3),
    ('Dried Fruits', 'dried_fruits', 'superfoods_health_food', 4),
    ('Whole Grains', 'whole_grains', 'superfoods_health_food', 5),
    ('Functional Foods', 'functional_foods', 'superfoods_health_food', 6),
    ('Organic Foods', 'organic_foods', 'superfoods_health_food', 7)
    ) as v(name, slug, parent_slug, ord)
    join categories c on c.seller_id = v_seller and c.slug = v.parent_slug
  on conflict (seller_id, slug) do update
     set name = excluded.name, parent_id = excluded.parent_id,
         sort_order = excluded.sort_order;

  -- ---- 2. what was already filed, moved onto the new tree -------------
  -- Product types FIRST. They cascade from categories, so a category
  -- deleted before its types have moved takes them with it.
  --
  -- The unique (category_id, slug) decides a collision: two "T-Shirts"
  -- arriving under one category from two old ones would break it, so the
  -- second is left where it is rather than failing the whole file.
  update product_types pt
     set category_id = dst.id
    from (values
      ('men_s_clothing', 'mens_clothing'),
      ('men_s_clothing__clothing', 'mens_clothing'),
      ('women_s_clothing', 'womens_clothing'),
      ('women_s_clothing__clothing', 'womens_clothing'),
      ('sportswear_gym_clothing', 'sportswear'),
      ('sportswear_gym_clothing__gym_sportswear', 'sportswear'),
      ('shoes', 'shoes_footwear'),
      ('shoes__footwear', 'shoes_footwear'),
      ('accessories__accessories', 'accessories'),
      ('gym_accessories__gym_accessories', 'gym_accessories'),
      ('supplements_sports_nutrition', 'sports_nutrition'),
      ('supplements_sports_nutrition__sports_nutrition', 'sports_nutrition')
         ) as m(old, new)
    join categories src on src.seller_id = v_seller and src.slug = m.old
    join categories dst on dst.seller_id = v_seller and dst.slug = m.new
   where pt.category_id = src.id
     and not exists (select 1 from product_types other
                      where other.category_id = dst.id and other.slug = pt.slug);

  update products p
     set category_id = dst.id
    from (values
      ('men_s_clothing', 'mens_clothing'),
      ('men_s_clothing__clothing', 'mens_clothing'),
      ('women_s_clothing', 'womens_clothing'),
      ('women_s_clothing__clothing', 'womens_clothing'),
      ('sportswear_gym_clothing', 'sportswear'),
      ('sportswear_gym_clothing__gym_sportswear', 'sportswear'),
      ('shoes', 'shoes_footwear'),
      ('shoes__footwear', 'shoes_footwear'),
      ('accessories__accessories', 'accessories'),
      ('gym_accessories__gym_accessories', 'gym_accessories'),
      ('supplements_sports_nutrition', 'sports_nutrition'),
      ('supplements_sports_nutrition__sports_nutrition', 'sports_nutrition')
         ) as m(old, new)
    join categories src on src.seller_id = v_seller and src.slug = m.old
    join categories dst on dst.seller_id = v_seller and dst.slug = m.new
   where p.category_id = src.id;

  -- A purchase order line carries a catalog category of its own, and one
  -- still naming a category that is about to disappear would create an
  -- uncategorised product when the goods land.
  update purchase_order_items poi
     set catalog_category_id = dst.id
    from (values
      ('men_s_clothing', 'mens_clothing'),
      ('men_s_clothing__clothing', 'mens_clothing'),
      ('women_s_clothing', 'womens_clothing'),
      ('women_s_clothing__clothing', 'womens_clothing'),
      ('sportswear_gym_clothing', 'sportswear'),
      ('sportswear_gym_clothing__gym_sportswear', 'sportswear'),
      ('shoes', 'shoes_footwear'),
      ('shoes__footwear', 'shoes_footwear'),
      ('accessories__accessories', 'accessories'),
      ('gym_accessories__gym_accessories', 'gym_accessories'),
      ('supplements_sports_nutrition', 'sports_nutrition'),
      ('supplements_sports_nutrition__sports_nutrition', 'sports_nutrition')
         ) as m(old, new)
    join categories src on src.seller_id = v_seller and src.slug = m.old
    join categories dst on dst.seller_id = v_seller and dst.slug = m.new
   where poi.catalog_category_id = src.id;

  -- ---- 3. the old tree, wherever nothing real is left in it -----------
  -- WHAT COUNTS AS REAL. A product, a purchase order line, or a product
  -- type that a product actually points at. Those are the shop's own
  -- work and a category holding any of them stays, with everything in it
  -- -- deleting it would cascade its types away and set its products'
  -- category to null, which is a product that disappears from every
  -- listing while still being live, buyable stock.
  --
  -- A PRODUCT TYPE ON ITS OWN DOES NOT COUNT. taxonomy-seed.sql inserts
  -- 267 of them, generated from a specification, under 25 aisles this
  -- shop does not stock. They are scaffolding: nobody typed them, no
  -- product uses them, and leaving them standing is what would keep
  -- Automotive and Musical Instruments in every category menu in the
  -- admin for ever. One that a product DOES point at is a different
  -- thing, and blocks the delete -- products.product_type_id is ON
  -- DELETE SET NULL, so removing it would strip a real product of what
  -- kind of thing it is and leave its answers describing nothing.
  --
  -- UNTIL IT SETTLES, not a fixed number of passes: emptying a child can
  -- leave its parent deletable, and that can cascade further up than two
  -- levels now the tree is three deep. Bounded by the loop counter, so a
  -- parent_id cycle cannot spin here for ever.
  for v_pass in 1..10 loop
    delete from categories c
     where c.seller_id = v_seller
       and c.slug <> all (array[


         'fashion_apparel',
         'shoes_footwear',
         'accessories',
         'fitness_wellness',
         'mens_clothing',
         'womens_clothing',
         'unisex_clothing',
         'activewear',
         'sportswear',
         'underwear_lingerie',
         'swimwear',
         'sports_shoes',
         'running',
         'training_gym',
         'football',
         'basketball',
         'hiking_outdoor',
         'casual',
         'formal',
         'headwear',
         'bags',
         'jewelry',
         'watches',
         'sunglasses',
         'belts',
         'wallets',
         'gym_accessories',
         'sports_nutrition',
         'dietary_supplements',
         'superfoods_health_food',
         'protein',
         'creatine',
         'pre_workout',
         'amino_acids',
         'electrolytes',
         'recovery',
         'vitamins',
         'minerals',
         'omega_fatty_acids',
         'digestive_health',
         'joint_health',
         'immune_support',
         'sleep_relaxation',
         'energy_focus',
         'womens_health',
         'mens_health',
         'superfoods',
         'healthy_snacks',
         'healthy_beverages',
         'nuts_seeds',
         'dried_fruits',
         'whole_grains',
         'functional_foods',
         'organic_foods'
       
       ])
       and not exists (select 1 from categories k where k.parent_id = c.id)
       and not exists (select 1 from products p where p.category_id = c.id)
       and not exists (select 1 from purchase_order_items i where i.catalog_category_id = c.id)
       and not exists (
         select 1 from product_types t
          join products p on p.product_type_id = t.id
         where t.category_id = c.id);
    exit when not found;
  end loop;
end
$focus$;
