import { resolveAnchor } from "./anchors";
import type { PlacementRequest } from "./anchors";
import type { Catalog } from "./catalog";
import { clearanceZone } from "./clearance";
import { footprint, freeSpans, polysOverlap, walls } from "./geometry";
import type { CatalogItem, Category, Furniture, Opening, Room, Rotation, Scene, Side, Span, Vec2, Wall } from "./types";
import { productFor } from "./catalog";

/** Choreographed layout modes exposed by arrange_room. */
export type ArrangeStyle = "conversation" | "media" | "open" | "work";

/** Pure arrange_room output; furniture preserves the scene's original id order. */
export interface ArrangeResult {
  furniture: Furniture[];
  moved: { id: string; from: Vec2; to: Vec2; rotation: Rotation }[];
  kept: string[];
  note: string;
}

type CatalogSource = Catalog | CatalogItem[];
type Role = "anchor" | "media" | "surface" | "storage" | "seating" | "soft" | "lighting" | "greenery" | "decor";
type MediaPlan = { sofaWall?: Wall; tvWall?: Wall; sofaId?: string; tvId?: string };
type SpanCache = Map<string, Span[]>;

const OPPOSITE: Record<Side, Side> = { north: "south", east: "west", south: "north", west: "east" };
const STACKABLE = new Set<Category>(["table-lamp", "decor"]);
const SURFACE = new Set<Category>(["table", "desk", "shelf", "tv-unit"]);

function clone(item: Furniture): Furniture {
  return { ...item, pos: { ...item.pos } };
}

function role(category: Category): Role {
  if (category === "sofa" || category === "bed") return "anchor";
  if (category === "tv-unit") return "media";
  if (category === "table" || category === "desk") return "surface";
  if (category === "wardrobe" || category === "shelf") return "storage";
  if (category === "armchair" || category === "chair") return "seating";
  if (category === "rug") return "soft";
  if (category === "floor-lamp" || category === "table-lamp") return "lighting";
  if (category === "plant") return "greenery";
  return "decor";
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function orderFor(style: ArrangeStyle, category: Category): number {
  const currentRole = role(category);
  const styleOrder: Record<ArrangeStyle, Role[]> = {
    conversation: ["anchor", "surface", "seating", "media", "storage", "lighting", "greenery", "decor", "soft"],
    media: ["media", "anchor", "surface", "seating", "storage", "lighting", "greenery", "decor", "soft"],
    open: ["anchor", "media", "storage", "surface", "seating", "lighting", "greenery", "decor", "soft"],
    work: ["surface", "anchor", "storage", "seating", "media", "lighting", "greenery", "decor", "soft"],
  };
  return styleOrder[style].indexOf(currentRole);
}

function largestWindow(scene: Scene, roomId: string): Opening | undefined {
  return scene.openings
    .filter((opening) => opening.roomId === roomId && opening.kind === "window")
    .sort((a, b) => b.width - a.width || a.id.localeCompare(b.id))[0];
}

function resolveFocusItem(items: Furniture[], ref: string, catalog: CatalogSource): Furniture | undefined {
  const needle = ref.trim().toLowerCase();
  const exact = items.filter((item) => item.id.toLowerCase() === needle || productFor(item, catalog)?.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const prefix = items.filter((item) => item.id.toLowerCase().startsWith(needle) || productFor(item, catalog)?.name.toLowerCase().startsWith(needle));
  return prefix.length === 1 ? prefix[0] : undefined;
}

function cachedSpans(
  scene: Scene,
  room: Room,
  wall: Wall,
  cat: CatalogItem,
  catalog: CatalogSource,
  cache: SpanCache,
  minLength: number,
): Span[] {
  const key = `${scene.furniture.length}:${wall.id}:${cat.dims.h}:${minLength}`;
  const cached = cache.get(key);
  if (cached) return cached.map((span) => ({ ...span }));
  const spans = freeSpans(room, wall, scene, catalog, { minLength, itemHeight: cat.dims.h });
  cache.set(key, spans.map((span) => ({ ...span })));
  return spans;
}

function wallCapacity(scene: Scene, room: Room, wall: Wall, cat: CatalogItem, catalog: CatalogSource, cache: SpanCache): number {
  const spans = cachedSpans(scene, room, wall, cat, catalog, cache, cat.dims.w);
  return spans.length > 0 ? Math.max(...spans.map((span) => span.end - span.start)) : Number.NEGATIVE_INFINITY;
}

function rankedWalls(
  scene: Scene, room: Room, cat: CatalogItem, catalog: CatalogSource, seed: number, itemId: string, cache: SpanCache, preferred?: Side,
): Wall[] {
  return walls(room).sort((a, b) => {
    const preferredA = a.side === preferred ? 1 : 0; const preferredB = b.side === preferred ? 1 : 0;
    const capacityA = wallCapacity(scene, room, a, cat, catalog, cache); const capacityB = wallCapacity(scene, room, b, cat, catalog, cache);
    return preferredB - preferredA || capacityB - capacityA
      || hash(`${seed}:${itemId}:${a.id}`) - hash(`${seed}:${itemId}:${b.id}`) || a.id.localeCompare(b.id);
  });
}

function wallRequests(
  scene: Scene, room: Room, wall: Wall, cat: CatalogItem, catalog: CatalogSource, cache: SpanCache, facing?: string,
): PlacementRequest[] {
  const spans = cachedSpans(scene, room, wall, cat, catalog, cache, cat.dims.w)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  return spans.map((span) => ({
    anchor: { wall: wall.id, along: (span.start + span.end) / 2, ...(facing ? { facing } : {}) },
  }));
}

function mediaPlan(scene: Scene, room: Room, items: Furniture[], catalog: CatalogSource, seed: number, cache: SpanCache): MediaPlan {
  const sofa = items.find((item) => productFor(item, catalog)?.category === "sofa");
  const tv = items.find((item) => productFor(item, catalog)?.category === "tv-unit");
  const sofaCat = sofa && productFor(sofa, catalog); const tvCat = tv && productFor(tv, catalog);
  if (!sofa || !tv || !sofaCat || !tvCat) return { sofaId: sofa?.id, tvId: tv?.id };
  const pairs = walls(room).flatMap((sofaWall) => walls(room)
    .filter((tvWall) => tvWall.side === OPPOSITE[sofaWall.side])
    .map((tvWall) => ({ sofaWall, tvWall, score: Math.min(wallCapacity(scene, room, sofaWall, sofaCat, catalog, cache), wallCapacity(scene, room, tvWall, tvCat, catalog, cache)) })));
  const best = pairs.sort((a, b) => b.score - a.score
    || hash(`${seed}:media:${a.sofaWall.id}`) - hash(`${seed}:media:${b.sofaWall.id}`) || a.sofaWall.id.localeCompare(b.sofaWall.id))[0];
  return { sofaWall: best?.sofaWall, tvWall: best?.tvWall, sofaId: sofa.id, tvId: tv.id };
}

function focalReference(scene: Scene, room: Room, items: Furniture[], catalog: CatalogSource, focus?: string): { ref: string; side?: Side; item?: Furniture } {
  if (focus?.toLowerCase().startsWith("window:")) {
    const id = focus.slice(focus.indexOf(":") + 1);
    const opening = scene.openings.find((entry) => entry.roomId === room.id && entry.kind === "window" && entry.id.toLowerCase() === id.toLowerCase());
    const wall = opening && walls(room).find((entry) => entry.id === opening.wallId);
    if (opening) return { ref: `window:${opening.id}`, side: wall?.side };
  }
  if (focus) {
    const item = resolveFocusItem(items, focus, catalog);
    if (item) return { ref: item.id, item };
  }
  const window = largestWindow(scene, room.id);
  const wall = window && walls(room).find((entry) => entry.id === window.wallId);
  return window ? { ref: `window:${window.id}`, side: wall?.side } : { ref: "room_center" };
}

function cornerRequests(room: Room, cat: CatalogItem): PlacementRequest[] {
  const xs = room.poly.map((point) => point.x); const ys = room.poly.map((point) => point.y);
  const insetX = cat.dims.w / 2 + 10; const insetY = cat.dims.d / 2 + 10;
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return [
    { pos: { x: minX + insetX, y: minY + insetY }, rotation: 0 },
    { pos: { x: maxX - insetX, y: minY + insetY }, rotation: 0 },
    { pos: { x: maxX - insetX, y: maxY - insetY }, rotation: 0 },
    { pos: { x: minX + insetX, y: maxY - insetY }, rotation: 0 },
  ];
}

function surfaceRequest(working: Scene, roomId: string, catalog: CatalogSource): PlacementRequest | undefined {
  const surface = working.furniture.find((item) => item.roomId === roomId && SURFACE.has(productFor(item, catalog)?.category ?? "rug"));
  return surface ? { pos: { ...surface.pos }, rotation: surface.rotation } : undefined;
}

function nearestSeating(working: Scene, roomId: string, catalog: CatalogSource): Furniture | undefined {
  return working.furniture.find((item) => item.roomId === roomId && ["sofa", "armchair", "bed"].includes(productFor(item, catalog)?.category ?? ""));
}

function requestsFor(
  item: Furniture, cat: CatalogItem, style: ArrangeStyle, working: Scene, room: Room, catalog: CatalogSource,
  seed: number, focal: { ref: string; side?: Side }, media: MediaPlan, cache: SpanCache,
): PlacementRequest[] {
  const preferred: PlacementRequest[] = [];
  const window = largestWindow(working, room.id);
  if (style === "media" && item.id === media.tvId && media.tvWall) preferred.push(...wallRequests(working, room, media.tvWall, cat, catalog, cache));
  if (style === "media" && item.id === media.sofaId && media.sofaWall) preferred.push(...wallRequests(working, room, media.sofaWall, cat, catalog, cache, media.tvId));
  if (style === "conversation" && (cat.category === "sofa" || cat.category === "armchair")) {
    const desired = cat.category === "sofa" && focal.side ? OPPOSITE[focal.side] : undefined;
    for (const wall of rankedWalls(working, room, cat, catalog, seed, item.id, cache, desired)) {
      if (cat.category !== "sofa" && focal.side && [focal.side, OPPOSITE[focal.side]].includes(wall.side)) continue;
      preferred.push(...wallRequests(working, room, wall, cat, catalog, cache, focal.ref));
    }
  }
  if (style === "work" && cat.category === "desk" && window) preferred.push({ anchor: { under: `window:${window.id}` } });
  if (style === "work" && cat.category === "chair") {
    const desk = working.furniture.find((entry) => productFor(entry, catalog)?.category === "desk" && entry.roomId === room.id);
    if (desk) preferred.push({ anchor: { next_to: desk.id, side: "front", gap_cm: 10, facing: desk.id } });
  }
  if (cat.category === "rug") {
    const seating = working.furniture.filter((entry) => entry.roomId === room.id && ["sofa", "armchair"].includes(productFor(entry, catalog)?.category ?? ""));
    if (seating.length) preferred.push({ pos: { x: seating.reduce((sum, entry) => sum + entry.pos.x, 0) / seating.length, y: seating.reduce((sum, entry) => sum + entry.pos.y, 0) / seating.length }, rotation: 90 });
    preferred.push({ anchor: { centered: true }, rotation: 90 }, { anchor: { centered: true }, rotation: 0 });
  }
  if (STACKABLE.has(cat.category)) {
    const surface = surfaceRequest(working, room.id, catalog);
    if (surface) preferred.push(surface);
  }
  if (style !== "open" && (cat.category === "floor-lamp" || (cat.category === "table-lamp" && !surfaceRequest(working, room.id, catalog)))) {
    const seating = nearestSeating(working, room.id, catalog);
    if (seating) preferred.push({ anchor: { next_to: seating.id, side: "left", gap_cm: 15 } }, { anchor: { next_to: seating.id, side: "right", gap_cm: 15 } });
  }
  if (cat.category === "plant") preferred.push(...cornerRequests(room, cat));
  if ((style === "conversation" || style === "media") && cat.category === "table") preferred.push({ anchor: { centered: true } });
  const wallFirst = style === "open" || cat.againstWall || ["wardrobe", "shelf", "tv-unit", "bed"].includes(cat.category);
  if (wallFirst) for (const wall of rankedWalls(working, room, cat, catalog, seed, item.id, cache)) preferred.push(...wallRequests(working, room, wall, cat, catalog, cache));
  if (!wallFirst && cat.category !== "rug") preferred.push({ anchor: { centered: true } });
  preferred.push({ pos: { ...item.pos }, rotation: item.rotation });
  if (cat.category !== "rug") {
    preferred.push({ anchor: { centered: true }, rotation: 0 }, { anchor: { centered: true }, rotation: 90 });
    if (!wallFirst) {
      for (const wall of rankedWalls(working, room, cat, catalog, seed, item.id, cache)) {
        preferred.push(...wallRequests(working, room, wall, cat, catalog, cache));
      }
    }
  }
  return preferred.map((request) => ({ ...request, maxNudgeCm: 45 }));
}

function clearancePenalty(working: Scene, placed: Furniture, cat: CatalogItem, catalog: CatalogSource): number {
  if (cat.category === "rug") return 0;
  const poly = footprint(placed, cat); const ownClearance = clearanceZone(placed, cat);
  let penalty = 0;
  for (const other of working.furniture.filter((entry) => entry.roomId === placed.roomId)) {
    const otherCat = productFor(other, catalog);
    if (!otherCat || otherCat.category === "rug") continue;
    const otherPoly = footprint(other, otherCat); const otherClearance = clearanceZone(other, otherCat);
    if ((ownClearance.length && polysOverlap(ownClearance, otherPoly)) || (otherClearance.length && polysOverlap(otherClearance, poly))) penalty += 1;
  }
  return penalty;
}

function placeOne(
  working: Scene, room: Room, item: Furniture, cat: CatalogItem, requests: PlacementRequest[], catalog: CatalogSource, acceptFirst = false,
): Furniture | undefined {
  let fallback: Furniture | undefined;
  for (const request of requests) {
    const result = resolveAnchor(working, room.id, cat, request, catalog);
    if (!result.ok) continue;
    const placed = { ...clone(item), pos: { ...result.pos }, rotation: result.rotation };
    if (!fallback) fallback = placed;
    if (acceptFirst) return placed;
    if (clearancePenalty(working, placed, cat, catalog) === 0) return placed;
  }
  return fallback;
}

/** Rebuilds one room into a deterministic, constraint-respecting semantic layout. */
export function arrangeRoom(
  scene: Scene,
  roomId: string,
  style: ArrangeStyle,
  catalog: CatalogSource,
  opts: { keepLocked?: boolean; focus?: string; seed?: number } = {},
): ArrangeResult {
  const room = scene.rooms.find((entry) => entry.id === roomId);
  const original = scene.furniture.map(clone);
  if (!room) return { furniture: original, moved: [], kept: [], note: `Room ${roomId} was not found` };
  const roomItems = original.filter((item) => item.roomId === roomId && item.status === "placed");
  if (roomItems.length === 0) return { furniture: original, moved: [], kept: [], note: `${room.name} is empty; nothing to arrange` };
  if (roomItems.every((item) => productFor(item, catalog)?.category === "rug")) {
    return { furniture: original, moved: [], kept: roomItems.map((item) => item.id), note: `${room.name} only has a rug; layout kept` };
  }

  const keepLocked = opts.keepLocked ?? true; const seed = opts.seed ?? 0;
  const fixed = roomItems.filter((item) => (keepLocked && item.locked) || !productFor(item, catalog));
  const focal = focalReference(scene, room, roomItems, catalog, opts.focus);
  if (focal.item && !fixed.some((item) => item.id === focal.item?.id)) fixed.push(focal.item);
  const fixedIds = new Set(fixed.map((item) => item.id));
  const outside = original.filter((item) => item.roomId !== roomId || item.status === "ghost");
  const working: Scene = { ...scene, furniture: [...outside.map(clone), ...fixed.map(clone)] };
  const spanCache: SpanCache = new Map();
  const media = mediaPlan(working, room, roomItems, catalog, seed, spanCache);
  const arrangeable = roomItems
    .filter((item) => !fixedIds.has(item.id))
    .sort((a, b) => {
      const catA = productFor(a, catalog) as CatalogItem; const catB = productFor(b, catalog) as CatalogItem;
      return orderFor(style, catA.category) - orderFor(style, catB.category)
        || catB.dims.w * catB.dims.d - catA.dims.w * catA.dims.d || a.id.localeCompare(b.id);
    });

  for (const item of arrangeable) {
    const cat = productFor(item, catalog) as CatalogItem;
    const requests = requestsFor(item, cat, style, working, room, catalog, seed, focal, media, spanCache);
    const placed = placeOne(working, room, item, cat, requests, catalog, style === "work" && cat.category === "chair");
    if (!placed) return { furniture: original, moved: [], kept: roomItems.map((entry) => entry.id), note: `${room.name} kept its existing valid layout; no complete ${style} fit` };
    working.furniture.push(placed);
  }

  const arranged = new Map(working.furniture.filter((item) => item.roomId === roomId).map((item) => [item.id, item]));
  const furniture = original.map((item) => clone(arranged.get(item.id) ?? item));
  const moved = roomItems.flatMap((from) => {
    const to = arranged.get(from.id) ?? from;
    return from.pos.x === to.pos.x && from.pos.y === to.pos.y && from.rotation === to.rotation
      ? [] : [{ id: from.id, from: { ...from.pos }, to: { ...to.pos }, rotation: to.rotation }];
  });
  const movedIds = new Set(moved.map((entry) => entry.id));
  const kept = roomItems.filter((item) => !movedIds.has(item.id)).map((item) => item.id);
  return { furniture, moved, kept, note: `Arranged ${room.name} for ${style} · ${moved.length} moved` };
}
