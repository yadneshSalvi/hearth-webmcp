import { access, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogSource } from "../../data/catalog.source";
import type { CatalogItem } from "../../src/engine/types";
import type { StorefrontProductNode } from "../../src/shopify/mapping";
import { storefrontConfig } from "./storefront";
import { confirmDestructive } from "./confirm";
import {
  adminPreflight,
  deleteProducts,
  ensureMetafieldDefinitions,
  listAdminProducts,
  publishProduct,
  storefrontProducts,
  uploadProductImage,
  upsertProduct,
} from "./operations";
import { runVerify } from "./verify";

interface SnapshotProduct extends CatalogItem {
  handle: string;
  price: number;
  variants: Array<{ id: string; colorway: string; price: number }>;
  imageUrl?: string;
}

function isHearth(tags: string[]): boolean {
  return tags.some((tag) => tag.toLowerCase() === "hearth");
}

function coreMetafieldsPresent(product: StorefrontProductNode): boolean {
  return Boolean(product.dims?.value && product.colorways?.value && product.clearance?.value && product.glb?.value);
}

async function waitForStorefront(expected: Set<string>): Promise<StorefrontProductNode[]> {
  let lastProducts: StorefrontProductNode[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastProducts = await storefrontProducts();
    const byHandle = new Map(lastProducts.map((product) => [product.handle, product]));
    const complete = [...expected].every((handle) => {
      const product = byHandle.get(handle);
      return product && coreMetafieldsPresent(product);
    });
    if (complete) return lastProducts;
    if (attempt < 19) await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  const received = new Set(lastProducts.map(({ handle }) => handle));
  const missing = [...expected].filter((handle) => !received.has(handle));
  throw new Error(`Storefront verification timed out; missing ${missing.length}: ${missing.slice(0, 5).join(", ")}`);
}

function snapshotProduct(item: CatalogItem, node: StorefrontProductNode): SnapshotProduct {
  const variants = item.colorways.map((colorway) => {
    const variant = node.variants.nodes.find((candidate) => {
      const option = candidate.selectedOptions.find(({ name }) => name.toLowerCase() === "colorway");
      return option?.value.toLowerCase() === colorway.name.toLowerCase();
    });
    if (!variant) throw new Error(`${item.id} is missing Storefront variant ${colorway.id}`);
    const price = Number(variant.price.amount);
    if (!Number.isFinite(price)) throw new Error(`${item.id}/${colorway.id} has an invalid price`);
    return { id: variant.id, colorway: colorway.id, price };
  });
  return {
    ...structuredClone(item),
    handle: item.id,
    price: item.price ?? 0,
    variants,
    ...(node.featuredImage?.url ? { imageUrl: node.featuredImage.url } : {}),
  };
}

async function writeSnapshot(nodes: StorefrontProductNode[]): Promise<void> {
  const config = storefrontConfig();
  if (config.version !== "2026-07") throw new Error(`Snapshot requires API 2026-07, received ${config.version}`);
  const byHandle = new Map(nodes.map((node) => [node.handle, node]));
  const products = catalogSource.map((item) => {
    const node = byHandle.get(item.id);
    if (!node) throw new Error(`Cannot snapshot missing Storefront product ${item.id}`);
    return snapshotProduct(item, node);
  }).sort((left, right) => left.handle.localeCompare(right.handle));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    storeDomain: config.domain,
    apiVersion: "2026-07" as const,
    products,
  };
  const target = resolve("data/catalog.snapshot.json");
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  await rename(temporary, target);
}

async function imageExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runSeed(args: string[] = process.argv.slice(2)): Promise<void> {
  const reset = args.includes("--reset");
  const images = args.includes("--images");
  const preflight = await adminPreflight();
  console.log(`Connected to ${preflight.shopName}; ${preflight.publications.length} publications, ${preflight.scopes.length} scopes.`);

  let products = await listAdminProducts();
  const toDelete = products.filter((product) => reset ? isHearth(product.tags) : !isHearth(product.tags));
  if (toDelete.length > 0) {
    const label = reset ? "hearth-tagged" : "non-hearth";
    await confirmDestructive(`Delete ${toDelete.length} ${label} Shopify products?`, args);
    await deleteProducts(toDelete, (done, total) => console.log(`[${done}/${total}] deleted ${label} product`));
  }
  if (reset) {
    products = await listAdminProducts();
    const remainingOther = products.filter((product) => !isHearth(product.tags));
    if (remainingOther.length > 0) {
      await confirmDestructive(`Delete ${remainingOther.length} non-hearth Shopify products?`, args);
      await deleteProducts(remainingOther, (done, total) => console.log(`[${done}/${total}] deleted non-hearth product`));
    }
  }

  const definitions = await ensureMetafieldDefinitions();
  console.log(`Metafields: ${definitions.created} created, ${definitions.existing} already correct.`);

  let uploadedImages = 0;
  let skippedImages = 0;
  for (const [index, item] of catalogSource.entries()) {
    const product = await upsertProduct(item);
    await publishProduct(product.id);
    if (images && !product.hasMedia) {
      const imagePath = resolve(`public/assets/thumbs/${item.id}.png`);
      if (await imageExists(imagePath)) {
        await uploadProductImage(product.id, imagePath, item.name);
        uploadedImages += 1;
      } else {
        skippedImages += 1;
      }
    }
    console.log(`[${index + 1}/${catalogSource.length}] upserted + published ${item.id}`);
  }

  console.log("Waiting for Storefront publication propagation…");
  const liveProducts = await waitForStorefront(new Set(catalogSource.map(({ id }) => id)));
  await writeSnapshot(liveProducts);
  const report = await runVerify({ print: true });
  console.log(`Seed complete: ${report.adminHearthProducts} products, ${report.storefrontProducts} Storefront-visible, ${uploadedImages} images uploaded${images ? `, ${skippedImages} missing thumbnails skipped` : ""}.`);
}

async function main(): Promise<void> {
  await runSeed();
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Shopify seeding failed");
    process.exitCode = 1;
  });
}
