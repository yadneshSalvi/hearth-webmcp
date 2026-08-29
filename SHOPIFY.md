# SHOPIFY.md — the Shopify contract (seeder, snapshot, route handlers, cart, checkout)

Store: **`hearth-studio.myshopify.com`** (development store, plan "Basic (test)", USD, US). Storefront API
**2026-07**. Headless channel storefront "Hearth". Brand shown to humans: **Hearth Studio**.

## 0. Secrets and where they may be used

| `.env` key | Used by | Never in |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | server + scripts (public value, fine to expose as `NEXT_PUBLIC_…` if ever needed) | — |
| `SHOPIFY_STOREFRONT_PUBLIC_TOKEN` | route handlers (`app/api/shop/*`, `app/api/cart`) | client bundle (we proxy through route handlers) |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | route handlers (preferred for server calls; adds buyer-IP forwarding) | client bundle |
| `SHOPIFY_ADMIN_TOKEN` | `scripts/shopify/*` only (seeding) | app code, route handlers, client |
| `SHOPIFY_API_VERSION` | everywhere (`2026-07`) | — |
| `SHOPIFY_STOREFRONT_PASSWORD` | `app/api/cart` (returned inside `get_checkout_link` results) and `app/checkout` helper | client bundle at build time |

Rule: only `process.env.*` reads in server files (`app/api/**`, `scripts/**`, `src/shopify/server.ts`).
`src/shopify/client.ts` (browser) talks only to our own `/api/*` routes.

## 1. Product data model (Admin seeding → Storefront reads)

One Shopify product per catalog item. **Handle = catalog id** (`sofa-endre`). Title = display name.
`productType` = category (`sofa|armchair|bed|wardrobe|table|desk|chair|shelf|tv-unit|rug|floor-lamp|table-lamp|plant|decor`).
`tags` = style tags (`scandinavian`, `japandi`, `mid-century`, `rustic`, `modern`, `coastal`) + `hearth`.
`vendor` = `Hearth Studio`. Status ACTIVE. One product option **Colorway**; one variant per colorway, price
identical across variants unless the source says otherwise; SKU `<handle>-<colorway>`; `inventoryPolicy: CONTINUE`
(never blocks checkout), `requiresShipping: true`, weight 0.

**Metafields** (namespace `hearth`, definitions created with storefront access `PUBLIC_READ`):

| key | type | example |
|---|---|---|
| `dims_cm` | `json` | `{"w":220,"d":95,"h":85}` |
| `category` | `single_line_text_field` | `sofa` |
| `style_tags` | `list.single_line_text_field` | `["scandinavian","modern"]` |
| `glb_url` | `url` | `https://hearth.yadneshsalvi.com/assets/glb/sofa-endre.glb` |
| `colorways` | `json` | `[{"id":"oak","name":"Oak","hex":"#D9C4A3"},…]` |
| `clearance_front_cm` | `number_integer` | `75` |
| `seat_count` | `number_integer` | `3` |
| `against_wall` | `boolean` | `true` |

Images: one beauty render per product (`/api/render` capture at 1200×900, clay material, golden-hour rig, plaster
background) uploaded via `productCreateMedia` / staged uploads; alt text = product name.

**Source of truth for the catalog** is `data/catalog.source.ts` (60–80 items curated from CC0 GLB sets; fields =
`CatalogItem` in SCENE_SCHEMA.md + `price`, `description ≤ 200 chars`). The seeder pushes it; the snapshot pulls back.

## 2. Seeder (`scripts/shopify/seed.ts`, Admin GraphQL `2026-07`, idempotent)

1. `verify` — `shop{name}`, `publications` (expect Hearth = `gid://shopify/Publication/311694131475`), scopes.
2. **Delete every pre-existing product** that is not tagged `hearth` (the store was created with sample data:
   snowboards, gift card, 1 ARCHIVED + 1 DRAFT) — `productDelete` in a loop with pagination.
3. Ensure metafield definitions above exist (`metafieldDefinitionCreate`, `access.storefront: PUBLIC_READ`), ownerType `PRODUCT`.
4. Upsert products by handle: `productSet` (2026-07 synchronous mode) with options/variants/metafields/tags; then
   media upload if missing; then `publishablePublish` to the Hearth publication (**without this the Storefront API
   returns nothing**) and also to Online Store (harmless).
5. Verify via the **Storefront** API (public token) that `products(first: 100)` returns every handle, with metafields.
6. Write `data/catalog.snapshot.json` (`§4`) — committed to the repo so browse/preview work offline and instantly.

Other scripts: `scripts/shopify/verify.ts` (step 1 + 5 only), `scripts/shopify/thumbs.ts` (renders + uploads images),
`scripts/shopify/reset.ts` (deletes `hearth`-tagged products; asks for `--yes`).
Locations (both active): `gid://shopify/Location/114892898579` (Shop location), `gid://shopify/Location/114892931347`.

## 3. Route handlers (all server-side, JSON, never cached unless stated)

| Route | Method | Body / query | Returns |
|---|---|---|---|
| `/api/shop/search` | `GET` | `q, category, max_price, max_w, max_d, style, colorway, limit` | `{ products: CatalogProduct[] }` from Storefront `products(query:)`; falls back to the snapshot on any error with `source:"snapshot"` |
| `/api/shop/product` | `GET` | `handle` | `{ product: CatalogProduct }` |
| `/api/cart` | `GET` | `id` | `{ cart: Cart }` (`cart(id)`) |
| `/api/cart` | `POST` | `{ op:"create"|"add"|"remove"|"set", cartId?, lines:[{variantId, quantity}] \| [{id, merchandiseId?, quantity}] \| lineIds }` | `{ cart: Cart }` (`cartCreate` / `cartLinesAdd` / `cartLinesRemove` / `cartLinesUpdate`) |
| `/api/checkout` | `GET` | `cartId` | `{ checkoutUrl, storePassword }` |
| `/api/render` | `GET` | `catalogId, colorway` | HTML page that renders one product for headless capture (scripts only) |

`Cart` = `{ id, checkoutUrl, lines:[{ id, variantId, handle, title, colorway, quantity, unitUsd, lineUsd }], subtotalUsd, count }`.
`CatalogProduct` = `CatalogItem` + `{ handle, price, variants:[{ id, colorway, price, available }], imageUrl? }`.

Cart id is kept in `localStorage["hearth.cartId"]`; a `404`/`null` cart → create a new one. Every cart mutation
is optimistic in the store, reconciled from the response, and marked `pending` while in flight; on network failure
the tool returns `unavailable` and the cart panel shows "Shopify offline — retry".

## 4. Snapshot (`data/catalog.snapshot.json`)
```ts
{ generatedAt: string; storeDomain: string; apiVersion: "2026-07";
  products: (CatalogItem & { handle: string; price: number; description: string;
             variants: { id: string; colorway: string; price: number }[]; imageUrl?: string })[] }
```
Loaded at build time into `src/shopify/snapshot.ts`; the client searches it locally (`fit.ts` filters) and the
server route also uses it as the fallback and for fit metadata not worth fetching live.

## 5. Storefront API query shapes (2026-07)

```graphql
# search
query Search($q: String!, $first: Int!) {
  products(first: $first, query: $q, sortKey: RELEVANCE) { nodes {
    id handle title productType tags vendor description(truncateAt: 200)
    priceRange { minVariantPrice { amount currencyCode } }
    featuredImage { url(transform: { maxWidth: 800 }) altText }
    variants(first: 12) { nodes { id title availableForSale price { amount } selectedOptions { name value } } }
    dims: metafield(namespace: "hearth", key: "dims_cm") { value }
    colorways: metafield(namespace: "hearth", key: "colorways") { value }
    clearance: metafield(namespace: "hearth", key: "clearance_front_cm") { value }
    seats: metafield(namespace: "hearth", key: "seat_count") { value }
    glb: metafield(namespace: "hearth", key: "glb_url") { value }
    againstWall: metafield(namespace: "hearth", key: "against_wall") { value }
  } }
}
# `query` grammar: `product_type:sofa tag:japandi variants.price:<800 title:*desk*`
# product by handle
query Product($handle: String!) { product(handle: $handle) { …same fields… } }
# cart
mutation CartCreate($lines: [CartLineInput!]) { cartCreate(input: { lines: $lines }) { cart { ...CartFields } userErrors { field message } } }
mutation CartAdd($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { message } } }
mutation CartRemove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ...CartFields } userErrors { message } } }
mutation CartUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { message } } }
query Cart($id: ID!) { cart(id: $id) { ...CartFields } }
fragment CartFields on Cart { id checkoutUrl totalQuantity
  cost { subtotalAmount { amount currencyCode } }
  lines(first: 50) { nodes { id quantity cost { totalAmount { amount } }
    merchandise { ... on ProductVariant { id title price { amount } selectedOptions { name value } product { handle title } } } } } }
```
Endpoint: `POST https://${SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`,
headers `Content-Type: application/json`, `X-Shopify-Storefront-Access-Token: <public>` (or
`Shopify-Storefront-Private-Token: <private>` + `Shopify-Storefront-Buyer-IP`). Retry once on 429/5xx.

## 6. Checkout on a password-protected development store (verified facts)

- The dev-store password wall **also gates `checkoutUrl`** (`/checkouts/cn/…` → `302 /password`). The toggle
  cannot be disabled on dev stores.
- `POST https://hearth-studio.myshopify.com/password` with form field `password=<pw>` (no CSRF, no session) →
  `302 /` and sets `_shopify_essential` (`SameSite=Lax; HttpOnly; Secure; Max-Age=1y`). With it, `checkoutUrl` → 200.
- `return_to`/`checkout_url` params are ignored; the browser lands on `/`.

**What we ship (both):**
1. **Agent path** — `get_checkout_link` returns `{ checkout_url, store_password, note }`; the agent tells the human.
2. **Human path** — the Cart panel's **Checkout** button, in this order:
   1. `window.open("", "hearth-shop")` **synchronously on the click**, so the popup rides the click's transient
      activation (the awaited `/api/checkout` round-trip below would otherwise lose it and be blocked);
   2. `await /api/checkout` for `{ checkoutUrl, storePassword }` — never from the bundle;
   3. a top-level `<form method="post" action="https://…/password" target="hearth-shop">` with hidden `password`,
      submitted into that window (the Lax cookie is sent on the top-level GET; it lasts a year, so later clicks go
      straight to checkout);
   4. ≈1 s later `target.location.replace(checkoutUrl)` — the same window is *navigated*, not opened a second time.
      `window.open(url, name, "noopener")` cannot be used here: per spec a non-empty target name is treated as
      `_blank` when `noopener` is set, which would abandon the window the password cookie was set in.
   The panel then shows the checkout URL as an `<a target="_blank" rel="noopener noreferrer">` plus
   "Store password: •••• (copy)", which is the whole flow when a popup blocker refuses the window.
   The **Checkout** button is only enabled when the studio is on the live client (`src/shopify/select.ts`);
   on the local catalog it is disabled and says why, because there is no real `checkoutUrl` to open.
Test payment: **Bogus Gateway**, card number `1` = success (`2` decline, `3` error), any future expiry, any CVV.

## 7. Cart ↔ scene linking rules (used by tools 9, 13, 14, 25, 27, 30)
- A cart line may be linked to one placed item (`Furniture.shopifyVariantId` + `cartLineId` in the store).
- `set_colorway` on a linked item → `cartLinesUpdate` to the matching variant.
- `remove_furniture` on a linked item → `cartLinesRemove` and `cart_line_removed:true`.
- `update_cart add {item}` links the line; `update_cart add {product}` creates an unlinked line.
- Budget: `meta.budgetUsd` (human sets it in the Cart panel; optional). `remaining_usd = budget − subtotal`.

## 8. Known store facts
Publications: Hearth `gid://shopify/Publication/311694131475` · Online Store `…311690789139` · Shop `…311690821907` · POS `…311690854675`.
Shipping (from test data): Domestic Standard $8 / Standard $0 (conditional) / Express $15; International $0/$30.
Sample variant for smoke tests until seeding: `gid://shopify/ProductVariant/54626021114131` ("The Complete Snowboard", $699.95).
