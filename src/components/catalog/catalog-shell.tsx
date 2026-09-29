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
  fetchCategoryContent,
  uploadPhotosAction,
  type CreateCategoryState,
} from "@/app/actions/catalog";
import { PendingPhotoCard, PhotoCard, ProductCard } from "./product-card";
import type { CategoryContent } from "@/app/actions/catalog";
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

  /**
   * Category content cache, keyed by category id, and the single source of
   * truth for what a category contains.
   *
   * Products and photos used to live in separate per-category state, which
   * meant every mutation had to update a list AND survive the next re-seed
   * from the network. Reading from one cache means a delete or a new capture
   * cannot be silently undone by a later fetch.
   *
   * State rather than a ref: it is read while rendering, and React forbids
   * reading a ref during render. Updates copy the Map, which is cheap at this
   * size (one entry per category) and gives a fresh reference to re-render on.
   */
  const [contentCache, setContentCache] = useState<Map<string, CategoryContent>>(
    () => new Map(),
  );

  /** Replaces a category's content. */
  const writeCache = (id: string, content: CategoryContent) => {
    setContentCache((prev) => {
      if (prev.get(id) === content) return prev;
      return new Map(prev).set(id, content);
    });
  };

  /** Applies a change to one category's cached content. */
  const patchCache = (
    id: string,
    patch: (content: CategoryContent) => CategoryContent,
  ) => {
    setContentCache((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const updated = patch(existing);
      if (updated === existing) return prev;
      return new Map(prev).set(id, updated);
    });
  };

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
  const removeProduct = useCallback(
    async (id: string) => {
      if (!activeId) return;
      const previous = contentCache.get(activeId);
      if (!previous) return;

      patchCache(activeId, (c) => ({
        ...c,
        products: c.products.filter((p) => p.id !== id),
      }));
      setCategories((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, productCount: Math.max(0, c.productCount - 1) }
            : c,
        ),
      );

      const res = await deleteProductAction(id);
      if (!res.ok) {
        console.error("deleteProduct failed:", res.error);
        writeCache(activeId, previous);
        setCategories((prev) =>
          prev.map((c) =>
            c.id === activeId ? { ...c, productCount: c.productCount + 1 } : c,
          ),
        );
        setCaptureError(res.error ?? "Could not delete that product.");
      }
    },
    [activeId, contentCache],
  );

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

  const activeContent = active ? contentCache.get(active.id) : undefined;

  const photos = readOnly
    ? (active ? (initialPhotos?.[active.id] ?? NO_PHOTOS) : NO_PHOTOS)
    : (activeContent?.photos ?? NO_PHOTOS);

  const products = readOnly
    ? (active ? (initialProducts?.[active.id] ?? NO_PRODUCTS) : NO_PRODUCTS)
    : (activeContent?.products ?? NO_PRODUCTS);

  // Photos still uploading for the category on screen. Listed first so a new
  // capture is the first thing in the grid, ahead of anything already there.
  const pendingForActive =
    !readOnly && active
      ? pendingPhotos.filter((p) => p.categoryId === active.id)
      : NO_PENDING;

  /**
   * Loads the selected category and warms its neighbours.
   *
   * One request for the category on screen, then the ones beside it are
   * fetched while the browser is idle. Tapping through the sidebar is the
   * normal way to use this screen, and on mobile data every uncached category
   * is a visible wait -- prefetching makes those instant without paying for
   * every category up front.
   */
  useEffect(() => {
    if (!active || readOnly) return;

    let cancelled = false;

    // Ids already resolved, so a re-run caused by the cache itself changing
    // does not re-fetch what it just stored.
    const loaded = new Set(contentCache.keys());

    const load = (id: string) =>
      fetchCategoryContent(id)
        .then((content) => {
          if (cancelled) return;
          writeCache(id, content);
        })
        .catch((err) => {
          console.error("fetchCategoryContent failed:", err);
          if (cancelled || id !== active.id) return;
          writeCache(id, { products: [], photos: [] });
          setCaptureError("Could not load this category.");
        });

    if (!loaded.has(active.id)) {
      load(active.id);
    }

    const index = categories.findIndex((c) => c.id === active.id);
    const neighbours = [
      categories[index - 1]?.id,
      categories[index + 1]?.id,
    ].filter((id): id is string => !!id && !loaded.has(id));

    if (neighbours.length > 0) {
      const warm = () => neighbours.forEach(load);
      // Safari only picked up requestIdleCallback in 16.4, so the timeout path
      // is still the common one on phones.
      const idle = window.requestIdleCallback;
      if (typeof idle === "function") {
        const handle = idle(warm, { timeout: 2500 });
        return () => {
          cancelled = true;
          window.cancelIdleCallback(handle);
        };
      }
      const timer = window.setTimeout(warm, 400);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [active, readOnly, categories, contentCache]);

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

  // Uploads still in flight, including anything compressed but not yet
  // flushed. Closing the camera must not abandon one, so this drives Done.
  const [pendingUploads, setPendingUploads] = useState(0);
  // Photos added during the current session, for the counter in the camera UI.
  const [sessionShots, setSessionShots] = useState(0);

  /**
   * Photos compressed and waiting to be sent.
   *
   * A rapid burst accumulates here and leaves as one batch, so shooting six
   * photos costs one metadata round trip rather than six. The delay is what
   * makes the batching work: a photo captured while the previous batch is in
   * flight joins the next one for free.
   */
  type ReadyUpload = {
    categoryId: string;
    pendingId: string;
    previewUrl: string | null;
    file: File;
    width: number;
    height: number;
  };

  const readyQueueRef = useRef<ReadyUpload[]>([]);
  const flushingRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);

  /**
   * Batch ceiling.
   *
   * Next.js caps a Server Action request body at 1MB by default. Photos are up
   * to 200KB each, so a batch has to stay well under that or the request is
   * rejected outright and the whole burst is lost. Roughly three max-size
   * photos fit; in practice these are 20-100KB, so a batch carries many more.
   */
  const MAX_BATCH_BYTES = 640 * 1024;
  const MAX_BATCH_COUNT = 12;

  /**
   * Sends everything currently queued as one batch.
   *
   * A plain function rather than a useCallback: it is only ever called from
   * event handlers, never handed to a memoised child, so memoising it would
   * only add dependency bookkeeping. The mutual recursion between this and
   * scheduleFlush runs through refs, which keeps both stable.
   */
  async function flushUploads() {
    if (flushingRef.current) return;
    const queued = readyQueueRef.current;
    if (queued.length === 0) return;

    readyQueueRef.current = [];
    flushingRef.current = true;

    // A session is normally one category, but grouping keeps a single RPC call
    // per category even if the selection ever spans two.
    const byCategory = new Map<string, ReadyUpload[]>();
    for (const item of queued) {
      const list = byCategory.get(item.categoryId);
      if (list) list.push(item);
      else byCategory.set(item.categoryId, [item]);
    }

    try {
      for (const [categoryId, items] of byCategory) {
        const { photos, errors } = await uploadPhotosAction(
          categoryId,
          items.map((i) => ({
            file: i.file,
            width: i.width,
            height: i.height,
          })),
        );

        if (photos.length > 0) {
          // Reversed so the earliest photo of the batch ends up first, which
          // is the order list_products returns (newest capture first).
          const added = photos.map((p) => p.photo).reverse();
          patchCache(categoryId, (c) => ({
            ...c,
            photos: [...added, ...c.photos],
          }));
          setCategories((prev) =>
            prev.map((c) =>
              c.id === categoryId
                ? { ...c, photoCount: c.photoCount + photos.length }
                : c,
            ),
          );
          setSessionShots((n) => n + photos.length);
        }

        items.forEach((item) => {
          if (item.previewUrl) dropPending(item.pendingId);
        });
        setPendingUploads((n) => Math.max(0, n - items.length));

        if (errors.length > 0) setCaptureError(errors[0]);
      }
    } catch (err) {
      console.error("flushUploads failed:", err);
      queued.forEach((item) => {
        if (item.previewUrl) dropPending(item.pendingId);
      });
      setPendingUploads((n) => Math.max(0, n - queued.length));
      setCaptureError("Could not save the photos. Please try again.");
    } finally {
      flushingRef.current = false;
      // Anything that arrived mid-flight goes out as the next batch.
      if (readyQueueRef.current.length > 0) scheduleFlush();
    }
  }

  /** Queues a flush, collapsing a burst into one batch. */
  function scheduleFlush() {
    if (flushingRef.current || flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flushUploads();
    }, 150);
  }

  /** Sends a photo immediately, bypassing the batching delay. */
  function flushNow() {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    void flushUploads();
  }

  // A timer left running after the camera closes would be a stray async
  // update; clear it on unmount.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  /**
   * Accepts one photo from either source and queues it.
   *
   * Not async: the picker calls this once per selected file in a tight loop,
   * and the shutter must return to ready immediately, so nothing here waits.
   */
  function handleCapture(source: Blob | ImageBitmap) {
    if (!active) return;
    // The category is pinned for the whole session: the camera covers the
    // screen, so it cannot change mid-session, but capture the id up front
    // rather than reading `active` again after two awaits.
    const categoryId = active.id;
    setCaptureError(null);
    setPendingUploads((n) => n + 1);

    const pendingId = `pending-${crypto.randomUUID()}`;

    // Placeholder in the grid straight away. An ImageBitmap has no URL, so it
    // is drawn to a small canvas for the preview only -- that is cheap next to
    // the encode we are about to do, and it is the difference between the
    // shutter appearing to work and appearing to hang.
    let previewUrl: string | null = null;
    void renderPreview(source)
      .then((preview) => {
        if (!preview) return;
        previewUrl = URL.createObjectURL(preview);
        const url = previewUrl;
        setPendingPhotos((prev) => [
          { id: pendingId, categoryId, url },
          ...prev,
        ]);
      })
      .catch(() => {
        // A missing preview is cosmetic; the upload still proceeds.
      })
      .finally(() => {
        void compressToJpeg(source, MAX_PHOTO_BYTES)
          .then((compressed) => {
            const item: ReadyUpload = {
              categoryId,
              pendingId,
              previewUrl,
              file: new File([compressed.blob], "photo.jpg", {
                type: "image/jpeg",
              }),
              width: compressed.width,
              height: compressed.height,
            };
            readyQueueRef.current.push(item);

            // Flush straight away once a batch is full, otherwise let the
            // short timer gather whatever else is on its way.
            const queued = readyQueueRef.current;
            const bytes = queued.reduce((sum, i) => sum + i.file.size, 0);
            if (bytes >= MAX_BATCH_BYTES || queued.length >= MAX_BATCH_COUNT) {
              flushNow();
            } else {
              scheduleFlush();
            }
          })
          .catch((err) => {
            console.error("compress failed:", err);
            if (previewUrl) dropPending(pendingId);
            setPendingUploads((n) => Math.max(0, n - 1));
            setCaptureError("Could not process that photo.");
          });
      });
  }

  // Leaves the camera. Anything already compressed is sent on the way out so
  // the grid is complete the moment the camera closes, and photos still being
  // compressed land as they finish -- the shell stays mounted either way.
  const closeCamera = () => {
    setCameraOpen(false);
    setSessionShots(0);
    flushNow();
  };

  const removePhoto = useCallback(
    (id: string) => {
      if (!activeId) return;
      const previous = contentCache.get(activeId);
      if (!previous) return;

      patchCache(activeId, (c) => ({
        ...c,
        photos: c.photos.filter((p) => p.id !== id),
      }));
      setCategories((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, photoCount: Math.max(0, c.photoCount - 1) }
            : c,
        ),
      );

      deletePhotoAction(id).then((res) => {
        if (!res.ok) {
          console.error("deletePhoto failed:", res.error);
          writeCache(activeId, previous);
          setCategories((prev) =>
            prev.map((c) =>
              c.id === activeId ? { ...c, photoCount: c.photoCount + 1 } : c,
            ),
          );
          setCaptureError(res.error ?? "Could not delete that photo.");
        }
      });
    },
    [activeId, contentCache],
  );

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
