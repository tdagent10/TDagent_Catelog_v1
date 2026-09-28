-- Public share links: each user gets a short, unguessable token. Scanning the
-- user's QR opens /menu/<token>, a read-only catalog with no editing UI.
--
-- The token (not the internal user id) goes in the URL so the id itself is
-- never exposed to customers.

alter table public.app_users
  add column if not exists share_token text;

-- 12 URL-safe chars from 9 random bytes (9 bytes = exactly 12 base64 chars,
-- no padding; '+'/'/' translated to '-'/'_').
update public.app_users
set share_token = substr(
  translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'), 1, 12
)
where share_token is null;

alter table public.app_users
  alter column share_token set default substr(
    translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'), 1, 12
  );

alter table public.app_users drop constraint if exists app_users_share_token_unique;
alter table public.app_users
  add constraint app_users_share_token_unique unique (share_token);

alter table public.app_users alter column share_token set not null;

-- Resolve a share token to its owner. The only entry point the public menu
-- page needs; it reveals nothing but the user id behind a valid token.
create or replace function public.resolve_share_token(p_token text)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select u.id from public.app_users u where u.share_token = p_token;
$$;

-- Lets the signed-in shopkeeper read their own token (and number, for the
-- download filename) without exposing anyone else's.
create or replace function public.get_my_share_token(p_user_id uuid)
returns table (share_token text, mobile_number text)
language sql
security definer
set search_path = public
as $$
  select u.share_token, u.mobile_number
  from public.app_users u
  where u.id = p_user_id;
$$;

revoke all on function public.resolve_share_token(text) from public;
revoke all on function public.get_my_share_token(uuid) from public;

grant execute on function public.resolve_share_token(text) to anon, authenticated;
grant execute on function public.get_my_share_token(uuid) to anon, authenticated;
