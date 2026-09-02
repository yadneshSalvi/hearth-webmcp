import type { Catalog } from "./catalog";
import { productFor } from "./catalog";
import { compareDims } from "./dims";
import type { DimsComparison } from "./dims";
import { footprint, freeSpans, polyInside, resolveWall, walls } from "./geometry";
import type { CatalogItem, Category, Dims, Room, Scene, Side, Span, Vec2, Wall } from "./types";

type CatalogSource = Catalog | CatalogItem[];

/** Fit result for one product against one derived room wall. */
export interface WallFit {
  fits: boolean;
  spareCm: number;
  span?: Span;
}

/** Product fit summary used by get_product. */
export interface WallFitSummary extends WallFit {
  wall: string;
  side: Side;
}

/** Catalog filters shared by the search_catalog handler. */
export interface CatalogSearch {
  query?: string;
  category?: Category;
  maxPriceUsd?: number;
  maxWidthCm?: number;
  maxDepthCm?: number;
  style?: string;
  colorway?: string;
  limit?: number;
  /** Target size; when given, results rank by size distance first (TOOLS.md §7). */
  targetDims?: Partial<Dims>;
  /** Per-side tolerance for a "close" match, cm (default 10). */
  toleranceCm?: number;
}

/** True when the query names at least one target side. */
export function hasTargetDims(target: Partial<Dims> | undefined): target is Partial<Dims> {
  return target !== undefined && (["w", "d", "h"] as const).some((side) => typeof target[side] === "number" && Number.isFinite(target[side]));
}

/** The size comparison for one result against the query's target, or undefined without a target. */
export function sizeComparison(item: CatalogItem, query: Pick<CatalogSearch, "targetDims" | "toleranceCm">): DimsComparison | undefined {
  return hasTargetDims(query.targetDims) ? compareDims(item.dims, query.targetDims, query.toleranceCm) : undefined;
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function prefixMatch(query: string, fields: string[]): boolean {
  const tokens = words(query);
  const fieldTokens = fields.flatMap(words);
  return tokens.every((token) => fieldTokens.some((field) => field.startsWith(token)));
}

function spanLength(span: Span): number {
  return span.end - span.start;
}

function projections(wall: Wall, point: Vec2): { along: number; inward: number } {
  const dx = (wall.b.x - wall.a.x) / wall.length;
  const dy = (wall.b.y - wall.a.y) / wall.length;
  return {
    along: (point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy,
    inward: (point.x - wall.a.x) * -dy + (point.y - wall.a.y) * dx,
  };
}

function depthBlockers(
  scene: Scene,
  room: Room,
  wall: Wall,
  depth: number,
  catalog: CatalogSource,
  ignored: Set<string>,
): Span[] {
  return scene.furniture.flatMap((item): Span[] => {
    if (item.roomId !== room.id || item.status !== "placed" || ignored.has(item.id)) return [];
    const itemCat = productFor(item, catalog);
    if (!itemCat) return [];
    const projected = footprint(item, itemCat).map((point) => projections(wall, point));
    const minDepth = Math.min(...projected.map((point) => point.inward));
    const maxDepth = Math.max(...projected.map((point) => point.inward));
    if (maxDepth < 0 || minDepth > depth + 5) return [];
    const along = projected.map((point) => point.along);
    return [{
      start: Math.max(0, Math.min(wall.length, ...along)),
      end: Math.max(0, Math.min(wall.length, Math.max(...along))),
    }];
  }).filter((span) => span.end > span.start);
}

function subtractBlockers(spans: Span[], blockers: Span[]): Span[] {
  return blockers.reduce<Span[]>((free, blocker) => free.flatMap((span): Span[] => {
    if (blocker.end <= span.start || blocker.start >= span.end) return [span];
    return [
      ...(blocker.start > span.start ? [{ start: span.start, end: Math.min(span.end, blocker.start) }] : []),
      ...(blocker.end < span.end ? [{ start: Math.max(span.start, blocker.end), end: span.end }] : []),
    ];
  }), spans);
}

function productSpans(
  scene: Scene,
  room: Room,
  wall: Wall,
  cat: CatalogItem,
  catalog: CatalogSource,
  ignoreItemIds: string[] = [],
): Span[] {
  const spans = freeSpans(room, wall, scene, catalog, { ignoreItemIds, minLength: 0, itemHeight: cat.dims.h });
  return subtractBlockers(spans, depthBlockers(scene, room, wall, cat.dims.d, catalog, new Set(ignoreItemIds)));
}

/** Finds the tightest currently free wall span that can hold a product's width. */
export function fitsOnWall(
  scene: Scene,
  room: Room,
  wall: Wall,
  cat: CatalogItem,
  catalog: CatalogSource,
  opts: { ignoreItemIds?: string[] } = {},
): WallFit {
  const spans = productSpans(scene, room, wall, cat, catalog, opts.ignoreItemIds);
  const fitting = spans
    .filter((span) => spanLength(span) >= cat.dims.w)
    .sort((a, b) => spanLength(a) - spanLength(b) || a.start - b.start)[0];
  if (fitting) return { fits: true, spareCm: spanLength(fitting) - cat.dims.w, span: { ...fitting } };
  const widest = [...spans].sort((a, b) => spanLength(b) - spanLength(a) || a.start - b.start)[0];
  return { fits: false, spareCm: (widest ? spanLength(widest) : 0) - cat.dims.w, ...(widest ? { span: { ...widest } } : {}) };
}

/** Formats a concise search result fit note for a wall. */
export function fitNote(
  scene: Scene,
  room: Room,
  wall: Wall,
  cat: CatalogItem,
  catalog: CatalogSource,
  opts: { ignoreItemIds?: string[] } = {},
): string {
  const fit = fitsOnWall(scene, room, wall, cat, catalog, opts);
  if (fit.fits) return `fits ${wall.side} wall · ${Math.round(fit.spareCm)} cm spare`;
  if (fit.span) return `too wide for ${wall.side} wall by ${Math.round(Math.abs(fit.spareCm))} cm`;
  return `no free span on ${wall.side} wall`;
}

/** Returns fit data for every derived wall, preserving repeated L-room sides by id. */
export function wallFits(scene: Scene, room: Room, cat: CatalogItem, catalog: CatalogSource): WallFitSummary[] {
  return walls(room).map((wall) => ({ wall: wall.id, side: wall.side, ...fitsOnWall(scene, room, wall, cat, catalog) }));
}

/** Tests whether a product footprint fits somewhere in a rectangular or L-shaped room. */
export function fitsInRoom(cat: CatalogItem, room: Room): boolean {
  const xs = [...new Set(room.poly.map((point) => point.x))].sort((a, b) => a - b);
  const ys = [...new Set(room.poly.map((point) => point.y))].sort((a, b) => a - b);
  for (let left = 0; left < xs.length - 1; left += 1) {
    for (let right = left + 1; right < xs.length; right += 1) {
      for (let top = 0; top < ys.length - 1; top += 1) {
        for (let bottom = top + 1; bottom < ys.length; bottom += 1) {
          const x1 = xs[left] as number; const x2 = xs[right] as number;
          const y1 = ys[top] as number; const y2 = ys[bottom] as number;
          const rectangle = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
          if (!polyInside(room.poly, rectangle)) continue;
          const width = x2 - x1; const depth = y2 - y1;
          if ((cat.dims.w <= width && cat.dims.d <= depth) || (cat.dims.d <= width && cat.dims.w <= depth)) return true;
        }
      }
    }
  }
  return false;
}

/** Filters and deterministically ranks catalog products, optionally by live wall fit. */
export function searchCatalog(
  catalog: CatalogItem[],
  query: CatalogSearch,
  ctx?: { scene: Scene; roomId: string; fitsWall?: string },
): CatalogItem[] {
  const room = ctx?.scene.rooms.find((entry) => entry.id === ctx.roomId);
  const wall = room && ctx?.fitsWall ? resolveWall(room, ctx.fitsWall) : undefined;
  if (ctx?.fitsWall && (!room || !wall)) return [];
  const fitSpare = new Map<string, number>();
  const filtered = catalog.filter((item) => {
    if (query.category && item.category !== query.category) return false;
    if (query.maxPriceUsd !== undefined && (item.price === undefined || item.price > query.maxPriceUsd)) return false;
    if (query.maxWidthCm !== undefined && item.dims.w > query.maxWidthCm) return false;
    if (query.maxDepthCm !== undefined && item.dims.d > query.maxDepthCm) return false;
    if (query.style && !prefixMatch(query.style, item.styleTags)) return false;
    if (query.colorway && !prefixMatch(query.colorway, item.colorways.flatMap((entry) => [entry.id, entry.name]))) return false;
    if (query.query && !prefixMatch(query.query, [
      item.name, item.category, ...item.styleTags, item.description ?? "",
      ...item.colorways.flatMap((entry) => [entry.id, entry.name]),
    ])) return false;
    if (room && wall && ctx) {
      const fit = fitsOnWall(ctx.scene, room, wall, item, catalog);
      if (!fit.fits) return false;
      fitSpare.set(item.id, fit.spareCm);
    }
    return true;
  });
  const limit = Math.max(1, Math.min(6, Math.trunc(query.limit ?? 6)));
  const distance = (item: CatalogItem): number => sizeComparison(item, query)?.distanceCm ?? 0;
  return filtered
    .sort((a, b) => distance(a) - distance(b)
      || (fitSpare.get(a.id) ?? 0) - (fitSpare.get(b.id) ?? 0)
      || (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
      || a.name.localeCompare(b.name))
    .slice(0, limit);
}
