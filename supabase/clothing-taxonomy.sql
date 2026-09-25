-- ===========================================================================
-- Clothing is the aisle. Men's and Women's are inside it.
-- ===========================================================================
-- The seeded tree had this upside down:
--
--   Men's Clothing   (category)    -> Clothing (subcategory) -> T-Shirts, ...
--   Women's Clothing (category)    -> Clothing (subcategory) -> Dresses, ...
--
-- so the word a shopper actually thinks in -- clothes -- sat one level BELOW
-- an answer to a question they had not been asked yet, twice, under two
-- different parents. It becomes:
--
--   Clothing (category) -> Men's Clothing   (subcategory) -> T-Shirts, ...
--                       -> Women's Clothing (subcategory) -> Dresses, ...
--
-- supabase/taxonomy-seed.sql now seeds this shape directly, so a fresh
-- install never has the old one. This file is for a shop that already
-- pasted the old seed: it moves what is filed rather than asking anyone to
-- refile it.
--
-- NOTHING IS DELETED THAT HOLDS ANYTHING. The two "Clothing" subcategories
-- are removed only after their product types and their products have been
-- moved up to the gendered category that will outlive them -- and
-- product_types cascades from categories, so doing it the other way round
-- would destroy them.
--
-- PER SELLER, because categories are. A marketplace with four stores that
-- each pasted the seed has four copies of this tree, and each is reshaped
-- on its own.
--
-- Safe to re-run: the second pass finds no old shape left and does nothing.
-- ===========================================================================

do $clothing$
declare
  v_seller   uuid;
  v_clothing uuid;
  v_gendered uuid;
  v_old_sub  uuid;
  v_slug     text;
begin
  for v_seller in
    select distinct seller_id from categories
     where slug in ('men_s_clothing', 'women_s_clothing')
  loop
    -- 1. The aisle itself. Reused when it is already there, which is what
    --    makes a second run a no-op rather than a duplicate-key error.
    select id into v_clothing
      from categories where seller_id = v_seller and slug = 'clothing';

    if v_clothing is null then
      insert into categories (seller_id, name, slug, parent_id, sort_order)
      values (
        v_seller, 'Clothing', 'clothing', null,
        -- Where the gendered pair used to sit, so the shop's own ordering
        -- is kept rather than dropping Clothing at the end of the list.
        coalesce((select min(sort_order) from categories
                   where seller_id = v_seller
                     and slug in ('men_s_clothing', 'women_s_clothing')), 0)
      )
      returning id into v_clothing;
    end if;

    for v_gendered, v_slug in
      select id, slug from categories
       where seller_id = v_seller
         and slug in ('men_s_clothing', 'women_s_clothing')
       order by sort_order
    loop
      -- 2. The subcategory that held everything, if it is still there.
      select id into v_old_sub
        from categories
       where seller_id = v_seller and slug = v_slug || '__clothing';

      if v_old_sub is not null then
        -- Product types move up. Skipping a slug the target already has
        -- keeps the unique (category_id, slug) intact on a half-finished
        -- run; there is nothing to lose, because the two rows would be the
        -- same product type under two names for one category.
        update product_types pt
           set category_id = v_gendered
         where pt.category_id = v_old_sub
           and not exists (
             select 1 from product_types other
              where other.category_id = v_gendered and other.slug = pt.slug);

        -- Anything still pointing at the old subcategory after that is a
        -- genuine duplicate of a type the target already had. Point its
        -- products at the survivor and drop it, rather than letting the
        -- cascade take products' product_type_id to null.
        update products p
           set product_type_id = (
             select other.id from product_types other
              where other.category_id = v_gendered
                and other.slug = (select pt.slug from product_types pt
                                   where pt.id = p.product_type_id))
         where p.product_type_id in (select id from product_types
                                      where category_id = v_old_sub);

        delete from product_types where category_id = v_old_sub;

        -- Products filed directly on the old subcategory follow it up.
        update products
           set category_id = v_gendered
         where category_id = v_old_sub;

        -- Purchase order lines carry a catalog category of their own, and
        -- a line still naming a category that is about to disappear would
        -- create an uncategorised product when the goods land.
        update purchase_order_items
           set catalog_category_id = v_gendered
         where catalog_category_id = v_old_sub;

        -- Nothing is filed under it any more.
        delete from categories where id = v_old_sub;
      end if;

      -- 3. And the gendered category becomes a subcategory of Clothing.
      update categories
         set parent_id = v_clothing,
             sort_order = case when v_slug = 'men_s_clothing' then 0 else 1 end
       where id = v_gendered;
    end loop;
  end loop;
end
$clothing$;
