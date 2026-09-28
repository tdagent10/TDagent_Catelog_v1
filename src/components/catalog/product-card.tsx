import { ProductImage } from "./product-image";
import type { CatalogPhoto } from "@/lib/catalog-types";
import type { Product } from "@/lib/catalog-data";

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
  onRemove?: (name: string) => void;
}) {
  return (
    <li className="min-w-0 rounded-xl border border-card-border bg-white p-1.5 sm:p-2">
      <div className="relative flex aspect-[7/6] items-center justify-center overflow-hidden rounded-lg bg-swatch-bg p-2 sm:p-3">
        <ProductImage spec={product.spec} />
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(product.name)}
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
          alt="Captured product"
          loading="lazy"
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
