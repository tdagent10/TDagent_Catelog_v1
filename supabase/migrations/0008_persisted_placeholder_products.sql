-- Persist the placeholder products instead of hardcoding them in the client.
--
-- The problem this fixes: the 61 sample products lived only in
-- src/lib/catalog-data.ts. Hiding one called setHiddenPlaceholders, a React
-- useState set, so the "deletion" evaporated on reload and every sample came
-- back at the next login. Deleting was never a real delete.
--
-- After this migration the same samples are real rows in public.products,
-- owned per user exactly like categories and photos. Hiding one deletes the
-- row, and it stays deleted on every future login.
--
-- The swatch spec (base colour, collar, detail pattern) moves into a jsonb
-- column so a product can be redrawn from the database alone.

-- ------------------------------------------------------------------ columns

alter table public.products
  add column if not exists spec jsonb not null default '{}'::jsonb;

alter table public.products
  add column if not exists sort_order integer not null default 0;

-- Template products are the ownerless originals cloned into each catalog,
-- mirroring is_template on categories.
alter table public.products
  add column if not exists is_template boolean not null default false;

create index if not exists products_user_id_idx
  on public.products (user_id);

create index if not exists products_category_user_idx
  on public.products (category_id, user_id);

-- ------------------------------------------- seed template product rows

-- One row per sample product, attached to the ownerless template category of
-- the same slug. Guarded on (category, name) so re-running is a no-op.
insert into public.products (category_id, name, spec, sort_order, is_template)
select c.id, v.name, v.spec, v.sort_order, true
from (values
  ('t-shirts',     'Essential Black Tee',    '{"base":"#1b1b1d"}', 0),
  ('t-shirts',     'Off-White Essential Tee','{"base":"#f6f5f1","detail":"small-graphic","accent":"#2b2b2b"}', 1),
  ('t-shirts',     'Navy Classic Tee',       '{"base":"#1c3059"}', 2),
  ('t-shirts',     'Sand Graphic Tee',       '{"base":"#d8c3a4","detail":"graphic","accent":"#3d3226"}', 3),
  ('t-shirts',     'Black Contrast Polo',    '{"base":"#1b1b1d","collar":"polo","accent":"#f2f2f2"}', 4),
  ('t-shirts',     'Forest Stripe Polo',     '{"base":"#14512f","collar":"polo","detail":"stripes","accent":"#cfe6d6"}', 5),
  ('t-shirts',     'Sky Blue Tee',           '{"base":"#c6dcf6","detail":"small-graphic","accent":"#2b4a75"}', 6),
  ('t-shirts',     'White Print Tee',        '{"base":"#f7f6f3","detail":"graphic","accent":"#1f2937"}', 7),
  ('t-shirts',     'Heather Grey Tee',       '{"base":"#b6b6b8","detail":"small-graphic","accent":"#1f2937"}', 8),
  ('t-shirts',     'Black Logo Tee',         '{"base":"#1a1a1c","detail":"graphic","accent":"#f5f5f5"}', 9),
  ('t-shirts',     'Olive Pocket Tee',       '{"base":"#7c8b69","detail":"pocket"}', 10),
  ('t-shirts',     'Crimson Pocket Tee',     '{"base":"#b42020","detail":"small-graphic","accent":"#f3e6e6"}', 11),

  ('shirts',       'White Oxford Shirt',     '{"base":"#f4f5f7","collar":"polo","accent":"#d7dbe2"}', 0),
  ('shirts',       'Blue Check Shirt',       '{"base":"#a9c4e4","detail":"stripes","accent":"#e8f0fa"}', 1),
  ('shirts',       'Grey Linen Shirt',       '{"base":"#c3c7cc"}', 2),
  ('shirts',       'Sky Casual Shirt',       '{"base":"#d3e6f7"}', 3),
  ('shirts',       'Sand Shirt',             '{"base":"#dccdb6"}', 4),
  ('shirts',       'Forest Shirt',           '{"base":"#2f5d45"}', 5),

  ('polo-shirts',  'Navy Polo',              '{"base":"#1b2b4d","collar":"polo","accent":"#e8e8e8"}', 0),
  ('polo-shirts',  'White Polo',             '{"base":"#f6f6f4","collar":"polo","accent":"#cfd4dc"}', 1),
  ('polo-shirts',  'Maroon Polo',            '{"base":"#7d2230","collar":"polo","accent":"#f0dcdc"}', 2),
  ('polo-shirts',  'Green Stripe Polo',      '{"base":"#1d5c3a","collar":"polo","detail":"stripes","accent":"#d6ebdf"}', 3),
  ('polo-shirts',  'Grey Polo',              '{"base":"#9ea3a8","collar":"polo","accent":"#e2e5e8"}', 4),

  ('jeans',        'Classic Blue Jeans',     '{"base":"#3c5a8a"}', 0),
  ('jeans',        'Light Wash Jeans',       '{"base":"#6f8fc0"}', 1),
  ('jeans',        'Dark Indigo Jeans',      '{"base":"#24365c"}', 2),
  ('jeans',        'Black Jeans',            '{"base":"#24252a"}', 3),

  ('trousers',     'Charcoal Trousers',      '{"base":"#3c4048"}', 0),
  ('trousers',     'Khaki Trousers',         '{"base":"#c2ab84"}', 1),
  ('trousers',     'Navy Trousers',          '{"base":"#283a5c"}', 2),
  ('trousers',     'Stone Trousers',         '{"base":"#b9b4a9"}', 3),

  ('shorts',       'Denim Shorts',           '{"base":"#4a6b9c"}', 0),
  ('shorts',       'Black Shorts',           '{"base":"#26272b"}', 1),
  ('shorts',       'Olive Shorts',           '{"base":"#7a8467"}', 2),
  ('shorts',       'Grey Shorts',            '{"base":"#a8adb2"}', 3),

  ('suits',        'Navy Two-Piece Suit',    '{"base":"#22304e"}', 0),
  ('suits',        'Charcoal Suit',          '{"base":"#41454d"}', 1),
  ('suits',        'Grey Suit',              '{"base":"#8d9299"}', 2),

  ('jackets',      'Denim Jacket',           '{"base":"#3f5f8f"}', 0),
  ('jackets',      'Black Bomber',           '{"base":"#1e1f23"}', 1),
  ('jackets',      'Olive Field Jacket',     '{"base":"#6f7a5c"}', 2),
  ('jackets',      'Tan Jacket',             '{"base":"#c19a6b"}', 3),

  ('hoodies',      'Black Hoodie',           '{"base":"#1c1d21"}', 0),
  ('hoodies',      'Grey Hoodie',            '{"base":"#9ba0a6"}', 1),
  ('hoodies',      'Navy Hoodie',            '{"base":"#25375c"}', 2),
  ('hoodies',      'Sand Hoodie',            '{"base":"#d5c3a8"}', 3),

  ('sweaters',     'Cream Knit Sweater',     '{"base":"#e6e0d4"}', 0),
  ('sweaters',     'Forest Sweater',         '{"base":"#2c5740"}', 1),
  ('sweaters',     'Charcoal Sweater',       '{"base":"#4a4e56"}', 2),
  ('sweaters',     'Rust Sweater',           '{"base":"#a5552f"}', 3),

  ('tracksuits',   'Navy Tracksuit',         '{"base":"#243459"}', 0),
  ('tracksuits',   'Black Tracksuit',        '{"base":"#1f2024"}', 1),
  ('tracksuits',   'Grey Tracksuit',         '{"base":"#8f949b"}', 2),

  ('caps-hats',    'Black Cap',              '{"base":"#1d1e22"}', 0),
  ('caps-hats',    'Navy Cap',               '{"base":"#26375c"}', 1),
  ('caps-hats',    'Khaki Cap',              '{"base":"#c0ab88"}', 2),
  ('caps-hats',    'White Cap',              '{"base":"#f1f1ef"}', 3),

  ('accessories',  'Leather Belt',           '{"base":"#4a342a"}', 0),
  ('accessories',  'Wool Scarf',             '{"base":"#8d3f3f"}', 1),
  ('accessories',  'Canvas Tote',            '{"base":"#ddd6c6"}', 2),
  ('accessories',  'Beanie',                 '{"base":"#33506e"}', 3)
) as v(slug, name, spec, sort_order)
join public.categories c
  on c.slug = v.slug
 and c.is_template
 and c.user_id is null
where not exists (
  select 1
  from public.products p
  where p.category_id = c.id
    and p.is_template
    and p.name = v.name
);

-- ------------------------------------ clone samples into existing catalogs

-- Every user already signed up gets the sample set for their template-slug
-- categories. NOT EXISTS keeps this idempotent and leaves any sample the user
-- already hid alone: hidden means the row is absent, so it is not re-added.
insert into public.products (user_id, category_id, name, spec, sort_order)
select c.user_id, c.id, t.name, t.spec, t.sort_order
from public.products t
join public.categories tc on tc.id = t.category_id
join public.categories c
  on c.slug = tc.slug
 and c.user_id is not null
where t.is_template
  and tc.is_template
  and not exists (
    select 1
    from public.products p
    where p.category_id = c.id
      and p.name = t.name
  );

-- Any product row from before this migration predates user_id on products.
-- Give it the owner of its category, the same way 0005 backfilled photos.
update public.products p
set user_id = c.user_id
from public.categories c
where p.category_id = c.id
  and p.user_id is null
  and c.user_id is not null;

-- ------------------------------------------------------- scoped functions

-- Signup/login provisions sample products for a new catalog alongside the
-- categories, and backfills any catalog created before this migration.
create or replace function public.clone_template_products(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.products (user_id, category_id, name, spec, sort_order)
  select p_user_id, c.id, t.name, t.spec, t.sort_order
  from public.products t
  join public.categories tc on tc.id = t.category_id
  join public.categories c on c.slug = tc.slug and c.user_id = p_user_id
  where t.is_template
    and tc.is_template
    and not exists (
      select 1 from public.products p
      where p.category_id = c.id and p.name = t.name
    );
end;
$$;

-- Rewritten so a first-time signup receives categories AND products, and an
-- older account with a catalog but no products is repaired on login.
create or replace function public.login_or_signup(p_mobile_number text)
returns table (
  id             uuid,
  mobile_number  text,
  created_at     timestamptz,
  last_login_at  timestamptz,
  is_new         boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_users;
begin
  select * into v_row
  from public.app_users u
  where u.mobile_number = p_mobile_number;

  if v_row.id is null then
    insert into public.app_users (mobile_number)
    values (p_mobile_number)
    returning * into v_row;

    insert into public.categories (user_id, name, slug, sort_order)
    select v_row.id, t.name, t.slug, t.sort_order
    from public.categories t
    where t.is_template;

    -- First signup: the sample set is seeded once, here and only here.
    perform public.clone_template_products(v_row.id);

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, true;
  else
    update public.app_users u
    set last_login_at = now()
    where u.id = v_row.id
    returning * into v_row;

    if not exists (
      select 1 from public.categories c where c.user_id = v_row.id
    ) then
      insert into public.categories (user_id, name, slug, sort_order)
      select v_row.id, t.name, t.slug, t.sort_order
      from public.categories t
      where t.is_template;
    end if;

    -- Returning user: DO NOT re-clone. A product the user deleted must stay
    -- deleted, so the sample set is seeded once at signup and never again.
    -- This only repairs accounts that predate this migration and have a
    -- catalog containing no products at all -- which cannot be the result of
    -- deliberately deleting everything, since there was nothing to delete.
    if not exists (
      select 1 from public.products p where p.user_id = v_row.id
    ) then
      perform public.clone_template_products(v_row.id);
    end if;

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, false;
  end if;
end;
$$;

-- Products for one category, in their authored order.
create or replace function public.list_products(
  p_user_id      uuid,
  p_category_id  uuid
)
returns table (
  id          uuid,
  name        text,
  spec        jsonb,
  sort_order  integer
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.name, p.spec, p.sort_order
  from public.products p
  join public.categories c on c.id = p.category_id
  where p.category_id = p_category_id
    and p.user_id = p_user_id
    and c.user_id = p_user_id
  order by p.sort_order, p.name;
$$;

-- A real delete. Scoped to the owner, so one account cannot remove another's.
create or replace function public.delete_product(p_user_id uuid, p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.products p
  where p.id = p_id and p.user_id = p_user_id;
$$;

-- ------------------------------------------------------------------- grants

-- clone_template_products is an internal helper: it exists only so
-- login_or_signup can seed a first-time catalog, so it is NOT granted to anon
-- or authenticated. login_or_signup still reaches it because it is
-- SECURITY DEFINER and runs as the function owner.
revoke all on function public.clone_template_products(uuid) from public, anon, authenticated;
revoke all on function public.list_products(uuid, uuid) from public;
revoke all on function public.delete_product(uuid, uuid) from public;

grant execute on function public.list_products(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_product(uuid, uuid) to anon, authenticated;

grant execute on function public.login_or_signup(text) to anon, authenticated;
