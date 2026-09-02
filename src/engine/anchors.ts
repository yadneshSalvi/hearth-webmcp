import { clearanceZone } from "./clearance";
import type { Catalog } from "./catalog";
import { openingClearZone, openingSegment, swingZone } from "./doors";
import {
  backAgainstWall, blocksWindow, footprint, freeSpans, itemToWallDistance, polyBBox, polyInside, polysOverlap,
  resolveWall, rotateDims, rotationForWall, walls,
} from "./geometry";
import { ROTATIONS } from "./types";
import type { CatalogItem, Furniture, Room, Rotation, Scene, Side, Span, Vec2, Wall } from "./types";
import { productFor } from "./catalog";

/** Semantic placement fields shared by place, move and preview tools. */
export interface Anchor {
  wall?: string;
  along?: "start" | "center" | "end" | number;
  facing?: string;
  next_to?: string;
  side?: "left" | "right" | "front" | "behind";
  gap_cm?: number;
  centered?: boolean;
  under?: string;
}

/** Inputs accepted by the pure anchor resolver. Raw position/rotation win last. */
export interface PlacementRequest {
  anchor?: Anchor;
  pos?: Vec2;
  rotation?: Rotation;
  ignoreItemIds?: string[];
  /** Internal search bound; WebMCP placement keeps the default 60 cm. */
  maxNudgeCm?: number;
}

/** A valid resolved placement or an actionable failure. */
export type PlacementResult =
  | { ok: true; pos: Vec2; rotation: Rotation; note: string; nudgedCm: number }
  | {
    ok: false;
    error: "blocked" | "invalid" | "not_found";
    detail: string;
    freeSpans?: { wall: string; side: Side; spans: Array<Span & { fits: boolean }> }[];
    suggestion?: string;
  };

type CatalogSource = Catalog | CatalogItem[];
type PositionKind = "wall" | "under" | "centered" | "next_to" | "raw";
type PositionPlan = { kind: PositionKind; wall?: Wall; along?: number; neighbour?: Furniture };
type Check = { hard: string[]; soft: string[] };
type Poly = ReturnType<typeof footprint>;
type Box = ReturnType<typeof polyBBox>;
type FurnitureBlocker = { id: string; cat: CatalogItem; poly: Poly; box: Box; clearanceBox?: Box };
type OpeningBlocker = {
  id: string;
  swing?: Poly;
  swingBox?: Box;
  clearBox?: Box;
  window?: { wall: Wall; start: number; end: number };
};
type PlacementBlockers = { furniture: FurnitureBlocker[]; openings: OpeningBlocker[] };

const STACKABLE = new Set(["table-lamp", "decor"]);
const SURFACES = new Set(["table", "desk", "shelf", "tv-unit"]);
const DIRECTIONS: Record<Rotation, { front: Vec2; right: Vec2 }> = {
  0: { front: { x: 0, y: 1 }, right: { x: -1, y: 0 } },
  90: { front: { x: -1, y: 0 }, right: { x: 0, y: -1 } },
  180: { front: { x: 0, y: -1 }, right: { x: 1, y: 0 } },
  270: { front: { x: 1, y: 0 }, right: { x: 0, y: 1 } },
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] as number;
      row[j] = Math.min((row[j - 1] as number) + 1, above + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length] as number;
}

function closestIds(query: string, candidates: { id: string; label?: string }[]): string[] {
  const needle = normalize(query);
  return candidates
    .map((entry) => ({ id: entry.id, score: Math.min(editDistance(needle, normalize(entry.id)), editDistance(needle, normalize(entry.label ?? entry.id))) }))
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(({ id }) => id);
}

function notFound(kind: string, ref: string, candidates: { id: string; label?: string }[]): PlacementResult {
  const closest = closestIds(ref, candidates);
  return { ok: false, error: "not_found", detail: `${kind} "${ref}" not found${closest.length ? `; closest: ${closest.join(", ")}` : ""}` };
}

function itemCandidates(scene: Scene, roomId: string, catalog: CatalogSource): Furniture[] {
  return scene.furniture.filter((item) => item.roomId === roomId && item.status === "placed" && productFor(item, catalog));
}

function resolveItem(scene: Scene, roomId: string, ref: string, catalog: CatalogSource): Furniture | undefined {
  const items = itemCandidates(scene, roomId, catalog);
  const selected = normalize(ref) === "selected" ? scene.meta.selection.itemId : undefined;
  if (selected) return items.find((item) => item.id === selected);
  const needle = normalize(ref);
  const label = (item: Furniture) => normalize(productFor(item, catalog)?.name ?? "");
  const exact = items.filter((item) => normalize(item.id) === needle || label(item) === needle);
  if (exact.length === 1) return exact[0];
  const prefix = items.filter((item) => normalize(item.id).startsWith(needle) || label(item).startsWith(needle));
  if (prefix.length === 1) return prefix[0];
  const substring = items.filter((item) => label(item).includes(needle));
  return substring.length === 1 ? substring[0] : undefined;
}

function largestRectangleCenter(room: Room): Vec2 {
  if (room.poly.length <= 4) {
    const xs = room.poly.map((point) => point.x);
    const ys = room.poly.map((point) => point.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  const xs = [...new Set(room.poly.map((point) => point.x))].sort((a, b) => a - b);
  const ys = [...new Set(room.poly.map((point) => point.y))].sort((a, b) => a - b);
  let best = { area: -1, center: { x: 0, y: 0 } };
  for (let left = 0; left < xs.length - 1; left += 1) {
    for (let right = left + 1; right < xs.length; right += 1) {
      for (let top = 0; top < ys.length - 1; top += 1) {
        for (let bottom = top + 1; bottom < ys.length; bottom += 1) {
          const x1 = xs[left] as number; const x2 = xs[right] as number;
          const y1 = ys[top] as number; const y2 = ys[bottom] as number;
          const corners = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
          const area = (x2 - x1) * (y2 - y1);
          if (area > best.area && polyInside(room.poly, corners)) best = { area, center: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
        }
      }
    }
  }
  return best.center;
}

function windowOnRoom(scene: Scene, roomId: string, ref: string) {
  const id = normalize(ref).startsWith("window:") ? ref.slice(ref.indexOf(":") + 1) : ref;
  return scene.openings.find((opening) => opening.roomId === roomId && opening.kind === "window" && normalize(opening.id) === normalize(id));
}

function targetPoint(scene: Scene, room: Room, ref: string, catalog: CatalogSource): Vec2 | PlacementResult {
  const needle = normalize(ref);
  if (needle === "room_center") return largestRectangleCenter(room);
  if (needle.startsWith("wall:")) {
    const wallRef = ref.slice(ref.indexOf(":") + 1);
    const wall = resolveWall(room, wallRef);
    return wall ? { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 }
      : notFound("Wall", wallRef, walls(room).map((entry) => ({ id: entry.id, label: entry.side })));
  }
  if (needle.startsWith("window:")) {
    const opening = windowOnRoom(scene, room.id, ref);
    if (!opening) return notFound("Window", ref, scene.openings.filter((entry) => entry.roomId === room.id && entry.kind === "window").map((entry) => ({ id: entry.id })));
    const { wall } = openingSegment(opening, room);
    const along = opening.offset + opening.width / 2;
    return { x: wall.a.x + (wall.b.x - wall.a.x) * along / wall.length, y: wall.a.y + (wall.b.y - wall.a.y) * along / wall.length };
  }
  const item = resolveItem(scene, room.id, ref, catalog);
  return item ? { ...item.pos } : notFound("Item", ref, itemCandidates(scene, room.id, catalog).map((entry) => ({ id: entry.id, label: productFor(entry, catalog)?.name })));
}

function facingRotation(from: Vec2, target: Vec2): Rotation {
  const dx = target.x - from.x; const dy = target.y - from.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 0 : 180;
  return dx < 0 ? 90 : 270;
}

function extentAlong(wall: Wall, cat: CatalogItem, rotation: Rotation): number {
  const dims = rotateDims(cat.dims, rotation);
  return Math.abs(wall.b.x - wall.a.x) >= Math.abs(wall.b.y - wall.a.y) ? dims.w : dims.d;
}

function clampAlong(wall: Wall, value: number, cat: CatalogItem, rotation: Rotation): number {
  const half = extentAlong(wall, cat, rotation) / 2;
  return Math.max(half, Math.min(wall.length - half, value));
}

function positionFor(plan: PositionPlan, room: Room, cat: CatalogItem, rotation: Rotation, raw?: Vec2): Vec2 {
  if (raw) return { ...raw };
  if ((plan.kind === "wall" || plan.kind === "under") && plan.wall) {
    const along = clampAlong(plan.wall, plan.along ?? plan.wall.length / 2, cat, rotation);
    return backAgainstWall(plan.wall, along, cat, rotation);
  }
  return largestRectangleCenter(room);
}

function nextToPosition(plan: PositionPlan, cat: CatalogItem, rotation: Rotation, anchor: Anchor, catalog: CatalogSource): Vec2 | undefined {
  const neighbour = plan.neighbour;
  if (!neighbour) return undefined;
  const neighbourCat = productFor(neighbour, catalog);
  if (!neighbourCat) return undefined;
  const side = anchor.side ?? "right";
  const axes = DIRECTIONS[neighbour.rotation];
  const vector = side === "front" ? axes.front : side === "behind" ? { x: -axes.front.x, y: -axes.front.y }
    : side === "right" ? axes.right : { x: -axes.right.x, y: -axes.right.y };
  const own = rotateDims(cat.dims, rotation); const other = rotateDims(neighbourCat.dims, neighbour.rotation);
  const half = vector.x === 0 ? (own.d + other.d) / 2 : (own.w + other.w) / 2;
  const gap = anchor.gap_cm ?? 10;
  return { x: neighbour.pos.x + vector.x * (half + gap), y: neighbour.pos.y + vector.y * (half + gap) };
}

function overlapAllowed(catA: CatalogItem, polyA: Poly, catB: CatalogItem, polyB: Poly): boolean {
  if (catA.category === "rug" || catB.category === "rug") return true;
  if (STACKABLE.has(catA.category) && SURFACES.has(catB.category) && polyInside(polyB, polyA)) return true;
  return STACKABLE.has(catB.category) && SURFACES.has(catA.category) && polyInside(polyA, polyB);
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.maxX > b.minX + 1e-7 && b.maxX > a.minX + 1e-7
    && a.maxY > b.minY + 1e-7 && b.maxY > a.minY + 1e-7;
}

function placementBlockers(
  scene: Scene,
  room: Room,
  cat: CatalogItem,
  catalog: CatalogSource,
  ignored: Set<string>,
): PlacementBlockers {
  const furniture = scene.furniture.flatMap((other): FurnitureBlocker[] => {
    if (other.roomId !== room.id || other.status !== "placed" || ignored.has(other.id)) return [];
    const otherCat = productFor(other, catalog);
    if (!otherCat) return [];
    const poly = footprint(other, otherCat);
    const clearance = clearanceZone(other, otherCat);
    return [{
      id: other.id,
      cat: otherCat,
      poly,
      box: polyBBox(poly),
      ...(clearance.length ? { clearanceBox: polyBBox(clearance) } : {}),
    }];
  });
  const openings = scene.openings.flatMap((opening): OpeningBlocker[] => {
    if (opening.roomId !== room.id) return [];
    const swing = swingZone(opening, room);
    const clear = openingClearZone(opening, room);
    if (!blocksWindow(cat, opening)) return [{
      id: opening.id,
      ...(swing ? { swing, swingBox: polyBBox(swing) } : {}),
      ...(clear ? { clearBox: polyBBox(clear) } : {}),
    }];
    const { wall } = openingSegment(opening, room);
    return [{
      id: opening.id,
      ...(swing ? { swing, swingBox: polyBBox(swing) } : {}),
      ...(clear ? { clearBox: polyBBox(clear) } : {}),
      window: { wall, start: opening.offset, end: opening.offset + opening.width },
    }];
  });
  return { furniture, openings };
}

function checkPlacement(room: Room, item: Furniture, cat: CatalogItem, blockers: PlacementBlockers): Check {
  const poly = footprint(item, cat); const hard: string[] = []; const soft: string[] = [];
  const box = polyBBox(poly);
  if (!polyInside(room.poly, poly)) hard.push("room boundary");
  for (const other of blockers.furniture) {
    if (boxesOverlap(box, other.box) && !overlapAllowed(cat, poly, other.cat, other.poly)) hard.push(other.id);
    if (other.clearanceBox && boxesOverlap(box, other.clearanceBox)) soft.push(`${other.id}'s clearance`);
  }
  for (const opening of blockers.openings) {
    if (cat.category !== "rug") {
      if (opening.swing && opening.swingBox && boxesOverlap(box, opening.swingBox) && polysOverlap(poly, opening.swing)) hard.push(`${opening.id}'s swing`);
      if (opening.clearBox && boxesOverlap(box, opening.clearBox)) hard.push(`${opening.id}'s clear zone`);
    }
    if (opening.window) {
      const { wall, start: windowStart, end: windowEnd } = opening.window;
      const dx = (wall.b.x - wall.a.x) / wall.length;
      const dy = (wall.b.y - wall.a.y) / wall.length;
      const projections = poly.map((point) => (point.x - wall.a.x) * dx + (point.y - wall.a.y) * dy);
      const start = Math.min(...projections);
      const end = Math.max(...projections);
      if (itemToWallDistance(item, cat, wall) <= 5 && start < windowEnd && end > windowStart) hard.push(opening.id);
    }
  }
  return { hard: [...new Set(hard)], soft: [...new Set(soft)] };
}

function wallOffsets(maxNudgeCm: number): number[] {
  return Array.from({ length: Math.floor(maxNudgeCm / 5) }, (_, index) => (index + 1) * 5).flatMap((distance) => [-distance, distance]);
}

function spiralOffsets(): Vec2[] {
  const result: Vec2[] = [];
  for (let radius = 5; radius <= 60; radius += 5) {
    const ring: Vec2[] = [];
    for (let x = -radius; x <= radius; x += 5) for (let y = -radius; y <= radius; y += 5) {
      if (Math.max(Math.abs(x), Math.abs(y)) === radius && Math.hypot(x, y) <= 60) ring.push({ x, y });
    }
    ring.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || b.x - a.x || a.y - b.y);
    result.push(...ring);
  }
  return result;
}

const SPIRAL = spiralOffsets();

function sideName(rotation: Rotation): Side {
  return ({ 0: "south", 90: "west", 180: "north", 270: "east" } as const)[rotation];
}

function bounded(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 79).trimEnd()}…`;
}

function wallNote(wall: Wall, along: number, rotation: Rotation): string {
  const corner = ({ north: "west", east: "north", south: "east", west: "south" } as const)[wall.side];
  return bounded(`on the ${wall.side} wall, ${Math.round(along)} cm from the ${corner} corner, facing ${sideName(rotation)}`);
}

function projectedAlong(wall: Wall, pos: Vec2): number {
  return ((pos.x - wall.a.x) * (wall.b.x - wall.a.x) + (pos.y - wall.a.y) * (wall.b.y - wall.a.y)) / wall.length;
}

function placementNote(plan: PositionPlan, pos: Vec2, rotation: Rotation, anchor: Anchor, facingFallback?: string): string {
  if (plan.wall && plan.kind !== "raw") {
    if (facingFallback) return bounded(`on the ${plan.wall.side} wall at ${Math.round(projectedAlong(plan.wall, pos))} cm; ${facingFallback}`);
    return wallNote(plan.wall, projectedAlong(plan.wall, pos), rotation);
  }
  if (plan.kind === "next_to") return bounded(`${anchor.side ?? "right"} of ${plan.neighbour?.id}, facing ${sideName(rotation)}`);
  return bounded(`${plan.kind === "centered" ? "centred in the room" : `at ${Math.round(pos.x)}, ${Math.round(pos.y)} cm`}, facing ${sideName(rotation)}`);
}

function formatList(values: string[]): string {
  if (values.length < 2) return values[0] ?? "available space";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function failureSpans(
  scene: Scene,
  room: Room,
  cat: CatalogItem,
  catalog: CatalogSource,
  requested: Wall | undefined,
  ignored: string[],
  canPlace: (wall: Wall, along: number, rotation: Rotation) => boolean,
) {
  return (requested ? [requested] : walls(room)).map((wall) => ({
    wall: wall.id,
    side: wall.side,
    spans: freeSpans(room, wall, scene, catalog, { ignoreItemIds: ignored, minLength: 0, itemHeight: cat.dims.h }).map((span) => {
      const rotation = rotationForWall(wall.side);
      const half = extentAlong(wall, cat, rotation) / 2;
      const min = span.start + half;
      const max = span.end - half;
      if (max < min - 1e-7) return { ...span, fits: false };
      const midpoint = (min + max) / 2;
      const candidates = [midpoint, min, max];
      for (let along = Math.ceil(min); along <= Math.floor(max); along += 1) candidates.push(along);
      candidates.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b);
      const along = candidates.find((value, index) => candidates.indexOf(value) === index && canPlace(wall, value, rotation));
      return { ...span, fits: along !== undefined, ...(along !== undefined ? { along } : {}) };
    }),
  }));
}

function targetOnOrBehindWall(wall: Wall, target: Vec2): boolean {
  const dx = (wall.b.x - wall.a.x) / wall.length;
  const dy = (wall.b.y - wall.a.y) / wall.length;
  const inwardDistance = (target.x - wall.a.x) * -dy + (target.y - wall.a.y) * dx;
  return inwardDistance <= 1e-7;
}

function conciseCm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Resolves semantic anchors into a valid, optionally nudged room-local placement. */
export function resolveAnchor(scene: Scene, roomId: string, cat: CatalogItem, req: PlacementRequest, catalog: CatalogSource): PlacementResult {
  const room = scene.rooms.find((entry) => entry.id === roomId);
  if (!room) return notFound("Room", roomId, scene.rooms.map((entry) => ({ id: entry.id, label: entry.name })));
  if (![cat.dims.w, cat.dims.d, req.pos?.x ?? 0, req.pos?.y ?? 0].every(Number.isFinite) || cat.dims.w <= 0 || cat.dims.d <= 0) {
    return { ok: false, error: "invalid", detail: "Position and product dimensions must be finite positive numbers" };
  }
  if (req.rotation !== undefined && !ROTATIONS.includes(req.rotation)) return { ok: false, error: "invalid", detail: "rotation must be 0, 90, 180 or 270" };
  const anchor = req.anchor ?? {}; const ignored = new Set(req.ignoreItemIds ?? []);
  if ((anchor.gap_cm !== undefined && (!Number.isFinite(anchor.gap_cm) || anchor.gap_cm < 0)) || (typeof anchor.along === "number" && !Number.isFinite(anchor.along))) {
    return { ok: false, error: "invalid", detail: "along and gap_cm must be finite; gap_cm cannot be negative" };
  }

  let plan: PositionPlan = { kind: anchor.wall ? "wall" : "centered" };
  let rotation: Rotation = 0;
  if (anchor.wall) {
    const wall = resolveWall(room, anchor.wall);
    if (!wall) return notFound("Wall", anchor.wall, walls(room).map((entry) => ({ id: entry.id, label: entry.side })));
    rotation = rotationForWall(wall.side);
    const half = extentAlong(wall, cat, rotation) / 2;
    const along = anchor.along === "start" ? half : anchor.along === "end" ? wall.length - half
      : typeof anchor.along === "number" ? anchor.along : wall.length / 2;
    plan = { kind: "wall", wall, along };
  }
  if (anchor.under) {
    const opening = windowOnRoom(scene, room.id, anchor.under);
    if (!opening) return notFound("Window", anchor.under, scene.openings.filter((entry) => entry.roomId === room.id && entry.kind === "window").map((entry) => ({ id: entry.id })));
    const wall = resolveWall(room, opening.wallId);
    if (!wall) return { ok: false, error: "invalid", detail: `Window ${opening.id} refers to an invalid wall` };
    rotation = rotationForWall(wall.side);
    plan = { kind: "under", wall, along: opening.offset + opening.width / 2 };
  }
  if (anchor.centered) { plan = { kind: "centered" }; rotation = 0; }
  if (anchor.next_to) {
    const neighbour = resolveItem(scene, room.id, anchor.next_to, catalog);
    if (!neighbour) return notFound("Item", anchor.next_to, itemCandidates(scene, room.id, catalog).map((entry) => ({ id: entry.id, label: productFor(entry, catalog)?.name })));
    plan = { kind: "next_to", neighbour }; rotation = neighbour.rotation;
  }
  if (req.pos) plan = { ...plan, kind: "raw" };
  let position = plan.kind === "next_to" ? nextToPosition(plan, cat, rotation, anchor, catalog) as Vec2 : positionFor(plan, room, cat, rotation, req.pos);
  let facingFallback: string | undefined;
  if (anchor.facing && req.rotation === undefined) {
    const facing = normalize(anchor.facing);
    if (facing.startsWith("wall:")) {
      const ref = anchor.facing.slice(anchor.facing.indexOf(":") + 1);
      const targetWall = resolveWall(room, ref);
      if (!targetWall) return notFound("Wall", ref, walls(room).map((entry) => ({ id: entry.id, label: entry.side })));
      const target = { x: (targetWall.a.x + targetWall.b.x) / 2, y: (targetWall.a.y + targetWall.b.y) / 2 };
      if (plan.wall && plan.kind !== "raw" && targetOnOrBehindWall(plan.wall, target)) {
        rotation = rotationForWall(plan.wall.side);
        facingFallback = "facing the room (target is behind it)";
      } else {
        rotation = ({ north: 180, east: 270, south: 0, west: 90 } as const)[targetWall.side];
      }
    } else {
      const target = targetPoint(scene, room, anchor.facing, catalog);
      if ("ok" in target) return target;
      if (plan.wall && plan.kind !== "raw" && targetOnOrBehindWall(plan.wall, target)) {
        rotation = rotationForWall(plan.wall.side);
        facingFallback = facing.startsWith("window:")
          ? "facing the room (window is behind it)"
          : "facing the room (target is behind it)";
      } else {
        rotation = facingRotation(position, target);
      }
    }
  }
  if (req.rotation !== undefined) rotation = req.rotation;
  if (plan.kind === "next_to") position = nextToPosition(plan, cat, rotation, anchor, catalog) as Vec2;
  else position = positionFor(plan, room, cat, rotation, req.pos);

  const blockers = placementBlockers(scene, room, cat, catalog, ignored);
  const candidate = (pos: Vec2): { item: Furniture; check: Check } => {
    const item: Furniture = { id: "__candidate__", catalogId: cat.id, roomId, pos, rotation, colorway: cat.colorways[0]?.id ?? "oak", status: "placed" };
    return { item, check: checkPlacement(room, item, cat, blockers) };
  };
  const initial = candidate(position);
  if (initial.check.hard.length === 0) {
    return { ok: true, pos: position, rotation, note: placementNote(plan, position, rotation, anchor, facingFallback), nudgedCm: 0 };
  }

  const positions: { pos: Vec2; distance: number }[] = [];
  const maxNudgeCm = req.maxNudgeCm ?? 60;
  if (plan.wall && plan.kind !== "raw") {
    const base = clampAlong(plan.wall, plan.along ?? plan.wall.length / 2, cat, rotation);
    for (const offset of wallOffsets(maxNudgeCm)) {
      const along = clampAlong(plan.wall, base + offset, cat, rotation);
      positions.push({ pos: backAgainstWall(plan.wall, along, cat, rotation), distance: Math.abs(along - base) });
    }
  } else {
    positions.push(...SPIRAL.filter((offset) => Math.hypot(offset.x, offset.y) <= maxNudgeCm)
      .map((offset) => ({ pos: { x: position.x + offset.x, y: position.y + offset.y }, distance: Math.round(Math.hypot(offset.x, offset.y)) })));
  }
  const seen = new Set<string>();
  for (const attempt of positions) {
    const key = `${attempt.pos.x},${attempt.pos.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const checked = candidate(attempt.pos);
    if (checked.check.hard.length === 0) {
      return { ok: true, pos: attempt.pos, rotation, note: placementNote(plan, attempt.pos, rotation, anchor, facingFallback), nudgedCm: attempt.distance };
    }
  }

  const data = failureSpans(scene, room, cat, catalog, plan.wall, [...ignored], (wall, along, wallRotation) => {
    const item: Furniture = {
      id: "__candidate__", catalogId: cat.id, roomId, pos: backAgainstWall(wall, along, cat, wallRotation),
      rotation: wallRotation, colorway: cat.colorways[0]?.id ?? "oak", status: "placed",
    };
    return checkPlacement(room, item, cat, blockers).hard.length === 0;
  });
  const spans = data.flatMap((entry) => entry.spans.map((span) => ({ ...entry, span })));
  const fit = spans.filter((entry) => entry.span.fits).sort((a, b) => (b.span.end - b.span.start) - (a.span.end - a.span.start))[0];
  const widest = spans.sort((a, b) => (b.span.end - b.span.start) - (a.span.end - a.span.start))[0];
  const fitAlong = fit?.span.along;
  const suggestion = fit && fitAlong !== undefined
    ? `${fit.side} wall ${Math.round(fit.span.start)}–${Math.round(fit.span.end)} cm fits; try along: ${conciseCm(fitAlong)}`
    : widest
      ? `${widest.side} wall free span ${Math.round(widest.span.start)}–${Math.round(widest.span.end)} cm; try a narrower item or clear the wall`
      : "Try a smaller item or clear another wall";
  const publicSpans = data.map((entry) => ({
    wall: entry.wall,
    side: entry.side,
    spans: entry.spans.map(({ start, end, fits }) => ({ start, end, fits })),
  }));
  return { ok: false, error: "blocked", detail: `blocked by ${formatList(initial.check.hard)}`, freeSpans: publicSpans, suggestion };
}

/** Describes an item's wall relationship and facing direction for receipts. */
export function describePlacement(scene: Scene, item: Furniture, catalog: CatalogSource): string {
  const room = scene.rooms.find((entry) => entry.id === item.roomId); const cat = productFor(item, catalog);
  if (!room || !cat) return bounded(`at ${Math.round(item.pos.x)}, ${Math.round(item.pos.y)} cm, facing ${sideName(item.rotation)}`);
  const wall = walls(room).find((entry) => rotationForWall(entry.side) === item.rotation && itemToWallDistance(item, cat, entry) <= 5);
  if (wall) {
    const along = ((item.pos.x - wall.a.x) * (wall.b.x - wall.a.x) + (item.pos.y - wall.a.y) * (wall.b.y - wall.a.y)) / wall.length;
    return wallNote(wall, along, item.rotation);
  }
  const center = largestRectangleCenter(room);
  if (Math.hypot(item.pos.x - center.x, item.pos.y - center.y) <= 5) return bounded(`centred in the ${room.name}, facing ${sideName(item.rotation)}`);
  return bounded(`at ${Math.round(item.pos.x)}, ${Math.round(item.pos.y)} cm in the ${room.name}, facing ${sideName(item.rotation)}`);
}

/** Resolves a relative move while ignoring the moved item's old footprint. */
export function deltaMove(scene: Scene, item: Furniture, delta: { x?: number; y?: number }, catalog: CatalogSource): PlacementResult {
  const cat = productFor(item, catalog);
  if (!cat) return notFound("Product", item.catalogId, []);
  return resolveAnchor(scene, item.roomId, cat, { pos: { x: item.pos.x + (delta.x ?? 0), y: item.pos.y + (delta.y ?? 0) }, rotation: item.rotation, ignoreItemIds: [item.id] }, catalog);
}

/** Returns an item's rotation after a supported quarter/half turn. */
export function rotateBy(item: Furniture, by: 90 | -90 | 180): Rotation {
  return (((item.rotation + by + 360) % 360) as Rotation);
}
