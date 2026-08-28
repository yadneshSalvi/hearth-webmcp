import { CATEGORIES } from "../engine/types";
import type { Category, Colorway, Dims } from "../engine/types";
import { asColorwayId } from "../engine/catalog";
import { colorways } from "../tokens";
import { snapshotByHandle } from "./snapshot";
import type { CatalogProduct, CatalogVariant, ShopifyCart, ShopifyCartLine } from "./types";

interface MetafieldValue {
  value: string;
}

interface MoneyValue {
  amount: string;
  currencyCode?: string;
}

export interface StorefrontProductNode {
  id: string;
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  vendor: string;
  description: string;
  priceRange: { minVariantPrice: MoneyValue };
  featuredImage?: { url: string; altText?: string | null } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      availableForSale: boolean;
      price: MoneyValue;
      selectedOptions: Array<{ name: string; value: string }>;
    }>;
  };
  dims?: MetafieldValue | null;
  colorways?: MetafieldValue | null;
  clearance?: MetafieldValue | null;
  seats?: MetafieldValue | null;
  glb?: MetafieldValue | null;
  againstWall?: MetafieldValue | null;
}

export interface StorefrontCartNode {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: { subtotalAmount: MoneyValue };
  lines: {
    nodes: Array<{
      id: string;
      quantity: number;
      attributes?: Array<{ key: string; value: string }>;
      cost: { totalAmount: MoneyValue };
      merchandise: {
        id: string;
        title: string;
        price: MoneyValue;
        selectedOptions: Array<{ name: string; value: string }>;
        product: { handle: string; title: string };
      };
    }>;
  };
}

export type CartWithCheckout = ShopifyCart & { checkoutUrl: string };

function finiteMoney(value: MoneyValue | undefined): number | undefined {
  if (!value || (value.currencyCode && value.currencyCode !== "USD")) return undefined;
  const amount = Number(value.amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDims(value: string | undefined): Dims | undefined {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return undefined;
  const { w, d, h } = parsed;
  if (![w, d, h].every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0)) return undefined;
  return { w: w as number, d: d as number, h: h as number };
}

function parseColorways(value: string | undefined): Colorway[] | undefined {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const ids = parsed.map((entry) => isRecord(entry) && typeof entry.id === "string" ? asColorwayId(entry.id) : undefined);
  if (ids.length === 0 || ids.some((id) => !id)) return undefined;
  return ids.map((id) => ({ id: id!, ...colorways[id!] }));
}

function categoryOf(value: string): Category | undefined {
  return CATEGORIES.find((category) => category === value);
}

function integerMetafield(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function booleanMetafield(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function colorwayId(value: string, available: Colorway[]): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return available.find((entry) => entry.id === normalized || entry.name.toLowerCase() === value.trim().toLowerCase())?.id
    ?? normalized;
}

/** Maps live product data, filling invalid or missing fit metadata from the committed snapshot. */
export function mapStorefrontProduct(node: StorefrontProductNode): CatalogProduct {
  const fallback = snapshotByHandle(node.handle);
  const dims = parseDims(node.dims?.value) ?? fallback?.dims;
  const liveColorways = parseColorways(node.colorways?.value) ?? fallback?.colorways;
  const category = categoryOf(node.productType) ?? fallback?.category;
  if (!dims || !liveColorways || !category) {
    throw new Error(`Product ${node.handle} has no valid Hearth metadata or snapshot fallback`);
  }

  const fallbackPrice = fallback?.price ?? 0;
  const price = finiteMoney(node.priceRange?.minVariantPrice) ?? fallbackPrice;
  const mappedVariants = node.variants.nodes.flatMap<CatalogVariant>((variant) => {
    const option = variant.selectedOptions.find(({ name }) => name.toLowerCase() === "colorway");
    if (!option || typeof variant.id !== "string") return [];
    return [{
      id: variant.id,
      colorway: colorwayId(option.value, liveColorways),
      price: finiteMoney(variant.price) ?? price,
      available: Boolean(variant.availableForSale),
    }];
  });
  const variants = mappedVariants.length > 0 ? mappedVariants : (fallback?.variants ?? []);
  const clearanceFront = integerMetafield(node.clearance?.value) ?? fallback?.clearanceFront ?? 0;
  const seatCount = integerMetafield(node.seats?.value) ?? fallback?.seatCount;
  const againstWall = booleanMetafield(node.againstWall?.value) ?? fallback?.againstWall;
  const styleTags = node.tags.filter((tag) => tag.toLowerCase() !== "hearth");

  return {
    id: node.handle,
    handle: node.handle,
    name: node.title || fallback?.name || node.handle,
    category,
    dims,
    clearanceFront,
    ...(seatCount === undefined ? {} : { seatCount }),
    glb: node.glb?.value || fallback?.glb || `/assets/glb/${node.handle}.glb`,
    colorways: liveColorways,
    styleTags: styleTags.length > 0 ? styleTags : (fallback?.styleTags ?? []),
    price,
    description: node.description || fallback?.description || "",
    ...(againstWall === undefined ? {} : { againstWall }),
    variants,
    ...(node.featuredImage?.url ? { imageUrl: node.featuredImage.url } : fallback?.imageUrl ? { imageUrl: fallback.imageUrl } : {}),
  };
}

function mapCartLine(line: StorefrontCartNode["lines"]["nodes"][number]): ShopifyCartLine | undefined {
  const merchandise = line.merchandise;
  if (!merchandise?.id || !merchandise.product?.handle) return undefined;
  const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1;
  const unitUsd = finiteMoney(merchandise.price) ?? 0;
  const lineUsd = finiteMoney(line.cost?.totalAmount) ?? unitUsd * quantity;
  const option = merchandise.selectedOptions.find(({ name }) => name.toLowerCase() === "colorway");
  const itemId = line.attributes?.find(({ key }) => key === "_hearth_item_id")?.value;
  return {
    id: line.id,
    variantId: merchandise.id,
    handle: merchandise.product.handle,
    title: merchandise.product.title,
    colorway: option ? option.value.trim().toLowerCase().replace(/\s+/g, "-") : merchandise.title,
    quantity,
    unitUsd,
    lineUsd,
    ...(itemId ? { itemId } : {}),
  };
}

export function mapStorefrontCart(node: StorefrontCartNode): CartWithCheckout {
  const lines = node.lines.nodes.map(mapCartLine).filter((line): line is ShopifyCartLine => line !== undefined);
  return {
    id: node.id,
    checkoutUrl: node.checkoutUrl,
    lines,
    subtotalUsd: finiteMoney(node.cost?.subtotalAmount) ?? lines.reduce((total, line) => total + line.lineUsd, 0),
    count: Number.isInteger(node.totalQuantity) ? node.totalQuantity : lines.reduce((total, line) => total + line.quantity, 0),
  };
}
