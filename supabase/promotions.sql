-- ===========================================================================
-- promotions.sql — homepage promo tiles ("Oportunidades aos melhores preços")
--
-- Run ONCE in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- ===========================================================================

create table if not exists promotions (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  title       text not null,               -- "Som", "Cuidado Pessoal"
  badge_label text not null default '',    -- "-55%", "Novo", left blank = no badge
  image_url   text not null,
  -- Where the tile sends a visitor. A category slug is the common case
  -- (this is a merchandising shortcut into the existing catalog, not a
  -- second product system), but a free path also covers "/shop?sort=low"
  -- style links.
  href        text not null default '/shop',
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_promotions_active_sort on promotions(active, sort_order);

alter table promotions enable row level security;

drop policy if exists promotions_public_read on promotions;
create policy promotions_public_read on promotions for select using (active = true);
-- No public insert/update/delete: every write goes through the admin
-- server action using the service-role client, same trust model as
-- hero_slides and categories.

-- Reuses the existing public "product-images" bucket (see uploadHeroImage
-- in lib/actions/hero.ts) under a "promotions/" prefix rather than a new
-- bucket + policy set for what is still just "an image the admin uploaded".
