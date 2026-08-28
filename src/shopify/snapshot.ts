import snapshotJson from "../../data/catalog.snapshot.json";
import { CATEGORIES } from "../engine/types";
import type { CatalogItem, Category } from "../engine/types";
import { asColorwayId } from "../engine/catalog";
import { colorways } from "../tokens";
import type { CatalogProduct } from "./types";

interface SnapshotVariant {
  id: string;
  colorway: string;
  price: number;
}

interface SnapshotProduct extends CatalogItem {
  handle: string;
  price: number;
  variants: SnapshotVariant[];
  imageUrl?: string;
}

export interface CatalogSnapshot {
  generatedAt: string;
  storeDomain: string;
  apiVersion: "2026-07";
  products: SnapshotProduct[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORIES.includes(value as Category);
}

function parseProduct(value: unknown): SnapshotProduct | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.handle !== "string") return undefined;
  if (typeof value.name !== "string" || !isCategory(value.category) || !isRecord(value.dims)) return undefined;
  if (!isFiniteNumber(value.dims.w) || !isFiniteNumber(value.dims.d) || !isFiniteNumber(value.dims.h)) return undefined;
  if (!isFiniteNumber(value.clearanceFront) || !isFiniteNumber(value.price) || typeof value.glb !== "string") return undefined;
  if (!Array.isArray(value.colorways) || !Array.isArray(value.styleTags) || !Array.isArray(value.variants)) return undefined;

  const parsedColorways = value.colorways.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return undefined;
    const id = asColorwayId(entry.id);
    return id ? { id, ...colorways[id] } : undefined;
  });
  if (parsedColorways.some((entry) => entry === undefined)) return undefined;

  const variants = value.variants.map((variant) => {
    if (!isRecord(variant) || typeof variant.id !== "string" || typeof variant.colorway !== "string") return undefined;
    if (!isFiniteNumber(variant.price)) return undefined;
    return { id: variant.id, colorway: variant.colorway, price: variant.price };
  });
  if (variants.some((variant) => variant === undefined)) return undefined;
  if (!value.styleTags.every((tag) => typeof tag === "string")) return undefined;

  return {
    id: value.id,
    handle: value.handle,
    name: value.name,
    category: value.category,
    dims: { w: value.dims.w, d: value.dims.d, h: value.dims.h },
    clearanceFront: value.clearanceFront,
    ...(isFiniteNumber(value.seatCount) ? { seatCount: value.seatCount } : {}),
    glb: value.glb,
    colorways: parsedColorways as SnapshotProduct["colorways"],
    styleTags: [...value.styleTags] as string[],
    price: value.price,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.againstWall === "boolean" ? { againstWall: value.againstWall } : {}),
    variants: variants as SnapshotVariant[],
    ...(typeof value.imageUrl === "string" ? { imageUrl: value.imageUrl } : {}),
  };
}

function parseSnapshot(value: unknown): CatalogSnapshot {
  if (!isRecord(value) || typeof value.generatedAt !== "string" || typeof value.storeDomain !== "string") {
    throw new Error("Invalid Shopify catalog snapshot metadata");
  }
  if (value.apiVersion !== "2026-07" || !Array.isArray(value.products)) {
    throw new Error("Invalid Shopify catalog snapshot version or products");
  }
  const products = value.products.map(parseProduct);
  if (products.some((product) => product === undefined)) {
    throw new Error("Invalid product in Shopify catalog snapshot");
  }
  return { generatedAt: value.generatedAt, storeDomain: value.storeDomain, apiVersion: value.apiVersion, products: products as SnapshotProduct[] };
}

const snapshot = parseSnapshot(snapshotJson);
const byHandle = new Map(snapshot.products.map((product) => [product.handle, product]));

function asCatalogProduct(product: SnapshotProduct): CatalogProduct {
  return structuredClone({
    ...product,
    variants: product.variants.map((variant) => ({ ...variant, available: true })),
  });
}

export function snapshotProducts(): CatalogProduct[] {
  return snapshot.products.map(asCatalogProduct);
}

export function snapshotByHandle(handle: string): CatalogProduct | undefined {
  const product = byHandle.get(handle.trim().toLowerCase());
  return product ? asCatalogProduct(product) : undefined;
}

export function snapshotMetadata(): Omit<CatalogSnapshot, "products"> {
  return { generatedAt: snapshot.generatedAt, storeDomain: snapshot.storeDomain, apiVersion: snapshot.apiVersion };
}
