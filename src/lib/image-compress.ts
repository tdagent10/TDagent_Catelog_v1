/** Hard ceiling for a captured photo. 200 KiB. */
export const MAX_PHOTO_BYTES = 200 * 1024;

/** Longest edge kept. The grid renders ~300px cards, so this is already generous. */
const MAX_EDGE = 1600;

const START_QUALITY = 0.72;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.1;
const SHRINK_STEP = 0.8;
const MIN_EDGE = 120;
const MAX_ATTEMPTS = 14;

export type CompressedPhoto = {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
};

/**
 * A single reused worker.
 *
 * Kept alive between photos so the second and later captures skip worker
 * startup entirely, which matters when shooting a burst.
 */
let worker: Worker | null = null;
let workerUnavailable = false;
let nextJobId = 0;

function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (typeof Worker === "undefined") return null;
  // OffscreenCanvas is what actually moves the encode off the main thread.
  if (typeof OffscreenCanvas === "undefined") return null;

  if (worker) return worker;

  try {
    worker = new Worker("/photo-worker.js");
    // A failure here (404, CSP, syntax) permanently disables the worker path so
    // we stop paying for a broken instance on every capture.
    worker.addEventListener("error", () => {
      workerUnavailable = true;
      worker = null;
    });
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function compressInWorker(
  instance: Worker,
  bitmap: ImageBitmap,
  maxBytes: number,
): Promise<CompressedPhoto> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return;
      instance.removeEventListener("message", onMessage);
      if (event.data.ok) {
        const { blob, width, height, bytes } = event.data;
        resolve({ blob, width, height, bytes });
      } else {
        reject(new Error(event.data.error || "Could not encode the photo."));
      }
    };

    instance.addEventListener("message", onMessage);

    // Transfer ownership of the bitmap: zero-copy, and the caller's reference
    // is detached. Safe because callers hand over a bitmap they just created.
    try {
      instance.postMessage({ id, bitmap, maxBytes, maxEdge: MAX_EDGE }, [bitmap]);
    } catch (err) {
      instance.removeEventListener("message", onMessage);
      reject(err instanceof Error ? err : new Error("Could not start the encoder."));
    }
  });
}

/**
 * Main-thread fallback for browsers without OffscreenCanvas.
 *
 * Same convergence as the worker, so output quality is comparable; it is just
 * slow enough to be visible as a stutter.
 */
async function compressOnMainThread(
  bitmap: ImageBitmap,
  maxBytes: number,
): Promise<CompressedPhoto> {
  let width = bitmap.width;
  let height = bitmap.height;

  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  let quality = START_QUALITY;
  let best: CompressedPhoto | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) break;

    if (blob.size <= maxBytes) {
      return { blob, width, height, bytes: blob.size };
    }

    best = { blob, width, height, bytes: blob.size };

    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
    } else {
      const nextW = Math.round(width * SHRINK_STEP);
      const nextH = Math.round(height * SHRINK_STEP);
      if (nextW < MIN_EDGE || nextH < MIN_EDGE) break;
      width = nextW;
      height = nextH;
      quality = 0.65;
    }
  }

  if (!best) throw new Error("Could not encode the photo.");
  if (best.bytes > maxBytes) {
    throw new Error(
      `Photo could not be reduced below ${Math.round(maxBytes / 1024)}KB.`,
    );
  }
  return best;
}

async function toBitmap(source: Blob | ImageBitmap): Promise<ImageBitmap> {
  if (typeof ImageBitmap === "undefined") {
    throw new Error("This browser cannot read the captured frame.");
  }
  if (source instanceof ImageBitmap) return source;
  return createImageBitmap(source);
}

/**
 * Re-encodes an image as JPEG until it fits under `maxBytes`.
 *
 * Accepts a Blob (file picker) or an ImageBitmap (live camera frame). JPEG
 * rather than the original format, which also strips EXIF/GPS metadata -
 * useful when photos are taken on a shop floor.
 *
 * NOTE: an ImageBitmap passed in is transferred to the worker and is detached
 * afterwards. Do not reuse it.
 */
export async function compressToJpeg(
  source: Blob | ImageBitmap,
  maxBytes: number = MAX_PHOTO_BYTES,
): Promise<CompressedPhoto> {
  const bitmap = await toBitmap(source);
  const instance = getWorker();

  if (instance) {
    try {
      return await compressInWorker(instance, bitmap, maxBytes);
    } catch (err) {
      // The worker already closed the bitmap on its own error path, so there
      // is nothing to clean up and nothing left to retry with.
      throw err instanceof Error ? err : new Error("Could not encode the photo.");
    }
  }

  try {
    return await compressOnMainThread(bitmap, maxBytes);
  } finally {
    bitmap.close();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
