/**
 * Camera maths: the free orbit's angles and stops, the whole-home volume the dollhouse frames, and
 * the cut-away test for furniture standing in front of the framed room. Split out of
 * `src/scene/math.ts` — which is the *scene* maths (cm→m, wall geometry, GLB normalisation, stacking)
 * — because the camera grew its own body of rules and both files were over the size guideline.
 *
 * Stands on `src/scene/space.ts` (the frame of reference) and never on `math.ts`, so there is no
 * import cycle; `math.ts` re-exports everything here, so every existing import and test keeps
 * working. No three, no React: every export is unit-tested without WebGL.
 */
import type { Room, Vec2, Yaw } from "../engine/types";
import {
  DOLLHOUSE_PITCH,
  M,
  WALL_T,
  clamp,
  fitHalfHeight,
  homeBox,
  smoothstep,
} from "./space";
import type { Box3Like } from "./space";

/**
 * World-space bounding box in metres for the whole home, inflated by the wall thickness exactly as
 * `roomBox` inflates one room: walls extrude *outward* from the room polygons, so framing the bare
 * polygons clips the very walls that frame the shot.
 */
export function wholeHomeBox(rooms: Room[]): Box3Like {
  const box = homeBox(rooms);
  const pad = WALL_T * M;
  return {
    min: [box.min[0] - pad, box.min[1], box.min[2] - pad],
    max: [box.max[0] + pad, box.max[1], box.max[2] + pad],
  };
}

/** Centre of the home's footprint in world centimetres — what the wall cut-away measures against. */
export function homeCentreCm(rooms: Room[]): Vec2 {
  const box = homeBox(rooms);
  return { x: (box.min[0] + box.max[0]) / 2 / M, y: (box.min[2] + box.max[2]) / 2 / M };
}

/**
 * Per-item opacity for furniture standing between the camera and the framed room.
 *
 * The walls in front of the framed room are cut away (`wallOpacity`), which is what exposes the
 * neighbour's wardrobe standing behind them: at a low pitch or a face-on angle it plants itself in
 * the middle of the room the human is looking at. So the same test, on the same edges, for the body
 * as well as the wall — measured from the corner of the item's footprint nearest the camera.
 *
 * `centreCm` is the item's centre in world centimetres, `extentM` the half-extents of its
 * axis-aligned footprint in metres. Callers exclude the framed room's own items, ghosts and the
 * selection (src/scene/Furniture.tsx): only a *neighbour* can be in the way.
 */
export function furnitureOpacity(
  centreCm: Vec2,
  extentM: { x: number; z: number },
  focusCentre: Vec2,
  azimuth: number,
  pitch: number,
  opts: { cutInFront?: boolean } = {},
): number {
  if (!(opts.cutInFront ?? true)) return 1;
  // Above 80° the shot is nearly a plan and nothing occludes anything, exactly as for walls.
  if (pitch > (Math.PI / 180) * 80) return 1;
  const toCamera = { x: Math.sin(azimuth), y: Math.cos(azimuth) };
  const dx = (centreCm.x - focusCentre.x) * M;
  const dy = (centreCm.y - focusCentre.y) * M;
  const frontness = dx * toCamera.x + dy * toCamera.y
    + Math.abs(toCamera.x) * extentM.x + Math.abs(toCamera.y) * extentM.z;
  return 1 - smoothstep(0.35, 1.3, frontness);
}

/** Camera azimuth in degrees for each dollhouse yaw corner — the odd multiples of 45°. */
export const YAW_DEGREES: Record<Yaw, number> = { sw: -45, se: 45, ne: 135, nw: -135 };

/**
 * Camera azimuth in radians for a dollhouse yaw. The camera sits on that compass corner, so
 * `sw` (−45°) looks from the south-west toward the north-east and the north wall runs up-right.
 */
export function yawAzimuth(yaw: Yaw): number {
  return (YAW_DEGREES[yaw] * Math.PI) / 180;
}

/** The isometric dollhouse pitch in degrees: the base every manual pitch offset is measured from. */
export const DOLLHOUSE_PITCH_DEG = (DOLLHOUSE_PITCH * 180) / Math.PI;

/**
 * Free-orbit pitch limits (STYLE.md §2). Below 15° the camera starts to look up at the floor from
 * outside the house; above 75° the isometric shot flattens into a fake plan with none of plan
 * view's clarity. The dollhouse pitch sits inside the range, so 0 is always a legal offset.
 */
export const PITCH_MIN_DEG = 15;
export const PITCH_MAX_DEG = 75;

/** The camera's eight stops: the four dollhouse corners and the four face-on elevations. */
export const VIEW_STEP_DEG = 45;

/** Rewrites an angle in degrees into (−180, 180], so an unbounded orbit never drifts. */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Clamps an absolute pitch in degrees into the free-orbit range. */
export function clampPitchDeg(deg: number): number {
  return clamp(deg, PITCH_MIN_DEG, PITCH_MAX_DEG);
}

/** Rounds an angle onto a grid of `step` degrees. The wall cut-away re-renders on this grid only. */
export function quantizeDeg(deg: number, step: number): number {
  if (!(step > 0)) return deg;
  // −0 would be a different snapshot value from 0 for a strict-equality memo, so normalise it away.
  return Math.round(deg / step) * step + 0;
}

/** The yaw corner whose azimuth is exactly `deg`, or undefined for a face-on elevation. */
export function yawAtDegrees(deg: number): Yaw | undefined {
  const wanted = normalizeDeg(deg);
  for (const yaw of Object.keys(YAW_DEGREES) as Yaw[]) {
    if (Math.abs(normalizeDeg(YAW_DEGREES[yaw] - wanted)) < 1e-6) return yaw;
  }
  return undefined;
}

/** A camera stop, split into the corner the scene stores and the offset the camera store holds. */
export interface ViewStep {
  yaw: Yaw;
  offsetDeg: number;
}

/**
 * The next 45° stop past `yaw + offsetDeg`, decomposed back into a scene yaw and a camera offset.
 *
 * A corner stop is stored as the corner with no offset, so `[` and `]` keep writing the undoable,
 * agent-visible yaw they always did. A face-on elevation sits 45° from two corners: the one the
 * camera is already on wins (no second store write, no extra undo step), otherwise the corner
 * behind the travel, so the sweep stays continuous.
 */
export function stepAzimuth(yaw: Yaw, offsetDeg: number, direction: number): ViewStep {
  const way = direction >= 0 ? 1 : -1;
  const current = normalizeDeg(YAW_DEGREES[yaw] + offsetDeg);
  const notch = current / VIEW_STEP_DEG;
  // Strictly past the current angle, so a press from a stop always moves exactly one notch.
  const index = way > 0 ? Math.floor(notch + 1e-6) + 1 : Math.ceil(notch - 1e-6) - 1;
  const target = normalizeDeg(index * VIEW_STEP_DEG);
  const corner = yawAtDegrees(target);
  if (corner) return { yaw: corner, offsetDeg: 0 };
  const held = normalizeDeg(target - YAW_DEGREES[yaw]);
  if (Math.abs(Math.abs(held) - VIEW_STEP_DEG) < 1e-6) return { yaw, offsetDeg: held };
  const behind = yawAtDegrees(target - VIEW_STEP_DEG * way);
  return behind ? { yaw: behind, offsetDeg: VIEW_STEP_DEG * way } : { yaw, offsetDeg: held };
}

/** The eight 45° stops as azimuths in radians. */
export function viewStopAzimuths(): number[] {
  const stops: number[] = [];
  for (let index = -3; index <= 4; index += 1) stops.push((index * VIEW_STEP_DEG * Math.PI) / 180);
  return stops;
}

/**
 * The largest framed half-height over every 45° stop at the orbit's pitch extremes — what a shot
 * has to be fitted against if the free orbit must never clip the framed room.
 */
export function fitHalfHeightWorst(box: Box3Like, aspect: number, padding: number): number {
  const pitches = [PITCH_MIN_DEG, DOLLHOUSE_PITCH_DEG, PITCH_MAX_DEG].map((deg) => (deg * Math.PI) / 180);
  let worst = 0;
  for (const azimuth of viewStopAzimuths()) {
    for (const pitch of pitches) worst = Math.max(worst, fitHalfHeight(box, azimuth, pitch, aspect, padding));
  }
  return worst;
}
