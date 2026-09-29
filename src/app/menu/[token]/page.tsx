import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CatalogShell } from "@/components/catalog/catalog-shell";
import { createServerClient } from "@/lib/supabase/server";
import { mapCategory, mapPhoto, mapProduct } from "@/lib/catalog-types";
import type { CatalogPhoto, Category, Product } from "@/lib/catalog-types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const url = `/menu/${token}`;
  return {
    title: "TDagent",
    description: "Browse the catalog — products and categories.",
    openGraph: {
      type: "website",
      siteName: "TDagent",
      title: "TDagent",
      description: "Browse the catalog — products and categories.",
      url,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "TDagent — retail shop catalog",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "TDagent",
      description: "Browse the catalog — products and categories.",
      images: ["/og.png"],
    },
  };
}

type Row = Record<string, unknown>;
const asRows = (data: unknown): Row[] =>
  Array.isArray(data) ? (data as Row[]) : [];

// Share tokens are 12 URL-safe chars; reject anything else before querying.
const TOKEN_RE = /^[A-Za-z0-9\-_]{8,32}$/;

/**
 * A shared catalog only changes when its owner edits it, and the link gets
 * handed to customers opening it on mobile data. Caching at the CDN means a
 * repeat visit is served from the edge rather than rebuilding the page and
 * re-querying the database.
 */
export const revalidate = 60;

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const supabase = createServerClient();

  // One call for the whole catalog.
  //
  // This used to resolve the token, list categories, then make two calls per
  // category -- 25 round trips for a 12-category catalog, each with its own
  // latency. That is the single biggest cost when a customer opens a shared
  // link on a phone, and it is now one request.
  const { data, error } = await supabase.rpc("get_public_catalog", {
    p_token: token,
  });
  if (error) {
    console.error("get_public_catalog failed:", error);
    notFound();
  }

  // A scalar jsonb function comes back from PostgREST as the bare value, not
  // wrapped in a row object like a `returns table` function is. Reading it as
  // rows yields nothing, which would render an empty catalog rather than an
  // error, so both shapes are accepted.
  const payload = (
    data && typeof data === "object" && !Array.isArray(data)
      ? data
      : asRows(data)[0]
  ) as Record<string, unknown> | undefined;

  if (!payload) notFound();

  const rawCategories = Array.isArray(payload.categories)
    ? (payload.categories as Row[])
    : [];

  const categories: Category[] = rawCategories.map((c) =>
    mapCategory({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sort_order: c.sortOrder,
      // Counts are unused in the read-only view; the shell derives its own
      // display count from the preloaded lists.
      product_count: 0,
      photo_count: 0,
    }),
  );

  const photoEntries: [string, CatalogPhoto[]][] = [];
  const productEntries: [string, Product[]][] = [];

  rawCategories.forEach((c) => {
    const id = String(c.id);
    photoEntries.push([
      id,
      (Array.isArray(c.photos) ? (c.photos as Row[]) : []).map((p) =>
        mapPhoto({
          ...p,
          storage_path: p.storagePath,
          created_at: p.createdAt,
        }),
      ),
    ]);
    productEntries.push([
      id,
      (Array.isArray(c.products) ? (c.products as Row[]) : []).map((p) =>
        mapProduct({ ...p, sort_order: p.sortOrder }),
      ),
    ]);
  });

  return (
    <CatalogShell
      initialCategories={categories}
      initialPhotos={Object.fromEntries(photoEntries)}
      initialProducts={Object.fromEntries(productEntries)}
      readOnly
    />
  );
}
