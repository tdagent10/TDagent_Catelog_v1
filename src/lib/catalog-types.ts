import { publicPhotoUrl } from "./supabase/server";

export type Category = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  photoCount: number;
};

export type CatalogPhoto = {
  id: string;
  url: string;
  storagePath: string;
  bytes: number;
  width: number;
  height: number;
  takenAt: string;
};

/** Postgres returns bigint counts as strings over PostgREST. */
function toCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    sortOrder: toCount(row.sort_order),
    productCount: toCount(row.product_count),
    photoCount: toCount(row.photo_count),
  };
}

export function mapPhoto(row: Record<string, unknown>): CatalogPhoto {
  const storagePath = String(row.storage_path);
  return {
    id: String(row.id),
    url: publicPhotoUrl(storagePath),
    storagePath,
    bytes: toCount(row.bytes),
    width: toCount(row.width),
    height: toCount(row.height),
    takenAt: String(row.created_at),
  };
}
