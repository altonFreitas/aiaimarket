-- ===========================================================================
-- Loja AIAI -- a hero slide can FEATURE A PRODUCT
--
-- One nullable column. A slide that names a product renders the shop's
-- real card for it over the picture -- its own photos, its own badge, its
-- own price and its own rating -- and a slide that names none renders
-- exactly what it always did: picture, headline, copy, CTA.
--
-- WHY A FOREIGN KEY AND NOT A COPY OF THE PRODUCT'S DETAILS. The obvious
-- shape is to type a name, a price and a star rating into the slide, which
-- is what a designer's mock-up implies. It is also how a homepage comes to
-- advertise $69.00 for a product the catalogue sells at $75.00, or five
-- stars for one nobody has reviewed. The slide stores WHICH product; every
-- figure on the card is read from that product at render time, so the
-- storefront cannot contradict itself.
--
-- ON DELETE SET NULL, not CASCADE. Deleting a product must not silently
-- delete the slide built around it -- the picture, the headline and the
-- CTA are the shop owner's work and are still worth something. The slide
-- loses its card and keeps everything else, which is a visible, recoverable
-- state rather than a vanished banner nobody can explain.
--
-- Safe to re-run.
-- ===========================================================================

alter table hero_slides
  add column if not exists product_id uuid references products(id) on delete set null;

comment on column hero_slides.product_id is
  'Optional product featured on this slide. NULL means the slide is picture + copy only. Every figure on the card (price, rating, photos, stock) is read from the product, never copied here.';

-- The homepage reads slides in sort order and then the products they name.
-- Small either way at this shop's size; the index costs nothing and keeps
-- the join honest if the carousel ever grows.
create index if not exists hero_slides_product_idx
  on hero_slides (product_id)
  where product_id is not null;

-- ---------------------------------------------------------------------------
-- READABLE BY THE STOREFRONT.
--
-- The anon key holds grants on named columns, not on tables (see
-- schema.sql), so a new column is invisible to the public site until it is
-- granted -- which looks exactly like the column not existing.
-- ---------------------------------------------------------------------------
grant select (product_id) on hero_slides to anon, authenticated;
