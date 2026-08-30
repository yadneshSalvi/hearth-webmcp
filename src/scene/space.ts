/**
 * The scene's frame of reference: centimetres → metres, the architectural constants, the two scalar
 * helpers everything rounds through, and the box/camera-axis maths that both the renderer and the
 * camera stand on.
 *
 * A leaf on purpose. `src/scene/math.ts` (scene maths) and `src/scene/cameraMath.ts` (camera maths)
 * both import from here and neither imports the other's body, so there is no import cycle to make a
 * module-scope constant read `undefined`. `math.ts` re-exports all three, so every existing import
 * and test keeps working.
 */
import { polyBBox } from "../engine/geometry";
import type { Room } from "../engine/types";

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

/** Returns the target angle rewritten within ±π of `from` so tweens take the short way round. */
export function nearestAngle(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let candidate = to;
  while (candidate - from > Math.PI) candidate -= twoPi;
  while (from - candidate > Math.PI) candidate += twoPi;
  return candidate;
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

