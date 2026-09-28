# Retail catalog app

Login screen for a retail shop catalog. Next.js 16 (App Router) + Supabase.

## What this is right now

Two screens, matching the supplied designs:

- `/` — login. Mobile number only.
- `/catalog` — category sidebar, product count, and a product grid.

`/catalog` is guarded: without the `tdagent_user` cookie it redirects to `/`.

Product data is a hardcoded array in `src/lib/catalog-data.ts`. Categories are
clickable and switch the grid client-side.

**+ Add Category** is live. It reveals an inline text field (autofocused) with
Add/Cancel. Submitting with Enter works. The new category is written to the
database, appended to the sidebar, selected immediately, and shows an empty
state until you photograph something into it.

## Backend

Everything runs through Supabase: Postgres for data, Storage for photos.
`supabase/config.toml` is initialised, so the CLI can push the migrations.

## Per-user catalogs

Every mobile number gets its **own** catalog. Signing in shows only the
categories and photos belonging to that number — one shopkeeper never sees
another's data.

How it works:

- `categories`, `products` and `product_photos` each carry a `user_id` owner.
- The 13 built-in categories live on as ownerless **template** rows.
  `login_or_signup()` clones them into a personal catalog for every first-time
  signup (and repairs older accounts that predate catalogs).
- Every RPC takes the user id and filters by it. The app's server actions read
  that id from the `tdagent_user` session cookie, never from client input.
- Data created before per-user scoping was attributed to whoever had signed up
  most recently when it was created.

Caveat: the anon key is public by design, so anyone who knows another user's
random uuid *could* call the RPCs directly with it. The UI never exposes other
users' ids, which is sufficient for a shop-counter app but not for hostile
environments. Real row-level isolation would need Supabase Auth (JWT-based RLS)
instead of the cookie model.

## Customer QR sharing

Each user has a short share token (`app_users.share_token`, 12 URL-safe
chars, auto-generated). The **Share** button in the catalog header opens a
modal with a scannable QR plus **Download QR** (PNG) and **Copy link**.

Scanning opens `/menu/<token>`: a public, login-free, **view-only** catalog —
same categories and photos, but no × delete buttons, no camera, no Add
Category, no Share button. Unknown tokens 404. All photos are preloaded
server-side so the page needs no authenticated calls.

| Migration / RPC | Purpose |
| --- | --- |
| `0006_share_tokens.sql` | Token column + backfill, `resolve_share_token`, `get_my_share_token` |
| `resolve_share_token(text)` | Token → owner id; the share page's only entry point |
| `get_my_share_token(uuid)` | Signed-in shopkeeper reads their own token |

### Schema

| Migration | Contents |
| --- | --- |
| `0001_app_users.sql` | `app_users` table + `login_or_signup()` for mobile-only sign-in |
| `0002_catalog.sql` | `categories`, `products`, `product_photos`, the `product-photos` storage bucket, and RPCs |
| `0003/0004` | Fixed PL/pgSQL ambiguous-column errors in the RPCs |
| `0005_per_user_catalogs.sql` | Owner columns, template seeds, backfill, scoped RPCs |

The same access model throughout: RLS is enabled on every table and all traffic
goes through `SECURITY DEFINER` functions, so the public anon key cannot read or
write the tables directly.

### RPCs

| Function | Purpose |
| --- | --- |
| `login_or_signup(text)` | Find-or-create a customer by mobile number; provisions a personal catalog |
| `list_categories(uuid)` | That user's categories with product and photo counts |
| `create_category(uuid, text)` | Add a category, slugifying and de-duplicating the name |
| `delete_category(uuid, uuid)` | Remove a category (cascades) |
| `list_photos(uuid, uuid)` | Photos for a category, newest first |
| `add_photo(uuid, uuid, text, int, int, int)` | Record a stored photo; **rejects over 200KB** |
| `delete_photo(uuid, uuid)` | Remove a photo row and return its storage path |

### Server actions

`src/app/actions/catalog.ts` wraps those RPCs for the UI:
`fetchCategories`, `fetchPhotos`, `createCategoryAction`, `uploadPhotoAction`,
`deletePhotoAction`, `deleteCategoryAction`.

Photo upload flow: the browser compresses to under 200KB, the action writes the
file to the `product-photos` bucket, then records the row. If the row insert
fails the uploaded object is removed again, so storage and the table cannot
drift apart. The 200KB ceiling is enforced **server-side too**, so it holds
regardless of what a client sends.

### Applying the migrations

```bash
npx supabase login
npx supabase link --project-ref cjumdbkmqvwshgqoxtkg
npx supabase db push
```

Or paste the files into the Supabase SQL editor in numeric order
(`0001` → `0007`). All are idempotent.

Until they are applied, the catalog page renders a setup notice rather than
crashing.

## Deploying (Vercel + tdagent.tejendra1.com.np)

1. Push this folder to a GitHub repo, then import it in Vercel
   (framework preset: Next.js — no custom settings needed).
2. In Vercel → Project → Settings → Environment Variables, add:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Deploy. Then add the custom domain: Vercel → Project → Settings →
   Domains → add `tdagent.tejendra1.com.np`.
4. At your DNS provider for `tejendra1.com.np`, add:
   `CNAME tdagent → cname.vercel-dns.com`
   (Vercel shows the exact record to add — use theirs if it differs.)
5. Wait for DNS + Vercel's automatic HTTPS certificate, then open
   `https://tdagent.tejendra1.com.np` on the phones and Add to Home Screen.
   Download/print the share QRs **after** this so they encode the live domain.

Notes:

- PWA install and the live camera both require `https://` — Vercel provides
  it automatically with the custom domain.
- App updates are automatic: the service worker checks for a new version on
  load, hourly, and whenever the app returns to the foreground, then reloads
  into it. `/sw.js` is served with `max-age=0, must-revalidate` so updates
  are never stuck behind a cache. No action needed per deploy.

### Environment variables (required on the host)

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cjumdbkmqvwshgqoxtkg.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon public key (Dashboard → Project Settings → API) |

Both are `NEXT_PUBLIC_` and ship in the browser bundle by design. Never add the
`service_role` key — it bypasses all row-level security.

### Checklist before going live

- [ ] Migrations `0001`–`0007` applied (verify: `list_categories` exists and the
      `product-photos` bucket has a 200KB file size limit)
- [ ] Env vars set on the host
- [ ] Production build passes: `npm run build`
- [ ] Camera requires `https://` (or `localhost`): `getUserMedia` is blocked on
      plain `http://` LAN addresses. The native-camera fallback still works
      there, but the live viewfinder will not
- [ ] Share QRs encode the current origin — download/print them **after**
      deploying so they point at the live URL, not `localhost`
- [ ] Revoke any personal access tokens (`sbp_…`) created during setup

## PWA (Add to Home Screen)

The app is installable on Android and iOS:

- `src/app/manifest.ts` serves `/manifest.webmanifest` (standalone display,
  192 + 512 icons, maskable icon)
- `public/icons/` holds the generated brand icons; regenerate with
  `node scripts/gen-icons.mjs` (needs the `sharp` dev dependency)
- `public/sw.js` is a hand-rolled service worker: cache-first for build
  assets and product photos, network-first with cache fallback for pages —
  previously visited screens open offline. Server actions (POST) are never
  intercepted
- iOS gets `apple-touch-icon`, `mobile-web-app-capable` (plus the legacy
  Apple-prefixed flag), and fullscreen-capable web-app meta

Install: **Android** → Chrome menu → "Add to Home screen" (or "Install app").
**iPhone** → Safari Share button → "Add to Home Screen". Requires `https://`
(or `localhost`) — same requirement as the live camera. On the home screen the
app opens fullscreen, no browser chrome.

### What is still client-side

Built-in categories and the 12 placeholder T-Shirts come from
`src/lib/catalog-data.ts` and are drawn as SVG, not stored. Only
**user-added categories** and **captured photos** are persisted. Products
themselves have a table but no CRUD UI yet, so the `products` table is empty and
`product_count` reads 0 — the count on screen comes from the placeholder data.

## Camera

The blue camera button opens a capture dialog that adapts to the device, so the
same build works on a shop phone and on a desktop laptop.

**Live viewfinder** — used when a camera is reachable. Requests
`getUserMedia` with `facingMode: environment` (rear camera) and shows a live
`<video>` with a shutter button.

**Fallback buttons** — shown when the live camera cannot start, with the actual
reason rather than a generic message:

| Reason | Cause |
| --- | --- |
| insecure | Page is not on `https://` or `localhost` |
| denied | `NotAllowedError` — permission blocked |
| none | `NotFoundError` — no camera on the device |
| unsupported | No `navigator.mediaDevices` at all |

- **Open camera** — `<input type="file" capture="environment">`. On a phone this
  opens the device's own Camera app full screen, which is the most reliable path
  on a shop floor. Desktop browsers ignore `capture` and show a file picker.
- **Choose a file** — plain file input, no `capture`.

Captured photos are re-encoded as JPEG and appended to a **Captured photos**
strip at the bottom of the page, newest first, with a remove button on each.

### The 200KB cap

`src/lib/image-compress.ts` guarantees every photo is under **200 KiB**
(`MAX_PHOTO_BYTES`). It caps the long edge at 1600px, then walks JPEG quality
down from 0.82 to 0.45, shrinking the frame in 0.8 steps until the encoded blob
fits. Re-encoding as JPEG also strips EXIF/GPS metadata.

Verified against worst-case pure-random-noise images, which barely compress at
all:

| Source | Result | Size |
| --- | --- | --- |
| 4000×3000 noise | 1280×960 | 188.9 KB |
| 1920×1080 noise | 1024×576 | 199.5 KB |
| 8000×6000 noise | 1280×960 | 188.8 KB |

Real photographs compress far better than noise, so shop photos normally land
well under the cap at higher quality.

### Photos are persisted

Captured photos are uploaded to the `product-photos` storage bucket and recorded
in `product_photos`, so they survive a refresh and are shared across staff
devices. `list_photos(uuid)` fetches them per selected category.

### `getUserMedia` needs a secure context

The camera only works on `https://` or `localhost`. It will not work if you open
the app over a LAN IP like `http://192.168.x.x:3000`.

### Product images

`ProductImage` draws each garment as an inline SVG in the colours from the
design. The reference used photography of branded garments (Nike, Adidas,
Levi's, The North Face); those trademarks are deliberately not reproduced, so
the placeholders are neutral. Swap in real photos when you have them.

## Signup / login model

**There is no password and no OTP.** The user types a mobile number and taps
`Signup/Login`:

- number not in the database -> a row is created (signup)
- number already in the database -> the existing row's `last_login_at` is
  updated (login)

A `tdagent_user` httpOnly cookie is set to the user's `id`.

### Security warning

Anyone who knows a customer's mobile number can sign in as that customer. There
is no second factor of any kind. This is acceptable for a shop-counter or
internal staff device. It is **not** adequate for real customer accounts that
hold personal data. If you need real authentication later, add Supabase phone
OTP in front of this flow.

On success the action calls `redirect("/catalog")`. That call must stay
**outside** the surrounding `try`/`catch` — it signals by throwing
`NEXT_REDIRECT`, and a `catch` around it turns a successful login into an error
message.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file:

   ```bash
   cp .env.example .env.local
   ```

   Then fill in the anon key from Supabase Dashboard -> Project Settings -> API.
   The URL is already set for project `cjumdbkmqvwshgqoxtkg`.

3. Run the database migration. Either paste
   `supabase/migrations/0001_app_users.sql` into the Supabase SQL Editor, or use
   the CLI:

   ```bash
   supabase db push
   ```

4. Start the dev server:

   ```bash
   npm run dev
   ```

Until step 2 and 3 are done, the form validates the number but reports that the
app is not set up yet.

## Notes on the data model

All signup/login traffic goes through the `login_or_signup` Postgres function,
which is `SECURITY DEFINER`. RLS is enabled on `app_users` and the function is
the only thing granted execute access, so the public anon key cannot read the
full user table directly.
