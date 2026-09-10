-- ===========================================================================
-- Loja AIAI -- becoming a seller is by invitation
--
-- HOW IT USED TO WORK. One checkbox in Settings opened /seller/register to
-- the whole internet, and closing it shut the door on everybody. Neither
-- state matches how this marketplace actually recruits: somebody messages
-- the owner, the owner decides, and the owner lets that one person in.
--
-- An invite is that decision, written down. The owner presses a button,
-- gets a link, and sends it to the person who asked. The link registers ONE
-- store and then stops working. Nothing else reaches the registration form.
--
-- WHAT AN INVITE IS NOT. It is not approval. A store registered through a
-- link is still `pending` and still cannot sell until the owner approves it
-- on the Sellers screen -- exactly as before. The invite decides who may
-- APPLY; approval still decides who may trade. Two decisions, two moments,
-- and the second one is where the owner reads what was actually typed.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists seller_invites (
  id          uuid primary key default gen_random_uuid(),

  -- The secret in the link. Unique because it IS the identifier: the
  -- registration form looks a row up by this and nothing else, and two rows
  -- sharing one token would make "which invite was used" unanswerable.
  -- Minted with crypto.randomBytes in lib/actions/seller-invites.ts, never
  -- in SQL: a token a database could regenerate is not a secret.
  token       text not null unique,

  -- Who the owner meant it for, in the owner's own words -- "Alton, AITA
  -- Store, asked on WhatsApp". Never shown to the person invited. Without
  -- it a list of eight live links is eight identical rows, and revoking the
  -- right one becomes guesswork.
  note        text not null default '',
  created_by  text not null default '',
  created_at  timestamptz not null default now(),

  -- NOT NULL on purpose: a link with no end is a permanent hole in the
  -- front door, left open by the first person who forgot about it. The
  -- application picks the span; the column simply refuses to have none.
  expires_at  timestamptz not null,

  -- Claimed. Set once, by a conditional update that only matches while it
  -- is still null -- which is what makes two people opening the same link
  -- at the same moment resolve to one registration rather than two.
  used_at     timestamptz,
  used_by     uuid references sellers(id) on delete set null,

  -- Withdrawn before it was used. Separate from used_at because they are
  -- different answers to "why did my link stop working", and the owner
  -- revoking one should not have it read as a store that registered.
  revoked_at  timestamptz
);

create index if not exists idx_seller_invites_token on seller_invites(token);
create index if not exists idx_seller_invites_open
  on seller_invites(created_at desc) where used_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Nobody reads this table but the server.
--
-- RLS on with NO policies at all, which in PostgreSQL denies every row to
-- anon and authenticated. That is the intent: a token is a credential, and
-- a table of live credentials that any visitor could list would make the
-- invitation meaningless. Every read and write goes through the service
-- role (lib/actions/seller-invites.ts and the registration action), which
-- bypasses RLS.
-- ---------------------------------------------------------------------------
alter table seller_invites enable row level security;
revoke all on seller_invites from anon, authenticated;

comment on table seller_invites is
  'One-use links that let a person reach /seller/register. Not approval -- a store registered through one is still pending. See supabase/seller-invites.sql.';

-- ---------------------------------------------------------------------------
-- Done.
--
-- settings.seller_registration_enabled is left alone and is no longer read:
-- the invite is the gate now, and a shop that had once switched that column
-- off would otherwise find its invitations silently refused. The column
-- stays for older rows rather than being dropped, because dropping it is
-- the one change this file could make that an older deployment could not
-- survive being rolled back.
-- ---------------------------------------------------------------------------
