/**
 * Pure interaction maths for direct manipulation: frame conversion, magnetic snapping
 * (wall flush → neighbour alignment → 5 cm grid), live dimension lines, neighbour gaps and
 * stacking targets. No three, no React — every export here is unit-tested without WebGL.
 *
 * Frames (SCENE_SCHEMA.md): room-local centimetres with the origin at the room's north-west
 * corner, x east, y south. World centimetres add `room.origin`. The renderer's three.js frame is
 * metres with x ← world x and z ← world y, so the cm → m conversion happens exactly once.
 */
import { polyBBox, polyInside, rectPoly, rotateDims, rotationForWall, walls } from "../engine/geometry";
import type { CatalogItem, Conflict, Furniture, Room, Rotation, Side, Vec2, Wall } from "../engine/types";
import { M } from "./math";

const EPSILON = 1e-6;

/** A back edge this close to a wall snaps flush (STYLE.md §3 magnetic feel). */
export const WALL_SNAP_CM = 12;
/** Edge/centre alignment with a neighbour inside this distance snaps. */
export const ALIGN_SNAP_CM = 8;
/** Everything that is neither wall-flush nor aligned lands on this grid. */
export const GRID_CM = 5;
/**
 * Release band multiplier. A snap that is already engaged only lets go at `threshold × this`, so
 * a hand hovering exactly on the boundary cannot make the item flicker in and out of the snap.
 */
export const HYSTERESIS = 1.6;

/** Room-local centimetres → world centimetres. */
export function roomToWorldCm(room: Room, local: Vec2): Vec2 {
  return { x: local.x + room.origin.x, y: local.y + room.origin.y };
}

/** World centimetres → room-local centimetres. */
export function worldToRoomCm(room: Room, world: Vec2): Vec2 {
  return { x: world.x - room.origin.x, y: world.y - room.origin.y };
}

/** A point on the renderer's y = 0 floor plane (metres) → world centimetres. */
export function threeToWorldCm(point: { x: number; z: number }): Vec2 {
  return { x: point.x / M, y: point.z / M };
}

/** World centimetres → a floor-plane position in the renderer's metres. */
export function worldCmToThree(world: Vec2, y = 0): [number, number, number] {
  return [world.x * M, y, world.y * M];
}

/** The room whose polygon contains a world-centimetre point; `prefer` wins ties to stop flicker. */
export function roomAtWorldCm(rooms: readonly Room[], world: Vec2, prefer?: string): Room | undefined {
  const hits = rooms.filter((room) => pointInside(room.poly, worldToRoomCm(room, world)));
  return hits.find((room) => room.id === prefer) ?? hits[0];
}

/** Half the axis-aligned footprint extent of a product at a rotation, per axis. */
export function halfExtent(product: CatalogItem, rotation: Rotation): Vec2 {
  const dims = rotateDims(product.dims, rotation);
  return { x: dims.w / 2, y: dims.d / 2 };
}

/** The axis-aligned footprint of a hypothetical placement, without needing a Furniture record. */
export function poseFootprint(product: CatalogItem, pos: Vec2, rotation: Rotation): Vec2[] {
  const dims = rotateDims(product.dims, rotation);
  return rectPoly(pos, dims.w, dims.d);
}

/** Clamps a centre so the whole footprint stays inside the room's bounding box. */
export function clampCentreInsideRoom(room: Room, product: CatalogItem, pos: Vec2, rotation: Rotation): Vec2 {
  const box = polyBBox(room.poly);
  const half = halfExtent(product, rotation);
  return {
    x: clampRange(pos.x, box.minX + half.x, box.maxX - half.x),
    y: clampRange(pos.y, box.minY + half.y, box.maxY - half.y),
  };
}

function clampRange(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return value < min ? min : value > max ? max : value;
}

function pointInside(poly: Vec2[], point: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type Axis = "x" | "y";

interface WallLine {
  wall: Wall;
  axis: Axis;
  /** Room-local coordinate of the wall face. */
  line: number;
  /** +1 or −1: the direction along `axis` that points into the room. */
  inward: 1 | -1;
  /** Wall extent along the other axis. */
  span: { min: number; max: number };
}

/** Decomposes a room's walls into axis-aligned lines with an inward direction. */
export function wallLines(room: Room): WallLine[] {
  return walls(room).map((wall) => {
    const vertical = Math.abs(wall.b.x - wall.a.x) < Math.abs(wall.b.y - wall.a.y);
    const axis: Axis = vertical ? "x" : "y";
    const inward: 1 | -1 = wall.side === "north" || wall.side === "west" ? 1 : -1;
    const other: Axis = vertical ? "y" : "x";
    return {
      wall,
      axis,
      line: vertical ? wall.a.x : wall.a.y,
      inward,
      span: { min: Math.min(wall.a[other], wall.b[other]), max: Math.max(wall.a[other], wall.b[other]) },
    };
  });
}

/** Which snaps are currently engaged, so the next frame can widen their release band. */
export interface SnapMemory {
  wallX?: string;
  wallY?: string;
  guideX?: string;
  guideY?: string;
}

export interface WallSnapRequest {
  room: Room;
  product: CatalogItem;
  pos: Vec2;
  rotation: Rotation;
  /** false while Alt is held or for products that do not want a wall. */
  allowRotate: boolean;
  threshold?: number;
  memory?: SnapMemory;
}

export interface WallSnapResult {
  pos: Vec2;
  rotation: Rotation;
  /** Snapped wall id per axis, at most one each. */
  walls: { x?: string; y?: string };
  /** The wall side that drove the rotation, when the item turned to face away from it. */
  rotatedTo?: Side;
  snapped: Axis[];
}

/**
 * Priority 1: wall flush. The nearest footprint edge inside `threshold` of a wall pulls the item
 * flush to it, at most one wall per axis so a corner catches both. For `againstWall` products the
 * closest wall also sets the rotation, turning the item's back to it (`rotationForWall`).
 */
export function snapToWalls(request: WallSnapRequest): WallSnapResult {
  const { room, product, pos, allowRotate } = request;
  const base = request.threshold ?? WALL_SNAP_CM;
  const memory = request.memory ?? {};
  const half = halfExtent(product, request.rotation);
  const candidates: { line: WallLine; distance: number }[] = [];

  for (const line of wallLines(room)) {
    const other: Axis = line.axis === "x" ? "y" : "x";
    const otherHalf = other === "x" ? half.x : half.y;
    if (pos[other] + otherHalf <= line.span.min + EPSILON || pos[other] - otherHalf >= line.span.max - EPSILON) continue;
    const edge = pos[line.axis] - line.inward * (line.axis === "x" ? half.x : half.y);
    const distance = Math.abs(edge - line.line);
    const sticky = memory[line.axis === "x" ? "wallX" : "wallY"] === line.wall.id;
    if (distance > base * (sticky ? HYSTERESIS : 1)) continue;
    candidates.push({ line, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);

  const nearest = candidates[0];
  const rotation = allowRotate && product.againstWall === true && nearest ? rotationForWall(nearest.line.wall.side) : request.rotation;
  const finalHalf = halfExtent(product, rotation);
  const result: WallSnapResult = { pos: { ...pos }, rotation, walls: {}, snapped: [] };
  if (allowRotate && product.againstWall === true && nearest) result.rotatedTo = nearest.line.wall.side;

  for (const axis of ["x", "y"] as Axis[]) {
    const pick = candidates.find((candidate) => candidate.line.axis === axis);
    if (!pick) continue;
    const extent = axis === "x" ? finalHalf.x : finalHalf.y;
    result.pos[axis] = pick.line.line + pick.line.inward * extent;
    result.walls[axis] = pick.line.wall.id;
    result.snapped.push(axis);
  }
  return result;
}

export type AlignKind = "min" | "center" | "max";

export interface AlignGuide {
  /** Stable key used for snap hysteresis. */
  key: string;
  axis: Axis;
  /** Room-local coordinate of the guide line. */
  at: number;
  /** Guide extent along the other axis, room-local. */
  from: number;
  to: number;
  itemId: string;
  kind: AlignKind;
}

export interface NeighbourRef {
  item: Furniture;
  product: CatalogItem;
}

export interface AlignRequest {
  product: CatalogItem;
  pos: Vec2;
  rotation: Rotation;
  neighbours: readonly NeighbourRef[];
  /** Axes already claimed by a wall snap; alignment leaves them alone. */
  skip?: Partial<Record<Axis, boolean>>;
  threshold?: number;
  memory?: SnapMemory;
}

export interface AlignResult {
  pos: Vec2;
  guides: AlignGuide[];
}

const KINDS: readonly AlignKind[] = ["min", "center", "max"];

function edgeValue(box: { min: number; max: number }, kind: AlignKind): number {
  return kind === "min" ? box.min : kind === "max" ? box.max : (box.min + box.max) / 2;
}

function spans(product: CatalogItem, pos: Vec2, rotation: Rotation): Record<Axis, { min: number; max: number }> {
  const half = halfExtent(product, rotation);
  return {
    x: { min: pos.x - half.x, max: pos.x + half.x },
    y: { min: pos.y - half.y, max: pos.y + half.y },
  };
}

/**
 * Priority 2: neighbour alignment. Edges and centres that come within `threshold` of another
 * item's edge or centre lock together and publish a guide line for the renderer to draw.
 */
export function alignToNeighbours(request: AlignRequest): AlignResult {
  const base = request.threshold ?? ALIGN_SNAP_CM;
  const memory = request.memory ?? {};
  const self = spans(request.product, request.pos, request.rotation);
  const pos = { ...request.pos };
  const guides: AlignGuide[] = [];

  for (const axis of ["x", "y"] as Axis[]) {
    if (request.skip?.[axis]) continue;
    const other: Axis = axis === "x" ? "y" : "x";
    let best: { delta: number; guide: AlignGuide } | undefined;
    for (const neighbour of request.neighbours) {
      const theirs = spans(neighbour.product, neighbour.item.pos, neighbour.item.rotation);
      for (const selfKind of KINDS) {
        for (const theirKind of KINDS) {
          const delta = edgeValue(theirs[axis], theirKind) - edgeValue(self[axis], selfKind);
          const key = `${neighbour.item.id}:${axis}:${selfKind}:${theirKind}`;
          const sticky = memory[axis === "x" ? "guideX" : "guideY"] === key;
          if (Math.abs(delta) > base * (sticky ? HYSTERESIS : 1)) continue;
          if (best && Math.abs(delta) >= Math.abs(best.delta) && !sticky) continue;
          best = {
            delta,
            guide: {
              key,
              axis,
              at: edgeValue(theirs[axis], theirKind),
              from: Math.min(self[other].min, theirs[other].min) - 12,
              to: Math.max(self[other].max, theirs[other].max) + 12,
              itemId: neighbour.item.id,
              kind: theirKind,
            },
          };
        }
      }
    }
    if (!best) continue;
    pos[axis] += best.delta;
    guides.push(best.guide);
  }
  return { pos, guides };
}

/** Priority 3: the 5 cm grid, applied only to axes no wall or guide has claimed. */
export function gridSnap(pos: Vec2, free: Partial<Record<Axis, boolean>> = { x: true, y: true }, grid = GRID_CM): Vec2 {
  const step = (value: number) => (grid > 0 ? Math.round(value / grid) * grid : value);
  return { x: free.x ? step(pos.x) : pos.x, y: free.y ? step(pos.y) : pos.y };
}

export interface DimensionLine {
  side: Side;
  axis: Axis;
  /** Room-local endpoints: `a` on the footprint edge, `b` on the wall. */
  a: Vec2;
  b: Vec2;
  /** Rounded gap in centimetres. */
  cm: number;
}

const RAYS: readonly { side: Side; dir: Vec2 }[] = [
  { side: "north", dir: { x: 0, y: -1 } },
  { side: "east", dir: { x: 1, y: 0 } },
  { side: "south", dir: { x: 0, y: 1 } },
  { side: "west", dir: { x: -1, y: 0 } },
];

/**
 * Live dimension lines: from the middle of each footprint edge to the nearest room boundary in
 * that direction. Ray-casts the room polygon, so an L-room measures to the wall that is actually
 * there rather than to a bounding box.
 */
export function dimensionLines(room: Room, foot: Vec2[]): DimensionLine[] {
  const box = polyBBox(foot);
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  const origins: Record<Side, Vec2> = {
    north: { x: midX, y: box.minY },
    east: { x: box.maxX, y: midY },
    south: { x: midX, y: box.maxY },
    west: { x: box.minX, y: midY },
  };
  const lines: DimensionLine[] = [];
  for (const ray of RAYS) {
    const origin = origins[ray.side];
    const distance = rayToPolygon(origin, ray.dir, room.poly);
    // A flush edge has nothing to measure; drawing a zero-length line would leave a stray tick.
    if (distance === undefined || distance < 1) continue;
    lines.push({
      side: ray.side,
      axis: ray.dir.x === 0 ? "y" : "x",
      a: { ...origin },
      b: { x: origin.x + ray.dir.x * distance, y: origin.y + ray.dir.y * distance },
      cm: Math.round(distance),
    });
  }
  return lines;
}

/** Distance from `origin` along `dir` to the nearest polygon edge, or undefined when it misses. */
export function rayToPolygon(origin: Vec2, dir: Vec2, poly: Vec2[]): number | undefined {
  let nearest: number | undefined;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominator = dir.x * ey - dir.y * ex;
    if (Math.abs(denominator) < EPSILON) continue;
    const ox = a.x - origin.x;
    const oy = a.y - origin.y;
    const t = (ox * ey - oy * ex) / denominator;
    const u = (ox * dir.y - oy * dir.x) / denominator;
    if (t < -EPSILON || u < -EPSILON || u > 1 + EPSILON) continue;
    if (nearest === undefined || t < nearest) nearest = t;
  }
  return nearest;
}

export interface NeighbourGap {
  itemId: string;
  axis: Axis;
  cm: number;
  a: Vec2;
  b: Vec2;
}

/**
 * The gap to the nearest item along one axis, measured edge to edge between the two footprints,
 * for the "…and 40 cm to the armchair" readout under the pointer.
 */
export function neighbourGap(
  product: CatalogItem,
  pos: Vec2,
  rotation: Rotation,
  neighbours: readonly NeighbourRef[],
  axis: Axis,
): NeighbourGap | undefined {
  const self = spans(product, pos, rotation);
  const other: Axis = axis === "x" ? "y" : "x";
  let best: NeighbourGap | undefined;
  for (const neighbour of neighbours) {
    const theirs = spans(neighbour.product, neighbour.item.pos, neighbour.item.rotation);
    const overlapMin = Math.max(self[other].min, theirs[other].min);
    const overlapMax = Math.min(self[other].max, theirs[other].max);
    if (overlapMax - overlapMin <= EPSILON) continue;
    const ahead = theirs[axis].min - self[axis].max;
    const behind = self[axis].min - theirs[axis].max;
    const gap = Math.max(ahead, behind);
    if (gap < 0) continue;
    if (best && gap >= best.cm) continue;
    const mid = (overlapMin + overlapMax) / 2;
    const near = ahead >= behind ? self[axis].max : self[axis].min;
    const far = ahead >= behind ? theirs[axis].min : theirs[axis].max;
    best = {
      itemId: neighbour.item.id,
      axis,
      cm: Math.round(gap),
      a: axis === "x" ? { x: near, y: mid } : { x: mid, y: near },
      b: axis === "x" ? { x: far, y: mid } : { x: mid, y: far },
    };
  }
  return best;
}

/** Categories that may rest on a surface, and the surfaces they may rest on (SCENE_SCHEMA.md). */
export const STACKABLE_CATEGORIES: readonly string[] = ["table-lamp", "decor"];
export const SURFACE_CATEGORIES: readonly string[] = ["table", "desk", "shelf", "tv-unit"];

export interface StackTarget {
  itemId: string;
  heightCm: number;
}

/**
 * The surface a stackable footprint is resting fully inside, if any. A lamp entirely on a table is
 * a legal placement and the renderer elevates it; a lamp hanging over the edge is not.
 */
export function stackSurfaceFor(product: CatalogItem, foot: Vec2[], others: readonly NeighbourRef[]): StackTarget | undefined {
  if (!STACKABLE_CATEGORIES.includes(product.category)) return undefined;
  let best: StackTarget | undefined;
  for (const other of others) {
    if (!SURFACE_CATEGORIES.includes(other.product.category)) continue;
    if (!polyInside(poseFootprint(other.product, other.item.pos, other.item.rotation), foot)) continue;
    if (!best || other.product.dims.h > best.heightCm) best = { itemId: other.item.id, heightCm: other.product.dims.h };
  }
  return best;
}

/** A ≤ 44-character chip explaining why a placement is refused, from an engine conflict. */
export function conflictReason(conflict: Conflict, itemId: string): string {
  const others = conflict.items.filter((id) => id !== itemId);
  const first = others[0];
  switch (conflict.kind) {
    case "overlap":
      return first ? `overlaps ${first}` : "overlaps another item";
    case "outside":
      return "outside the room";
    case "clearance":
      return first ? `blocks ${first}'s clearance` : "not enough clearance";
    case "door_swing":
      return first ? `blocks ${first}'s swing` : "blocks a door";
    case "traffic":
      return "blocks the walkway";
    case "access_path":
      return "blocks the accessible path";
    case "turning_circle":
      return "no turning circle";
    case "reach":
      return "out of reach";
  }
}
