-- Fix for login_or_signup: PL/pgSQL output variables created by RETURNS TABLE
-- shadow the table columns of the same name, making unqualified references
-- ambiguous. Qualify every column with a table alias.
--
-- Symptom before this fix:
--   ERROR: 42702: column reference "mobile_number" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.

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

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, true;
  else
    update public.app_users u
    set last_login_at = now()
    where u.id = v_row.id
    returning * into v_row;

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, false;
  end if;
end;
$$;

revoke all on function public.login_or_signup(text) from public;
grant execute on function public.login_or_signup(text) to anon, authenticated;
