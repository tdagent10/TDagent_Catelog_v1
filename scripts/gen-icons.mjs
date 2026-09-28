// One-off icon generator: renders TDagent brand icons from inline SVG.
// Run: node scripts/gen-icons.mjs
// Outputs: public/icons/*.png (manifest), src/app/apple-icon.png (iOS),
//          src/app/icon.png (modern favicon).
import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
await mkdir(outDir, { recursive: true });

const RED = "#e8112d";

const base = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="230" fill="${RED}"/>
  <text x="512" y="668" font-family="Arial, Helvetica, sans-serif" font-size="470" font-weight="900" fill="#ffffff" text-anchor="middle">TD</text>
</svg>`;

// Maskable: full-bleed background, key art inside the central safe zone.
const maskable = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${RED}"/>
  <rect x="212" y="212" width="600" height="600" rx="140" fill="#ffffff"/>
  <text x="512" y="622" font-family="Arial, Helvetica, sans-serif" font-size="300" font-weight="900" fill="${RED}" text-anchor="middle">TD</text>
</svg>`;

const jobs = [
  { name: "icon-192.png", size: 192, svg: base(1024) },
  { name: "icon-512.png", size: 512, svg: base(1024) },
  { name: "maskable-512.png", size: 512, svg: maskable(1024) },
];

for (const { name, size, svg } of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(outDir, name));
  console.log("wrote", name);
}

// Social share card (1200x630): brand red, app name, tagline.
const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${RED}"/>
  <circle cx="1050" cy="80" r="220" fill="#ffffff" opacity="0.08"/>
  <circle cx="120" cy="580" r="160" fill="#000000" opacity="0.10"/>
  <text x="100" y="300" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="900" fill="#ffffff">TDagent</text>
  <text x="100" y="390" font-family="Arial, Helvetica, sans-serif" font-size="48" fill="#ffffff" opacity="0.92">Retail shop catalog</text>
  <text x="100" y="460" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#ffffff" opacity="0.75">Browse products &amp; categories</text>
</svg>`;
await sharp(Buffer.from(og)).resize(1200, 630).png().toFile(path.join(root, "public", "og.png"));
console.log("wrote public/og.png");

// iOS home-screen icon (180x180, no transparency issues: full rounded mark).
await sharp(Buffer.from(base(1024)))
  .resize(180, 180)
  .png()
  .toFile(path.join(root, "src", "app", "apple-icon.png"));
console.log("wrote src/app/apple-icon.png");

// Modern favicon.
await copyFile(path.join(outDir, "icon-192.png"), path.join(root, "src", "app", "icon.png"));
console.log("wrote src/app/icon.png");
