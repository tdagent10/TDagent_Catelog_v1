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
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (isUnset(url) || isUnset(key)) {
    throw new SupabaseNotConfiguredError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.",
    );
  }

  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const PHOTO_BUCKET = "product-photos";

/** Public URL for an object in the photos bucket. */
export function publicPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new SupabaseNotConfiguredError("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${storagePath}`;
}
