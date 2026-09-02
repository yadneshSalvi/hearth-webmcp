import { productFor, createCatalog } from "../../engine/catalog";
import { resolveWall } from "../../engine/geometry";
import type { CatalogItem, Colorway, Furniture, Opening, Room, Scene, Variant, Wall } from "../../engine/types";
import type { CatalogProduct, Result, ShopifyCart } from "../../shopify/types";
import type { HearthState } from "../../state/types";
import { HearthError } from "../../state/types";
import type { Err, ToolContext, ToolSource } from "../define";

interface Candidate {
  id: string;
  name: string;
  category?: string;
  type?: string;
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

function tokenOverlap(ref: string, candidate: Candidate): number {
  const queryTokens = new Set(tokens(ref));
  const candidateTokens = new Set(tokens(`${candidate.name} ${candidate.category ?? candidate.type ?? ""}`));
  return [...queryTokens].filter((token) => candidateTokens.has(token)).length;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

export function alternatives(ref: string, candidates: Candidate[]): string[] {
  const needle = normalize(ref);
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      overlap: tokenOverlap(ref, candidate),
      distance: Math.min(editDistance(needle, normalize(candidate.id)), editDistance(needle, normalize(candidate.name))),
    }))
    .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(({ id }) => id);
}

export function notFound(kind: string, ref: string, candidates: Candidate[]): Err {
  return {
    ok: false,
    error: "not_found",
    detail: `${kind} ${ref} was not found.`,
    alternatives: alternatives(ref, candidates),
  };
}

function resolveCandidate<T extends Candidate>(ref: string, candidates: T[]): T | undefined {
  const needle = normalize(ref);
  const idMatch = candidates.find((candidate) => normalize(candidate.id) === needle);
  if (idMatch) return idMatch;
  const nameMatches = candidates.filter((candidate) => normalize(candidate.name) === needle);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) return undefined;
  const prefixes = candidates.filter((candidate) => normalize(candidate.id).startsWith(needle) || normalize(candidate.name).startsWith(needle));
  return prefixes.length === 1 ? prefixes[0] : undefined;
}

export function resolveRoom(state: HearthState, ref?: string): Room | Err {
  const requested = ref ?? state.scene.meta.activeRoomId;
  const room = resolveCandidate(requested, state.scene.rooms);
  return room ?? notFound("Room", requested, state.scene.rooms);
}

export function resolveItem(state: HearthState, ref: string): Furniture | Err {
  if (normalize(ref) === "selected") {
    const selected = state.scene.meta.selection.itemId;
    const item = selected ? state.scene.furniture.find((candidate) => candidate.id === selected) : undefined;
    return item ?? notFound("Item", ref, itemCandidates(state));
  }
  const candidates = state.scene.furniture.map((item) => ({
    ...item,
    name: state.catalog.find((product) => product.id === item.catalogId)?.name ?? item.catalogId,
    category: state.catalog.find((product) => product.id === item.catalogId)?.category,
  }));
  return resolveCandidate(ref, candidates) ?? notFound("Item", ref, candidates);
}

export function resolveProduct(state: HearthState, ref: string): CatalogItem | Err {
  const catalog = createCatalog(state.catalog);
  return catalog.resolveProduct(ref) ?? notFound("Product", ref, state.catalog);
}

function itemCandidates(state: HearthState): Candidate[] {
  return state.scene.furniture.map((item) => ({
    id: item.id,
    name: state.catalog.find((product) => product.id === item.catalogId)?.name ?? item.catalogId,
    category: state.catalog.find((product) => product.id === item.catalogId)?.category,
  }));
}

export function resolveOpening(state: HearthState, ref: string): Opening | Err {
  const candidates = state.scene.openings.map((opening) => ({ ...opening, name: opening.id }));
  return resolveCandidate(ref, candidates) ?? notFound("Opening", ref, candidates);
}

export function resolveVariant(scene: Scene, roomId: string, ref: string): Variant | Err {
  const candidates = scene.variants
    .filter((variant) => variant.roomId === roomId)
    .map((variant) => ({ ...variant, id: variant.name }));
  return resolveCandidate(ref, candidates) ?? notFound("Variant", ref, candidates);
}

export function resolveColorway(state: HearthState, item: Furniture, ref: string): Colorway | Err {
  const product = productFor(item, state.catalog);
  if (!product) return notFound("Product", item.catalogId, state.catalog);
  const colorway = createCatalog(state.catalog).resolveColorway(product, ref);
  return colorway ?? notFound("Colorway", ref, product.colorways);
}

export function resolveRoomWall(room: Room, ref: string): Wall | Err {
  const wall = resolveWall(room, ref);
  const candidates = room.poly.map((_, index) => ({ id: `w${index}`, name: `w${index}` }));
  return wall ?? notFound("Wall", ref, candidates);
}

export function productName(state: HearthState, item: Furniture): string {
  return state.catalog.find((product) => product.id === item.catalogId)?.name ?? item.catalogId;
}

/** Resolves one colorway to the Storefront variant id returned by Shopify. */
export function variantId(product: CatalogProduct | CatalogItem, colorway: string): string | undefined {
  if ("variants" in product) return product.variants.find((variant) => variant.colorway === colorway)?.id;
  return product.shopify?.variantIds[colorway] ?? `gid://shopify/ProductVariant/local-${product.id}-${colorway}`;
}

export function sourceForStore(source: ToolSource): "agent" | "assistant" {
  return source === "assistant" ? "assistant" : "agent";
}

export function fromCaught(error: unknown): Err {
  if (error instanceof HearthError) {
    return { ok: false, error: error.code, detail: error.detail, alternatives: [] };
  }
  return {
    ok: false,
    error: "unavailable",
    detail: error instanceof Error ? error.message : "The requested change is temporarily unavailable.",
  };
}

export function syncCart(context: ToolContext, cart: ShopifyCart): void {
  context.store.getState().setCart({
    id: cart.id,
    subtotalUsd: cart.subtotalUsd,
    status: "idle",
    lines: cart.lines.map((line) => ({ ...line })),
  });
}

/** Mirrors Shopify reachability into the cart chrome for every human- or agent-visible call. */
export function trackShopifyResult<T>(context: ToolContext, result: Result<T>): Result<T> {
  context.store.getState().setCartStatus(!result.ok && result.error === "unavailable" ? "offline" : "idle");
  return result;
}

export function openingOffset(
  wall: Wall,
  width: number,
  value: number | "start" | "center" | "end" | undefined,
): number {
  if (typeof value === "number") return value;
  if (value === "end") return wall.length - width;
  if (value === "center" || value === undefined) return (wall.length - width) / 2;
  return 0;
}

export function compactOpening(opening: Opening): Record<string, unknown> {
  return {
    id: opening.id,
    kind: opening.kind,
    wall: opening.wallId,
    offset_cm: opening.offset,
    width_cm: opening.width,
    ...(opening.swing ? { swing: opening.swing } : {}),
    ...(opening.hinge ? { hinge: opening.hinge } : {}),
    ...(opening.sillHeight !== undefined ? { sill_height_cm: opening.sillHeight } : {}),
  };
}
