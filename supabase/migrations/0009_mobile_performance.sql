-- Fewer round trips, for real mobile networks.
--
-- The catalog screen used to need one round trip per category, times two:
-- the sidebar page fetched categories, then every category switch fired
-- fetchPhotos + fetchProducts as two separate POSTs, and the public share
-- page did 1 + 2N calls for a 13-category catalog. On a phone each of those
-- is a full network round trip with its own latency, so the cost is
-- multiplied by the number of categories.
--
-- This migration:
--   * adds the composite index product_photos was missing, so the hot
--     category+owner lookup is index-only rather than a scan;
--   * adds get_category_content, returning a category's products AND photos
--     in a single call, replacing the two per category;
--   * adds get_public_catalog, returning an entire shareable catalog in one
--     call, replacing the N+1 the share page did per category;
--   * caps photos per category so a large catalog cannot produce an
--     unbounded response.

-- ------------------------------------------------------------------- indexes

-- list_photos filters on both columns, and products already has this pairing.
create index if not exists product_photos_category_user_idx
  on public.product_photos (category_id, user_id);

-- Ordering is by created_at desc within a category, so a matching index can
-- satisfy both the filter and the sort without a separate sort step.
create index if not exists product_photos_category_user_created_idx
  on public.product_photos (category_id, user_id, created_at desc);

-- Guard against a runaway catalog making the public payload unusable.
create index if not exists product_photos_user_created_idx
  on public.product_photos (user_id, created_at desc);

-- ------------------------------------------------------------------ functions

-- Products and photos for one category, in a single round trip.
--
-- Returns a single jsonb row so the whole result is one value: the client
-- needs both halves at once to render a category, and issuing them as two
-- calls doubled the latency of every category switch.
create or replace function public.get_category_content(
  p_user_id      uuid,
  p_category_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_category public.categories;
begin
  -- Scoped to the owner: a category that is not theirs reads as empty rather
  -- than leaking whether it exists.
  select * into v_category
  from public.categories c
  where c.id = p_category_id and c.user_id = p_user_id;

  if v_category.id is null then
    return jsonb_build_object(
      'category', null,
      'products', '[]'::jsonb,
      'photos', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'category', jsonb_build_object(
      'id', v_category.id,
      'name', v_category.name,
      'slug', v_category.slug,
      'sort_order', v_category.sort_order
    ),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'spec', p.spec,
          'sort_order', p.sort_order
        ) order by p.sort_order, p.name
      )
      from (
        select * from public.products pr
        where pr.category_id = p_category_id and pr.user_id = p_user_id
        order by pr.sort_order, pr.name
        limit 500
      ) p
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ph.id,
          'storage_path', ph.storage_path,
          'bytes', ph.bytes,
          'width', ph.width,
          'height', ph.height,
          'created_at', ph.created_at
        ) order by ph.created_at desc
      )
      from (
        select * from public.product_photos pp
        where pp.category_id = p_category_id and pp.user_id = p_user_id
        order by pp.created_at desc
        limit 300
      ) ph
    ), '[]'::jsonb)
  );
end;
$$;

-- An entire shareable catalog in one call.
--
-- The share page previously resolved the token, listed categories, then made
-- two calls per category. This replaces all of that with one request, which
-- is what a customer opening a shared link on mobile data actually feels.
--
-- Photographed products are what customers care about, so photos are included
-- for every category but capped; a shopkeeper with hundreds of shots still
-- gets a page that opens.
create or replace function public.get_public_catalog(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
  from public.app_users u
  where u.share_token = p_token;

  if v_user_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'mobileNumber', (select u.mobile_number from public.app_users u where u.id = v_user_id),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug,
          'sortOrder', c.sort_order,
          'products', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', pr.id,
                'name', pr.name,
                'spec', pr.spec,
                'sortOrder', pr.sort_order
              ) order by pr.sort_order, pr.name
            )
            from (
              select * from public.products x
              where x.category_id = c.id and x.user_id = c.user_id
              order by x.sort_order, x.name
              limit 200
            ) pr
          ), '[]'::jsonb),
          'photos', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', ph.id,
                'storagePath', ph.storage_path,
                'bytes', ph.bytes,
                'width', ph.width,
                'height', ph.height,
                'createdAt', ph.created_at
              ) order by ph.created_at desc
            )
            from (
              select * from public.product_photos y
              where y.category_id = c.id and y.user_id = c.user_id
              order by y.created_at desc
              limit 60
            ) ph
          ), '[]'::jsonb)
        ) order by c.sort_order, c.name
      )
      from public.categories c
      where c.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------------- grants

revoke all on function public.get_category_content(uuid, uuid) from public;
revoke all on function public.get_public_catalog(text) from public;

grant execute on function public.get_category_content(uuid, uuid) to anon, authenticated;
grant execute on function public.get_public_catalog(text) to anon, authenticated;
