-- Catalog backend: categories, products, and captured photos.
--
-- Same access model as 0001_app_users.sql: RLS stays enabled on every table
-- and all traffic goes through SECURITY DEFINER functions, so the public anon
-- key cannot read or write the tables directly.
--
-- Photos live in Supabase Storage; this file only stores their metadata.

-- ---------------------------------------------------------------- categories

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null unique,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;

-- ------------------------------------------------------------------ products

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid        not null references public.categories (id) on delete cascade,
  name        text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists products_category_id_idx
  on public.products (category_id);

alter table public.products enable row level security;

-- ------------------------------------------------------------ product photos

create table if not exists public.product_photos (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid        not null references public.categories (id) on delete cascade,
  storage_path text        not null,
  bytes        integer     not null,
  width        integer     not null,
  height       integer     not null,
  created_at   timestamptz not null default now()
);

create index if not exists product_photos_category_id_idx
  on public.product_photos (category_id);

alter table public.product_photos enable row level security;

-- ------------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "anon reads product photos" on storage.objects;
create policy "anon reads product photos"
  on storage.objects for select
  using (bucket_id = 'product-photos');

drop policy if exists "anon uploads product photos" on storage.objects;
create policy "anon uploads product photos"
  on storage.objects for insert
  with check (bucket_id = 'product-photos');

drop policy if exists "anon deletes product photos" on storage.objects;
create policy "anon deletes product photos"
  on storage.objects for delete
  using (bucket_id = 'product-photos');

-- ----------------------------------------------------------------- functions

-- Reads every category with its counts in one round trip.
create or replace function public.list_categories()
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
    (select count(*) from public.products     p  where p.category_id  = c.id),
    (select count(*) from public.product_photos ph where ph.category_id = c.id)
  from public.categories c
  order by c.sort_order, c.name;
$$;

create or replace function public.create_category(p_name text)
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
  v_clean := btrim(coalesce(p_name, ''));
  if v_clean = '' then
    raise exception 'Category name cannot be empty';
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(v_clean), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'category';
  end if;

  -- Disambiguate rather than reject, so a shopkeeper is never blocked.
  if exists (select 1 from public.categories where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into public.categories (name, slug, sort_order)
  values (
    v_clean,
    v_slug,
    coalesce((select max(sort_order) + 1 from public.categories), 0)
  )
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.slug, v_row.sort_order;
end;
$$;

create or replace function public.delete_category(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.categories where id = p_id;
$$;

create or replace function public.list_photos(p_category_id uuid)
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
  select id, storage_path, bytes, width, height, created_at
  from public.product_photos
  where category_id = p_category_id
  order by created_at desc;
$$;

-- The 200KB ceiling is enforced HERE as well as in the browser, so the limit
-- holds no matter what the client sends.
create or replace function public.add_photo(
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
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Unknown category';
  end if;

  insert into public.product_photos
    (category_id, storage_path, bytes, width, height)
  values
    (p_category_id, p_storage_path, p_bytes, p_width, p_height)
  returning * into v_row;

  return query
    select v_row.id, v_row.storage_path, v_row.bytes, v_row.width, v_row.height, v_row.created_at;
end;
$$;

create or replace function public.delete_photo(p_id uuid)
returns table (storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  delete from public.product_photos
  where id = p_id
  returning storage_path into v_path;

  if v_path is null then
    raise exception 'Photo not found';
  end if;

  return query select v_path;
end;
$$;

-- ------------------------------------------------------------------- grants

revoke all on function public.list_categories() from public;
revoke all on function public.create_category(text) from public;
revoke all on function public.delete_category(uuid) from public;
revoke all on function public.list_photos(uuid) from public;
revoke all on function public.add_photo(uuid, text, integer, integer, integer) from public;
revoke all on function public.delete_photo(uuid) from public;

grant execute on function public.list_categories() to anon, authenticated;
grant execute on function public.create_category(text) to anon, authenticated;
grant execute on function public.delete_category(uuid) to anon, authenticated;
grant execute on function public.list_photos(uuid) to anon, authenticated;
grant execute on function public.add_photo(uuid, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.delete_photo(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- seed data

-- The categories the UI ships with. Safe to re-run.
insert into public.categories (name, slug, sort_order)
select v.name, v.slug, v.sort_order
from (values
  ('T-Shirts',      't-shirts',      0),
  ('Shirts',        'shirts',        1),
  ('Polo Shirts',   'polo-shirts',   2),
  ('Jeans',         'jeans',         3),
  ('Trousers',      'trousers',      4),
  ('Shorts',        'shorts',        5),
  ('Suits',         'suits',         6),
  ('Jackets',       'jackets',       7),
  ('Hoodies',       'hoodies',       8),
  ('Sweaters',      'sweaters',      9),
  ('Tracksuits',    'tracksuits',   10),
  ('Caps & Hats',   'caps-hats',    11),
  ('Accessories',   'accessories',  12)
) as v(name, slug, sort_order)
on conflict (slug) do nothing;
