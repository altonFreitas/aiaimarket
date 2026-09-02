-- ===========================================================================
-- Loja AIAI -- named admin accounts, and a record of who did what
--
-- Until now the admin was one shared login: ADMIN_EMAIL and ADMIN_PASSWORD
-- in the environment, with a TOTP secret on the settings row. That is a
-- reasonable arrangement for one person and stops being one the moment a
-- second person has the password -- because nothing anywhere records who
-- refunded an order, who zeroed a shelf, or who changed a price.
--
-- Two tables. Staff accounts are ADDITIVE: the environment credentials keep
-- working exactly as before, as the owner. That is deliberate. A shop
-- depends on this login, and a migration that moved the only way in would
-- be one bad deploy away from locking the owner out of their own business.
--
-- Safe to re-run.
-- ===========================================================================

create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  -- Stored lower-cased by the application; the index enforces that two
  -- accounts cannot differ only by capitalisation.
  email         text not null,
  -- scrypt, as "scrypt$N$r$p$salt$hash". Node's own crypto, so no
  -- dependency to keep patched, and a real password KDF rather than a
  -- plain hash that a graphics card walks through in an afternoon.
  password_hash text not null,

  -- Same four columns settings and sellers carry, so lib/totp.ts works
  -- against this table unchanged.
  totp_secret          text,
  totp_enabled         boolean not null default false,
  totp_failed_attempts int not null default 0,
  totp_locked_until    timestamptz,

  -- Deactivated rather than deleted: removing the row would orphan every
  -- audit entry that points at it.
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists admin_users_email_key on admin_users (lower(email));

comment on table admin_users is
  'Named admin logins, in addition to the environment owner credentials. Never delete a row -- set active=false, or the audit trail loses who acted.';

-- ---------------------------------------------------------------------------
-- The record
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),

  actor_kind  text not null check (actor_kind in ('owner', 'staff', 'system')),
  actor_id    uuid references admin_users(id) on delete set null,
  -- Copied, not joined. An audit trail that forgets who did it once the
  -- account is gone is not an audit trail, and "the owner" has no row at
  -- all.
  actor_label text not null default '',

  -- What happened, in a form that can be grouped: 'stock.adjust',
  -- 'order.refund', 'product.price', 'po.receive'.
  action      text not null,
  -- What it happened to.
  entity      text not null default '',
  entity_id   text,
  -- One line a person can read without opening anything else.
  summary     text not null default '',
  -- Anything structured worth keeping: before and after values, amounts.
  meta        jsonb not null default '{}'
);

create index if not exists audit_log_at_idx     on audit_log (at desc);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id, at desc);
create index if not exists audit_log_actor_idx  on audit_log (actor_id, at desc);

comment on table audit_log is
  'Append-only record of admin actions. Nothing updates or deletes a row here.';

-- ---------------------------------------------------------------------------
-- Grants -- both tables are admin-only, and neither is ever public
-- ---------------------------------------------------------------------------
alter table admin_users enable row level security;
alter table audit_log   enable row level security;
revoke all on admin_users from anon, authenticated;
revoke all on audit_log   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Done.
--
-- Nothing changes until a staff account is created, in Settings -> Admin
-- users. The owner's environment login is untouched.
-- ---------------------------------------------------------------------------
