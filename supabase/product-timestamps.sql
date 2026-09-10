-- WHEN A PRODUCT LAST CHANGED.
--
-- Run AFTER supabase/schema.sql.
--
-- products has created_at and nothing else, so the sitemap had no honest
-- <lastmod> to give: a price cut, a restock, a rewritten description and a
-- new photo all left the row looking exactly as old as the day it was
-- typed. A sitemap that says a page has not changed since 2024 is worse
-- than one that says nothing -- a crawler believes it and stops coming
-- back, so the sale never shows up in a result.
--
-- Maintained by the database rather than by the app: every writer would
-- otherwise have to remember, and the one that forgets is the one that
-- matters. Backfilled from created_at so existing rows start out truthful
-- rather than all claiming to have changed the moment this ran.
alter table products add column if not exists updated_at timestamptz;
update products set updated_at = created_at where updated_at is null;
alter table products alter column updated_at set default now();

create or replace function touch_product_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at
  before update on products
  for each row execute function touch_product_updated_at();

-- The sitemap orders by it, and the admin's "recently changed" reading of
-- the catalog would too.
create index if not exists idx_products_updated_at on products (updated_at desc);
