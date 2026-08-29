/**
 * Pure scene maths: cm→m frame conversion, camera fitting, wall fade, GLB normalisation and
 * stacking elevation. No three, no React — every export here is unit-tested without WebGL.
 */
import { footprint, polyBBox, polyInside } from "../engine/geometry";
import type { CatalogItem, Furniture, Rotation, Room, Vec2, Yaw } from "../engine/types";

export type Vec3 = [number, number, number];

/** Centimetres → metres. The renderer converts exactly once (SCENE_SCHEMA.md). */
export const M = 0.01;

/** Architectural constants in centimetres (STYLE.md §2 dollhouse look). */
export const WALL_H = 260;
export const WALL_T = 12;
export const BASEBOARD_H = 8;
export const BASEBOARD_T = 2.2;
export const DOOR_H = 205;
export const DOOR_LEAF_T = 4;
export const DOOR_OPEN_DEG = 70;
export const ARCH_SPRING = 190;
export const WINDOW_TOP = 210;
export const SILL_T = 3;

/** Isometric dollhouse pitch: atan(1/√2) ≈ 35.264° (STYLE.md §2). */
export const DOLLHOUSE_PITCH = Math.atan(1 / Math.SQRT2);
export const PLAN_PITCH = Math.PI / 2;

/** Clamps a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Hermite smoothstep between two edges; returns 0 below `a` and 1 above `b`. */
export function smoothstep(a: number, b: number, x: number): number {
  if (b === a) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Camera azimuth in radians for a dollhouse yaw. The camera sits on that compass corner, so
 * `sw` (−45°) looks from the south-west toward the north-east and the north wall runs up-right.
 */
export function yawAzimuth(yaw: Yaw): number {
  const degrees = { sw: -45, se: 45, ne: 135, nw: -135 }[yaw];
  return (degrees * Math.PI) / 180;
}

/** Returns the target angle rewritten within ±π of `from` so tweens take the short way round. */
export function nearestAngle(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let candidate = to;
  while (candidate - from > Math.PI) candidate -= twoPi;
  while (from - candidate > Math.PI) candidate += twoPi;
  return candidate;
}

/**
 * Mesh Y rotation for a scene rotation. 0 = front faces south (+z); the model's front is −z,
 * so rotY = π − rotation (90 → west, 180 → north, 270 → east).
 */
export function rotationRadians(rotation: Rotation): number {
  return Math.PI - (rotation * Math.PI) / 180;
}

/** Y rotation that maps local +x onto a room-plane direction (x east, y south). */
export function directionRadians(dx: number, dy: number): number {
  return Math.atan2(-dy, dx);
}

/** Room-local centimetres → world metres on the floor plane. */
export function toWorld(room: Room, point: Vec2): Vec3 {
  return [(room.origin.x + point.x) * M, 0, (room.origin.y + point.y) * M];
}

/** Camera right axis for an azimuth/pitch pair (Euler YXZ: y = azimuth, x = −pitch). */
export function cameraRight(azimuth: number): Vec3 {
  return [Math.cos(azimuth), 0, -Math.sin(azimuth)];
}

/** Camera up axis for an azimuth/pitch pair. At pitch 90° it points north, giving plan view. */
export function cameraUp(azimuth: number, pitch: number): Vec3 {
  return [-Math.sin(pitch) * Math.sin(azimuth), Math.cos(pitch), -Math.sin(pitch) * Math.cos(azimuth)];
}

/** Unit vector from the framed centre toward the camera. */
export function cameraOffset(azimuth: number, pitch: number): Vec3 {
  return [Math.cos(pitch) * Math.sin(azimuth), Math.sin(pitch), Math.cos(pitch) * Math.cos(azimuth)];
}

/** Camera position at `distance` metres from `centre` along the view axis. */
export function cameraPosition(centre: Vec3, azimuth: number, pitch: number, distance: number): Vec3 {
  const offset = cameraOffset(azimuth, pitch);
  return [centre[0] + offset[0] * distance, centre[1] + offset[1] * distance, centre[2] + offset[2] * distance];
}

export interface Box3Like {
  min: Vec3;
  max: Vec3;
}

/** The eight corners of an axis-aligned box, in metres. */
export function boxCorners(box: Box3Like): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z]);
    }
  }
  return corners;
}

/** Box centre in metres. */
export function boxCentre(box: Box3Like): Vec3 {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

/**
 * Orthographic half-height that frames a box for the given azimuth/pitch and viewport aspect,
 * with fractional padding (0.12 = 12 % per STYLE.md framing).
 */
export function fitHalfHeight(box: Box3Like, azimuth: number, pitch: number, aspect: number, padding: number): number {
  const centre = boxCentre(box);
  const right = cameraRight(azimuth);
  const up = cameraUp(azimuth, pitch);
  let halfWidth = 0;
  let halfHeight = 0;
  for (const corner of boxCorners(box)) {
    const dx = corner[0] - centre[0];
    const dy = corner[1] - centre[1];
    const dz = corner[2] - centre[2];
    halfWidth = Math.max(halfWidth, Math.abs(dx * right[0] + dy * right[1] + dz * right[2]));
    halfHeight = Math.max(halfHeight, Math.abs(dx * up[0] + dy * up[1] + dz * up[2]));
  }
  const safeAspect = aspect > 0 ? aspect : 1;
  return Math.max(halfHeight, halfWidth / safeAspect) * (1 + padding);
}

/** Cubic-bezier easing generator; `motion.easeOut` is cubicBezier(0.22, 1, 0.36, 1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const curve = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  return (time: number) => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    let low = 0;
    let high = 1;
    let t = time;
    for (let i = 0; i < 24; i += 1) {
      const x = curve(x1, x2, t);
      if (Math.abs(x - time) < 1e-5) break;
      if (x < time) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return curve(y1, y2, t);
  };
}

/** STYLE.md §3 chrome/camera easing as a react-spring easing function. */
export const easeOut = cubicBezier(0.22, 1, 0.36, 1);

export interface NormalizeResult {
  /** Uniform scale applied to the loaded GLB so its bbox width equals dims.w (metres). */
  scale: number;
  /** Translation applied after scaling: centres x/z on the footprint and rests min y on 0. */
  offset: Vec3;
}

/**
 * Normalises a loaded GLB bounding box (model units) onto a catalog footprint: uniform scale so
 * the bbox width matches `dims.w` cm, centred on the footprint, min y resting on the floor.
 */
export function normalizeTransform(box: Box3Like, dims: { w: number; d: number; h: number }): NormalizeResult {
  const width = box.max[0] - box.min[0];
  const scale = width > 1e-6 ? (dims.w * M) / width : 1;
  const centreX = (box.min[0] + box.max[0]) / 2;
  const centreZ = (box.min[2] + box.max[2]) / 2;
  return { scale, offset: [-centreX * scale, -box.min[1] * scale, -centreZ * scale] };
}

/**
 * Per-wall opacity: walls whose outward normal points at the camera stand between it and the
 * interior, so they fade to 0.12; walls at the back stay opaque (STYLE.md §2 wall auto-fade).
 */
export function wallFadeOpacity(outward: Vec2, azimuth: number, pitch: number): number {
  if (pitch > (Math.PI / 180) * 80) return 1;
  const toCamera = { x: Math.sin(azimuth), y: Math.cos(azimuth) };
  const facing = outward.x * toCamera.x + outward.y * toCamera.y;
  return 1 - smoothstep(0.05, 0.35, facing) * (1 - 0.12);
}

/**
 * Opacity a fully cut-away wall keeps. The brief specifies 0.12; at that value a sunlit plaster
 * wall veils roughly a third of an isometric frame in milky white and several of them stack into
 * haze, so the cut-away is binary. A cut wall's presence is carried by its 1 px top-edge hairline
 * and its baseboard, which stays legible at 0.32 (see Rooms.tsx).
 */
export const WALL_FADED = 0;

/**
 * Final per-wall opacity in dollhouse view. A wall is cut away when its outward normal faces the
 * camera (the classic cut-away) or when it stands in front of the framed room — a neighbour's
 * 2.6 m wall must never hide the room the camera is looking at. Input is world centimetres.
 */
export function wallOpacity(outward: Vec2, samples: Vec2[], focusCentre: Vec2, azimuth: number, pitch: number): number {
  if (pitch > (Math.PI / 180) * 80) return 1;
  const toCamera = { x: Math.sin(azimuth), y: Math.cos(azimuth) };
  const facing = outward.x * toCamera.x + outward.y * toCamera.y;
  let frontness = -Infinity;
  for (const sample of samples) {
    const dx = (sample.x - focusCentre.x) * M;
    const dy = (sample.y - focusCentre.y) * M;
    frontness = Math.max(frontness, dx * toCamera.x + dy * toCamera.y);
  }
  const cut = Math.max(smoothstep(0.05, 0.35, facing), smoothstep(0.35, 1.3, frontness));
  return 1 - cut * (1 - WALL_FADED);
}

const STACKABLE = new Set(["table-lamp", "decor"]);
const SURFACES = new Set(["table", "desk", "shelf", "tv-unit"]);

/**
 * Elevation in centimetres for a stackable item resting on a surface below it, per
 * SCENE_SCHEMA.md §Stacking. Returns 0 when the item sits on the floor.
 */
export function stackElevationCm(item: Furniture, product: CatalogItem, scene: { furniture: Furniture[] }, byId: (id: string) => CatalogItem | undefined): number {
  if (!STACKABLE.has(product.category)) return 0;
  const own = footprint(item, product);
  let best = 0;
  for (const other of scene.furniture) {
    if (other.id === item.id || other.roomId !== item.roomId || other.status === "ghost") continue;
    const surface = byId(other.catalogId);
    if (!surface || !SURFACES.has(surface.category)) continue;
    if (polyInside(footprint(other, surface), own)) best = Math.max(best, surface.dims.h);
  }
  return best;
}

/** World-space bounding box in metres for a set of rooms, from floor to wall top. */
export function homeBox(rooms: Room[]): Box3Like {
  if (rooms.length === 0) return { min: [0, 0, 0], max: [1, WALL_H * M, 1] };
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const room of rooms) {
    const box = polyBBox(room.poly);
    minX = Math.min(minX, room.origin.x + box.minX);
    maxX = Math.max(maxX, room.origin.x + box.maxX);
    minZ = Math.min(minZ, room.origin.y + box.minY);
    maxZ = Math.max(maxZ, room.origin.y + box.maxY);
  }
  return { min: [minX * M, 0, minZ * M], max: [maxX * M, WALL_H * M, maxZ * M] };
}

/**
 * World-space bounding box in metres for one room, from floor to wall top and inflated by the wall
 * thickness. A room's walls extrude *outward* from its polygon, so framing the bare polygon clips
 * the very walls that frame the shot — most visibly along the south edge.
 */
export function roomBox(room: Room): Box3Like {
  const box = homeBox([room]);
  const pad = WALL_T * M;
  return {
    min: [box.min[0] - pad, box.min[1], box.min[2] - pad],
    max: [box.max[0] + pad, box.max[1], box.max[2] + pad],
  };
}

/** World-space bounding box in metres around a single placed item, padded by `pad` metres. */
export function itemBox(room: Room, item: Furniture, product: CatalogItem, pad = 0.6): Box3Like {
  const box = polyBBox(footprint(item, product));
  return {
    min: [(room.origin.x + box.minX) * M - pad, 0, (room.origin.y + box.minY) * M - pad],
    max: [(room.origin.x + box.maxX) * M + pad, product.dims.h * M + pad, (room.origin.y + box.maxY) * M + pad],
  };
}
