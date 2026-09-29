import { createClient } from "@supabase/supabase-js";

export class SupabaseNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseNotConfiguredError";
  }
}

/** True when a value is absent or still the placeholder from .env.example. */
function isUnset(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  return (
    v === "" ||
    v === "your-anon-public-key-here" ||
    v.startsWith("your-") ||
    v.startsWith("<") ||
    v.includes("REPLACE") ||
    v.includes("your-project")
  );
}

/**
 * Server-side Supabase client.
 *
 * Uses the public `anon` key. All write access is funnelled through the
 * `login_or_signup` Postgres function, which is SECURITY DEFINER, so the
 * browser never talks to the table directly.
 *
 * The client is built once and reused: constructing one per request opened a
 * fresh connection pool for every server action, which is wasteful as soon as
 * more than one user is hitting the app.
 *
 * The factory is a separate non-generic function on purpose. Typing the cache
 * as `ReturnType<typeof createClient>` resolves that generic against its
 * constraint rather than its default, which collapses `.rpc()` to a signature
 * accepting no arguments at all.
 */
function buildClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

let cachedClient: ReturnType<typeof buildClient> | null = null;

export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (isUnset(url) || isUnset(key)) {
    throw new SupabaseNotConfiguredError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.",
    );
  }

  if (cachedClient) return cachedClient;

  cachedClient = buildClient();
  return cachedClient;
}

export const PHOTO_BUCKET = "product-photos";

/** Public URL for an object in the photos bucket, at original size. */
export function publicPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (isUnset(base)) {
    throw new SupabaseNotConfiguredError("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${storagePath}`;
}

/**
 * A right-sized copy of a photo, via Supabase's image transform.
 *
 * Catalog photos are captured at up to 1600px and land around 100-200KB, but
 * the grid renders them in cards a few hundred pixels wide. Shipping the whole
 * file to a phone meant ~200KB per card to draw something 250px across; this
 * brings the same image down to roughly 15-25KB.
 *
 * Both dimensions are passed deliberately. `width` alone resizes one axis and
 * leaves the other untouched, which stretches a 1024x768 photo into 400x768.
 * Pairing it with `height` and `resize=cover` reproduces exactly what
 * `object-cover` does in CSS, so the crop served is the crop seen.
 */
export function publicPhotoUrlSized(
  storagePath: string,
  width: number,
  height: number,
  quality = 62,
): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (isUnset(base)) {
    throw new SupabaseNotConfiguredError("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }
  const params = new URLSearchParams({
    width: String(Math.max(1, Math.round(width))),
    height: String(Math.max(1, Math.round(height))),
    resize: "cover",
    quality: String(quality),
  });
  return `${base}/storage/v1/render/image/public/${PHOTO_BUCKET}/${storagePath}?${params}`;
}
