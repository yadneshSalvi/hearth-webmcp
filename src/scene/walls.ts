/**
 * Wall solids built from a room polygon: 12 cm thick, 260 cm tall, extruded *outward* so interior
 * dimensions stay exact, with doors/arches splitting the wall and windows punched as shape holes.
 */
import { Path, Shape, ExtrudeGeometry, BoxGeometry, PlaneGeometry } from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { openingSegment } from "../engine/doors";
import { walls } from "../engine/geometry";
import type { Opening, Room, Side, Vec2, Wall } from "../engine/types";
import { ARCH_SPRING, BASEBOARD_H, BASEBOARD_T, DOOR_H, DOOR_LEAF_T, DOOR_OPEN_DEG, M, SILL_T, WALL_H, WALL_T, WINDOW_TOP, directionRadians } from "./math";
import type { Vec3 } from "./math";

const H = WALL_H * M;
const T = WALL_T * M;

export interface Span {
  u0: number;
  u1: number;
}

export interface LeafBuild {
  id: string;
  /** Hinge position along the wall, in metres from the wall start. */
  u: number;
  width: number;
  /** Rotation about the hinge when fully open, radians (sign encodes hinge + swing). */
  angle: number;
  /** +1 when the closed leaf extends toward +u, −1 when it extends back toward the wall start. */
  direction: 1 | -1;
}

export interface GlassBuild {
  id: string;
  geometry: BufferGeometry;
}

export interface WallBuild {
  id: string;
  side: Side;
  /** World position of the wall's start corner, metres. */
  origin: Vec3;
  rotationY: number;
  /** Outward normal in the room plane (x east, y south). */
  outward: Vec2;
  /** Wall length in metres. */
  length: number;
  /** Start, middle and end of the wall in world centimetres, for the cut-away test. */
  samplesCm: Vec2[];
  solid: BufferGeometry | null;
  trim: BufferGeometry | null;
  baseboard: BufferGeometry | null;
  glass: BufferGeometry | null;
  planBand: BufferGeometry | null;
  leaves: LeafBuild[];
}

function reachesFloor(opening: Opening): boolean {
  return opening.kind !== "window" || (opening.sillHeight ?? 90) < 4;
}

function gaps(length: number, blockers: Span[]): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  for (const blocker of [...blockers].sort((a, b) => a.u0 - b.u0)) {
    if (blocker.u0 > cursor) spans.push({ u0: cursor, u1: blocker.u0 });
    cursor = Math.max(cursor, blocker.u1);
  }
  if (cursor < length) spans.push({ u0: cursor, u1: length });
  return spans.filter((span) => span.u1 - span.u0 > 1e-4);
}

function rectShape(u0: number, u1: number, v0: number, v1: number): Shape {
  const shape = new Shape();
  shape.moveTo(u0, v0);
  shape.lineTo(u1, v0);
  shape.lineTo(u1, v1);
  shape.lineTo(u0, v1);
  shape.closePath();
  return shape;
}

function rectHole(u0: number, u1: number, v0: number, v1: number): Path {
  const path = new Path();
  path.moveTo(u0, v0);
  path.lineTo(u0, v1);
  path.lineTo(u1, v1);
  path.lineTo(u1, v0);
  path.closePath();
  return path;
}

/** Header above an arch: the wall above the springline minus the elliptical head. */
function archHeader(u0: number, u1: number): Shape {
  const spring = ARCH_SPRING * M;
  const radiusX = (u1 - u0) / 2;
  const radiusY = Math.min(radiusX, H - spring - 0.08);
  const shape = new Shape();
  shape.moveTo(u0, spring);
  shape.lineTo(u0, H);
  shape.lineTo(u1, H);
  shape.lineTo(u1, spring);
  shape.absellipse((u0 + u1) / 2, spring, radiusX, radiusY, 0, Math.PI, false, 0);
  shape.closePath();
  return shape;
}

function extrude(shape: Shape): BufferGeometry {
  const geometry = new ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, steps: 1 });
  // Shape −z is the outward face after the wall group's Y rotation, so pull the solid outward.
  geometry.translate(0, 0, -T);
  return geometry;
}

function box(width: number, height: number, depth: number, x: number, y: number, z: number): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

function merge(parts: BufferGeometry[]): BufferGeometry | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] as BufferGeometry;
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

/** Vertical reveals and a lintel lining one opening, protruding 1.5 cm on both wall faces. */
function jamb(u0: number, u1: number, v0: number, v1: number): BufferGeometry[] {
  const reveal = 0.03;
  const protrude = 0.015;
  const depth = T + protrude * 2;
  const z = -T / 2;
  const parts = [
    box(reveal, v1 - v0, depth, u0 + reveal / 2, (v0 + v1) / 2, z),
    box(reveal, v1 - v0, depth, u1 - reveal / 2, (v0 + v1) / 2, z),
    box(u1 - u0, reveal, depth, (u0 + u1) / 2, v1 - reveal / 2, z),
  ];
  if (v0 > 0.02) parts.push(box(u1 - u0 + 0.08, SILL_T * M, depth + 0.04, (u0 + u1) / 2, v0 - (SILL_T * M) / 2, z + 0.02));
  return parts;
}

/** A room polygon as a three Shape in the XZ plane; pair with rotation.x = −π/2 so normals point up. */
export function polygonShape(poly: Vec2[]): Shape {
  const shape = new Shape();
  poly.forEach((point, index) => {
    const x = point.x * M;
    const y = -point.y * M;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

/** Builds every renderable piece of one wall in wall-local metres (u along +x, v up, inward +z). */
function buildWall(wall: Wall, room: Room, openings: Opening[]): WallBuild {
  const length = wall.length * M;
  const dxn = (wall.b.x - wall.a.x) / wall.length;
  const dyn = (wall.b.y - wall.a.y) / wall.length;
  const mine = openings
    .filter((opening) => opening.roomId === room.id && opening.wallId.toLowerCase() === wall.id.toLowerCase())
    .map((opening) => ({ opening, u0: opening.offset * M, u1: (opening.offset + opening.width) * M }))
    .sort((a, b) => a.u0 - b.u0);

  const splitters = mine.filter((entry) => reachesFloor(entry.opening));
  const windows = mine.filter((entry) => !reachesFloor(entry.opening));
  const solids: BufferGeometry[] = [];
  const trims: BufferGeometry[] = [];
  const glassParts: BufferGeometry[] = [];
  const leaves: LeafBuild[] = [];

  for (const span of gaps(length, splitters)) {
    const shape = rectShape(span.u0, span.u1, 0, H);
    for (const entry of windows) {
      if (entry.u0 < span.u0 - 1e-6 || entry.u1 > span.u1 + 1e-6) continue;
      const sill = (entry.opening.sillHeight ?? 90) * M;
      shape.holes.push(rectHole(entry.u0, entry.u1, sill, WINDOW_TOP * M));
    }
    solids.push(extrude(shape));
  }

  for (const entry of splitters) {
    if (entry.opening.kind === "arch") solids.push(extrude(archHeader(entry.u0, entry.u1)));
    else solids.push(extrude(rectShape(entry.u0, entry.u1, DOOR_H * M, H)));
    trims.push(...jamb(entry.u0, entry.u1, 0, entry.opening.kind === "arch" ? ARCH_SPRING * M : DOOR_H * M));
    if (entry.opening.kind === "door") {
      const right = entry.opening.hinge === "right";
      const outward = entry.opening.swing === "out";
      const inwardSign = right ? 1 : -1;
      leaves.push({
        id: entry.opening.id,
        u: right ? entry.u1 : entry.u0,
        width: entry.u1 - entry.u0,
        angle: ((outward ? -inwardSign : inwardSign) * DOOR_OPEN_DEG * Math.PI) / 180,
        direction: right ? -1 : 1,
      });
    }
  }

  for (const entry of windows) {
    const sill = (entry.opening.sillHeight ?? 90) * M;
    const top = WINDOW_TOP * M;
    trims.push(...jamb(entry.u0, entry.u1, sill, top));
    const pane = new PlaneGeometry(entry.u1 - entry.u0, top - sill);
    pane.translate((entry.u0 + entry.u1) / 2, (sill + top) / 2, -T / 2);
    glassParts.push(pane);
  }

  const baseboardSpans = gaps(length, splitters.map((entry) => ({ u0: entry.u0, u1: entry.u1 })));
  const baseboard = merge(
    baseboardSpans.map((span) =>
      box(span.u1 - span.u0, BASEBOARD_H * M, BASEBOARD_T * M, (span.u0 + span.u1) / 2, (BASEBOARD_H * M) / 2, (BASEBOARD_T * M) / 2),
    ),
  );
  const planBand = merge(
    gaps(length, mine.map((entry) => ({ u0: entry.u0, u1: entry.u1 }))).map((span) =>
      box(span.u1 - span.u0, 0.006, T, (span.u0 + span.u1) / 2, 0.012, -T / 2),
    ),
  );

  return {
    id: wall.id,
    side: wall.side,
    origin: [(room.origin.x + wall.a.x) * M, 0, (room.origin.y + wall.a.y) * M],
    rotationY: directionRadians(dxn, dyn),
    outward: { x: dyn, y: -dxn },
    length,
    samplesCm: [0, 0.5, 1].map((t) => ({
      x: room.origin.x + wall.a.x + (wall.b.x - wall.a.x) * t,
      y: room.origin.y + wall.a.y + (wall.b.y - wall.a.y) * t,
    })),
    solid: merge(solids),
    trim: merge(trims),
    baseboard,
    glass: merge(glassParts),
    planBand,
    leaves,
  };
}

/**
 * Shared walls list the same doorway once per room, so only one of each coincident pair may render a
 * leaf. Returns the opening ids that own their doorway, chosen deterministically by id.
 */
export function primaryDoorIds(rooms: Room[], openings: Opening[]): Set<string> {
  const owners = new Map<string, string>();
  for (const opening of [...openings].sort((a, b) => a.id.localeCompare(b.id))) {
    if (opening.kind !== "door") continue;
    const room = rooms.find((candidate) => candidate.id === opening.roomId);
    if (!room) continue;
    let segment;
    try {
      segment = openingSegment(opening, room);
    } catch {
      continue;
    }
    const midX = Math.round(room.origin.x + (segment.a.x + segment.b.x) / 2);
    const midY = Math.round(room.origin.y + (segment.a.y + segment.b.y) / 2);
    const key = `${midX}:${midY}`;
    if (!owners.has(key)) owners.set(key, opening.id);
  }
  return new Set(owners.values());
}

/** Builds every wall of a room. Dispose the returned geometries when the room changes. */
export function buildRoomWalls(room: Room, openings: Opening[]): WallBuild[] {
  return walls(room).map((wall) => buildWall(wall, room, openings));
}

/** Frees every GPU buffer held by a wall build. */
export function disposeWalls(builds: WallBuild[]): void {
  for (const build of builds) {
    build.solid?.dispose();
    build.trim?.dispose();
    build.baseboard?.dispose();
    build.glass?.dispose();
    build.planBand?.dispose();
  }
}

export { DOOR_H, DOOR_LEAF_T, T as WALL_THICKNESS_M, H as WALL_HEIGHT_M };
