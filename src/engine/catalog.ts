import type { ColorwayId } from "../tokens";
import type { CatalogItem, Category, Colorway, Dims } from "./types";

/** Read-only catalog lookup and fuzzy-resolution API. */
export interface Catalog {
  byId(id: string): CatalogItem | undefined;
  all(): CatalogItem[];
  byCategory(category: Category): CatalogItem[];
  resolveProduct(query: string): CatalogItem | undefined;
  suggestProducts(query: string, n?: number): string[];
  resolveColorway(item: CatalogItem, query: string): Colorway | undefined;
  nextItemId(category: Category, existingIds: Iterable<string>): string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const TOKEN_ALIASES: Record<string, string> = {
  carpet: "rug",
  carpets: "rug",
  couch: "sofa",
  couches: "sofa",
};

function tokens(value: string): string[] {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean).map((token) => TOKEN_ALIASES[token] ?? token);
}

function tokenOverlap(query: string, item: CatalogItem): number {
  const queryTokens = new Set(tokens(query));
  const candidateTokens = new Set(tokens(`${item.name} ${item.category}`));
  return [...queryTokens].filter((token) => candidateTokens.has(token)).length;
}

function unique(items: CatalogItem[]): CatalogItem | undefined {
  const byId = [...new Map(items.map((item) => [item.id, item])).values()];
  return byId.length === 1 ? byId[0] : undefined;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let col = 1; col <= b.length; col += 1) {
      current[col] = Math.min(
        (current[col - 1] as number) + 1,
        (previous[col] as number) + 1,
        (previous[col - 1] as number) + (a[row - 1] === b[col - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] as number;
}

/** Resolves a colorway id/name or unique prefix, case-insensitively. */
export function resolveColorway(item: CatalogItem, query: string): Colorway | undefined {
  const needle = normalize(query);
  const exact = item.colorways.find((colorway) => normalize(colorway.id) === needle || normalize(colorway.name) === needle);
  if (exact) return exact;
  return uniqueColorway(item.colorways.filter((colorway) => normalize(colorway.id).startsWith(needle) || normalize(colorway.name).startsWith(needle)));
}

function uniqueColorway(colorways: Colorway[]): Colorway | undefined {
  return colorways.length === 1 ? colorways[0] : undefined;
}

/** Returns the first unused readable item id for a category. */
export function nextItemId(category: Category, existingIds: Iterable<string>): string {
  const ids = new Set(existingIds);
  let index = 1;
  while (ids.has(`${category}-${index}`)) index += 1;
  return `${category}-${index}`;
}

/** Builds an immutable-by-copy catalog with deterministic loose product resolution. */
export function createCatalog(items: CatalogItem[]): Catalog {
  const source = items.map((item) => ({ ...item, dims: { ...item.dims }, colorways: item.colorways.map((colorway) => ({ ...colorway })), styleTags: [...item.styleTags] }));
  const byIdMap = new Map(source.map((item) => [normalize(item.id), item]));
  const all = () => source.map((item) => ({ ...item, dims: { ...item.dims }, colorways: item.colorways.map((colorway) => ({ ...colorway })), styleTags: [...item.styleTags] }));
  const resolveProduct = (query: string): CatalogItem | undefined => {
    const needle = normalize(query);
    if (!needle) return undefined;
    const idMatch = byIdMap.get(needle);
    if (idMatch) return idMatch;
    const nameMatch = unique(source.filter((item) => normalize(item.name) === needle));
    if (nameMatch) return nameMatch;
    const prefix = unique(source.filter((item) => normalize(item.id).startsWith(needle) || normalize(item.name).startsWith(needle)));
    if (prefix) return prefix;
    return unique(source.filter((item) => normalize(item.name).includes(needle)));
  };
  const suggestProducts = (query: string, n = 3): string[] => {
    const needle = normalize(query);
    return source
      .map((item) => ({
        id: item.id,
        overlap: tokenOverlap(query, item),
        distance: Math.min(editDistance(needle, normalize(item.id)), editDistance(needle, normalize(item.name))),
      }))
      .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, n))
      .map(({ id }) => id);
  };
  return {
    byId: (id) => byIdMap.get(normalize(id)),
    all,
    byCategory: (category) => all().filter((item) => item.category === category),
    resolveProduct,
    suggestProducts,
    resolveColorway,
    nextItemId,
  };
}

/** Anything that can answer "which product is this id": a catalog, a plain list, or a lookup function. */
export type ProductSource = Catalog | CatalogItem[] | ((id: string) => CatalogItem | undefined);

/** A placed item, or anything that names a product and may carry its own size. */
export interface SizedRef {
  catalogId: string;
  dims?: Dims;
}

function lookupProduct(source: ProductSource, id: string): CatalogItem | undefined {
  if (typeof source === "function") return source(id);
  if (Array.isArray(source)) return source.find((item) => item.id === id);
  return source.byId(id);
}

/**
 * The product with a placed item's own size in place of the catalog size (SCENE_SCHEMA.md
 * §Effective dimensions). Returns the catalog record untouched when the item has no override, so
 * identity-based memoisation keeps working for the common case.
 */
export function withItemDims(item: SizedRef, product: CatalogItem): CatalogItem {
  const dims = item.dims;
  if (!dims) return product;
  if (dims.w === product.dims.w && dims.d === product.dims.d && dims.h === product.dims.h) return product;
  return { ...product, dims: { w: dims.w, d: dims.d, h: dims.h } };
}

/** Resolves a placed item's product with its effective dimensions. Every footprint path uses this. */
export function productFor(item: SizedRef, source: ProductSource): CatalogItem | undefined {
  const product = lookupProduct(source, item.catalogId);
  return product ? withItemDims(item, product) : undefined;
}

/** Narrows a string to a supported colorway id when one exists. */
export function asColorwayId(value: string): ColorwayId | undefined {
  const ids: ColorwayId[] = ["oak", "plaster", "charcoal", "terracotta", "sage", "ochre", "dusty-blue", "plum"];
  return ids.find((id) => id === normalize(value));
}
