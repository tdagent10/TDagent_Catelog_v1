-- Cover the user_id foreign keys flagged by the performance advisor.
-- Without these, per-user lookups degrade as photo/product counts grow.

create index if not exists product_photos_user_id_idx
  on public.product_photos (user_id);

create index if not exists products_user_id_idx
  on public.products (user_id);
