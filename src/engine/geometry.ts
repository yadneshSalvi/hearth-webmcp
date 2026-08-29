import type { Catalog } from "./catalog";
import type { CatalogItem, Furniture, Opening, Room, Rotation, Scene, Side, Span, Vec2, Wall } from "./types";

const EPSILON = 1e-7;

/** A window blocks furniture only when the product rises above its sill. */
export function blocksWindow(cat: Pick<CatalogItem, "dims">, opening: Opening): boolean {
  return opening.kind === "window" && cat.dims.h > (opening.sillHeight ?? 90);
}

/** Returns the room walls in polygon order; lengths are centimetres. */
export function walls(room: Room): Wall[] {
  return room.poly.map((a, index) => {
    const b = room.poly[(index + 1) % room.poly.length] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const outwardX = dy / length;
    const outwardY = -dx / length;
    let side: Side;
    if (Math.abs(outwardX) > Math.abs(outwardY)) side = outwardX > 0 ? "east" : "west";
    else side = outwardY > 0 ? "south" : "north";
    return { id: `w${index}`, side, a: { ...a }, b: { ...b }, length };
  });
}

/** Finds a derived wall by id, case-insensitively; returns undefined on failure. */
export function wallById(room: Room, id: string): Wall | undefined {
  const normalized = id.trim().toLowerCase();
  return walls(room).find((wall) => wall.id.toLowerCase() === normalized);
}

/** Finds the longest wall on a side; returns undefined when that side is absent. */
export function wallBySide(room: Room, side: Side): Wall | undefined {
  return walls(room)
    .filter((wall) => wall.side === side)
    .sort((a, b) => b.length - a.length)[0];
}

/** Resolves a wall id or compass side, case-insensitively; returns undefined on failure. */
export function resolveWall(room: Room, ref: string): Wall | undefined {
  const normalized = ref.trim().toLowerCase();
  if (normalized === "north" || normalized === "east" || normalized === "south" || normalized === "west") {
    return wallBySide(room, normalized);
  }
  return wallById(room, normalized);
}

/** Returns the axis-aligned footprint extents after a quarter-turn rotation. */
export function rotateDims(dims: { w: number; d: number }, rotation: Rotation): { w: number; d: number } {
  return rotation === 90 || rotation === 270 ? { w: dims.d, d: dims.w } : { w: dims.w, d: dims.d };
}

/** Creates four clockwise corners for an axis-aligned rectangle in centimetres. */
export function rectPoly(center: Vec2, w: number, d: number): Vec2[] {
  const halfW = w / 2;
  const halfD = d / 2;
  return [
    { x: center.x - halfW, y: center.y - halfD },
    { x: center.x + halfW, y: center.y - halfD },
    { x: center.x + halfW, y: center.y + halfD },
    { x: center.x - halfW, y: center.y + halfD },
  ];
}

/** Returns four clockwise, axis-aligned footprint corners for a placed item. */
export function footprint(item: Furniture, cat: CatalogItem): Vec2[] {
  const dims = rotateDims(cat.dims, item.rotation);
  return rectPoly(item.pos, dims.w, dims.d);
}

/** Returns the axis-aligned bounds of a non-empty polygon. */
export function polyBBox(poly: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; d: number } {
  if (poly.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, d: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of poly) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY };
}

/** Returns polygon area in square centimetres using the shoelace formula. */
export function polyArea(poly: Vec2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < poly.length; index += 1) {
    const a = poly[index] as Vec2;
    const b = poly[(index + 1) % poly.length] as Vec2;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > EPSILON) return false;
  return point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}

/** Tests polygon containment; points on an edge count as inside. */
export function pointInPoly(point: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previous = poly.length - 1; index < poly.length; previous = index, index += 1) {
    const a = poly[index] as Vec2;
    const b = poly[previous] as Vec2;
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properSegmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
}

/** Tests whether every inner vertex lies in outer without crossing its boundary. */
export function polyInside(outer: Vec2[], inner: Vec2[]): boolean {
  if (!inner.every((point) => pointInPoly(point, outer))) return false;
  for (let outerIndex = 0; outerIndex < outer.length; outerIndex += 1) {
    const a = outer[outerIndex] as Vec2;
    const b = outer[(outerIndex + 1) % outer.length] as Vec2;
    for (let innerIndex = 0; innerIndex < inner.length; innerIndex += 1) {
      const c = inner[innerIndex] as Vec2;
      const d = inner[(innerIndex + 1) % inner.length] as Vec2;
      if (properSegmentsCross(a, b, c, d)) return false;
    }
  }
  const centroid = inner.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return pointInPoly({ x: centroid.x / inner.length, y: centroid.y / inner.length }, outer);
}

function isOrthogonal(poly: Vec2[]): boolean {
  return poly.every((point, index) => {
    const next = poly[(index + 1) % poly.length] as Vec2;
    return Math.abs(point.x - next.x) < EPSILON || Math.abs(point.y - next.y) < EPSILON;
  });
}

function decomposeOrthogonal(poly: Vec2[]): Vec2[][] {
  if (poly.length <= 4 || !isOrthogonal(poly)) return [poly];
  const xs = [...new Set(poly.map((point) => point.x))].sort((a, b) => a - b);
  const rectangles: Vec2[][] = [];
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index] as number;
    const right = xs[index + 1] as number;
    const midX = (left + right) / 2;
    const intersections: number[] = [];
    for (let edge = 0; edge < poly.length; edge += 1) {
      const a = poly[edge] as Vec2;
      const b = poly[(edge + 1) % poly.length] as Vec2;
      if (Math.abs(a.y - b.y) < EPSILON && midX > Math.min(a.x, b.x) && midX < Math.max(a.x, b.x)) {
        intersections.push(a.y);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let yIndex = 0; yIndex + 1 < intersections.length; yIndex += 2) {
      const top = intersections[yIndex] as number;
      const bottom = intersections[yIndex + 1] as number;
      rectangles.push(rectPoly({ x: (left + right) / 2, y: (top + bottom) / 2 }, right - left, bottom - top));
    }
  }
  return rectangles.length > 0 ? rectangles : [poly];
}

function projection(poly: Vec2[], axis: Vec2): { min: number; max: number } {
  const values = poly.map((point) => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function satOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let index = 0; index < poly.length; index += 1) {
      const start = poly[index] as Vec2;
      const end = poly[(index + 1) % poly.length] as Vec2;
      const axis = { x: -(end.y - start.y), y: end.x - start.x };
      const pA = projection(a, axis);
      const pB = projection(b, axis);
      if (pA.max <= pB.min + EPSILON || pB.max <= pA.min + EPSILON) return false;
    }
  }
  return true;
}

/** Tests positive-area polygon overlap; boundary touching is not overlap. */
export function polysOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (a.length < 3 || b.length < 3 || polyArea(a) <= EPSILON || polyArea(b) <= EPSILON) return false;
  const aBox = polyBBox(a);
  const bBox = polyBBox(b);
  if (aBox.maxX <= bBox.minX + EPSILON || bBox.maxX <= aBox.minX + EPSILON
    || aBox.maxY <= bBox.minY + EPSILON || bBox.maxY <= aBox.minY + EPSILON) return false;
  return decomposeOrthogonal(a).some((partA) => decomposeOrthogonal(b).some((partB) => satOverlap(partA, partB)));
}

/** Returns overlap area for axis-aligned rectangles, or zero when disjoint/touching. */
export function overlapArea(a: Vec2[], b: Vec2[]): number {
  const aBox = polyBBox(a);
  const bBox = polyBBox(b);
  const width = Math.max(0, Math.min(aBox.maxX, bBox.maxX) - Math.max(aBox.minX, bBox.minX));
  const depth = Math.max(0, Math.min(aBox.maxY, bBox.maxY) - Math.max(aBox.minY, bBox.minY));
  return width * depth;
}

/** Returns room floor area in square centimetres. */
export function roomArea(room: Room): number {
  return polyArea(room.poly);
}

/** Returns room floor area in square metres rounded to one decimal place. */
export function roomAreaM2(room: Room): number {
  return Math.round((roomArea(room) / 10_000) * 10) / 10;
}

/** Returns the room bounding size as WIDTHxDEPTH in centimetres. */
export function roomSize(room: Room): string {
  const box = polyBBox(room.poly);
  return `${box.w}x${box.d}`;
}

function backEdge(item: Furniture, cat: CatalogItem): [Vec2, Vec2] {
  const { w, d } = cat.dims;
  switch (item.rotation) {
    case 0: return [{ x: item.pos.x - w / 2, y: item.pos.y - d / 2 }, { x: item.pos.x + w / 2, y: item.pos.y - d / 2 }];
    case 90: return [{ x: item.pos.x + d / 2, y: item.pos.y - w / 2 }, { x: item.pos.x + d / 2, y: item.pos.y + w / 2 }];
    case 180: return [{ x: item.pos.x + w / 2, y: item.pos.y + d / 2 }, { x: item.pos.x - w / 2, y: item.pos.y + d / 2 }];
    case 270: return [{ x: item.pos.x - d / 2, y: item.pos.y + w / 2 }, { x: item.pos.x - d / 2, y: item.pos.y - w / 2 }];
  }
}

function catalogLookup(catalog: Catalog | CatalogItem[], id: string): CatalogItem | undefined {
  return Array.isArray(catalog) ? catalog.find((item) => item.id === id) : catalog.byId(id);
}

function projectedDistance(wall: Wall, point: Vec2): number {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  return ((point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy) / wall.length;
}

/** Returns unblocked wall spans in centimetres from the clockwise wall start. */
export function freeSpans(
  room: Room,
  wall: Wall,
  scene: Scene,
  catalog: Catalog | CatalogItem[],
  opts: { ignoreItemIds?: string[]; minLength?: number; itemHeight?: number } = {},
): Span[] {
  const blocked: Span[] = scene.openings
    .filter((opening) => opening.roomId === room.id && opening.wallId.toLowerCase() === wall.id.toLowerCase())
    .filter((opening) => opening.kind !== "window" || opts.itemHeight === undefined || opts.itemHeight > (opening.sillHeight ?? 90))
    .map((opening) => ({ start: opening.offset, end: opening.offset + opening.width }));
  const ignored = new Set(opts.ignoreItemIds ?? []);
  for (const item of scene.furniture) {
    if (item.roomId !== room.id || item.status !== "placed" || ignored.has(item.id)) continue;
    const cat = catalogLookup(catalog, item.catalogId);
    if (!cat) continue;
    const [a, b] = backEdge(item, cat);
    if (distancePointSegment(a, wall.a, wall.b) <= 5 + EPSILON && distancePointSegment(b, wall.a, wall.b) <= 5 + EPSILON) {
      blocked.push({ start: Math.min(projectedDistance(wall, a), projectedDistance(wall, b)), end: Math.max(projectedDistance(wall, a), projectedDistance(wall, b)) });
    }
  }
  const merged = blocked
    .map((span) => ({ start: Math.max(0, Math.min(wall.length, span.start)), end: Math.max(0, Math.min(wall.length, span.end)) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start)
    .reduce<Span[]>((acc, span) => {
      const last = acc.at(-1);
      if (last && span.start <= last.end + EPSILON) last.end = Math.max(last.end, span.end);
      else acc.push({ ...span });
      return acc;
    }, []);
  const free: Span[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) free.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < wall.length) free.push({ start: cursor, end: wall.length });
  const minLength = opts.minLength ?? 20;
  return free.filter((span) => span.end - span.start + EPSILON >= minLength);
}

/** Returns the shortest distance in centimetres from a point to a line segment. */
export function distancePointSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (properSegmentsCross(a, b, c, d) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d)
    || pointOnSegment(c, a, b) || pointOnSegment(d, a, b)) return 0;
  return Math.min(distancePointSegment(a, c, d), distancePointSegment(b, c, d), distancePointSegment(c, a, b), distancePointSegment(d, a, b));
}

/** Returns the nearest footprint-edge distance to a wall in centimetres. */
export function itemToWallDistance(item: Furniture, cat: CatalogItem, wall: Wall): number {
  const poly = footprint(item, cat);
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < poly.length; index += 1) {
    nearest = Math.min(nearest, segmentDistance(poly[index] as Vec2, poly[(index + 1) % poly.length] as Vec2, wall.a, wall.b));
  }
  return nearest;
}

/** Returns the signed axis gap and direction from item A toward item B; overlap is negative. */
export function gapBetween(itemA: Furniture, itemB: Furniture, catalog: Catalog | CatalogItem[]): { gap_cm: number; direction: Side } {
  const catA = catalogLookup(catalog, itemA.catalogId);
  const catB = catalogLookup(catalog, itemB.catalogId);
  if (!catA || !catB) throw new Error("Unknown catalog item while measuring gap");
  const a = polyBBox(footprint(itemA, catA));
  const b = polyBBox(footprint(itemB, catB));
  const horizontalGap = Math.max(b.minX - a.maxX, a.minX - b.maxX);
  const verticalGap = Math.max(b.minY - a.maxY, a.minY - b.maxY);
  if (horizontalGap >= verticalGap) {
    return { gap_cm: horizontalGap, direction: itemB.pos.x >= itemA.pos.x ? "east" : "west" };
  }
  return { gap_cm: verticalGap, direction: itemB.pos.y >= itemA.pos.y ? "south" : "north" };
}

/** Snaps a centimetre value to the nearest grid multiple. */
export function snap(value: number, grid = 5): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Translates a polygon to the nearest grid position inside a room; may fail for an oversized polygon. */
export function clampInsideRoom(room: Room, poly: Vec2[]): Vec2[] {
  const clone = poly.map((point) => ({ ...point }));
  if (polyInside(room.poly, clone)) return clone;
  const roomBox = polyBBox(room.poly);
  const box = polyBBox(clone);
  const baseX = Math.min(Math.max(0, roomBox.minX - box.minX), roomBox.maxX - box.maxX);
  const baseY = Math.min(Math.max(0, roomBox.minY - box.minY), roomBox.maxY - box.maxY);
  const moved = clone.map((point) => ({ x: point.x + baseX, y: point.y + baseY }));
  if (polyInside(room.poly, moved)) return moved;
  let best: { distance: number; poly: Vec2[] } | undefined;
  for (let y = roomBox.minY - box.minY; y <= roomBox.maxY - box.maxY; y += 5) {
    for (let x = roomBox.minX - box.minX; x <= roomBox.maxX - box.maxX; x += 5) {
      const candidate = clone.map((point) => ({ x: point.x + x, y: point.y + y }));
      const distance = x * x + y * y;
      if (polyInside(room.poly, candidate) && (!best || distance < best.distance)) best = { distance, poly: candidate };
    }
  }
  return best?.poly ?? moved;
}

/** Converts a world-space centimetre point into a room-local point. */
export function worldToRoom(room: Room, point: Vec2): Vec2 {
  return { x: point.x - room.origin.x, y: point.y - room.origin.y };
}

/** Converts a room-local centimetre point into world space. */
export function roomToWorld(room: Room, point: Vec2): Vec2 {
  return { x: point.x + room.origin.x, y: point.y + room.origin.y };
}

/** Returns the rotation that places an item's back flush against a compass wall. */
export function rotationForWall(side: Side): Rotation {
  return { north: 0, east: 90, south: 180, west: 270 }[side] as Rotation;
}

/** Returns an item centre with its back flush to a wall at the given wall distance in cm. */
export function backAgainstWall(wall: Wall, along: number, cat: CatalogItem, rotation: Rotation): Vec2 {
  const dx = (wall.b.x - wall.a.x) / wall.length;
  const dy = (wall.b.y - wall.a.y) / wall.length;
  const point = { x: wall.a.x + dx * along, y: wall.a.y + dy * along };
  const dims = rotateDims(cat.dims, rotation);
  const perpendicularDepth = Math.abs(dx) > Math.abs(dy) ? dims.d : dims.w;
  return { x: point.x - dy * perpendicularDepth / 2, y: point.y + dx * perpendicularDepth / 2 };
}
