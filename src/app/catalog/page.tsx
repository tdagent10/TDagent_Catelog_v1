import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CatalogShell } from "@/components/catalog/catalog-shell";
import { fetchCategories } from "@/app/actions/catalog";
import type { Category } from "@/lib/catalog-types";

export default async function CatalogPage() {
  const jar = await cookies();
  if (!jar.get("tdagent_user")?.value) {
    redirect("/");
  }

  // Rendered on the server so the sidebar is correct on first paint. If the
  // database is not set up yet, show that plainly instead of crashing.
  let categories: Category[] = [];
  let loadError: string | null = null;

  try {
    categories = await fetchCategories();
  } catch (err) {
    console.error("fetchCategories failed:", err);
    loadError =
      "Could not load categories from the database. If you have not run the migrations yet, apply supabase/migrations/0001_app_users.sql and 0002_catalog.sql in the Supabase SQL editor.";
  }

  return <CatalogShell initialCategories={categories} loadError={loadError} />;
}
