-- Per-user catalogs: every category, product and photo belongs to one app user.
--
-- Before this migration everything was global: all users saw the same
-- categories and photos. After it, each mobile number gets its own catalog.
--
-- How it works:
-- * categories/products/product_photos gain a user_id owner column.
-- * The 13 built-in categories live on as template rows (is_template,
--   ownerless). A new signup clones them into a personal catalog inside
--   login_or_signup, and existing users are backfilled below.
-- * Data created before this migration has no recorded owner, so it is
--   attributed to whoever had signed up most recently when it was created
--   (signup order is the only ownership signal available).
-- * Slug uniqueness is per-owner now: unique(user_id, slug). Template slugs
--   (ownerless) can never collide with a user's slugs.

-- ------------------------------------------------------------------ columns

alter table public.categories
  add column if not exists user_id uuid references public.app_users (id) on delete cascade;

alter table public.categories
  add column if not exists is_template boolean not null default false;

alter table public.products
  add column if not exists user_id uuid references public.app_users (id) on delete cascade;

alter table public.product_photos
  add column if not exists user_id uuid references public.app_users (id) on delete cascade;

alter table public.categories drop constraint if exists categories_slug_key;
alter table public.categories drop constraint if exists categories_user_slug_unique;
alter table public.categories
  add constraint categories_user_slug_unique unique (user_id, slug);

-- ------------------------------------------------------- seed template rows

-- Re-adds Caps & Hats / Accessories too: they were deleted at some point, and
-- every new catalog should contain the full set of 13.
-- ORDER MATTERS: pre-existing seed rows must be flagged as templates BEFORE
-- the insert below, otherwise it duplicates them and the per-user backfill
-- trips the unique(user_id, slug) constraint.
update public.categories
set is_template = true
where user_id is null
  and slug in (
    't-shirts','shirts','polo-shirts','jeans','trousers','shorts','suits',
    'jackets','hoodies','sweaters','tracksuits','caps-hats','accessories'
  );

insert into public.categories (name, slug, sort_order, is_template)
select v.name, v.slug, v.sort_order, true
from (values
  ('T-Shirts',    't-shirts',     0),
  ('Shirts',      'shirts',       1),
  ('Polo Shirts', 'polo-shirts',  2),
  ('Jeans',       'jeans',        3),
  ('Trousers',    'trousers',     4),
  ('Shorts',      'shorts',       5),
  ('Suits',       'suits',        6),
  ('Jackets',     'jackets',      7),
  ('Hoodies',     'hoodies',      8),
  ('Sweaters',    'sweaters',     9),
  ('Tracksuits',  'tracksuits',  10),
  ('Caps & Hats', 'caps-hats',   11),
  ('Accessories', 'accessories', 12)
) as v(name, slug, sort_order)
where not exists (
  select 1 from public.categories c
  where c.is_template and c.slug = v.slug
);

-- ------------------------------------------- backfill catalogs for existing

-- Every existing user without a personal catalog gets a full clone.
-- DISTINCT ON guards against duplicate template rows, should any exist.
insert into public.categories (user_id, name, slug, sort_order)
select distinct on (u.id, t.slug) u.id, t.name, t.slug, t.sort_order
from public.app_users u
cross join public.categories t
where t.is_template
  and not exists (
    select 1 from public.categories c where c.user_id = u.id
  )
order by u.id, t.slug, t.sort_order;

-- Ownerless custom categories go to whoever had signed up most recently when
-- they were created.
update public.categories c
set user_id = (
  select u.id
  from public.app_users u
  where u.created_at <= c.created_at
  order by u.created_at desc
  limit 1
)
where c.user_id is null
  and not c.is_template;

-- Photos sitting on template categories move onto the matching clone owned by
-- whoever had signed up most recently when the photo was taken. Done in two
-- steps because Postgres does not allow the UPDATE target inside a JOIN .. ON.
update public.product_photos ph
set user_id = (
  select u.id
  from public.app_users u
  where u.created_at <= ph.created_at
  order by u.created_at desc
  limit 1
)
where ph.user_id is null;

update public.product_photos ph
set category_id = clone.id
from public.categories old, public.categories clone
where ph.category_id = old.id
  and old.is_template
  and clone.slug = old.slug
  and clone.user_id = ph.user_id;

-- Any remaining ownerless photos inherit their category's owner.
update public.product_photos ph
set user_id = c.user_id
from public.categories c
where ph.category_id = c.id
  and ph.user_id is null
  and c.user_id is not null;

-- ------------------------------------------------- drop unscoped functions

-- These signatures predate per-user scoping and must not remain callable.
drop function if exists public.list_categories();
drop function if exists public.create_category(text);
drop function if exists public.delete_category(uuid);
drop function if exists public.list_photos(uuid);
drop function if exists public.add_photo(uuid, text, integer, integer, integer);
drop function if exists public.delete_photo(uuid);

-- ------------------------------------------------------- scoped functions

-- Signup/login now also provisions a personal catalog for first-time users,
-- and repairs users that predate catalogs.
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

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, false;
  end if;
end;
$$;

create or replace function public.list_categories(p_user_id uuid)
returns table (
  id            uuid,
  name          text,
  slug          text,
  sort_order    integer,
  product_count bigint,
  photo_count   bigint
)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.slug,
    c.sort_order,
    (select count(*)
       from public.products p
      where p.category_id = c.id and p.user_id = p_user_id),
    (select count(*)
       from public.product_photos ph
      where ph.category_id = c.id and ph.user_id = p_user_id)
  from public.categories c
  where c.user_id = p_user_id
  order by c.sort_order, c.name;
$$;

create or replace function public.create_category(p_user_id uuid, p_name text)
returns table (id uuid, name text, slug text, sort_order integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text;
  v_slug  text;
  v_row   public.categories;
begin
  if not exists (select 1 from public.app_users u where u.id = p_user_id) then
    raise exception 'Unknown user';
  end if;

  v_clean := btrim(coalesce(p_name, ''));
  if v_clean = '' then
    raise exception 'Category name cannot be empty';
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(v_clean), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'category';
  end if;

  -- Scoped per owner: other users' slugs (and templates) never collide.
  if exists (
    select 1 from public.categories c
    where c.user_id = p_user_id and c.slug = v_slug
  ) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into public.categories (user_id, name, slug, sort_order)
  values (
    p_user_id,
    v_clean,
    v_slug,
    coalesce((
      select max(c.sort_order) + 1
      from public.categories c
      where c.user_id = p_user_id
    ), 0)
  )
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.slug, v_row.sort_order;
end;
$$;

create or replace function public.delete_category(p_user_id uuid, p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.categories c
  where c.id = p_id and c.user_id = p_user_id;
$$;

create or replace function public.list_photos(p_user_id uuid, p_category_id uuid)
returns table (
  id           uuid,
  storage_path text,
  bytes        integer,
  width        integer,
  height       integer,
  created_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select ph.id, ph.storage_path, ph.bytes, ph.width, ph.height, ph.created_at
  from public.product_photos ph
  join public.categories c on c.id = ph.category_id
  where ph.category_id = p_category_id
    and ph.user_id = p_user_id
    and c.user_id = p_user_id
  order by ph.created_at desc;
$$;

-- The 200KB ceiling is enforced HERE as well as in the browser, so the limit
-- holds no matter what the client sends.
create or replace function public.add_photo(
  p_user_id      uuid,
  p_category_id  uuid,
  p_storage_path text,
  p_bytes        integer,
  p_width        integer,
  p_height       integer
)
returns table (
  id           uuid,
  storage_path text,
  bytes        integer,
  width        integer,
  height       integer,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.product_photos;
begin
  if p_bytes is null or p_bytes <= 0 then
    raise exception 'Photo is empty';
  end if;
  if p_bytes > 204800 then
    raise exception 'Photo is % bytes, over the 200KB limit', p_bytes;
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.user_id = p_user_id
  ) then
    raise exception 'Unknown category';
  end if;

  insert into public.product_photos
    (user_id, category_id, storage_path, bytes, width, height)
  values
    (p_user_id, p_category_id, p_storage_path, p_bytes, p_width, p_height)
  returning * into v_row;

  return query
    select v_row.id, v_row.storage_path, v_row.bytes, v_row.width, v_row.height, v_row.created_at;
end;
$$;

create or replace function public.delete_photo(p_user_id uuid, p_id uuid)
returns table (storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  delete from public.product_photos ph
  where ph.id = p_id and ph.user_id = p_user_id
  returning ph.storage_path into v_path;

  if v_path is null then
    raise exception 'Photo not found';
  end if;

  return query select v_path;
end;
$$;

-- ------------------------------------------------------------------- grants

revoke all on function public.login_or_signup(text) from public;
revoke all on function public.list_categories(uuid) from public;
revoke all on function public.create_category(uuid, text) from public;
revoke all on function public.delete_category(uuid, uuid) from public;
revoke all on function public.list_photos(uuid, uuid) from public;
revoke all on function public.add_photo(uuid, uuid, text, integer, integer, integer) from public;
revoke all on function public.delete_photo(uuid, uuid) from public;

grant execute on function public.login_or_signup(text) to anon, authenticated;
grant execute on function public.list_categories(uuid) to anon, authenticated;
grant execute on function public.create_category(uuid, text) to anon, authenticated;
grant execute on function public.delete_category(uuid, uuid) to anon, authenticated;
grant execute on function public.list_photos(uuid, uuid) to anon, authenticated;
grant execute on function public.add_photo(uuid, uuid, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.delete_photo(uuid, uuid) to anon, authenticated;
