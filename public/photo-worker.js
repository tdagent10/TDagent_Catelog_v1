/* Off-main-thread JPEG compression for captured catalog photos.
 *
 * Encoding is the slow part of taking a photo, and canvas.toBlob() blocks the
 * thread it runs on. On a phone that means the viewfinder freezes while the
 * encode loop runs, which reads as "the camera is broken". Doing it here keeps
 * the camera responsive.
 *
 * Protocol: post { bitmap, maxBytes, maxEdge }, get back
 * { blob, width, height, bytes } or { error }.
 *
 * The ImageBitmap is TRANSFERRED, so the caller's reference is detached on
 * success. The caller must not touch it afterwards.
 */

const START_QUALITY = 0.72;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.1;
const SHRINK_STEP = 0.8;
const MIN_EDGE = 120;
const MAX_ATTEMPTS = 14;

function toBlob(canvas, quality) {
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

/**
 * Re-encodes until it fits under maxBytes.
 *
 * Starts lower and steps wider than the old main-thread loop did (0.82 down to
 * 0.45 in 0.08 steps = six full-size encodes before any resize). A catalogue
 * photo at 0.72 usually lands under the cap on the first or second attempt, so
 * the common case is one encode instead of six.
 */
async function encode(bitmap, maxBytes, maxEdge) {
  let width = bitmap.width;
  let height = bitmap.height;

  const longest = Math.max(width, height);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("OffscreenCanvas 2D unavailable");

  let quality = START_QUALITY;
  let best = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    canvas.width = width;
    canvas.height = height;

    // JPEG has no alpha; paint white so transparent PNGs do not turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await toBlob(canvas, quality);
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
    throw new Error("Photo could not be reduced enough.");
  }
  return best;
}

self.onmessage = async (event) => {
  const { bitmap, maxBytes, maxEdge, id } = event.data;
  try {
    const result = await encode(bitmap, maxBytes, maxEdge);
    // Close only after every drawImage is done with it.
    bitmap.close();
    self.postMessage({ id, ok: true, ...result });
  } catch (err) {
    try {
      bitmap.close();
    } catch {
      /* already closed */
    }
    self.postMessage({ id, ok: false, error: String(err && err.message) || "encode failed" });
  }
};
