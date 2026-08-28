import type { CatalogSource } from "./describe";
import { dimsStr, footStr, posArr } from "./describe";
import { openingSegment } from "./doors";
import {
  distancePointSegment,
  footprint,
  freeSpans,
  gapBetween,
  itemToWallDistance,
  resolveWall,
  walls,
} from "./geometry";
import { SIDES } from "./types";
import type { CatalogItem, Furniture, Opening, Scene, Side, Span, Vec2, Wall } from "./types";

/** A wall, placed item or opening resolved inside one room. */
export type MeasureSubject =
  | { kind: "wall"; id: string; side: Side }
  | { kind: "item"; id: string; name?: string }
  | { kind: "opening"; id: string };

/** Stable, compact result returned by the measure engine. */
export type MeasureResult = {
  ok: true;
  subject: MeasureSubject;
  to?: MeasureSubject;
  length_cm?: number;
  free_spans?: Span[];
  dims?: string;
  footprint?: string;
  pos?: [number, number];
  rotation?: Furniture["rotation"];
  clearance_front_cm?: number;
  width_cm?: number;
  offset_cm?: number;
  wall?: string;
  gap_cm?: number;
  direction?: Side;
  distance_cm?: number;
} | {
  ok: false;
  error: "not_found";
  alternatives: string[];
};

function catalogItem(catalog: CatalogSource, id: string): CatalogItem | undefined {
  return Array.isArray(catalog) ? catalog.find((item) => item.id === id) : catalog.byId(id);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function unique<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}

/** Resolves a measure reference without reading or mutating application state. */
export function resolveSubject(scene: Scene, roomId: string, ref: string, catalog: CatalogSource): MeasureSubject | undefined {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return undefined;
  const needle = normalize(ref);
  if (!needle) return undefined;

  const wall = resolveWall(room, needle);
  if (wall) return { kind: "wall", id: wall.id, side: wall.side };
  const sidePrefix = unique(SIDES.filter((side) => side.startsWith(needle)));
  if (sidePrefix) {
    const prefixedWall = resolveWall(room, sidePrefix);
    if (prefixedWall) return { kind: "wall", id: prefixedWall.id, side: prefixedWall.side };
  }
  const wallPrefix = unique(walls(room).filter((candidate) => candidate.id.toLowerCase().startsWith(needle)));
  if (wallPrefix) return { kind: "wall", id: wallPrefix.id, side: wallPrefix.side };

  const roomItems = scene.furniture.filter((item) => item.roomId === roomId);
  if (needle === "selected") {
    const selected = roomItems.find((item) => item.id === scene.meta.selection.itemId);
    if (selected) return itemSubject(selected, catalog);
  }
  const exactItem = roomItems.find((item) => normalize(item.id) === needle)
    ?? unique(roomItems.filter((item) => normalize(catalogItem(catalog, item.catalogId)?.name ?? "") === needle));
  if (exactItem) return itemSubject(exactItem, catalog);
  const prefixItem = unique(roomItems.filter((item) => normalize(item.id).startsWith(needle)
    || normalize(catalogItem(catalog, item.catalogId)?.name ?? "").startsWith(needle)));
  if (prefixItem) return itemSubject(prefixItem, catalog);
  const containsItem = unique(roomItems.filter((item) => normalize(catalogItem(catalog, item.catalogId)?.name ?? "").includes(needle)));
  if (containsItem) return itemSubject(containsItem, catalog);

  const roomOpenings = scene.openings.filter((opening) => opening.roomId === roomId);
  const exactOpening = roomOpenings.find((opening) => normalize(opening.id) === needle);
  if (exactOpening) return { kind: "opening", id: exactOpening.id };
  const prefixOpening = unique(roomOpenings.filter((opening) => normalize(opening.id).startsWith(needle)));
  return prefixOpening ? { kind: "opening", id: prefixOpening.id } : undefined;
}

function itemSubject(item: Furniture, catalog: CatalogSource): MeasureSubject {
  const name = catalogItem(catalog, item.catalogId)?.name;
  return { kind: "item", id: item.id, ...(name ? { name } : {}) };
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

function alternatives(scene: Scene, roomId: string, ref: string, catalog: CatalogSource): string[] {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return scene.rooms.map((candidate) => candidate.id).slice(0, 3);
  const candidates = [
    ...walls(room).flatMap((wall) => [wall.side, wall.id]),
    ...scene.furniture.filter((item) => item.roomId === roomId).flatMap((item) => [item.id, catalogItem(catalog, item.catalogId)?.name]),
    ...scene.openings.filter((opening) => opening.roomId === roomId).map((opening) => opening.id),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const distinct = [...new Set(candidates)];
  const needle = normalize(ref);
  return distinct
    .map((candidate, index) => ({ candidate, index, distance: editDistance(needle, normalize(candidate)) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function furniture(scene: Scene, subject: MeasureSubject): Furniture | undefined {
  return subject.kind === "item" ? scene.furniture.find((item) => item.id === subject.id) : undefined;
}

function opening(scene: Scene, subject: MeasureSubject): Opening | undefined {
  return subject.kind === "opening" ? scene.openings.find((candidate) => candidate.id === subject.id) : undefined;
}

function resolvedWall(scene: Scene, roomId: string, subject: MeasureSubject): Wall | undefined {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  return room && subject.kind === "wall" ? resolveWall(room, subject.id) : undefined;
}

function standalone(scene: Scene, roomId: string, subject: MeasureSubject, catalog: CatalogSource): MeasureResult {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, roomId, catalog) };
  if (subject.kind === "wall") {
    const wall = resolveWall(room, subject.id);
    if (!wall) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, subject.id, catalog) };
    return {
      ok: true,
      subject,
      length_cm: Math.round(wall.length),
      free_spans: freeSpans(room, wall, scene, Array.isArray(catalog) ? catalog : catalog.all()).slice(0, 6)
        .map((span) => ({ start: Math.round(span.start), end: Math.round(span.end) })),
    };
  }
  if (subject.kind === "item") {
    const item = furniture(scene, subject);
    const cat = item && catalogItem(catalog, item.catalogId);
    if (!item || !cat) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, subject.id, catalog) };
    return {
      ok: true,
      subject,
      dims: dimsStr(cat.dims),
      footprint: footStr(cat, item.rotation),
      pos: posArr(item.pos),
      rotation: item.rotation,
      clearance_front_cm: Math.round(cat.clearanceFront),
    };
  }
  const found = opening(scene, subject);
  if (!found) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, subject.id, catalog) };
  return {
    ok: true,
    subject,
    width_cm: Math.round(found.width),
    offset_cm: Math.round(found.offset),
    wall: found.wallId,
  };
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = orientation(a, b, point);
  return Math.abs(cross) < 1e-7
    && point.x >= Math.min(a.x, b.x) - 1e-7 && point.x <= Math.max(a.x, b.x) + 1e-7
    && point.y >= Math.min(a.y, b.y) - 1e-7 && point.y <= Math.max(a.y, b.y) + 1e-7;
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const crosses = ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
  if (crosses || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return 0;
  return Math.min(
    distancePointSegment(a, c, d),
    distancePointSegment(b, c, d),
    distancePointSegment(c, a, b),
    distancePointSegment(d, a, b),
  );
}

function polyToSegmentDistance(poly: Vec2[], a: Vec2, b: Vec2): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < poly.length; index += 1) {
    nearest = Math.min(nearest, segmentDistance(poly[index] as Vec2, poly[(index + 1) % poly.length] as Vec2, a, b));
  }
  return nearest;
}

function itemOpeningDistance(item: Furniture, cat: CatalogItem, found: Opening, room: NonNullable<Scene["rooms"][number]>): number {
  const segment = openingSegment(found, room);
  return polyToSegmentDistance(footprint(item, cat), segment.a, segment.b);
}

function wallWallDistance(left: Wall, right: Wall): number {
  const opposite = (left.side === "north" && right.side === "south") || (left.side === "south" && right.side === "north")
    || (left.side === "east" && right.side === "west") || (left.side === "west" && right.side === "east");
  if (opposite) {
    const leftHorizontal = left.side === "north" || left.side === "south";
    return leftHorizontal ? Math.abs(left.a.y - right.a.y) : Math.abs(left.a.x - right.a.x);
  }
  return segmentDistance(left.a, left.b, right.a, right.b);
}

function pairDistance(scene: Scene, roomId: string, left: MeasureSubject, right: MeasureSubject, catalog: CatalogSource): number | undefined {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return undefined;
  const leftItem = furniture(scene, left);
  const rightItem = furniture(scene, right);
  const leftWall = resolvedWall(scene, roomId, left);
  const rightWall = resolvedWall(scene, roomId, right);
  const leftOpening = opening(scene, left);
  const rightOpening = opening(scene, right);

  if (leftItem && rightWall) {
    const cat = catalogItem(catalog, leftItem.catalogId);
    return cat ? itemToWallDistance(leftItem, cat, rightWall) : undefined;
  }
  if (rightItem && leftWall) {
    const cat = catalogItem(catalog, rightItem.catalogId);
    return cat ? itemToWallDistance(rightItem, cat, leftWall) : undefined;
  }
  if (leftItem && rightOpening) {
    const cat = catalogItem(catalog, leftItem.catalogId);
    return cat ? itemOpeningDistance(leftItem, cat, rightOpening, room) : undefined;
  }
  if (rightItem && leftOpening) {
    const cat = catalogItem(catalog, rightItem.catalogId);
    return cat ? itemOpeningDistance(rightItem, cat, leftOpening, room) : undefined;
  }
  if (leftWall && rightWall) return wallWallDistance(leftWall, rightWall);
  if (leftWall && rightOpening) {
    const segment = openingSegment(rightOpening, room);
    return segmentDistance(leftWall.a, leftWall.b, segment.a, segment.b);
  }
  if (rightWall && leftOpening) {
    const segment = openingSegment(leftOpening, room);
    return segmentDistance(rightWall.a, rightWall.b, segment.a, segment.b);
  }
  if (leftOpening && rightOpening) {
    const a = openingSegment(leftOpening, room);
    const b = openingSegment(rightOpening, room);
    return segmentDistance(a.a, a.b, b.a, b.b);
  }
  return undefined;
}

/** Measures one subject when no comparison target is supplied. */
export function measure(scene: Scene, roomId: string, subject: string, catalog: CatalogSource): MeasureResult;
/** Measures one subject against a second wall, item or opening. */
export function measure(scene: Scene, roomId: string, subject: string, to: string | undefined, catalog: CatalogSource): MeasureResult;
/** Measures a resolved subject alone or against a second reference. */
export function measure(
  scene: Scene,
  roomId: string,
  subject: string,
  toOrCatalog: string | undefined | CatalogSource,
  catalogInput?: CatalogSource,
): MeasureResult {
  const to = typeof toOrCatalog === "string" || toOrCatalog === undefined ? toOrCatalog : undefined;
  const catalog = typeof toOrCatalog === "string" || toOrCatalog === undefined ? catalogInput : toOrCatalog;
  if (!catalog) return { ok: false, error: "not_found", alternatives: [] };
  const left = resolveSubject(scene, roomId, subject, catalog);
  if (!left) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, subject, catalog) };
  if (to === undefined) return standalone(scene, roomId, left, catalog);
  const right = resolveSubject(scene, roomId, to, catalog);
  if (!right) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, to, catalog) };

  if (left.kind === "item" && right.kind === "item") {
    const leftItem = furniture(scene, left);
    const rightItem = furniture(scene, right);
    if (!leftItem || !rightItem || !catalogItem(catalog, leftItem.catalogId) || !catalogItem(catalog, rightItem.catalogId)) {
      return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, subject, catalog) };
    }
    const gap = gapBetween(leftItem, rightItem, Array.isArray(catalog) ? catalog : catalog.all());
    return { ok: true, subject: left, to: right, gap_cm: Math.round(gap.gap_cm), direction: gap.direction };
  }

  const distance = pairDistance(scene, roomId, left, right, catalog);
  if (distance === undefined) return { ok: false, error: "not_found", alternatives: alternatives(scene, roomId, to, catalog) };
  return { ok: true, subject: left, to: right, distance_cm: Math.round(distance) };
}
