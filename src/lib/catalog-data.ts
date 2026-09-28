import type { GarmentSpec } from "@/components/catalog/product-image";

export type Product = {
  name: string;
  spec: GarmentSpec;
};

export type Category = {
  slug: string;
  label: string;
  products: Product[];
};

const item = (name: string, spec: GarmentSpec): Product => ({ name, spec });

export const CATEGORIES: Category[] = [
  {
    slug: "t-shirts",
    label: "T-Shirts",
    products: [
      item("Essential Black Tee", { base: "#1b1b1d" }),
      item("Off-White Essential Tee", { base: "#f6f5f1", detail: "small-graphic", accent: "#2b2b2b" }),
      item("Navy Classic Tee", { base: "#1c3059" }),
      item("Sand Graphic Tee", { base: "#d8c3a4", detail: "graphic", accent: "#3d3226" }),
      item("Black Contrast Polo", { base: "#1b1b1d", collar: "polo", accent: "#f2f2f2" }),
      item("Forest Stripe Polo", { base: "#14512f", collar: "polo", detail: "stripes", accent: "#cfe6d6" }),
      item("Sky Blue Tee", { base: "#c6dcf6", detail: "small-graphic", accent: "#2b4a75" }),
      item("White Print Tee", { base: "#f7f6f3", detail: "graphic", accent: "#1f2937" }),
      item("Heather Grey Tee", { base: "#b6b6b8", detail: "small-graphic", accent: "#1f2937" }),
      item("Black Logo Tee", { base: "#1a1a1c", detail: "graphic", accent: "#f5f5f5" }),
      item("Olive Pocket Tee", { base: "#7c8b69", detail: "pocket" }),
      item("Crimson Pocket Tee", { base: "#b42020", detail: "small-graphic", accent: "#f3e6e6" }),
    ],
  },
  {
    slug: "shirts",
    label: "Shirts",
    products: [
      item("White Oxford Shirt", { base: "#f4f5f7", collar: "polo", accent: "#d7dbe2" }),
      item("Blue Check Shirt", { base: "#a9c4e4", detail: "stripes", accent: "#e8f0fa" }),
      item("Grey Linen Shirt", { base: "#c3c7cc" }),
      item("Sky Casual Shirt", { base: "#d3e6f7" }),
      item("Sand Shirt", { base: "#dccdb6" }),
      item("Forest Shirt", { base: "#2f5d45" }),
    ],
  },
  {
    slug: "polo-shirts",
    label: "Polo Shirts",
    products: [
      item("Navy Polo", { base: "#1b2b4d", collar: "polo", accent: "#e8e8e8" }),
      item("White Polo", { base: "#f6f6f4", collar: "polo", accent: "#cfd4dc" }),
      item("Maroon Polo", { base: "#7d2230", collar: "polo", accent: "#f0dcdc" }),
      item("Green Stripe Polo", { base: "#1d5c3a", collar: "polo", detail: "stripes", accent: "#d6ebdf" }),
      item("Grey Polo", { base: "#9ea3a8", collar: "polo", accent: "#e2e5e8" }),
    ],
  },
  {
    slug: "jeans",
    label: "Jeans",
    products: [
      item("Classic Blue Jeans", { base: "#3c5a8a" }),
      item("Light Wash Jeans", { base: "#6f8fc0" }),
      item("Dark Indigo Jeans", { base: "#24365c" }),
      item("Black Jeans", { base: "#24252a" }),
    ],
  },
  {
    slug: "trousers",
    label: "Trousers",
    products: [
      item("Charcoal Trousers", { base: "#3c4048" }),
      item("Khaki Trousers", { base: "#c2ab84" }),
      item("Navy Trousers", { base: "#283a5c" }),
      item("Stone Trousers", { base: "#b9b4a9" }),
    ],
  },
  {
    slug: "shorts",
    label: "Shorts",
    products: [
      item("Denim Shorts", { base: "#4a6b9c" }),
      item("Black Shorts", { base: "#26272b" }),
      item("Olive Shorts", { base: "#7a8467" }),
      item("Grey Shorts", { base: "#a8adb2" }),
    ],
  },
  {
    slug: "suits",
    label: "Suits",
    products: [
      item("Navy Two-Piece Suit", { base: "#22304e" }),
      item("Charcoal Suit", { base: "#41454d" }),
      item("Grey Suit", { base: "#8d9299" }),
    ],
  },
  {
    slug: "jackets",
    label: "Jackets",
    products: [
      item("Denim Jacket", { base: "#3f5f8f" }),
      item("Black Bomber", { base: "#1e1f23" }),
      item("Olive Field Jacket", { base: "#6f7a5c" }),
      item("Tan Jacket", { base: "#c19a6b" }),
    ],
  },
  {
    slug: "hoodies",
    label: "Hoodies",
    products: [
      item("Black Hoodie", { base: "#1c1d21" }),
      item("Grey Hoodie", { base: "#9ba0a6" }),
      item("Navy Hoodie", { base: "#25375c" }),
      item("Sand Hoodie", { base: "#d5c3a8" }),
    ],
  },
  {
    slug: "sweaters",
    label: "Sweaters",
    products: [
      item("Cream Knit Sweater", { base: "#e6e0d4" }),
      item("Forest Sweater", { base: "#2c5740" }),
      item("Charcoal Sweater", { base: "#4a4e56" }),
      item("Rust Sweater", { base: "#a5552f" }),
    ],
  },
  {
    slug: "tracksuits",
    label: "Tracksuits",
    products: [
      item("Navy Tracksuit", { base: "#243459" }),
      item("Black Tracksuit", { base: "#1f2024" }),
      item("Grey Tracksuit", { base: "#8f949b" }),
    ],
  },
  {
    slug: "caps-hats",
    label: "Caps & Hats",
    products: [
      item("Black Cap", { base: "#1d1e22" }),
      item("Navy Cap", { base: "#26375c" }),
      item("Khaki Cap", { base: "#c0ab88" }),
      item("White Cap", { base: "#f1f1ef" }),
    ],
  },
  {
    slug: "accessories",
    label: "Accessories",
    products: [
      item("Leather Belt", { base: "#4a342a" }),
      item("Wool Scarf", { base: "#8d3f3f" }),
      item("Canvas Tote", { base: "#ddd6c6" }),
      item("Beanie", { base: "#33506e" }),
    ],
  },
];

export const DEFAULT_CATEGORY = CATEGORIES[0].slug;
