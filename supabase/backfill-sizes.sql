-- ===========================================================================
-- A product's size list, caught up with the variants it is actually sold in
-- ===========================================================================
-- products.sizes is what the storefront draws its size picker from, and what
-- the catalogue card reads to decide between "Add to cart" and "Choose size".
-- The variants are the other account of the same fact -- one row per SKU,
-- each carrying its own size answer.
--
-- The two are written by different code and BOTH of those writers swallow
-- their own errors on purpose: addSize() in lib/receiving.ts and syncSizes()
-- in lib/actions/product-attributes.ts each decide, correctly, that a size
-- list which could not be extended must not fail a receipt or a save. The
-- stock is real either way.
--
-- The cost of that is this: a product can end up with variants in S, M and L
-- and an empty products.sizes -- and then it is sold by size everywhere
-- except on the two screens a shopper actually uses. The card offers "Add to
-- cart" where its neighbours offer "Choose size", and the product page shows
-- no picker at all.
--
-- ADDS, NEVER REPLACES. A size somebody typed by hand and has no variant for
-- is still a size they sell; the variants' sizes are appended after the
-- product's own, in variant order, and anything already listed is left alone.
-- Comparison is case-insensitive, so "m" does not gain an "M" beside it.
--
-- Safe to re-run: the second pass finds nothing to add and updates no rows.
-- ===========================================================================

do $sizes$
begin
  -- A shop that has not run supabase/variants.sql has no variants to read,
  -- and nothing here applies to it.
  if to_regclass('public.product_variants') is null
     or to_regclass('public.variant_attribute_values') is null then
    return;
  end if;

  with variant_sizes as (
    select v.product_id,
           trim(vav.value) as size,
           min(v.display_order) as ord
      from product_variants v
      join variant_attribute_values vav on vav.variant_id = v.id
      join attributes a on a.id = vav.attribute_id and a.slug = 'size'
     where coalesce(trim(vav.value), '') <> ''
     group by v.product_id, trim(vav.value)
  )
  update products p
     set sizes = coalesce(p.sizes, '{}'::text[]) || (
       select coalesce(array_agg(vs.size order by vs.ord, vs.size), '{}'::text[])
         from variant_sizes vs
        where vs.product_id = p.id
          and not exists (
            select 1 from unnest(coalesce(p.sizes, '{}'::text[])) as had
             where lower(had) = lower(vs.size))
     )
   where exists (
     select 1 from variant_sizes vs
      where vs.product_id = p.id
        and not exists (
          select 1 from unnest(coalesce(p.sizes, '{}'::text[])) as had
           where lower(had) = lower(vs.size))
   );
end
$sizes$;
