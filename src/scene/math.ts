/**
 * Pure scene maths: room and item volumes, the wall cut-away, GLB normalisation onto a catalog
 * footprint, and stacking elevation. No three, no React — every export here is unit-tested without
 * WebGL.
 *
 * Two neighbours carry the rest and are re-exported from the bottom of this file, so "import the
 * scene maths from math.ts" stays true: `src/scene/space.ts` is the frame of reference (cm→m, the
 * architectural constants, the box and camera-axis maths) and `src/scene/cameraMath.ts` is the
 * camera's own body of rules (the free orbit's angles and stops, the whole-home volume, the
 * furniture cut-away).
 */
import { footprint, polyBBox, polyInside } from "../engine/geometry";
import type { CatalogItem, Furniture, Rotation, Room, Vec2 } from "../engine/types";
import { M, WALL_T, homeBox, smoothstep } from "./space";
import type { Box3Like, Vec3 } from "./space";

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
export function wallOpacity(
  outward: Vec2,
  samples: Vec2[],
  focusCentre: Vec2,
  azimuth: number,
  pitch: number,
  opts: { cutInFront?: boolean } = {},
): number {
  if (pitch > (Math.PI / 180) * 80) return 1;
  const toCamera = { x: Math.sin(azimuth), y: Math.cos(azimuth) };
  const facing = outward.x * toCamera.x + outward.y * toCamera.y;
  // Framing the *whole* home turns the second test off: every wall in the southern half of a 12 m
  // home stands metres in front of the home's centre, so keeping it would delete half the house
  // instead of revealing one room. The facing test alone is the classic dollhouse cut-away.
  let frontness = -Infinity;
  if (opts.cutInFront ?? true) {
    for (const sample of samples) {
      const dx = (sample.x - focusCentre.x) * M;
      const dy = (sample.y - focusCentre.y) * M;
      frontness = Math.max(frontness, dx * toCamera.x + dy * toCamera.y);
    }
  }
  const cut = Math.max(smoothstep(0.05, 0.35, facing), smoothstep(0.35, 1.3, frontness));
  return 1 - cut * (1 - WALL_FADED);
}

/**
 * Height of the selection halo above the floor, in metres. Above every rug the catalog ships — the
 * tallest, `rug-mark`, tops out at 4.13 cm — so selecting a chair standing on a rug draws its ring
 * on the rug rather than inside it (`tests/scene/assets.test.ts` checks this against the manifest).
 */
export const SELECTION_HALO_Y = 0.05;

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

/**
 * The frame of reference lives in `src/scene/space.ts` and the camera's own maths in
 * `src/scene/cameraMath.ts`; both are re-exported here so the renderer, the rig and the tests keep
 * importing "the scene maths" from one place.
 */
export {
  ARCH_SPRING,
  BASEBOARD_H,
  BASEBOARD_T,
  DOLLHOUSE_PITCH,
  DOOR_H,
  DOOR_LEAF_T,
  DOOR_OPEN_DEG,
  M,
  PLAN_PITCH,
  SILL_T,
  WALL_H,
  WALL_T,
  WINDOW_TOP,
  boxCentre,
  boxCorners,
  cameraOffset,
  cameraPosition,
  cameraRight,
  cameraUp,
  clamp,
  fitHalfHeight,
  homeBox,
  nearestAngle,
  smoothstep,
} from "./space";
export type { Box3Like, Vec3 } from "./space";
export {
  DOLLHOUSE_PITCH_DEG,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  VIEW_STEP_DEG,
  YAW_DEGREES,
  clampPitchDeg,
  fitHalfHeightWorst,
  furnitureOpacity,
  homeCentreCm,
  normalizeDeg,
  quantizeDeg,
  stepAzimuth,
  viewStopAzimuths,
  wholeHomeBox,
  yawAtDegrees,
  yawAzimuth,
} from "./cameraMath";
export type { ViewStep } from "./cameraMath";
