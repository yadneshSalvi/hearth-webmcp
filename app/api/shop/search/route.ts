import type { NextRequest } from "next/server";
import { CATEGORIES } from "@/src/engine/types";
import type { Category } from "@/src/engine/types";
import { mapStorefrontProduct } from "@/src/shopify/mapping";
import type { StorefrontProductNode } from "@/src/shopify/mapping";
import { buildStorefrontProductQuery, SEARCH_PRODUCTS_QUERY } from "@/src/shopify/queries";
import { storefrontFetch } from "@/src/shopify/server";
import { snapshotProducts } from "@/src/shopify/snapshot";
import type { CatalogProduct } from "@/src/shopify/types";

export const dynamic = "force-dynamic";

interface SearchInput {
  q?: string;
  category?: Category;
  maxPrice?: number;
  maxWidth?: number;
  maxDepth?: number;
  style?: string;
  colorway?: string;
  limit: number;
}

const CACHE_HEADERS = { "Cache-Control": "private, max-age=30" };

function optionalNumber(params: URLSearchParams, key: string): number | undefined | null {
  const raw = params.get(key);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseInput(params: URLSearchParams): SearchInput | string {
  const categoryValue = params.get("category")?.trim();
  const category = categoryValue ? CATEGORIES.find((candidate) => candidate === categoryValue) : undefined;
  if (categoryValue && !category) return `Unknown category ${categoryValue}`;
  const maxPrice = optionalNumber(params, "max_price");
  const maxWidth = optionalNumber(params, "max_w");
  const maxDepth = optionalNumber(params, "max_d");
  if (maxPrice === null || maxWidth === null || maxDepth === null) return "Numeric filters must be non-negative numbers";
  const limitRaw = optionalNumber(params, "limit");
  const limit = limitRaw ?? 6;
  if (limitRaw === null || !Number.isInteger(limit) || limit < 1 || limit > 50) return "limit must be an integer from 1 to 50";
  for (const key of ["q", "style", "colorway"] as const) {
    if ((params.get(key)?.length ?? 0) > 120) return `${key} is too long`;
  }
  return {
    ...(params.get("q")?.trim() ? { q: params.get("q")!.trim() } : {}),
    ...(category ? { category } : {}),
    ...(maxPrice === undefined ? {} : { maxPrice }),
    ...(maxWidth === undefined ? {} : { maxWidth }),
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(params.get("style")?.trim() ? { style: params.get("style")!.trim() } : {}),
    ...(params.get("colorway")?.trim() ? { colorway: params.get("colorway")!.trim() } : {}),
    limit,
  };
}

function includesQuery(product: CatalogProduct, query: string | undefined): boolean {
  if (!query) return true;
  const haystack = [
    product.handle,
    product.name,
    product.category,
    product.description ?? "",
    ...product.styleTags,
    ...product.colorways.flatMap(({ id, name }) => [id, name]),
  ].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function filtered(products: CatalogProduct[], input: SearchInput, applyText: boolean): CatalogProduct[] {
  const style = input.style?.toLowerCase();
  const colorway = input.colorway?.toLowerCase().replace(/\s+/g, "-");
  return products.filter((product) => (
    (!applyText || includesQuery(product, input.q))
    && (!input.category || product.category === input.category)
    && (input.maxPrice === undefined || product.price <= input.maxPrice)
    && (input.maxWidth === undefined || product.dims.w <= input.maxWidth)
    && (input.maxDepth === undefined || product.dims.d <= input.maxDepth)
    && (!style || product.styleTags.some((tag) => tag.toLowerCase() === style))
    && (!colorway || product.colorways.some(({ id, name }) => id === colorway || name.toLowerCase().replace(/\s+/g, "-") === colorway))
  )).slice(0, input.limit);
}

function snapshotResponse(input: SearchInput): Response {
  return Response.json(
    { products: filtered(snapshotProducts(), input, true), source: "snapshot" },
    { headers: CACHE_HEADERS },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const input = parseInput(request.nextUrl.searchParams);
  if (typeof input === "string") return Response.json({ error: "invalid", detail: input }, { status: 400 });
  const requestedQuery = buildStorefrontProductQuery({
    q: input.q,
    category: input.category,
    maxPrice: input.maxPrice,
    style: input.style,
    colorway: input.colorway,
  });
  const query = ["tag:hearth", requestedQuery].filter(Boolean).join(" AND ");
  const result = await storefrontFetch<{
    products: { nodes: StorefrontProductNode[] };
  }, { q: string; first: number }>(SEARCH_PRODUCTS_QUERY, { q: query, first: 100 }, request);
  if (!result.ok) return snapshotResponse(input);
  try {
    const products = result.data.products.nodes.map(mapStorefrontProduct);
    return Response.json({ products: filtered(products, input, false) }, { headers: CACHE_HEADERS });
  } catch {
    return snapshotResponse(input);
  }
}
