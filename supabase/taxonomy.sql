-- ===========================================================================
-- Loja AIAI -- product taxonomy and dynamic attributes
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
-- The seed that fills these tables is supabase/taxonomy-seed.sql.
--
-- WHAT THIS IS FOR. Until now a product was a row in `products` and every
-- property it could have was a column on that row. That works while the
-- shop sells shirts. It stops working the moment it also sells sofas,
-- smartphones and whey protein, because a sofa needs Seat Height and a
-- phone needs Storage and a shirt needs neither, and the answer cannot be
-- to keep adding columns -- product_seat_height, product_storage,
-- product_neck_type -- until the table has four hundred of them and every
-- product is mostly nulls.
--
-- So an attribute becomes a ROW, not a column:
--
--   categories -> product_types -> product_type_attributes -> attributes
--
-- and a new category is INSERT statements rather than a migration.
--
-- THREE LEVELS, AND WHY, given the specification's own database section
-- disagrees with its prose. The prose hangs attributes off a Product Type
-- (T-Shirts, Sofas, Smartphones); the schema it sketches hangs them off a
-- category and has no product_types table at all. The prose is right: a
-- category is far too coarse to carry attributes -- "Electronics" would
-- have to own Sleeve Length -- so attributes hang off the product type,
-- and a category is a place to browse.
--
-- The middle level is kept even though the specification's own data makes
-- it degenerate: all 25 categories have exactly one subcategory each. It
-- costs one nullable column, it is what the shop was asked for, and the
-- day "Electronics" needs both "Consumer Electronics" and "Components" it
-- is already there. It reuses `categories.parent_id`, which has existed
-- since schema.sql -- so subcategories are categories, and every screen
-- that already walks that tree keeps working.
--
-- GLOBAL, NOT PER SELLER. `categories` carries a seller_id; these tables
-- deliberately do not. A marketplace where five hundred sellers each
-- invent their own "Colour" cannot offer one colour filter, and its search
-- cannot match across stores. The taxonomy is the platform's, and only the
-- owner edits it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Product types
-- ---------------------------------------------------------------------------
-- The level that owns attributes. Hangs off a category row -- which is
-- either a top-level category or one of its children, because the shop is
-- free to file product types at whichever depth makes sense to it.

create table if not exists product_types (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references categories(id) on delete cascade,
  name          text not null,
  slug          text not null,
  description    text not null default '',
  status        text not null default 'active'
                  check (status in ('active', 'hidden')),
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  -- Unique per category, not globally: "Chairs" under Furniture and
  -- "Chairs" under Office are two different things with one name, and the
  -- shop should not have to invent "office-chairs-2".
  unique (category_id, slug)
);

create index if not exists product_types_category_idx
  on product_types (category_id, display_order);

comment on table product_types is
  'The level that owns attributes: T-Shirts, Sofas, Smartphones. Hangs off a category (or subcategory, which is a category with a parent). Global -- see supabase/taxonomy.sql.';

-- ---------------------------------------------------------------------------
-- 2. Attributes
-- ---------------------------------------------------------------------------
-- One row per property the catalogue can record, reusable across every
-- product type that needs it. "Brand" is one row, used by 256 product
-- types; "Seat Height" is one row used by five.

create table if not exists attributes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,

  -- Which control the form draws. The list is section 3 of the
  -- specification; src/lib/taxonomy/fieldTypes.ts infers it from the name
  -- and the attribute builder lets the owner correct it without a
  -- migration, which is the point of holding it in a row.
  field_type    text not null default 'text' check (field_type in (
                  'text','textarea','richtext',
                  'number','decimal','currency',
                  'select','multiselect','boolean',
                  'color','image','file',
                  'date','datetime',
                  'range','dimensions','tags')),

  -- Shown after the input and stored beside the value: cm, kg, W. Null
  -- where the question has no unit, which is most of them.
  unit          text,

  -- May this attribute tell one variant from another? Size and Colour can;
  -- Brand cannot -- a product has one brand however many sizes it comes in.
  is_variant    boolean not null default false,

  -- What the storefront may do with it. A free-text field is never
  -- filterable: a filter needs a set of values to offer, and free text has
  -- as many values as there are products.
  filterable    boolean not null default false,
  searchable    boolean not null default false,
  sortable      boolean not null default false,

  -- Who may see it. An admin-only attribute is for the shop's own records
  -- -- a supplier reference, a shelf location -- and never reaches a
  -- product page.
  admin_only    boolean not null default false,

  -- Min, max, pattern, step. Read by the form and re-checked on the
  -- server; jsonb because each field type wants different keys.
  validation    jsonb not null default '{}'::jsonb,

  display_order int  not null default 0,
  created_at    timestamptz not null default now(),

  -- HAS A HUMAN TOUCHED THIS ROW?
  --
  -- The seed writes 546 attributes and infers the field type of every one
  -- from its name. Some of those guesses are wrong, and get corrected in
  -- two different ways that must not fight each other:
  --
  --   * the owner corrects one in the attribute builder;
  --   * the inference rules are fixed and the seed is pasted again.
  --
  -- With ON CONFLICT DO NOTHING the second never reaches a shop that
  -- already ran the seed -- a fix shipped today would never arrive. With
  -- DO UPDATE it arrives by trampling the first. So the seed updates only
  -- the rows it still owns: the attribute builder sets this true on any
  -- manual edit, and from then on the seed leaves that row alone forever.
  admin_edited  boolean not null default false
);

create index if not exists attributes_variant_idx
  on attributes (is_variant) where is_variant;
create index if not exists attributes_filterable_idx
  on attributes (filterable) where filterable;

comment on table attributes is
  'Every property the catalogue can record, once, reusable across product types. field_type decides which control the form draws -- see src/lib/taxonomy/fieldTypes.ts.';

-- ---------------------------------------------------------------------------
-- 3. Attribute options
-- ---------------------------------------------------------------------------
-- The values a select or multiselect offers.
--
-- AN ATTRIBUTE WITH NO OPTIONS IS NOT BROKEN. The specification names 546
-- attributes and lists the values of almost none of them -- it says a
-- T-shirt has a "Collar Type" without ever saying what the collar types
-- are. Those are seeded as selects with no options, the form renders them
-- as a text box, and the day somebody fills the options in they become
-- dropdowns everywhere they appear. No schema change, no data migration.

create table if not exists attribute_options (
  id            uuid primary key default gen_random_uuid(),
  attribute_id  uuid not null references attributes(id) on delete cascade,
  label         text not null,
  -- What gets stored. Separate from the label so the shop can rename
  -- "Black" to "Jet Black" on every product page without rewriting the
  -- value on ten thousand rows.
  value         text not null,
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (attribute_id, value)
);

create index if not exists attribute_options_attr_idx
  on attribute_options (attribute_id, display_order);

-- ---------------------------------------------------------------------------
-- 4. Which attributes a product type has
-- ---------------------------------------------------------------------------
-- The join that makes the form dynamic. A T-shirt has fourteen rows here;
-- a sofa has eighteen; they share Brand, Material and Colour and nothing
-- else.
--
-- `required` lives HERE rather than on the attribute, because it depends
-- on the product: Storage is required on a smartphone and meaningless on a
-- sofa, and it is the same attribute row.

create table if not exists product_type_attributes (
  id              uuid primary key default gen_random_uuid(),
  product_type_id uuid not null references product_types(id) on delete cascade,
  attribute_id    uuid not null references attributes(id) on delete cascade,
  required        boolean not null default false,
  display_order   int  not null default 0,
  created_at      timestamptz not null default now(),
  unique (product_type_id, attribute_id)
);

create index if not exists pta_type_idx
  on product_type_attributes (product_type_id, display_order);
create index if not exists pta_attribute_idx
  on product_type_attributes (attribute_id);

comment on table product_type_attributes is
  'Which attributes each product type asks for, and which of them are required. `required` is here and not on `attributes` because the same attribute is mandatory on one product and irrelevant on another.';

-- ---------------------------------------------------------------------------
-- 5. The product learns its type
-- ---------------------------------------------------------------------------
-- NULLABLE, and that is not an oversight. Every product that exists today
-- has no product type, and this column appearing must not stop any of them
-- being sold, edited or found. They keep working exactly as they did; the
-- migration screen fills this in afterwards, product by product, and until
-- it does a null here simply means "no dynamic attributes for this one".

alter table products
  add column if not exists product_type_id uuid
    references product_types(id) on delete set null;

create index if not exists products_product_type_idx
  on products (product_type_id) where product_type_id is not null;

comment on column products.product_type_id is
  'Which product type this is, deciding the attributes it carries. Null for products created before the taxonomy existed -- they keep selling untouched. See supabase/taxonomy.sql.';

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------
-- READABLE BY ANYONE, because the storefront needs it: a category page
-- cannot build "Brand / Colour / Size" filters without reading which
-- attributes are filterable, and that runs as anon.
--
-- Nothing here is a secret -- it is the shape of a shop's catalogue, which
-- every visitor can see anyway by looking at the products. Writing is
-- another matter and goes through the service role, which is what the
-- admin actions use.

alter table product_types            enable row level security;
alter table attributes               enable row level security;
alter table attribute_options        enable row level security;
alter table product_type_attributes  enable row level security;

drop policy if exists product_types_public_read on product_types;
create policy product_types_public_read on product_types
  for select using (status = 'active');

drop policy if exists attributes_public_read on attributes;
create policy attributes_public_read on attributes
  for select using (not admin_only);

drop policy if exists attribute_options_public_read on attribute_options;
create policy attribute_options_public_read on attribute_options
  for select using (true);

drop policy if exists pta_public_read on product_type_attributes;
create policy pta_public_read on product_type_attributes
  for select using (true);

-- Read only, and only the columns a storefront actually draws with. No
-- insert, update or delete for anon or authenticated: the taxonomy is the
-- platform's, and it changes through the admin screens or not at all.
revoke all on product_types           from anon, authenticated;
revoke all on attributes              from anon, authenticated;
revoke all on attribute_options       from anon, authenticated;
revoke all on product_type_attributes from anon, authenticated;

grant select on product_types           to anon, authenticated;
grant select on attributes              to anon, authenticated;
grant select on attribute_options       to anon, authenticated;
grant select on product_type_attributes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The integrity the application must not be trusted to keep
-- ---------------------------------------------------------------------------
-- Section 25 of the brief: never trust a category_id, a product_type_id or
-- an attribute_id off a form. The foreign keys above already stop an id
-- that names nothing. This stops the subtler one -- an id that names
-- something REAL but unrelated, which is what an attacker sends: a valid
-- attribute that belongs to a different product type.
--
-- It is a function rather than a constraint because the check spans three
-- tables, and the server action calls it before writing any value.

create or replace function attribute_belongs_to_type(
  p_product_type_id uuid, p_attribute_id uuid
) returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from product_type_attributes
     where product_type_id = p_product_type_id
       and attribute_id    = p_attribute_id
  );
$$;

comment on function attribute_belongs_to_type is
  'True when this attribute is one the product type actually asks for. The guard against a form posting a real attribute id that belongs to something else -- see section 25 of the rebuild brief.';

-- Likewise for the tree: a product type must sit under the category the
-- form claims, or under one of its children.
create or replace function type_belongs_to_category(
  p_product_type_id uuid, p_category_id uuid
) returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
      from product_types pt
      join categories c on c.id = pt.category_id
     where pt.id = p_product_type_id
       and (c.id = p_category_id or c.parent_id = p_category_id)
  );
$$;

comment on function type_belongs_to_category is
  'True when this product type sits under that category, directly or as one of its subcategories.';
