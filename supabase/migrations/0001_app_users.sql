-- Retail catalog app: customers identified by mobile number only.
--
-- SECURITY NOTE: this design has NO password, NO OTP and NO session token.
-- Anyone who knows a customer's mobile number can sign in as that customer.
-- That is acceptable for a shop-counter / staff device, but it is not
-- sufficient protection for real customer accounts holding personal data.

create table if not exists public.app_users (
  id             uuid primary key default gen_random_uuid(),
  mobile_number  text        not null unique,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- Single entry point for signup + login. SECURITY DEFINER so it can reach the
-- table while RLS stays on, and so the anon key can never read the whole table.
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
  from public.app_users
  where mobile_number = p_mobile_number;

  if v_row.id is null then
    insert into public.app_users (mobile_number)
    values (p_mobile_number)
    returning * into v_row;

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, true;
  else
    update public.app_users
    set last_login_at = now()
    where id = v_row.id
    returning * into v_row;

    return query
      select v_row.id, v_row.mobile_number, v_row.created_at, v_row.last_login_at, false;
  end if;
end;
$$;

revoke all on function public.login_or_signup(text) from public;
grant execute on function public.login_or_signup(text) to anon, authenticated;
