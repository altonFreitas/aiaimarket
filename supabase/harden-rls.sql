-- harden-rls.sql
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- This script does NOT run automatically — apply-update.js never touches your
-- database, it only writes this file for you to review and run yourself.
--
-- Why: every upload and every order insert in this codebase already goes
-- through a server action using the SERVICE ROLE key (supabaseAdmin()),
-- which bypasses RLS entirely. That means the public-facing insert
-- policies below are not used by the app at all -- they only exist as an
-- open door for anyone holding the public anon key (visible in any
-- browser's network tab) to write directly to your database/storage via
-- the Supabase REST API, bypassing all of the app's validation,
-- compression, and price/stock checks. Dropping them closes that door
-- without changing any app behavior.

-- Orders: stop accepting inserts from the anon/public role directly.
-- placeOrder() already inserts via the service-role client.
drop policy if exists orders_public_insert on orders;

-- Storage: stop accepting uploads from the anon/public role directly.
-- Every upload path (products.ts, hero.ts, seller-products.ts, orders.ts)
-- already uploads via the service-role client.
drop policy if exists "product images public upload" on storage.objects;
drop policy if exists "payment proofs public upload" on storage.objects;

-- Public READ access to product images is still required (that's how
-- <img>/next/image tags load them in the browser) -- left untouched:
--   policy "product images public read" on storage.objects for select ...
