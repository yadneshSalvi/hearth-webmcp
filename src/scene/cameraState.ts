"use client";
/**
 * The human's camera adjustments, on top of the framed shot the rig computes from the scene.
 *
 * An external store in the style of `src/scene/focus.ts`: no React state and no three, so a drag
 * can write it on every pointer event without re-rendering anything. The rig follows it with one
 * react-spring — `set` while a drag is in hand, `start` for a command — and the wall cut-away
 * subscribes through `useOrbitQuantized`, which only wakes React when the angle crosses a step.
 *
 * Everything here is an *offset*: the azimuth is measured from the framed corner
 * (`yawAzimuth(meta.yaw)`), the pitch from the isometric dollhouse pitch, the zoom from the fitted
 * frame and the pan from the framed centre. So the scene stays the single source of framing
 * (SCENE_SCHEMA.md) and an agent's `set_view` still re-homes the shot.
 */
import { useSyncExternalStore } from "react";
import { hearthStore } from "../state/store";
import type { View } from "../engine/types";
import { focusKind } from "./focus";
import type { FocusKind } from "./focus";
import {
  DOLLHOUSE_PITCH_DEG,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  PLAN_PITCH,
  YAW_DEGREES,
  clamp,
  normalizeDeg,
  quantizeDeg,
  stepAzimuth,
} from "./math";

/** Manual zoom range, unchanged from the rig's original wheel clamp. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.2;

/** The pitch offsets that keep the effective pitch inside [15°, 75°] (STYLE.md §2). */
const PITCH_OFFSET_MIN = PITCH_MIN_DEG - DOLLHOUSE_PITCH_DEG;
const PITCH_OFFSET_MAX = PITCH_MAX_DEG - DOLLHOUSE_PITCH_DEG;

/** Pan limit before the rig has measured the home, in metres. */
const DEFAULT_PAN_LIMIT = 3;

/** A drag writes per pointer event; a command (button, key, reset, agent) tweens. */
export type CameraMode = "immediate" | "tween";

export interface OrbitOffset {
  /** Degrees added to the framed corner's azimuth. Unbounded, normalised to (−180, 180]. */
  azimuthDeg: number;
  /** Degrees added to the dollhouse pitch, clamped so the effective pitch stays in [15°, 75°]. */
  pitchDeg: number;
}

export interface CameraState {
  orbit: OrbitOffset;
  /** 1 = the framed shot. */
  zoom: number;
  /** Metres along the camera's right and up axes. */
  pan: { x: number; y: number };
  mode: CameraMode;
}

const HOME_ORBIT: OrbitOffset = { azimuthDeg: 0, pitchDeg: 0 };
const HOME: CameraState = { orbit: HOME_ORBIT, zoom: 1, pan: { x: 0, y: 0 }, mode: "immediate" };

let state: CameraState = HOME;
let plan = false;
let panLimit = DEFAULT_PAN_LIMIT;
let metresPerPixel = 0.01;
let requestFrame: (() => void) | undefined;
/** Set by `stepView` when it writes a new corner: the corner and the offset are one intent. */
let framingSkip = false;
const listeners = new Set<() => void>();

function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function publish(patch: Partial<CameraState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
  // `frameloop="demand"` draws nothing on its own, so a camera change that never asks for a frame
  // is a camera change nobody sees.
  requestFrame?.();
}

/** The rig publishes its own root's `invalidate` here (see the note in src/scene/Studio.tsx). */
export function setCameraInvalidate(fn: (() => void) | undefined): void {
  requestFrame = fn;
}

/** The rig reports how far one screen pixel travels in world metres, every frame. */
export function setCameraPixelScale(scale: number): void {
  if (scale > 0) metresPerPixel = scale;
}

/**
 * How far one screen pixel travels in world metres, as of the last drawn frame. Read imperatively
 * from `useFrame` — the plan-view room labels size themselves against it (src/scene/Rooms.tsx).
 */
export function cameraMetresPerPixel(): number {
  return metresPerPixel;
}

/** The rig reports how far the pan may travel from the framed centre, in metres. */
export function setCameraPanLimit(limit: number): void {
  if (limit > 0) panLimit = limit;
}

/** Plan view is north-up by definition, so the orbit is inert there and resets on the way in. */
export function setCameraPlanView(next: boolean): void {
  if (plan === next) return;
  plan = next;
  if (next && (state.orbit.azimuthDeg !== 0 || state.orbit.pitchDeg !== 0)) {
    publish({ orbit: HOME_ORBIT, mode: reducedMotion() ? "immediate" : "tween" });
  }
}

/** True while the camera is looking north-up from above and cannot be orbited. */
export function cameraIsPlan(): boolean {
  return plan;
}

/** The live camera adjustments. Read imperatively from `useFrame` and from gesture handlers. */
export function getCameraState(): CameraState {
  return state;
}

/** The orbit the rig should actually apply: zero in plan view. */
export function effectiveOrbit(): OrbitOffset {
  return plan ? HOME_ORBIT : state.orbit;
}

/** True when the human has moved the camera off the framed shot. */
export function cameraOffHome(): boolean {
  return state.zoom !== 1 || state.pan.x !== 0 || state.pan.y !== 0
    || state.orbit.azimuthDeg !== 0 || state.orbit.pitchDeg !== 0;
}

export function subscribeCamera(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The whole camera state, for React readers that need every field. */
export function useCameraState(): CameraState {
  return useSyncExternalStore(subscribeCamera, getCameraState, () => HOME);
}

/** True while the reset-view control should be offered. */
export function useCameraOffHome(): boolean {
  return useSyncExternalStore(subscribeCamera, cameraOffHome, () => false);
}

const quantized = new Map<number, OrbitOffset>();

/**
 * The effective orbit rounded onto a grid of `stepDeg` degrees. The snapshot object is reused until
 * the rounded angle actually changes, so a 2 s orbit drag re-renders its readers a handful of times
 * rather than once per pointer event (the wall cut-away's own 300 ms fade smooths the step).
 */
function quantizedOrbit(stepDeg: number): OrbitOffset {
  const orbit = effectiveOrbit();
  const azimuthDeg = quantizeDeg(orbit.azimuthDeg, stepDeg);
  const pitchDeg = quantizeDeg(orbit.pitchDeg, stepDeg);
  const previous = quantized.get(stepDeg);
  if (previous && previous.azimuthDeg === azimuthDeg && previous.pitchDeg === pitchDeg) return previous;
  const next = { azimuthDeg, pitchDeg };
  quantized.set(stepDeg, next);
  return next;
}

/** Subscribes to the orbit on a coarse grid; see `quantizedOrbit`. */
export function useOrbitQuantized(stepDeg: number): OrbitOffset {
  return useSyncExternalStore(subscribeCamera, () => quantizedOrbit(stepDeg), () => HOME_ORBIT);
}

/** Sets the orbit offsets outright. Commands tween, drags do not. */
export function setOrbit(azimuthDeg: number, pitchDeg: number, opts: { tween?: boolean } = {}): void {
  if (plan) return;
  const orbit = {
    azimuthDeg: normalizeDeg(azimuthDeg),
    pitchDeg: clamp(pitchDeg, PITCH_OFFSET_MIN, PITCH_OFFSET_MAX),
  };
  const tween = (opts.tween ?? true) && !reducedMotion();
  if (orbit.azimuthDeg === state.orbit.azimuthDeg && orbit.pitchDeg === state.orbit.pitchDeg) return;
  publish({ orbit, mode: tween ? "tween" : "immediate" });
}

/** Turns and tilts the camera by a delta, immediately — this is the drag path. */
export function orbitBy(azimuthDeg: number, pitchDeg: number): void {
  if (plan) return;
  setOrbit(state.orbit.azimuthDeg + azimuthDeg, state.orbit.pitchDeg + pitchDeg, { tween: false });
}

/** Slides the framed shot so it follows the pointer 1:1, in screen pixels. */
export function panByPixels(dxPx: number, dyPx: number): void {
  if (dxPx === 0 && dyPx === 0) return;
  publish({
    pan: {
      x: clamp(state.pan.x - dxPx * metresPerPixel, -panLimit, panLimit),
      y: clamp(state.pan.y + dyPx * metresPerPixel, -panLimit, panLimit),
    },
    mode: "immediate",
  });
}

/** Multiplies the manual zoom, within the rig's clamp. */
export function zoomBy(factor: number): void {
  if (!(factor > 0)) return;
  const zoom = clamp(state.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (zoom === state.zoom) return;
  publish({ zoom, mode: "immediate" });
}

/**
 * The human's adjustments, copied out. A capture borrows the framed shot (src/ui/capture.ts) and has
 * to hand back exactly the view it took, down to the pan.
 */
export function cameraAdjustments(): CameraState {
  return { orbit: { ...state.orbit }, zoom: state.zoom, pan: { ...state.pan }, mode: state.mode };
}

/**
 * Puts a snapshot from `cameraAdjustments` back, by tween. Unlike `setOrbit` this ignores the plan
 * flag: a capture switches the view to plan and back, and the human's tilt has to survive that.
 */
export function restoreCameraAdjustments(saved: CameraState, opts: { tween?: boolean } = {}): void {
  const tween = (opts.tween ?? true) && !reducedMotion();
  publish({
    orbit: { ...saved.orbit },
    zoom: saved.zoom,
    pan: { ...saved.pan },
    mode: tween ? "tween" : "immediate",
  });
}

/** Returns the camera to the framed shot. Already home is not an event. */
export function resetCamera(opts: { tween?: boolean } = {}): void {
  if (!cameraOffHome()) return;
  const tween = (opts.tween ?? false) && !reducedMotion();
  publish({ orbit: HOME_ORBIT, zoom: 1, pan: { x: 0, y: 0 }, mode: tween ? "tween" : "immediate" });
}

/**
 * Steps the effective azimuth to the next 45° stop — the four dollhouse corners and the four
 * face-on elevations. The corner goes to the scene (undoable, agent-visible, exactly as `[` and `]`
 * always were) and only when it changes; the remainder is this store's offset, tweened alongside.
 */
export function stepView(direction: number): void {
  const store = hearthStore.getState();
  const meta = store.scene.meta;
  if (meta.view === "plan") return;
  const next = stepAzimuth(meta.yaw, state.orbit.azimuthDeg, direction);
  if (next.yaw !== meta.yaw) {
    framingSkip = true;
    store.setView("human", { yaw: next.yaw });
  }
  setOrbit(next.offsetDeg, state.orbit.pitchDeg, { tween: true });
}

/**
 * True when the framing change the rig is reacting to was this module's own 45° step, so the shot
 * must keep the human's zoom, pan and tilt instead of re-homing.
 */
export function consumeFramingSkip(): boolean {
  const skip = framingSkip;
  framingSkip = false;
  return skip;
}

export interface CameraBridge {
  /** Effective azimuth in degrees: the framed corner plus the orbit, normalised to (−180, 180]. */
  azimuthDeg: number;
  /** Effective pitch in degrees. */
  pitchDeg: number;
  zoom: number;
  pan: { x: number; y: number };
  offHome: boolean;
  view: View;
  /** What the rig is framing: the whole home, the active/focused room, or one item. */
  focus: FocusKind;
}

/** What `window.__hearthStudio.camera()` reports (src/scene/Studio.tsx). Test-only. */
export function cameraBridgeSnapshot(): CameraBridge {
  const meta = hearthStore.getState().scene.meta;
  const isPlan = meta.view === "plan";
  const orbit = isPlan ? HOME_ORBIT : state.orbit;
  return {
    azimuthDeg: isPlan ? 0 : normalizeDeg(YAW_DEGREES[meta.yaw] + orbit.azimuthDeg),
    pitchDeg: isPlan ? (PLAN_PITCH * 180) / Math.PI : DOLLHOUSE_PITCH_DEG + orbit.pitchDeg,
    zoom: state.zoom,
    pan: { ...state.pan },
    offHome: cameraOffHome(),
    view: meta.view,
    focus: focusKind(),
  };
}

/** Test hook: drops every adjustment and registration without touching the scene. */
export function resetCameraStateForTests(): void {
  state = HOME;
  plan = false;
  panLimit = DEFAULT_PAN_LIMIT;
  metresPerPixel = 0.01;
  framingSkip = false;
  quantized.clear();
}
