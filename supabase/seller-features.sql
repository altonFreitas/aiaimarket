-- ===========================================================================
-- Loja AIAI -- what each seller has been given access to
--
-- One column on sellers. It answers one question:
--
--   features  WHICH OF THE OWNER'S TOOLS this store may open, beyond the
--             four screens that make it a seller at all.
--             Keys from src/lib/sellerFeatures.ts -- 'sales', 'stock'.
--
-- The four included screens -- dashboard, products, orders, store settings
-- -- are NOT listed here and never will be. A seller who cannot list a
-- product or see an order is not a store with fewer features, it is a
-- broken account, so they are held by every approved seller and there is
-- nothing to store. Only what is genuinely a choice lives in this column.
--
-- WHY THE DEFAULT IS EMPTY, INCLUDING FOR STORES THAT ALREADY EXIST.
--
-- supabase/admin-roles.sql, which does the same job for staff accounts,
-- backfills existing rows to full access. It has to: those accounts were
-- created when every admin had everything, and applying the safe default
-- to them would silently take away access somebody was using.
--
-- This is the opposite case and takes the opposite decision. Every feature
-- in this column is a screen that did not exist before this file, so no
-- seller has ever had one, and nobody loses anything by starting at empty.
-- Granting them all by default would instead give away, to every store on
-- the marketplace, the thing the owner intends to offer store by store.
--
-- Safe to re-run.
-- ===========================================================================

alter table sellers
  add column if not exists features text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- A key the application does not recognise is dropped when the row is read
-- (normalizeFeatures in src/lib/sellerFeatures.ts), so a bad value cannot
-- grant anything. This keeps them out of the table in the first place,
-- where a typo would otherwise sit on the Sellers screen looking like a
-- feature somebody had paid for.
--
-- ADDING A FEATURE LATER means adding it to this constraint too. The
-- constraint is dropped and recreated rather than guarded by an existence
-- check, so re-running this file after editing the list actually applies
-- the new list instead of silently keeping the old one -- which is the
-- failure mode of the "create if not exists" version of this: the app
-- offers a checkbox, the owner ticks it, and the save fails against a
-- constraint written before the feature existed.
-- ---------------------------------------------------------------------------
alter table sellers drop constraint if exists sellers_features_check;
alter table sellers
  add constraint sellers_features_check check (
    features <@ array['sales','stock']::text[]
  );

comment on column sellers.features is
  'Which of the owner''s tools this store may open, beyond the four screens every seller has. Keys from src/lib/sellerFeatures.ts. Enforced in requireSellerFeature(), src/lib/actions/guard.ts.';

-- ---------------------------------------------------------------------------
-- The column is the platform's to set, never the seller's
--
-- Every write to this column goes through setSellerFeatures(), which
-- requires an admin session and uses the service role. But "the code does
-- not do that" is not a permission, so the rule is stated here too.
--
-- WHAT ACTUALLY PROTECTS IT is that sellers has no UPDATE grant for anon
-- or authenticated at all -- see the comment in schema.sql, which refused
-- to add one precisely because a blanket UPDATE would let a store set its
-- own status to 'approved'. The same grant would let it grant itself every
-- feature on this list. This re-asserts that state rather than assuming
-- some later file has not loosened it.
--
-- A COLUMN-LEVEL REVOKE WOULD NOT WORK, and is worth writing down because
-- it looks like it should. In PostgreSQL a table-level UPDATE grant is not
-- reduced by revoking one column from it:
--
--     grant update on sellers to authenticated;
--     revoke update (features) on sellers from authenticated;
--     select has_column_privilege('authenticated','sellers','features','update');
--     -- true
--
-- The first draft of this file did exactly that and tested as protected
-- while granting nothing. Restricting by column requires revoking the
-- table-level privilege and granting the wanted columns back one by one.
-- If a "sellers edit their own profile" grant is ever added, it has to be
-- written that way, and features must not be in the list.
-- ---------------------------------------------------------------------------
revoke update on sellers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes for anyone until you tick something on
-- Sellers -> a store -> Access. Every store keeps exactly the four screens
-- it already had; the extra ones appear in that store's navigation the
-- moment you grant them, and disappear the moment you take them away.
-- ---------------------------------------------------------------------------
