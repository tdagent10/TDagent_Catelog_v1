/** Hard ceiling for a captured photo. 200 KiB. */
export const MAX_PHOTO_BYTES = 200 * 1024;

const MAX_EDGE = 1600;
const START_QUALITY = 0.82;
const MIN_QUALITY = 0.45;
const SHRINK_STEP = 0.8;
const MIN_EDGE = 120;

/**
 * Generous, because a full pass costs one down-step per attempt and a noisy
 * photo can need several shrink passes before it fits. The loop exits as soon
 * as the photo is under the cap.
 */
const MAX_ATTEMPTS = 60;

export type CompressedPhoto = {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Re-encodes an image as JPEG until it fits under `maxBytes`.
 *
 * Encoded as JPEG rather than kept in its original format, which also strips
 * EXIF/GPS metadata - useful when photos are taken on a shop floor.
 */
export async function compressToJpeg(
  source: Blob,
  maxBytes: number = MAX_PHOTO_BYTES,
): Promise<CompressedPhoto> {
  const bitmap = await createImageBitmap(source);

  let width = bitmap.width;
  let height = bitmap.height;

  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable.");
  }

  let quality = START_QUALITY;
  let best: CompressedPhoto | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    canvas.width = width;
    canvas.height = height;

    // JPEG has no alpha; paint white so transparent PNGs do not turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) break;

    if (blob.size <= maxBytes) {
      bitmap.close();
      return { blob, width, height, bytes: blob.size };
    }

    best = { blob, width, height, bytes: blob.size };

    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.08);
    } else {
      // Quality is spent; shrink the frame and try again from mid quality.
      const nextW = Math.round(width * SHRINK_STEP);
      const nextH = Math.round(height * SHRINK_STEP);
      if (nextW < MIN_EDGE || nextH < MIN_EDGE) break;
      width = nextW;
      height = nextH;
      quality = 0.7;
    }
  }

  bitmap.close();

  if (!best) throw new Error("Could not encode the photo.");

  // A 160px floor can still exceed the cap for a very noisy image. Give the
  // caller something rather than silently returning an oversized photo.
  if (best.bytes > maxBytes) {
    throw new Error(
      `Photo could not be reduced below ${Math.round(maxBytes / 1024)}KB.`,
    );
  }

  return best;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
