"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";
import { compressToJpeg, MAX_PHOTO_BYTES } from "@/lib/image-compress";
import type { CatalogPhoto, Category, Product } from "@/lib/catalog-types";
import {
  createCategoryAction,
  deleteCategoryAction,
  deletePhotoAction,
  deleteProductAction,
  fetchPhotos,
  fetchProducts,
  uploadPhotoAction,
  type CreateCategoryState,
} from "@/app/actions/catalog";
import { PendingPhotoCard, PhotoCard, ProductCard } from "./product-card";
import { CameraCapture } from "./camera-capture";
import { ShareQrModal } from "./share-qr-modal";
import { getMyShareToken } from "@/app/actions/share";
import { CameraIcon, PlusIcon, QrIcon } from "./icons";

const NO_PHOTOS: CatalogPhoto[] = [];
const NO_PRODUCTS: Product[] = [];

/** A photo visible in the grid while its upload is still running. */
type PendingPhoto = {
  id: string;
  categoryId: string;
  url: string;
};

const NO_PENDING: PendingPhoto[] = [];

/** Preview edge for the optimistic thumbnail. Small: it is only a placeholder. */
const PREVIEW_EDGE = 320;

/**
 * Renders a capture to a small JPEG blob for the optimistic thumbnail.
 *
 * A camera capture arrives as an ImageBitmap, which has no URL and cannot be
 * put in an <img>. This is a separate, deliberately tiny encode -- so the
 * thumbnail appears immediately without paying for the full-size one.
 */
async function renderPreview(source: Blob | ImageBitmap): Promise<Blob | null> {
  if (typeof ImageBitmap === "undefined") return null;
  const bitmap =
    source instanceof ImageBitmap ? source : await createImageBitmap(source);

  // The source bitmap is transferred to the compression worker, so it must not
  // be closed here. Only a bitmap this function decoded itself is closed.
  const ownsBitmap = !(source instanceof ImageBitmap);

  try {
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.7),
    );
  } catch {
    return null;
  } finally {
    if (ownsBitmap) bitmap.close();
  }
}

function AddSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-lg bg-accent-blue px-3 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Adding…" : "Add"}
    </button>
  );
}

export function CatalogShell({
  initialCategories,
  loadError = null,
  readOnly = false,
  initialPhotos,
  initialProducts,
}: {
  initialCategories: Category[];
  loadError?: string | null;
  /** Customer view: no editing UI of any kind. */
  readOnly?: boolean;
  /** Preloaded photos per category (used in read-only mode). */
  initialPhotos?: Record<string, CatalogPhoto[]>;
  /** Preloaded products per category (used in read-only mode). */
  initialProducts?: Record<string, Product[]>;
}) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [activeId, setActiveId] = useState<string | null>(
    initialCategories[0]?.id ?? null,
  );

  // Photos are stored against the category they belong to, so a stale list can
  // never be shown against a newly selected category.
  const [photosState, setPhotosState] = useState<{
    id: string;
    list: CatalogPhoto[];
  } | null>(null);

  // Same shape and same reason for products: they belong to a category, and
  // these used to be a hardcoded constant with a client-side hide set.
  const [productsState, setProductsState] = useState<{
    id: string;
    list: Product[];
  } | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareLabel, setShareLabel] = useState("");
  const [shareLoading, setShareLoading] = useState(false);

  async function openShare() {
    setShareLoading(true);
    try {
      const info = await getMyShareToken();
      if (!info) {
        setCaptureError("Could not load your share link. Try again.");
        return;
      }
      setShareUrl(`${window.location.origin}/menu/${info.token}`);
      setShareLabel(info.mobileNumber);
      setShareOpen(true);
    } finally {
      setShareLoading(false);
    }
  }
  const deleteCategory = async (id: string) => {
    const result = await deleteCategoryAction(id);
    if (!result.ok) return;

    const next = categories.filter((c) => c.id !== id);
    setCategories(next);
    if (activeId === id) {
      setActiveId(next[0]?.id ?? null);
    }
  };

  /**
   * Removes a product for good.
   *
   * The row is dropped from the grid immediately so the tap feels instant,
   * then deleted server-side. If the delete fails the row is put back, so
   * the screen never claims a product is gone while the database still has
   * it and it reappears at the next login.
   */
  const removeProduct = useCallback(async (id: string) => {
    const previous = productsState;
    setProductsState((prev) =>
      prev ? { ...prev, list: prev.list.filter((p) => p.id !== id) } : prev,
    );
    setCategories((prev) =>
      prev.map((c) =>
        c.id === activeId ? { ...c, productCount: Math.max(0, c.productCount - 1) } : c,
      ),
    );

    const res = await deleteProductAction(id);
    if (!res.ok) {
      console.error("deleteProduct failed:", res.error);
      setProductsState(previous);
      setCategories((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, productCount: c.productCount + 1 }
            : c,
        ),
      );
      setCaptureError(res.error ?? "Could not delete that product.");
    }
  }, [productsState, activeId]);

  // Always open the live-camera dialog first: it tries the real device camera
  // via getUserMedia (works on Windows, Android Chrome and iOS Safari over
  // https/localhost). If the live camera cannot start, the dialog offers the
  // phone's native Camera app plus a file fallback — so a `capture` attribute
  // being ignored can never leave the user with only a file picker.
  const openCamera = () => {
    setCaptureError(null);
    setCameraOpen(true);
  };

  const active =
    categories.find((c) => c.id === activeId) ?? categories[0] ?? null;

  /**
   * Photos shown in the grid before their upload lands.
   *
   * Compressing and uploading a photo takes long enough that waiting for it
   * before showing anything reads as a broken camera. The thumbnail is placed
   * in the grid immediately from a local object URL, marked as saving, and
   * swapped for the stored photo when the request completes.
   */
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);

  // Object URLs are a real leak if they outlive the page, so every one is
  // revoked when its entry is replaced or removed.
  const dropPending = (id: string) => {
    setPendingPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  // A ref, not a dependency: the unmount cleanup must revoke the URLs that are
  // live at that moment, and a closure over the state would only ever see the
  // empty array it captured on mount.
  const pendingRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    pendingRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, []);

  const photos = readOnly
    ? (active ? (initialPhotos?.[active.id] ?? NO_PHOTOS) : NO_PHOTOS)
    : active && photosState?.id === active.id
      ? photosState.list
      : NO_PHOTOS;

  const products = readOnly
    ? (active ? (initialProducts?.[active.id] ?? NO_PRODUCTS) : NO_PRODUCTS)
    : active && productsState?.id === active.id
      ? productsState.list
      : NO_PRODUCTS;

  // Photos still uploading for the category on screen. Listed first so a new
  // capture is the first thing in the grid, ahead of anything already there.
  const pendingForActive =
    !readOnly && active
      ? pendingPhotos.filter((p) => p.categoryId === active.id)
      : NO_PENDING;

  // Products and photos for the selected category, fetched per selection.
  // Skipped entirely in read-only mode: photos arrive preloaded and a customer
  // view has no editing controls to trigger a product fetch.
  useEffect(() => {
    if (!active || readOnly) return;

    let cancelled = false;

    fetchPhotos(active.id)
      .then((list) => {
        if (!cancelled) setPhotosState({ id: active.id, list });
      })
      .catch((err) => {
        console.error("fetchPhotos failed:", err);
        if (!cancelled) {
          setPhotosState({ id: active.id, list: NO_PHOTOS });
          setCaptureError("Could not load photos for this category.");
        }
      });

    fetchProducts(active.id)
      .then((list) => {
        if (!cancelled) setProductsState({ id: active.id, list });
      })
      .catch((err) => {
        console.error("fetchProducts failed:", err);
        if (!cancelled) {
          setProductsState({ id: active.id, list: NO_PRODUCTS });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active, readOnly]);

  const [addState, addFormAction] = useActionState<
    CreateCategoryState,
    FormData
  >(createCategoryAction, {});

  // A successful create comes back on addState; fold it into the list once.
  const lastAddedId = useRef<string | null>(null);
  useEffect(() => {
    const created = addState.category;
    if (!created || created.id === lastAddedId.current) return;

    lastAddedId.current = created.id;
    setCategories((prev) => [...prev, created]);
    setActiveId(created.id);
    setAdding(false);
  }, [addState]);

  // Uploads still in flight. A capture session can shoot several photos back
  // to back, so this counts concurrent work rather than a single boolean --
  // closing the camera must not abandon an upload that is mid-request.
  const [pendingUploads, setPendingUploads] = useState(0);
  // Photos taken during the current session, for the counter in the camera UI.
  const [sessionShots, setSessionShots] = useState(0);

  async function handleCapture(source: Blob | ImageBitmap) {
    if (!active) return;
    // The category is pinned for the whole session: the camera covers the
    // screen, so it cannot change mid-session, but capture the id up front
    // rather than reading `active` again after two awaits.
    const categoryId = active.id;
    setCaptureError(null);
    setPendingUploads((n) => n + 1);

    // Placeholder in the grid straight away. An ImageBitmap has no URL, so it
    // is drawn to a small canvas for the preview only -- that is cheap compared
    // with the encode we are about to do, and it is the difference between the
    // shutter appearing to work and appearing to hang.
    const pendingId = `pending-${crypto.randomUUID()}`;
    let previewUrl: string | null = null;
    try {
      const preview = await renderPreview(source);
      if (preview) {
        previewUrl = URL.createObjectURL(preview);
        setPendingPhotos((prev) => [
          { id: pendingId, categoryId, url: previewUrl as string },
          ...prev,
        ]);
      }
    } catch {
      // A missing preview is cosmetic; the upload still proceeds.
    }

    try {
      const compressed = await compressToJpeg(source, MAX_PHOTO_BYTES);
      const file = new File([compressed.blob], "photo.jpg", {
        type: "image/jpeg",
      });

      const result = await uploadPhotoAction(
        categoryId,
        file,
        compressed.width,
        compressed.height,
      );

      if (!result.ok) {
        if (previewUrl) dropPending(pendingId);
        setCaptureError(result.error);
        return;
      }

      // Replace the local preview with the stored photo.
      if (previewUrl) dropPending(pendingId);

      setPhotosState((prev) => {
        const base = prev?.id === categoryId ? prev.list : NO_PHOTOS;
        return { id: categoryId, list: [result.photo, ...base] };
      });
      setCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, photoCount: c.photoCount + 1 } : c,
        ),
      );
      setSessionShots((n) => n + 1);
      // Deliberately NOT closing the camera: a session lasts until the user
      // taps Done, so several angles of one garment can be shot in a row.
    } catch (err) {
      console.error("handleCapture failed:", err);
      if (previewUrl) dropPending(pendingId);
      setCaptureError("Could not process that photo.");
    } finally {
      setPendingUploads((n) => Math.max(0, n - 1));
    }
  }

  // Leaves the camera and resets the per-session counter.
  const closeCamera = () => {
    setCameraOpen(false);
    setSessionShots(0);
    setPendingUploads(0);
  };

  const removePhoto = useCallback((id: string) => {
    setPhotosState((prev) =>
      prev ? { ...prev, list: prev.list.filter((p) => p.id !== id) } : prev,
    );

    deletePhotoAction(id).then((res) => {
      if (!res.ok) {
        console.error("deletePhoto failed:", res.error);
        setCaptureError(res.error ?? "Could not delete that photo.");
      }
    });
  }, []);

  // The count matches exactly what the grid below renders: products from the
  // database, plus captured photos, plus any still uploading.
  const displayedCount = products.length + photos.length + pendingForActive.length;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 flex h-[56px] items-center justify-between border-b border-hairline bg-white/95 px-4 backdrop-blur sm:h-[74px] sm:px-8">
        <span className="text-[22px] leading-none font-extrabold tracking-tight text-brand sm:text-[34px]">
          TDagent
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={openShare}
            disabled={shareLoading}
            className="flex touch-manipulation items-center gap-1.5 rounded-lg border border-accent-blue-soft bg-white px-3 py-2 text-[14px] font-semibold text-accent-blue transition-colors hover:bg-accent-blue/5 disabled:opacity-50 sm:text-[15px]"
          >
            <QrIcon className="h-[18px] w-[18px]" />
            {shareLoading ? "…" : "Share"}
          </button>
        )}
      </header>

      <div className="flex flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-hairline bg-white max-md:sticky max-md:top-[56px] max-md:z-20 max-md:min-h-0 max-md:gap-2 max-md:border-b max-md:bg-white/95 max-md:px-3 max-md:py-2 max-md:backdrop-blur md:min-h-[calc(100dvh-74px)] md:w-[283px] md:border-r md:px-5 md:py-6">
          <nav aria-label="Categories" className="min-w-0 flex-1 max-md:-mx-3 max-md:overflow-x-auto max-md:px-3">
            <ul className="no-scrollbar flex flex-col gap-1 max-md:flex-row max-md:gap-2">
              {categories.map((category) => {
                const isActive = category.id === active?.id;
                return (
                  <li key={category.id} className="flex items-center gap-1 max-md:shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveId(category.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex-1 rounded-lg px-4 py-3 text-left text-[17px] transition-colors max-md:whitespace-nowrap max-md:px-3 max-md:py-2 max-md:text-[15px] ${
                        isActive
                          ? "bg-brand-tint font-bold text-brand"
                          : "font-medium text-navy hover:bg-canvas"
                      }`}
                    >
                      {category.name}
                    </button>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => deleteCategory(category.id)}
                        aria-label={`Delete ${category.name}`}
                        className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-black/60 text-[9px] leading-none font-bold text-white hover:bg-black/80 active:bg-black/80 after:absolute after:-inset-3 after:content-[''] relative"
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {!readOnly && (
          <div className="mt-auto pt-8 max-md:mt-0 max-md:flex max-md:justify-center max-md:pt-1">
            {adding ? (
              <form action={addFormAction} className="max-md:w-full max-md:max-w-xs">
                <label htmlFor="newCategory" className="sr-only">
                  Category name
                </label>
                <input
                  id="newCategory"
                  name="name"
                  autoFocus
                  placeholder="Category name"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAdding(false);
                  }}
                  className="w-full rounded-lg border border-accent-blue-soft bg-white px-4 py-3 text-[17px] text-foreground outline-none placeholder:text-navy/35"
                />

                {addState.error && (
                  <p role="alert" className="mt-2 text-sm font-medium text-brand">
                    {addState.error}
                  </p>
                )}

                <div className="mt-2 flex gap-2">
                  <AddSubmitButton />
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="rounded-lg border border-card-border px-3 py-2.5 text-[15px] font-semibold text-navy transition-colors hover:bg-canvas"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent-blue-soft bg-white px-4 py-3 text-[17px] font-semibold text-accent-blue transition-colors hover:bg-accent-blue/5 max-md:w-auto max-md:px-5 max-md:py-2 max-md:text-[15px]"
              >
                <PlusIcon className="h-[18px] w-[18px] max-md:h-4 max-md:w-4" />
                Add Category
              </button>
            )}
          </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-4 sm:px-7 sm:py-7">
          {active ? (
            <>
              {loadError && (
                <p
                  role="alert"
                  className="mb-6 rounded-xl border border-brand/30 bg-brand-tint px-5 py-4 text-sm font-medium text-navy"
                >
                  {loadError}
                </p>
              )}

              <div className="flex items-start gap-3 sm:gap-6">
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[24px] leading-tight font-extrabold tracking-tight text-navy sm:text-[40px] sm:leading-none">
                    {active.name}
                  </h1>
                  <p className="mt-1.5 text-[15px] font-medium text-accent-blue sm:mt-3 sm:text-[17px]">
                    {displayedCount} products
                  </p>
                </div>

                {!readOnly && (
                  <>
                    <div className="flex flex-1 flex-col items-center gap-1.5">
                      <button
                        type="button"
                        onClick={openCamera}
                        aria-label={`Take a photo for ${active.name}`}
                        className="flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-full bg-accent-blue text-white shadow-lg transition-colors hover:bg-blue-700 active:scale-95 sm:h-[60px] sm:w-[60px] sm:shadow-none"
                      >
                        <CameraIcon className="h-6 w-6 sm:h-7 sm:w-7" />
                      </button>
                      <span className="text-center text-[12px] leading-tight font-semibold text-navy/60 sm:text-[13px]">
                        upload cloth photo
                      </span>
                    </div>

                    <div className="min-w-0 flex-1" aria-hidden="true" />
                  </>
                )}
              </div>

              {products.length + photos.length + pendingForActive.length > 0 ? (
                <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-7 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4">
                  {pendingForActive.map((p) => (
                    <PendingPhotoCard key={p.id} url={p.url} />
                  ))}
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onRemove={readOnly ? undefined : removeProduct}
                    />
                  ))}
                  {photos.map((photo) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      onRemove={readOnly ? undefined : removePhoto}
                    />
                  ))}
                </ul>
              ) : (
                <div className="mt-7 flex flex-col items-center gap-2 rounded-xl border border-dashed border-card-border bg-white/60 px-6 py-16 text-center">
                  <p className="text-[17px] font-bold text-navy">
                    No products in {active.name} yet
                  </p>
                  <p className="max-w-sm text-sm font-medium text-navy/55">
                    Use the blue camera button to add the first photo for this
                    category.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-card-border bg-white/60 px-6 py-16 text-center">
              <p className="text-[17px] font-bold text-navy">No categories yet</p>
              {loadError ? (
                <p className="mx-auto mt-2 max-w-md text-sm font-medium text-navy/55">
                  {loadError}
                </p>
              ) : (
                <p className="mt-2 text-sm font-medium text-navy/55">
                  Use &ldquo;Add Category&rdquo; to create your first one.
                </p>
              )}
            </div>
          )}
        </main>
      </div>

      {!readOnly && (
        <CameraCapture
          key={cameraOpen ? "camera-open" : "camera-closed"}
          open={cameraOpen}
          onClose={closeCamera}
          onCapture={handleCapture}
          busy={false}
          error={captureError}
          shots={sessionShots}
          uploading={pendingUploads}
        />
      )}

      <ShareQrModal
        key={shareOpen ? `share-open-${shareUrl}` : "share-closed"}
        open={shareOpen}
        url={shareUrl}
        label={shareLabel}
        onClose={() => setShareOpen(false)}
      />

    </div>
  );
}
