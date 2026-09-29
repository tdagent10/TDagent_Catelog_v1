"use server";

import { cookies } from "next/headers";
import { createServerClient, PHOTO_BUCKET } from "@/lib/supabase/server";
import {
  mapCategory,
  mapPhoto,
  mapProduct,
  type CatalogPhoto,
  type Category,
  type Product,
} from "@/lib/catalog-types";
import { MAX_PHOTO_BYTES } from "@/lib/image-compress";

export type CatalogState = {
  error?: string;
  message?: string;
};

export type CreateCategoryState = CatalogState & { category?: Category };

/** The browser compresses first; this is the authoritative check. */
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

type Row = Record<string, unknown>;

const asRows = (data: unknown): Row[] =>
  Array.isArray(data) ? (data as Row[]) : [];

/**
 * Reads a jsonb value out of an RPC result.
 *
 * A Postgres function returning a scalar `jsonb` comes back from PostgREST as
 * the bare value, not wrapped in a row object like a `returns table` function
 * is. Treating it as rows silently yields nothing, which shows up as an empty
 * catalog rather than an error, so both shapes are handled here.
 */
function asJsonObject(data: unknown): Row {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Row;
  }
  return asRows(data)[0] ?? {};
}

/** Reads a json array out of an RPC result, tolerating either shape. */
function asJsonArray(value: unknown): Row[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // Some builds nest the payload under the function's return name.
    const nested = (value as Row)[Object.keys(value as Row)[0]];
    if (Array.isArray(nested)) return nested as Row[];
    return [];
  }
  return Array.isArray(value) ? (value as Row[]) : [];
}

/**
 * The signed-in user's id, taken from the session cookie set at login. Every
 * catalog call is scoped through this, so the client never supplies a user id
 * and one mobile number cannot reach another's catalog through the UI.
 */
async function requireUserId(): Promise<string> {
  const jar = await cookies();
  const id = jar.get("tdagent_user")?.value;
  if (!id) throw new Error("Not signed in.");
  return id;
}

export async function fetchCategories(): Promise<Category[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("list_categories", {
    p_user_id: await requireUserId(),
  });
  if (error) throw new Error(error.message);
  return asRows(data).map(mapCategory);
}

export type CategoryContent = {
  products: Product[];
  photos: CatalogPhoto[];
};

/**
 * A category's products and photos in one round trip.
 *
 * These used to be two separate calls fired together, which cost two network
 * round trips on every category switch -- the dominant cost of browsing a
 * catalog on mobile data. The server returns both halves as one jsonb value.
 */
export async function fetchCategoryContent(
  categoryId: string,
): Promise<CategoryContent> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("get_category_content", {
    p_user_id: await requireUserId(),
    p_category_id: categoryId,
  });
  if (error) throw new Error(error.message);

  const row = asJsonObject(data);
  if (!row.category) return { products: [], photos: [] };

  return {
    products: asJsonArray(row.products).map(mapProduct),
    photos: asJsonArray(row.photos).map(mapPhoto),
  };
}

export async function fetchProducts(categoryId: string): Promise<Product[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("list_products", {
    p_user_id: await requireUserId(),
    p_category_id: categoryId,
  });
  if (error) throw new Error(error.message);
  return asRows(data).map(mapProduct);
}

/**
 * Deletes a product row for good.
 *
 * This used to be a client-side useState toggle, so a "deleted" sample came
 * straight back on the next login. Now the row is gone for good.
 */
export async function deleteProductAction(
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerClient();

  const { error } = await supabase.rpc("delete_product", {
    p_user_id: await requireUserId(),
    p_id: productId,
  });

  if (error) {
    console.error("delete_product failed:", error);
    return { ok: false, error: "Could not delete that product." };
  }

  return { ok: true };
}

export async function fetchPhotos(categoryId: string): Promise<CatalogPhoto[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("list_photos", {
    p_user_id: await requireUserId(),
    p_category_id: categoryId,
  });
  if (error) throw new Error(error.message);
  return asRows(data).map(mapPhoto);
}

export async function createCategoryAction(
  _prev: CreateCategoryState,
  formData: FormData,
): Promise<CreateCategoryState> {
  const name = String(formData.get("name") ?? "").trim();

  if (!name) return { error: "Enter a category name." };
  if (name.length > 60) return { error: "Keep the name under 60 characters." };

  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("create_category", {
    p_user_id: await requireUserId(),
    p_name: name,
  });

  if (error) {
    console.error("create_category failed:", error);
    return { error: "Could not add that category. Please try again." };
  }

  const row = asRows(data)[0];
  if (!row) return { error: "Could not add that category. Please try again." };

  return {
    message: `Added ${name}.`,
    category: mapCategory({ ...row, product_count: 0, photo_count: 0 }),
  };
}

export async function uploadPhotoAction(
  categoryId: string,
  file: File,
  width: number,
  height: number,
): Promise<{ ok: true; photo: CatalogPhoto } | { ok: false; error: string }> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: "Only JPEG, PNG or WebP photos are allowed." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      error: `Photo is ${Math.round(file.size / 1024)}KB, over the 200KB limit.`,
    };
  }

  const supabase = createServerClient();
  const userId = await requireUserId();
  const path = `${userId}/${categoryId}/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("photo upload failed:", uploadError);
    return { ok: false, error: "Could not save the photo. Please try again." };
  }

  const { data, error } = await supabase.rpc("add_photo", {
    p_user_id: userId,
    p_category_id: categoryId,
    p_storage_path: path,
    p_bytes: file.size,
    p_width: width,
    p_height: height,
  });

  if (error) {
    // Roll the object back so storage and the table cannot drift apart.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    console.error("add_photo failed:", error);
    return {
      ok: false,
      error: error.message.includes("200KB")
        ? "That photo is over the 200KB limit."
        : "Could not save the photo. Please try again.",
    };
  }

  const row = asRows(data)[0];
  if (!row) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return { ok: false, error: "Could not save the photo. Please try again." };
  }

  return { ok: true, photo: mapPhoto(row) };
}

export async function deletePhotoAction(
  photoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerClient();

  const { data, error } = await supabase.rpc("delete_photo", {
    p_user_id: await requireUserId(),
    p_id: photoId,
  });
  if (error) {
    console.error("delete_photo failed:", error);
    return { ok: false, error: "Could not delete that photo." };
  }

  const row = asRows(data)[0];
  const path = row?.storage_path ? String(row.storage_path) : null;

  if (path) {
    const { error: removeError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove([path]);
    if (removeError) {
      console.error("storage remove failed:", removeError);
    }
  }

  return { ok: true };
}

export async function deleteCategoryAction(
  categoryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServerClient();

  const userId = await requireUserId();

  // Collect photo paths first: the cascade removes the rows, after which the
  // paths are no longer readable.
  const { data: photos } = await supabase.rpc("list_photos", {
    p_user_id: userId,
    p_category_id: categoryId,
  });

  const { error } = await supabase.rpc("delete_category", {
    p_user_id: userId,
    p_id: categoryId,
  });
  if (error) {
    console.error("delete_category failed:", error);
    return { ok: false, error: "Could not delete that category." };
  }

  const paths = asRows(photos)
    .map((p) => p.storage_path)
    .filter((p): p is string => typeof p === "string");

  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove(paths);
    if (removeError) {
      console.error("storage remove failed:", removeError);
    }
  }

  return { ok: true };
}
