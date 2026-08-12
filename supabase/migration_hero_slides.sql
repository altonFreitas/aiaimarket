-- ============================================================
-- Migration: hero_slides (homepage carousel)
-- Run this once in the Supabase SQL editor (Project -> SQL Editor ->
-- New query -> paste -> Run). Safe to run more than once.
-- ============================================================

create table if not exists hero_slides (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default current_seller_id(),
  image_url   text not null,
  headline    text not null default '',
  subtext     text not null default '',
  cta_label   text not null default '',
  cta_href    text not null default '',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table hero_slides enable row level security;

drop policy if exists hero_slides_public_read on hero_slides;
create policy hero_slides_public_read on hero_slides for select using (true);

-- No public insert/update/delete policy -- same as categories and
-- products, all writes go through the server using the service-role
-- key (supabaseAdmin()), which bypasses RLS entirely.
