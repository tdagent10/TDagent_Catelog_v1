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
import { CATEGORIES, type Product } from "@/lib/catalog-data";
import type { CatalogPhoto, Category } from "@/lib/catalog-types";
import {
  createCategoryAction,
  deleteCategoryAction,
  deletePhotoAction,
  fetchPhotos,
  uploadPhotoAction,
  type CreateCategoryState,
} from "@/app/actions/catalog";
import { PhotoCard, ProductCard } from "./product-card";
import { CameraCapture } from "./camera-capture";
import { ShareQrModal } from "./share-qr-modal";
import { getMyShareToken } from "@/app/actions/share";
import { CameraIcon, PlusIcon, QrIcon } from "./icons";

/** Placeholder products the UI ships with, keyed by category slug. */
const PLACEHOLDER_PRODUCTS: Record<string, Product[]> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.products]),
);

const NO_PHOTOS: CatalogPhoto[] = [];

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
}: {
  initialCategories: Category[];
  loadError?: string | null;
  /** Customer view: no editing UI of any kind. */
  readOnly?: boolean;
  /** Preloaded photos per category (used in read-only mode). */
  initialPhotos?: Record<string, CatalogPhoto[]>;
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
  const [hiddenPlaceholders, setHiddenPlaceholders] = useState<Set<string>>(
    new Set(),
  );

  const deleteCategory = async (id: string) => {
    const result = await deleteCategoryAction(id);
    if (!result.ok) return;

    const next = categories.filter((c) => c.id !== id);
    setCategories(next);
    if (activeId === id) {
      setActiveId(next[0]?.id ?? null);
    }
  };

  const removePlaceholder = (name: string) => {
    setHiddenPlaceholders((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

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

  const photos = readOnly
    ? (active ? (initialPhotos?.[active.id] ?? NO_PHOTOS) : NO_PHOTOS)
    : active && photosState?.id === active.id
      ? photosState.list
      : NO_PHOTOS;

  // Photos for the selected category, fetched per selection.
  // Skipped entirely in read-only mode: photos arrive preloaded.
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

  async function handleCapture(source: Blob) {
    if (!active) return;
    // The category is pinned for the whole session: the camera covers the
    // screen, so it cannot change mid-session, but capture the id up front
    // rather than reading `active` again after two awaits.
    const categoryId = active.id;
    setCaptureError(null);
    setPendingUploads((n) => n + 1);

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
        setCaptureError(result.error);
        return;
      }

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

  const placeholders = active ? PLACEHOLDER_PRODUCTS[active.slug] : undefined;
  const visiblePlaceholders = (placeholders ?? []).filter(
    (p) => !hiddenPlaceholders.has(p.name),
  );

  // The count matches exactly what the grid below renders: visible
  // placeholders plus captured photos.
  const displayedCount = visiblePlaceholders.length + photos.length;

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

              {visiblePlaceholders.length + photos.length > 0 ? (
                <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-7 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4">
                  {visiblePlaceholders.map((product) => (
                    <ProductCard
                      key={product.name}
                      product={product}
                      onRemove={readOnly ? undefined : removePlaceholder}
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
