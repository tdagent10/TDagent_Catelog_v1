import { ProductImage } from "./product-image";
import type { CatalogPhoto, Product } from "@/lib/catalog-types";

/**
 * Tiny delete affordance: a very small 12px dot visually, with an invisible
 * expanded hit-area so it stays tappable on touch screens (≈36px target).
 */
const TINY_X =
  "absolute right-1 top-1 flex h-3 w-3 items-center justify-center rounded-full bg-black/60 text-[9px] leading-none font-bold text-white hover:bg-black/80 active:bg-black/80 after:absolute after:-inset-3 after:content-['']";

export function ProductCard({
  product,
  onRemove,
}: {
  product: Product;
  onRemove?: (id: string) => void;
}) {
  return (
    <li className="min-w-0 rounded-xl border border-card-border bg-white p-1.5 sm:p-2">
      <div className="relative flex aspect-[7/6] items-center justify-center overflow-hidden rounded-lg bg-swatch-bg p-2 sm:p-3">
        <ProductImage spec={product.spec} />
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(product.id)}
            aria-label={`Remove ${product.name}`}
            className={TINY_X}
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
}

export function PhotoCard({
  photo,
  onRemove,
}: {
  photo: CatalogPhoto;
  onRemove?: (id: string) => void;
}) {
  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-card-border bg-white p-1.5 sm:p-2">
      <div className="relative overflow-hidden rounded-lg bg-swatch-bg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          srcSet={photo.srcSet}
          // 2 columns on a phone, 3 on tablet, 4 on desktop. Declaring this
          // lets the browser pick from the srcset instead of taking the
          // full-size src, which is the whole point of the variants.
          sizes="(max-width: 640px) 48vw, (max-width: 1280px) 32vw, 24vw"
          alt="Captured product"
          loading="lazy"
          decoding="async"
          className="aspect-[7/6] w-full object-cover"
        />
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(photo.id)}
            aria-label="Remove photo"
            className={TINY_X}
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * A photo that is on screen before its upload has finished.
 *
 * Shown the moment the shutter fires so the tap registers instantly, then
 * swapped for a real PhotoCard. Slightly dimmed with a "Saving" badge so it is
 * never mistaken for a stored photo, and deliberately not deletable: there is
 * no server-side id to delete yet.
 */
export function PendingPhotoCard({ url }: { url: string }) {
  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-card-border bg-white p-1.5 opacity-70 sm:p-2">
      <div className="relative overflow-hidden rounded-lg bg-swatch-bg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Uploading photo"
          className="aspect-[7/6] w-full object-cover"
        />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/55 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/35 border-t-white"
          />
          Saving
        </span>
      </div>
    </li>
  );
}
