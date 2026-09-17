-- ---------------------------------------------------------------------------
-- A seller choosing to publish their address
-- ---------------------------------------------------------------------------
-- The store page shows where a store is, so a customer can decide whether
-- to collect. Until now that could only ever be the city and country,
-- because sellers.address is not granted to anon at all -- see the column
-- grant in schema.sql, which hands the public id, store_name, slug,
-- description, city, country, seller_type and created_at and nothing else.
--
-- That limit was right and stays. A seller trading from home gave that
-- address to the marketplace when they registered; nobody told them it
-- would appear on a public page, and turning it on for everybody because
-- a map pin would be more precise is not a decision the marketplace gets
-- to make on their behalf.
--
-- So it becomes theirs to make. This column is that choice.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- DEFAULT FALSE, AND THAT IS THE WHOLE POINT
-- ---------------------------------------------------------------------------
-- Every seller who registered before this existed answered no question, so
-- the answer recorded for them is no. A default of true would publish the
-- home addresses of every store on the marketplace the moment this file
-- ran, silently, with the migration reading like a feature.
--
-- `not null` so there is no third state: a null here would be "we do not
-- know whether they agreed", and code reading that as anything other than
-- no is the same leak by a slower route.
-- ---------------------------------------------------------------------------
alter table sellers
  add column if not exists address_public boolean not null default false;

comment on column sellers.address_public is
  'The seller ticked "show my address on my store page" in their own settings. False for anybody who never answered. sellers.address stays ungranted to anon whatever this says -- the address is read with the service role and withheld unless this is true; see getSellerPublicAddress() in src/lib/data/public.ts.';

-- ---------------------------------------------------------------------------
-- NOTHING NEW IS GRANTED TO anon, DELIBERATELY
-- ---------------------------------------------------------------------------
-- The obvious move is to add `address` to the public column grant and let
-- the app decide. It is the wrong one: a column grant cannot be conditional,
-- so that would publish every seller's address to anybody holding the anon
-- key -- which is in the browser -- and leave this column as decoration
-- that only the UI respected.
--
-- The address is therefore read with the SERVICE ROLE, in one function that
-- checks this flag and the seller's status before returning it, and anon
-- still cannot select the column at all. Two answers have to agree before
-- an address reaches a page, and one of them is enforced by a privilege
-- rather than by code somebody might change.
--
-- The flag itself is not granted either. The public page has no use for
-- "this seller declined": it either shows an address or does not.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Done. Nothing on any page changes until a seller opens Store settings and
-- ticks the box themselves.
-- ---------------------------------------------------------------------------
