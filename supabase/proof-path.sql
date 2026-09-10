-- A PAYMENT PROOF THAT STOPS BEING READABLE.
--
-- Run AFTER supabase/schema.sql.
--
-- orders.proof_url held a signed Supabase Storage URL with a 365-day
-- expiry, written once at upload and then stored on the order row. Two
-- problems, and the second is the one that matters:
--
--   1. The URL grants access on its own -- no session, no cookie. Anyone
--      who ever sees that row (a backup, an export, a screenshot of an
--      admin screen, a support ticket, a leaked service key) can read a
--      customer's bank transfer slip for a year afterwards.
--   2. Because it is stored, revoking it is not possible. The only way to
--      cut off a leaked URL is to delete the file.
--
-- So the row keeps the PATH, which grants nothing, and a URL is minted
-- fresh each time somebody with the right to see it actually looks. That
-- makes the link's life the length of one viewing rather than a year, and
-- it makes the storage bucket -- which is already private -- the thing
-- that decides who may read it.
alter table orders add column if not exists proof_path text;

comment on column orders.proof_path is
  'Storage path of the payment proof. Signed URLs are minted per view; see src/lib/paymentProof.ts.';

create index if not exists orders_proof_path_idx on orders (proof_path) where proof_path is not null;
