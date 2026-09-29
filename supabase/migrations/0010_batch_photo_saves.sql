-- Batch photo saves, so a burst costs one metadata round trip instead of N.
--
-- Saving one photo took two sequential network round trips: the Storage
-- upload, then the add_photo RPC. Shooting six photos in a row meant twelve
-- round trips, and on a phone each one is latency the user waits through.
--
-- The Storage upload has to stay per-object -- the bytes have to move -- but
-- those uploads are independent and already run in parallel. The metadata
-- insert is what can be collapsed, because N rows in one call cost the same
-- round trip as one.

-- Inserts many photo rows in a single call.
--
-- p_items is a jsonb array of {storagePath, bytes, width, height}. The 200KB
-- ceiling is enforced here exactly as it was per photo, so batching cannot be
-- used to slip an oversized image past the limit. Any offending item fails the
-- whole batch, which is reported back to the client rather than silently
-- dropping photos.
create or replace function public.add_photos(
  p_user_id      uuid,
  p_category_id  uuid,
  p_items        jsonb
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
  v_item jsonb;
  v_path text;
  v_bytes integer;
  v_row public.product_photos;
begin
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.user_id = p_user_id
  ) then
    raise exception 'Unknown category';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No photos to add';
  end if;

  -- Cap the batch so a single call cannot be used to write an unbounded
  -- number of rows. A phone gallery selection tops out well below this.
  if jsonb_array_length(p_items) > 40 then
    raise exception 'Too many photos in one batch (max 40)';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_path := v_item->>'storagePath';
    v_bytes := (v_item->>'bytes')::integer;

    if v_path is null or v_path = '' then
      raise exception 'Photo is missing its storage path';
    end if;
    if v_bytes is null or v_bytes <= 0 then
      raise exception 'Photo is empty';
    end if;
    if v_bytes > 204800 then
      raise exception 'Photo is % bytes, over the 200KB limit', v_bytes;
    end if;

    insert into public.product_photos
      (user_id, category_id, storage_path, bytes, width, height)
    values
      (p_user_id, p_category_id, v_path, v_bytes,
       (v_item->>'width')::integer, (v_item->>'height')::integer)
    returning * into v_row;

    return query
      select v_row.id, v_row.storage_path, v_row.bytes,
             v_row.width, v_row.height, v_row.created_at;
  end loop;
end;
$$;

-- Kept so existing single-photo callers and the older client build still work
-- while a deployment is rolling out. New code uses add_photos.
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
begin
  return query
    select * from public.add_photos(
      p_user_id,
      p_category_id,
      jsonb_build_array(jsonb_build_object(
        'storagePath', p_storage_path,
        'bytes', p_bytes,
        'width', p_width,
        'height', p_height
      ))
    );
end;
$$;

revoke all on function public.add_photos(uuid, uuid, jsonb) from public;
revoke all on function public.add_photo(uuid, uuid, text, integer, integer, integer) from public;

grant execute on function public.add_photos(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.add_photo(uuid, uuid, text, integer, integer, integer) to anon, authenticated;
