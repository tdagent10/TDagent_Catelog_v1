-- Fixes the same PL/pgSQL output-variable shadowing in create_category and
-- add_photo that was already corrected in 0003 for login_or_signup.
--
-- RETURNS TABLE (...) declares output variables named after each column, so an
-- unqualified reference to such a name inside the body is ambiguous.

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
  if exists (select 1 from public.categories c where c.slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into public.categories (name, slug, sort_order)
  values (
    v_clean,
    v_slug,
    coalesce((select max(c.sort_order) + 1 from public.categories c), 0)
  )
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.slug, v_row.sort_order;
end;
$$;

revoke all on function public.create_category(text) from public;
grant execute on function public.create_category(text) to anon, authenticated;

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
  if not exists (select 1 from public.categories c where c.id = p_category_id) then
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

revoke all on function public.add_photo(uuid, text, integer, integer, integer) from public;
grant execute on function public.add_photo(uuid, text, integer, integer, integer) to anon, authenticated;
