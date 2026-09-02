import type { Catalog } from "./catalog";
import { turningCircleDiameter } from "./clearance";
import { footprint, polyInside, polysOverlap } from "./geometry";
import type { CatalogItem, Category, Furniture, Scene, Vec2 } from "./types";
import { productFor } from "./catalog";

const CIRCLE_RADIUS = turningCircleDiameter / 2;
const REACH_DEPTH_CM = 120;
const TURNING_CATEGORIES = new Set<Category>(["bed", "desk", "sofa"]);
const REACH_CATEGORIES = new Set<Category>(["wardrobe", "shelf", "desk", "tv-unit"]);
const NON_BLOCKING = new Set<Category>(["rug", "table-lamp", "decor"]);

/** A sampled 150 cm turning circle and the reasons it does or does not fit. */
export interface TurningCircleCandidate {
  center: Vec2;
  /** Sixteen-point room-local circle approximation in centimetres. */
  zone: Vec2[];
  blockers: string[];
  inside: boolean;
  fits: boolean;
}

/** A geometric accessibility issue consumed by the conflict aggregator. */
export interface AccessibilityIssue {
  kind: "turning_circle" | "reach";
  item: Furniture;
  zone: Vec2[];
  blockers: string[];
  outside: boolean;
}

interface Obstacle {
  id: string;
  poly: Vec2[];
}

function vectors(rotation: Furniture["rotation"]): { front: Vec2; right: Vec2 } {
  switch (rotation) {
    case 0: return { front: { x: 0, y: 1 }, right: { x: 1, y: 0 } };
    case 90: return { front: { x: -1, y: 0 }, right: { x: 0, y: 1 } };
    case 180: return { front: { x: 0, y: -1 }, right: { x: -1, y: 0 } };
    case 270: return { front: { x: 1, y: 0 }, right: { x: 0, y: -1 } };
  }
}

function offset(point: Vec2, along: Vec2, distance: number): Vec2 {
  return { x: point.x + along.x * distance, y: point.y + along.y * distance };
}

function circle(center: Vec2): Vec2[] {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = index * Math.PI * 2 / 16;
    return { x: center.x + Math.cos(angle) * CIRCLE_RADIUS, y: center.y + Math.sin(angle) * CIRCLE_RADIUS };
  });
}

function shifts(limit: number): number[] {
  const result = [0];
  for (let distance = 10; distance < limit; distance += 10) result.push(-distance, distance);
  if (limit > 0 && result.every((value) => Math.abs(value) !== limit)) result.push(-limit, limit);
  return result;
}

function obstacles(scene: Scene, roomId: string, itemId: string, catalog: Catalog): Obstacle[] {
  return scene.furniture
    .filter((candidate) => candidate.roomId === roomId && candidate.id !== itemId && candidate.status === "placed")
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((candidate) => {
      const cat = productFor(candidate, catalog);
      return cat && !NON_BLOCKING.has(cat.category) ? [{ id: candidate.id, poly: footprint(candidate, cat) }] : [];
    });
}

function candidateCenters(item: Furniture, cat: CatalogItem): Vec2[] {
  const { front, right } = vectors(item.rotation);
  if (cat.category === "bed") {
    const along = shifts(Math.max(0, cat.dims.d / 2 - CIRCLE_RADIUS));
    const result: Vec2[] = [];
    for (const side of [-1, 1]) {
      const sideCenter = offset(item.pos, right, side * (cat.dims.w / 2 + CIRCLE_RADIUS));
      for (const shift of along) result.push(offset(sideCenter, front, shift));
    }
    return result;
  }
  if (cat.category === "desk" || cat.category === "sofa") {
    const frontCenter = offset(item.pos, front, cat.dims.d / 2 + CIRCLE_RADIUS);
    return shifts(cat.dims.w / 2).map((shift) => offset(frontCenter, right, shift));
  }
  return [];
}

/**
 * Samples deterministic 150 cm circles beside a bed or in front of a desk/sofa.
 * Missing rooms, products, and unsupported categories return an empty array.
 */
export function turningCircleCandidates(
  scene: Scene,
  roomId: string,
  item: Furniture,
  catalog: Catalog,
): TurningCircleCandidate[] {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  const cat = productFor(item, catalog);
  if (!room || !cat || item.roomId !== roomId || !TURNING_CATEGORIES.has(cat.category)) return [];
  const roomObstacles = obstacles(scene, roomId, item.id, catalog);
  return candidateCenters(item, cat).map((candidateCenter) => {
    const zone = circle(candidateCenter);
    const inside = polyInside(room.poly, zone);
    const blockers = roomObstacles.filter((obstacle) => polysOverlap(zone, obstacle.poly)).map((obstacle) => obstacle.id);
    return { center: candidateCenter, zone, blockers, inside, fits: inside && blockers.length === 0 };
  });
}

/**
 * Returns the first fitting turning circle, or the least-obstructed candidate for an overlay.
 * Returns undefined when the room, product, or category cannot produce candidates.
 */
export function findTurningCircle(
  scene: Scene,
  roomId: string,
  item: Furniture,
  catalog: Catalog,
): TurningCircleCandidate | undefined {
  const candidates = turningCircleCandidates(scene, roomId, item, catalog);
  const fitting = candidates.find((candidate) => candidate.fits);
  if (fitting) return fitting;
  return candidates.reduce<TurningCircleCandidate | undefined>((best, candidate) => {
    if (!best) return candidate;
    const score = (candidate.inside ? 0 : 1_000) + candidate.blockers.length * 100;
    const bestScore = (best.inside ? 0 : 1_000) + best.blockers.length * 100;
    return score < bestScore ? candidate : best;
  }, undefined);
}

/**
 * Returns the 120 cm front reach rectangle in room-local centimetres.
 * Categories without an accessibility reach rule return an empty polygon.
 */
export function reachZone(item: Furniture, cat: CatalogItem): Vec2[] {
  if (!REACH_CATEGORIES.has(cat.category)) return [];
  const { front, right } = vectors(item.rotation);
  const center = offset(item.pos, front, cat.dims.d / 2 + REACH_DEPTH_CM / 2);
  const halfWidth = cat.dims.w / 2;
  const halfDepth = REACH_DEPTH_CM / 2;
  return [
    offset(offset(center, right, -halfWidth), front, -halfDepth),
    offset(offset(center, right, halfWidth), front, -halfDepth),
    offset(offset(center, right, halfWidth), front, halfDepth),
    offset(offset(center, right, -halfWidth), front, halfDepth),
  ];
}

/**
 * Evaluates turning-circle and front-reach geometry for one room.
 * Invalid rooms/products are skipped; inputs are never mutated.
 */
export function accessibilityIssues(scene: Scene, roomId: string, catalog: Catalog): AccessibilityIssue[] {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return [];
  const result: AccessibilityIssue[] = [];
  const items = scene.furniture
    .filter((item) => item.roomId === roomId && item.status === "placed")
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const item of items) {
    const cat = productFor(item, catalog);
    if (!cat) continue;
    if (TURNING_CATEGORIES.has(cat.category)) {
      const best = findTurningCircle(scene, roomId, item, catalog);
      if (best && !best.fits) result.push({ kind: "turning_circle", item, zone: best.zone, blockers: best.blockers, outside: !best.inside });
    }
    const zone = reachZone(item, cat);
    if (zone.length === 0) continue;
    const itemObstacles = obstacles(scene, roomId, item.id, catalog);
    const blockers = itemObstacles.filter((obstacle) => polysOverlap(zone, obstacle.poly)).map((obstacle) => obstacle.id);
    const outside = !polyInside(room.poly, zone);
    if (outside || blockers.length > 0) result.push({ kind: "reach", item, zone, blockers, outside });
  }
  return result;
}
