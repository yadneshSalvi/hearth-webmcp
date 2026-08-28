import { accessibilityIssues } from "./access";
import type { Catalog } from "./catalog";
import { clearanceZone, walkwayMin } from "./clearance";
import { openingClearZone, swingZone } from "./doors";
import { footprint, overlapArea, pointInPoly, polyArea, polyBBox, polyInside, polysOverlap, rectPoly } from "./geometry";
import { trafficPaths } from "./traffic";
import type { CatalogItem, Conflict, ConflictKind, Furniture, Room, Scene, Side, Vec2 } from "./types";

const EPSILON = 1e-7;
const STACKABLES = new Set(["table-lamp", "decor"]);
const SURFACES = new Set(["table", "desk", "shelf", "tv-unit"]);
const KIND_ORDER: ConflictKind[] = ["overlap", "outside", "clearance", "door_swing", "traffic", "access_path", "turning_circle", "reach"];
const DIRECTIONS: Array<readonly [Side, Vec2]> = [
  ["north", { x: 0, y: -1 }], ["east", { x: 1, y: 0 }], ["south", { x: 0, y: 1 }], ["west", { x: -1, y: 0 }],
];

/** Options shared by room and whole-home conflict evaluation. */
export interface ConflictOptions {
  /** Enables 90 cm paths, turning circles, and reach rules. Defaults to scene metadata. */
  accessibility?: boolean;
}

interface ResolvedItem {
  item: Furniture;
  cat: CatalogItem;
  poly: Vec2[];
}

interface Move {
  itemId: string;
  cm: number;
  direction: Side;
}

function bounded(value: string): string {
  return value.length <= 80 ? value : value.slice(0, 80);
}

function translate(poly: Vec2[], vector: Vec2, distance: number): Vec2[] {
  return poly.map((point) => ({ x: point.x + vector.x * distance, y: point.y + vector.y * distance }));
}

function findMove(itemId: string, predicate: (vector: Vec2, cm: number) => boolean, maxCm: number): Move | undefined {
  for (let cm = 5; cm <= maxCm; cm += 5) {
    for (const [direction, vector] of DIRECTIONS) if (predicate(vector, cm)) return { itemId, cm, direction };
  }
  return undefined;
}

function shorter(a: Move | undefined, b: Move | undefined): Move | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.cm <= b.cm ? a : b;
}

function moveText(move: Move | undefined, fallbackId: string): string {
  return bounded(move ? `move ${move.itemId} ${move.cm} cm ${move.direction}` : `move ${fallbackId} 5 cm north, then recheck`);
}

function resolvedItems(scene: Scene, roomId: string, catalog: Catalog): ResolvedItem[] {
  return scene.furniture
    .filter((item) => item.roomId === roomId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((item) => {
      const cat = catalog.byId(item.catalogId);
      return cat ? [{ item, cat, poly: footprint(item, cat) }] : [];
    });
}

function stackingAllowed(a: ResolvedItem, b: ResolvedItem): boolean {
  if (a.cat.category === "rug" || b.cat.category === "rug") return a.cat.category !== b.cat.category;
  if (STACKABLES.has(a.cat.category) && SURFACES.has(b.cat.category)) return polyInside(b.poly, a.poly);
  if (STACKABLES.has(b.cat.category) && SURFACES.has(a.cat.category)) return polyInside(a.poly, b.poly);
  return false;
}

function intersectionZone(a: Vec2[], b: Vec2[]): Vec2[] | undefined {
  const left = polyBBox(a);
  const right = polyBBox(b);
  const minX = Math.max(left.minX, right.minX);
  const minY = Math.max(left.minY, right.minY);
  const maxX = Math.min(left.maxX, right.maxX);
  const maxY = Math.min(left.maxY, right.maxY);
  return maxX > minX && maxY > minY ? rectPoly({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, maxX - minX, maxY - minY) : undefined;
}

function movePolyOut(item: ResolvedItem, zones: Vec2[][], room: Room): Move | undefined {
  const bounds = polyBBox(room.poly);
  const limit = Math.ceil(bounds.w + bounds.d);
  return findMove(item.item.id, (vector, cm) => {
    const moved = translate(item.poly, vector, cm);
    return polyInside(room.poly, moved) && zones.every((zone) => !polysOverlap(moved, zone));
  }, limit) ?? findMove(item.item.id, (vector, cm) => {
    const moved = translate(item.poly, vector, cm);
    return zones.every((zone) => !polysOverlap(moved, zone));
  }, limit);
}

function overlapConflicts(items: ResolvedItem[], room: Room): Conflict[] {
  const result: Conflict[] = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      let a = items[left] as ResolvedItem;
      let b = items[right] as ResolvedItem;
      if (a.item.status === "ghost" && b.item.status === "ghost") continue;
      if (b.item.status === "ghost") [a, b] = [b, a];
      const area = overlapArea(a.poly, b.poly);
      if (area <= 4 + EPSILON || stackingAllowed(a, b)) continue;
      const isGhost = a.item.status === "ghost";
      const ids = isGhost ? [a.item.id, b.item.id] : [a.item.id, b.item.id].sort();
      result.push({
        kind: "overlap",
        items: ids,
        roomId: room.id,
        detail: bounded(`${ids[0]} overlaps ${ids[1]} by ${Math.ceil(area)} cm²`),
        fix: moveText(movePolyOut(a, [b.poly], room), a.item.id),
        zone: intersectionZone(a.poly, b.poly),
        severity: isGhost ? "warn" : "error",
      });
    }
  }
  return result;
}

function outsideConflict(item: ResolvedItem, room: Room): Conflict | undefined {
  if (item.item.status !== "placed" || polyInside(room.poly, item.poly)) return undefined;
  const bounds = polyBBox(room.poly);
  const move = findMove(item.item.id, (vector, cm) => polyInside(room.poly, translate(item.poly, vector, cm)), Math.ceil((bounds.w + bounds.d) * 2));
  const opposite: Record<Side, Side> = { north: "south", east: "west", south: "north", west: "east" };
  const amount = move?.cm ?? 5;
  const side = move ? opposite[move.direction] : "edge";
  return {
    kind: "outside",
    items: [item.item.id],
    roomId: room.id,
    detail: bounded(`${item.item.id} is ${amount} cm outside at the ${side} side`),
    fix: moveText(move, item.item.id),
    zone: item.poly.map((point) => ({ ...point })),
    severity: "error",
  };
}

function cellObstructionArea(zone: Vec2[], room: Room, blockers: ResolvedItem[]): number {
  const box = polyBBox(zone);
  const xs = [box.minX, box.maxX, ...room.poly.map((point) => point.x), ...blockers.flatMap((item) => {
    const bounds = polyBBox(item.poly);
    return [bounds.minX, bounds.maxX];
  })].filter((value) => value >= box.minX && value <= box.maxX);
  const ys = [box.minY, box.maxY, ...room.poly.map((point) => point.y), ...blockers.flatMap((item) => {
    const bounds = polyBBox(item.poly);
    return [bounds.minY, bounds.maxY];
  })].filter((value) => value >= box.minY && value <= box.maxY);
  const sortedX = [...new Set(xs)].sort((a, b) => a - b);
  const sortedY = [...new Set(ys)].sort((a, b) => a - b);
  const blockerBoxes = blockers.map((item) => polyBBox(item.poly));
  let area = 0;
  for (let x = 0; x < sortedX.length - 1; x += 1) {
    for (let y = 0; y < sortedY.length - 1; y += 1) {
      const left = sortedX[x] as number;
      const right = sortedX[x + 1] as number;
      const top = sortedY[y] as number;
      const bottom = sortedY[y + 1] as number;
      const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
      const occupied = blockerBoxes.some((blocker) => point.x > blocker.minX && point.x < blocker.maxX && point.y > blocker.minY && point.y < blocker.maxY);
      if (!pointInPoly(point, room.poly) || occupied) area += (right - left) * (bottom - top);
    }
  }
  return area;
}

function clearanceMove(owner: ResolvedItem, zone: Vec2[], blockers: ResolvedItem[], room: Room): Move | undefined {
  const bounds = polyBBox(room.poly);
  const limit = Math.ceil(bounds.w + bounds.d);
  let best = findMove(owner.item.id, (vector, cm) => {
    const movedItem = translate(owner.poly, vector, cm);
    const movedZone = translate(zone, vector, cm);
    return polyInside(room.poly, movedItem) && polyInside(room.poly, movedZone)
      && blockers.every((blocker) => !polysOverlap(movedZone, blocker.poly));
  }, limit);
  if (blockers.length === 1) best = shorter(best, movePolyOut(blockers[0] as ResolvedItem, [zone], room));
  return best ?? findMove(owner.item.id, (vector, cm) => {
    const movedZone = translate(zone, vector, cm);
    return blockers.every((blocker) => !polysOverlap(movedZone, blocker.poly));
  }, limit);
}

function isFunctionalPair(owner: ResolvedItem, blocker: ResolvedItem): boolean {
  const pair = new Set([owner.cat.category, blocker.cat.category]);
  return pair.has("chair") && (pair.has("table") || pair.has("desk"));
}

function clearanceConflicts(items: ResolvedItem[], room: Room): Conflict[] {
  const placed = items.filter((entry) => entry.item.status === "placed");
  const result: Conflict[] = [];
  for (const owner of placed) {
    if (STACKABLES.has(owner.cat.category)) continue;
    const zone = clearanceZone(owner.item, owner.cat);
    if (zone.length === 0) continue;
    const blockers = placed.filter((candidate) => candidate.item.id !== owner.item.id && candidate.cat.category !== "rug"
      && !isFunctionalPair(owner, candidate) && overlapArea(zone, candidate.poly) > EPSILON);
    const blockedArea = cellObstructionArea(zone, room, blockers);
    const totalArea = polyArea(zone);
    if (blockedArea <= EPSILON || totalArea <= EPSILON) continue;
    const ratio = Math.min(1, blockedArea / totalArea);
    const freeCm = Math.max(0, Math.floor(owner.cat.clearanceFront * (1 - ratio) / 5) * 5);
    result.push({
      kind: "clearance",
      items: [owner.item.id, ...blockers.map((blocker) => blocker.item.id).sort()],
      roomId: room.id,
      detail: bounded(`${owner.item.id} has ${freeCm} cm clear; needs ${owner.cat.clearanceFront} cm`),
      fix: moveText(clearanceMove(owner, zone, blockers, room), blockers[0]?.item.id ?? owner.item.id),
      zone,
      severity: ratio >= 0.5 ? "error" : "warn",
    });
  }
  return result;
}

function doorConflicts(scene: Scene, items: ResolvedItem[], room: Room): Conflict[] {
  const result: Conflict[] = [];
  const openings = scene.openings.filter((opening) => opening.roomId === room.id && opening.kind !== "window").sort((a, b) => a.id.localeCompare(b.id));
  for (const item of items.filter((entry) => entry.item.status === "placed")) {
    for (const opening of openings) {
      let clear: Vec2[] | null = null;
      let swing: Vec2[] | null = null;
      try {
        clear = openingClearZone(opening, room);
        swing = swingZone(opening, room);
      } catch {
        continue;
      }
      const clearHit = clear ? polysOverlap(item.poly, clear) : false;
      const swingHit = swing ? polysOverlap(item.poly, swing) : false;
      if (!clearHit && !swingHit) continue;
      const zones = [clearHit ? clear : null, swingHit ? swing : null].filter((zone): zone is Vec2[] => zone !== null);
      result.push({
        kind: "door_swing",
        items: [item.item.id, opening.id],
        roomId: room.id,
        detail: bounded(clearHit ? `${item.item.id} blocks ${opening.id}'s 90 cm clear zone` : `${item.item.id} blocks ${opening.id}'s ${opening.width} cm swing`),
        fix: moveText(movePolyOut(item, zones, room), item.item.id),
        zone: (clearHit ? clear : swing) ?? undefined,
        severity: "error",
      });
    }
  }
  return result;
}

function center(poly: Vec2[]): Vec2 {
  const box = polyBBox(poly);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function endpointPoint(scene: Scene, room: Room, catalog: Catalog, id: string): Vec2 | undefined {
  const item = scene.furniture.find((candidate) => candidate.id === id);
  const cat = item ? catalog.byId(item.catalogId) : undefined;
  if (item && cat) {
    const zone = clearanceZone(item, cat);
    return zone.length > 0 ? center(zone) : { ...item.pos };
  }
  const opening = scene.openings.find((candidate) => candidate.id === id && candidate.roomId === room.id);
  try {
    const zone = opening ? openingClearZone(opening, room) : null;
    return zone ? center(zone) : undefined;
  } catch {
    return undefined;
  }
}

function distanceToPoly(point: Vec2, poly: Vec2[]): number {
  const box = polyBBox(poly);
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  return Math.hypot(dx, dy);
}

function pathFix(scene: Scene, room: Room, catalog: Catalog, from: string, to: string, pinch: Vec2 | undefined, required: number): string {
  const fromPoint = endpointPoint(scene, room, catalog, from);
  const toPoint = endpointPoint(scene, room, catalog, to);
  const reference = pinch ?? (fromPoint && toPoint ? { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 } : fromPoint ?? toPoint);
  const candidates = resolvedItems(scene, room.id, catalog).filter((entry) => entry.item.status === "placed" && entry.cat.category !== "rug" && !STACKABLES.has(entry.cat.category));
  if (!reference || candidates.length === 0) return bounded(`keep a ${required} cm clear route from ${from} to ${to}`);
  const blocker = [...candidates].sort((a, b) => distanceToPoly(reference, a.poly) - distanceToPoly(reference, b.poly) || a.item.id.localeCompare(b.item.id))[0] as ResolvedItem;
  const bounds = polyBBox(room.poly);
  const move = findMove(blocker.item.id, (vector, cm) => {
    const moved = translate(blocker.poly, vector, cm);
    return polyInside(room.poly, moved) && distanceToPoly(reference, moved) >= required / 2 - EPSILON;
  }, Math.ceil(bounds.w + bounds.d));
  return moveText(move, blocker.item.id);
}

function trafficConflicts(scene: Scene, room: Room, catalog: Catalog, accessibility: boolean): Conflict[] {
  const furnitureIds = new Set(scene.furniture.map((item) => item.id));
  const required = walkwayMin(accessibility);
  return trafficPaths(scene, room.id, catalog, { accessibility }).filter((path) => !path.ok).map((path) => {
    const ids = [path.from, path.to].sort((a, b) => Number(furnitureIds.has(b)) - Number(furnitureIds.has(a)) || a.localeCompare(b));
    return {
      kind: accessibility ? "access_path" : "traffic",
      items: ids,
      roomId: room.id,
      detail: bounded(path.points.length === 0 ? `no ${required} cm path from ${path.from} to ${path.to}` : `${path.from} to ${path.to} is ${path.minWidthCm} cm wide; needs ${required} cm`),
      fix: pathFix(scene, room, catalog, path.from, path.to, path.pinch, required),
      zone: path.points.length > 0 ? path.points : undefined,
      severity: accessibility ? "error" : "warn",
    } satisfies Conflict;
  });
}

function accessConflicts(scene: Scene, room: Room, catalog: Catalog, items: ResolvedItem[]): Conflict[] {
  return accessibilityIssues(scene, room.id, catalog).map((issue) => {
    const blockers = items.filter((entry) => issue.blockers.includes(entry.item.id));
    const owner = items.find((entry) => entry.item.id === issue.item.id);
    const move = blockers.reduce<Move | undefined>((best, blocker) => shorter(best, movePolyOut(blocker, [issue.zone], room)), undefined)
      ?? (owner ? clearanceMove(owner, issue.zone, blockers, room) : undefined);
    const blocked = owner ? cellObstructionArea(issue.zone, room, blockers) : polyArea(issue.zone);
    const total = polyArea(issue.zone);
    const free = Math.max(0, Math.floor(120 * (1 - Math.min(1, blocked / Math.max(total, 1))) / 5) * 5);
    return {
      kind: issue.kind,
      items: [issue.item.id, ...issue.blockers],
      roomId: room.id,
      detail: bounded(issue.kind === "turning_circle" ? `no 150 cm turning circle beside ${issue.item.id}` : `${issue.item.id} has ${free} cm reach space; needs 120 cm`),
      fix: moveText(move, issue.blockers[0] ?? issue.item.id),
      zone: issue.zone,
      severity: issue.kind === "turning_circle" ? "error" : "warn",
    };
  });
}

function compareConflicts(a: Conflict, b: Conflict): number {
  return Number(a.severity === "warn") - Number(b.severity === "warn")
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || (a.items[0] ?? "").localeCompare(b.items[0] ?? "")
    || a.roomId.localeCompare(b.roomId)
    || a.items.join("|").localeCompare(b.items.join("|"));
}

/** Evaluates all deterministic geometric, traffic, and optional accessibility rules in one room. */
export function evaluateRoom(scene: Scene, roomId: string, catalog: Catalog, opts: ConflictOptions = {}): Conflict[] {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return [];
  const items = resolvedItems(scene, roomId, catalog);
  const accessibility = opts.accessibility ?? scene.meta.accessibilityMode;
  const conflicts = [
    ...overlapConflicts(items, room),
    ...items.flatMap((item) => outsideConflict(item, room) ?? []),
    ...clearanceConflicts(items, room),
    ...doorConflicts(scene, items, room),
    ...trafficConflicts(scene, room, catalog, accessibility),
    ...(accessibility ? accessConflicts(scene, room, catalog, items) : []),
  ];
  return conflicts.sort(compareConflicts);
}

/** Evaluates every room and returns one globally stable conflict list. */
export function evaluateHome(scene: Scene, catalog: Catalog, opts: ConflictOptions = {}): Conflict[] {
  return scene.rooms.flatMap((room) => evaluateRoom(scene, room.id, catalog, opts)).sort(compareConflicts);
}

/** Counts error and warning records without mutating or reordering the input. */
export function countBySeverity(conflicts: readonly Conflict[]): { error: number; warn: number } {
  return conflicts.reduce((count, conflict) => ({ ...count, [conflict.severity]: count[conflict.severity] + 1 }), { error: 0, warn: 0 });
}

/** Returns conflicts involving a furniture/opening id, preserving their existing order. */
export function conflictsForItem(conflicts: readonly Conflict[], itemId: string): Conflict[] {
  return conflicts.filter((conflict) => conflict.items.includes(itemId));
}
