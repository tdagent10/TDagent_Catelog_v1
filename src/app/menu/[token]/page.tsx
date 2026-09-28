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

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const supabase = createServerClient();

  const { data: resolved } = await supabase.rpc("resolve_share_token", {
    p_token: token,
  });
  const owner = asRows(resolved)[0];
  if (!owner || typeof owner.user_id !== "string") notFound();

  const userId = owner.user_id as string;

  const { data: catData } = await supabase.rpc("list_categories", {
    p_user_id: userId,
  });
  const categories: Category[] = asRows(catData).map(mapCategory);

  // Preload every category's photos and products so the view-only page needs
  // no authenticated client calls at all.
  const [photoEntries, productEntries] = await Promise.all([
    Promise.all(
      categories.map(async (c) => {
        const { data } = await supabase.rpc("list_photos", {
          p_user_id: userId,
          p_category_id: c.id,
        });
        const photos: CatalogPhoto[] = asRows(data).map(mapPhoto);
        return [c.id, photos] as const;
      }),
    ),
    Promise.all(
      categories.map(async (c) => {
        const { data } = await supabase.rpc("list_products", {
          p_user_id: userId,
          p_category_id: c.id,
        });
        const products: Product[] = asRows(data).map(mapProduct);
        return [c.id, products] as const;
      }),
    ),
  ]);

  return (
    <CatalogShell
      initialCategories={categories}
      initialPhotos={Object.fromEntries(photoEntries)}
      initialProducts={Object.fromEntries(productEntries)}
      readOnly
    />
  );
}
