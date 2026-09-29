import { publicPhotoUrl, publicPhotoUrlSized } from "./supabase/server";
import type { GarmentSpec } from "@/components/catalog/product-image";

export type Category = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  photoCount: number;
};

/**
 * A catalog product, now a real database row rather than a hardcoded
 * placeholder. The swatch spec is stored as jsonb so the garment can be
 * redrawn from the database alone.
 */
export type Product = {
  id: string;
  name: string;
  spec: GarmentSpec;
  sortOrder: number;
};

export type CatalogPhoto = {
  id: string;
  url: string;
  /**
   * Right-sized variants for `srcset`, so the phone downloads a card-sized
   * image instead of the full ~200KB original. `url` stays as the full-size
   * fallback and is what the optimistic preview and any zoom use.
   */
  srcSet: string;
  storagePath: string;
  bytes: number;
  width: number;
  height: number;
  takenAt: string;
};

/**
 * Card aspect the grid renders at (CSS `aspect-[7/6]`), 7:6.
 *
 * The transform endpoint needs an explicit target box to avoid stretching the
 * image, so this ratio is the one to request.
 */
const CARD_ASPECT = 7 / 6;

/** Widths offered to the browser. Chosen for 2/3/4-column grids at DPR 1-3. */
const SRCSET_WIDTHS = [240, 400, 640, 900];

/**
 * Builds a srcset of right-sized variants, never upscaling.
 *
 * A photo captured small is offered only up to its own width: asking for more
 * would just transfer the same pixels twice.
 */
function buildSrcSet(
  storagePath: string,
  naturalWidth: number,
): string {
  const widths = SRCSET_WIDTHS.filter((w) => w < naturalWidth);
  // Always offer at least the natural size, so there is a candidate at any DPR.
  const sizes = widths.length > 0 ? widths : [naturalWidth];

  return sizes
    .map((w) => {
      const url = publicPhotoUrlSized(
        storagePath,
        w,
        Math.round(w / CARD_ASPECT),
      );
      return `${url} ${w}w`;
    })
    .join(", ");
}

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

/**
 * Narrows an untrusted jsonb value to a drawable GarmentSpec.
 *
 * The column is `jsonb not null default '{}'`, so an empty or malformed spec
 * is expected rather than exceptional. Falling back to a neutral grey keeps a
 * bad row renderable instead of crashing the whole grid.
 */
export function mapSpec(value: unknown): GarmentSpec {
  const raw = (value ?? {}) as Record<string, unknown>;
  const base = typeof raw.base === "string" ? raw.base : "#b6b6b8";

  const spec: GarmentSpec = { base };

  if (typeof raw.shade === "string") spec.shade = raw.shade;
  if (typeof raw.accent === "string") spec.accent = raw.accent;

  if (raw.collar === "crew" || raw.collar === "polo") spec.collar = raw.collar;

  if (
    raw.detail === "plain" ||
    raw.detail === "stripes" ||
    raw.detail === "pocket" ||
    raw.detail === "graphic" ||
    raw.detail === "small-graphic"
  ) {
    spec.detail = raw.detail;
  }

  return spec;
}

export function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.name),
    spec: mapSpec(row.spec),
    sortOrder: toCount(row.sort_order),
  };
}

export function mapPhoto(row: Record<string, unknown>): CatalogPhoto {
  const storagePath = String(row.storage_path);
  const width = toCount(row.width);
  return {
    id: String(row.id),
    url: publicPhotoUrl(storagePath),
    srcSet: buildSrcSet(storagePath, width || 640),
    storagePath,
    bytes: toCount(row.bytes),
    width,
    height: toCount(row.height),
    takenAt: String(row.created_at),
  };
}
