import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { CatalogItem } from "../../src/engine/types";
import type { StorefrontProductNode } from "../../src/shopify/mapping";
import { SEARCH_PRODUCTS_QUERY } from "../../src/shopify/queries";
import { adminGraphql } from "./admin";
import { storefrontGraphql } from "./storefront";

export const HEARTH_PUBLICATION_ID = "gid://shopify/Publication/311694131475";
export const ONLINE_STORE_PUBLICATION_ID = "gid://shopify/Publication/311690789139";

export const METAFIELD_DEFINITIONS = [
  { key: "dims_cm", name: "Dimensions (cm)", type: "json" },
  { key: "category", name: "Hearth category", type: "single_line_text_field" },
  { key: "style_tags", name: "Hearth style tags", type: "list.single_line_text_field" },
  { key: "glb_url", name: "GLB asset URL", type: "url" },
  { key: "colorways", name: "Hearth colorways", type: "json" },
  { key: "clearance_front_cm", name: "Front clearance (cm)", type: "number_integer" },
  { key: "seat_count", name: "Seat count", type: "number_integer" },
  { key: "against_wall", name: "Against wall", type: "boolean" },
] as const;

interface UserError {
  field?: string[] | null;
  message: string;
}

interface AdminProduct {
  id: string;
  handle: string;
  title: string;
  tags: string[];
  status: string;
}

interface ProductConnectionPage {
  products: {
    nodes: AdminProduct[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
}

export interface AdminPreflight {
  shopName: string;
  publications: Array<{ id: string; name: string }>;
  scopes: string[];
}

export interface DefinitionStatus {
  key: string;
  type: string;
  storefront: string | null;
}

export interface SeededProduct {
  id: string;
  handle: string;
  variants: Array<{ id: string; title: string; price: string; sku?: string | null }>;
  hasMedia: boolean;
}

function assertNoUserErrors(label: string, errors: UserError[]): void {
  if (errors.length === 0) return;
  const detail = errors.map(({ field, message }) => `${field?.join(".") ?? "input"}: ${message}`).join("; ");
  throw new Error(`${label} failed: ${detail}`);
}

export async function adminPreflight(): Promise<AdminPreflight> {
  const data = await adminGraphql<{
    shop: { name: string };
    publications: { nodes: Array<{ id: string; name: string }> };
    currentAppInstallation: { accessScopes: Array<{ handle: string }> };
  }>(`
    query SeedPreflight {
      shop { name }
      publications(first: 50) { nodes { id name } }
      currentAppInstallation { accessScopes { handle } }
    }
  `);
  const publications = data.publications.nodes;
  if (!publications.some(({ id }) => id === HEARTH_PUBLICATION_ID)) {
    throw new Error(`Required Hearth publication ${HEARTH_PUBLICATION_ID} was not found`);
  }
  if (!publications.some(({ id }) => id === ONLINE_STORE_PUBLICATION_ID)) {
    throw new Error(`Required Online Store publication ${ONLINE_STORE_PUBLICATION_ID} was not found`);
  }
  return {
    shopName: data.shop.name,
    publications,
    scopes: data.currentAppInstallation.accessScopes.map(({ handle }) => handle).sort(),
  };
}

export async function listAdminProducts(): Promise<AdminProduct[]> {
  const products: AdminProduct[] = [];
  let after: string | null = null;
  do {
    const data: ProductConnectionPage = await adminGraphql<ProductConnectionPage, { after: string | null }>(`
      query ProductsForSeed($after: String) {
        products(first: 100, after: $after, sortKey: ID) {
          nodes { id handle title tags status }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after });
    products.push(...data.products.nodes);
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor ?? null : null;
  } while (after);
  return products;
}

export async function deleteProducts(products: AdminProduct[], onProgress?: (done: number, total: number) => void): Promise<void> {
  for (const [index, product] of products.entries()) {
    const data = await adminGraphql<{
      productDelete: { deletedProductId?: string | null; userErrors: UserError[] };
    }, { input: { id: string } }>(`
      mutation DeleteProduct($input: ProductDeleteInput!) {
        productDelete(input: $input, synchronous: true) {
          deletedProductId
          userErrors { field message }
        }
      }
    `, { input: { id: product.id } });
    assertNoUserErrors(`Deleting ${product.handle}`, data.productDelete.userErrors);
    if (data.productDelete.deletedProductId !== product.id) {
      throw new Error(`Shopify did not confirm deletion of ${product.handle}`);
    }
    onProgress?.(index + 1, products.length);
  }
}

export async function definitionStatuses(): Promise<DefinitionStatus[]> {
  const data = await adminGraphql<{
    metafieldDefinitions: {
      nodes: Array<{ key: string; type: { name: string }; access: { storefront: string | null } }>;
    };
  }>(`
    query HearthMetafieldDefinitions {
      metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "hearth") {
        nodes { key type { name } access { storefront } }
      }
    }
  `);
  return data.metafieldDefinitions.nodes
    .map((definition) => ({ key: definition.key, type: definition.type.name, storefront: definition.access.storefront }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export async function ensureMetafieldDefinitions(): Promise<{ created: number; existing: number }> {
  const existing = await definitionStatuses();
  let created = 0;
  for (const definition of METAFIELD_DEFINITIONS) {
    const found = existing.find(({ key }) => key === definition.key);
    if (found) {
      if (found.type !== definition.type || found.storefront !== "PUBLIC_READ") {
        throw new Error(`Metafield hearth.${definition.key} exists with type/access ${found.type}/${found.storefront ?? "NONE"}`);
      }
      continue;
    }
    const data = await adminGraphql<{
      metafieldDefinitionCreate: { createdDefinition?: { id: string } | null; userErrors: UserError[] };
    }, { definition: Record<string, unknown> }>(`
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message }
        }
      }
    `, {
      definition: {
        namespace: "hearth",
        key: definition.key,
        name: definition.name,
        ownerType: "PRODUCT",
        type: definition.type,
        access: { storefront: "PUBLIC_READ" },
      },
    });
    assertNoUserErrors(`Creating metafield hearth.${definition.key}`, data.metafieldDefinitionCreate.userErrors);
    if (!data.metafieldDefinitionCreate.createdDefinition) {
      throw new Error(`Shopify omitted created definition hearth.${definition.key}`);
    }
    created += 1;
  }
  return { created, existing: METAFIELD_DEFINITIONS.length - created };
}

function productMetafields(item: CatalogItem): Array<Record<string, string>> {
  return [
    { namespace: "hearth", key: "dims_cm", type: "json", value: JSON.stringify(item.dims) },
    { namespace: "hearth", key: "category", type: "single_line_text_field", value: item.category },
    { namespace: "hearth", key: "style_tags", type: "list.single_line_text_field", value: JSON.stringify(item.styleTags) },
    { namespace: "hearth", key: "glb_url", type: "url", value: `https://hearth.yadneshsalvi.com${item.glb}` },
    { namespace: "hearth", key: "colorways", type: "json", value: JSON.stringify(item.colorways) },
    { namespace: "hearth", key: "clearance_front_cm", type: "number_integer", value: String(item.clearanceFront) },
    ...(item.seatCount === undefined ? [] : [{ namespace: "hearth", key: "seat_count", type: "number_integer", value: String(item.seatCount) }]),
    ...(item.againstWall === undefined ? [] : [{ namespace: "hearth", key: "against_wall", type: "boolean", value: String(item.againstWall) }]),
  ];
}

export async function upsertProduct(item: CatalogItem): Promise<SeededProduct> {
  const price = item.price ?? 0;
  const data = await adminGraphql<{
    productSet: {
      product?: {
        id: string;
        handle: string;
        media: { nodes: Array<{ id: string }> };
        variants: { nodes: Array<{ id: string; title: string; price: string; sku?: string | null }> };
      } | null;
      userErrors: UserError[];
    };
  }, { identifier: { handle: string }; input: Record<string, unknown> }>(`
    mutation UpsertHearthProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
      productSet(identifier: $identifier, input: $input, synchronous: true) {
        product {
          id
          handle
          media(first: 1) { nodes { id } }
          variants(first: 20) { nodes { id title price sku } }
        }
        userErrors { field message }
      }
    }
  `, {
    identifier: { handle: item.id },
    input: {
      handle: item.id,
      title: item.name,
      descriptionHtml: item.description ?? "",
      productType: item.category,
      tags: [...new Set(["hearth", ...item.styleTags])],
      vendor: "Hearth Studio",
      status: "ACTIVE",
      productOptions: [{
        name: "Colorway",
        position: 1,
        values: item.colorways.map(({ name }) => ({ name })),
      }],
      variants: item.colorways.map((colorway, index) => ({
        position: index + 1,
        optionValues: [{ optionName: "Colorway", name: colorway.name }],
        price: String(price),
        sku: `${item.id}-${colorway.id}`,
        inventoryPolicy: "CONTINUE",
        inventoryItem: {
          requiresShipping: true,
          tracked: false,
          measurement: { weight: { value: 0, unit: "KILOGRAMS" } },
        },
      })),
      metafields: productMetafields(item),
    },
  });
  assertNoUserErrors(`Upserting ${item.id}`, data.productSet.userErrors);
  const product = data.productSet.product;
  if (!product || product.handle !== item.id) throw new Error(`Shopify omitted product ${item.id} after productSet`);
  if (product.variants.nodes.length !== item.colorways.length) {
    throw new Error(`${item.id} has ${product.variants.nodes.length} variants; expected ${item.colorways.length}`);
  }
  for (const colorway of item.colorways) {
    const variant = product.variants.nodes.find(({ title }) => title.toLowerCase() === colorway.name.toLowerCase());
    if (!variant) throw new Error(`${item.id} is missing Admin variant ${colorway.name}`);
    if (variant.sku !== `${item.id}-${colorway.id}`) throw new Error(`${item.id}/${colorway.id} has an incorrect SKU`);
    if (Number(variant.price) !== price) throw new Error(`${item.id}/${colorway.id} has an incorrect price`);
  }
  return {
    id: product.id,
    handle: product.handle,
    variants: product.variants.nodes,
    hasMedia: product.media.nodes.length > 0,
  };
}

export async function publishProduct(productId: string): Promise<void> {
  const data = await adminGraphql<{
    publishablePublish: { userErrors: UserError[] };
  }, { id: string; input: Array<{ publicationId: string }> }>(`
    mutation PublishHearthProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }
  `, {
    id: productId,
    input: [
      { publicationId: HEARTH_PUBLICATION_ID },
      { publicationId: ONLINE_STORE_PUBLICATION_ID },
    ],
  });
  assertNoUserErrors(`Publishing ${productId}`, data.publishablePublish.userErrors);
}

export async function uploadProductImage(productId: string, imagePath: string, alt: string): Promise<void> {
  const file = await readFile(imagePath);
  const fileStats = await stat(imagePath);
  const staged = await adminGraphql<{
    stagedUploadsCreate: {
      stagedTargets?: Array<{
        url?: string | null;
        resourceUrl?: string | null;
        parameters: Array<{ name: string; value: string }>;
      }> | null;
      userErrors: UserError[];
    };
  }, { input: Array<Record<string, unknown>> }>(`
    mutation StageProductImage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      resource: "IMAGE",
      filename: basename(imagePath),
      mimeType: "image/png",
      httpMethod: "POST",
      fileSize: String(fileStats.size),
    }],
  });
  assertNoUserErrors(`Staging image for ${productId}`, staged.stagedUploadsCreate.userErrors);
  const target = staged.stagedUploadsCreate.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) throw new Error(`Shopify omitted staged upload target for ${productId}`);

  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append("file", new Blob([new Uint8Array(file)], { type: "image/png" }), basename(imagePath));
  const upload = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  if (!upload.ok) throw new Error(`Staged image upload for ${productId} returned HTTP ${upload.status}`);

  const created = await adminGraphql<{
    productCreateMedia: { media: Array<{ id: string }>; mediaUserErrors: UserError[] };
  }, { productId: string; media: Array<Record<string, string>> }>(`
    mutation CreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId,
    media: [{ originalSource: target.resourceUrl, alt, mediaContentType: "IMAGE" }],
  });
  assertNoUserErrors(`Creating media for ${productId}`, created.productCreateMedia.mediaUserErrors);
  if (created.productCreateMedia.media.length === 0) throw new Error(`Shopify omitted created media for ${productId}`);
}

export async function storefrontProducts(): Promise<StorefrontProductNode[]> {
  const data = await storefrontGraphql<{ products: { nodes: StorefrontProductNode[] } }, { q: string; first: number }>(
    SEARCH_PRODUCTS_QUERY,
    { q: "tag:hearth", first: 100 },
  );
  return data.products.nodes;
}

export async function storefrontShopName(): Promise<string> {
  const data = await storefrontGraphql<{ shop: { name: string } }>(`query StorefrontShop { shop { name } }`);
  return data.shop.name;
}
