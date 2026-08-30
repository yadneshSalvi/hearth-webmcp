"use client";
/**
 * Orthographic camera rig. Two views (STYLE.md §2): dollhouse at the isometric 35.264° pitch on the
 * 45° corners, and plan top-down with north up. Commands — a view or yaw change, a room switch, an
 * agent's `set_view`, the reset control — tween over 600 ms; a drag moves the camera on the same
 * frame the pointer moved.
 *
 * The scene owns the framing (`meta.view`, `meta.yaw`, the active room, the focus override); the
 * human's adjustments on top of it live in `src/scene/cameraState.ts` and are applied here by one
 * spring: `set` while a gesture is in hand, `start` for a command. The gestures themselves are in
 * `src/scene/cameraGestures.ts`, mounted by Interaction.tsx — this file only follows the store.
 *
 * Framing measures the *visible* canvas — the window minus the floating panels (src/scene/insets.ts)
 * — so a room is never composed under the catalog or the inspector.
 */
import { useEffect, useMemo, useRef } from "react";
import { OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useSpring } from "@react-spring/three";
import type { OrthographicCamera as OrthographicCameraImpl } from "three";
import { motion as motionTokens } from "../tokens";
import {
  consumeFramingSkip,
  effectiveOrbit,
  getCameraState,
  resetCamera,
  setCameraInvalidate,
  setCameraPanLimit,
  setCameraPixelScale,
  setCameraPlanView,
  subscribeCamera,
} from "./cameraState";
import { setFocusTarget, useFocusTarget, useFocusToken } from "./focus";
import { introAzimuthOffset } from "./intro";
import type { FocusTarget } from "./focus";
import { useFramedBox } from "./framing";
import { useReducedMotion } from "./idle";
import { insetCentreOffsetPx, insetHalfScale, useCanvasInsets, visibleAspect } from "./insets";
import {
  DOLLHOUSE_PITCH,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  PLAN_PITCH,
  boxCentre,
  cameraOffset,
  cameraRight,
  cameraUp,
  clamp,
  easeOut,
  fitHalfHeight,
  homeBox,
  nearestAngle,
  normalizeDeg,
  yawAzimuth,
} from "./math";
import { useMeta, useRooms } from "./useSceneStore";

const PADDING = 0.12;
const DISTANCE = 60;
const DEG = Math.PI / 180;
const PITCH_MIN = PITCH_MIN_DEG * DEG;
const PITCH_MAX = PITCH_MAX_DEG * DEG;
/**
 * How far the pan may travel from the framed centre: enough that a room-framed shot can be dragged
 * onto any neighbour in the home, and never less than 3 m so a studio flat can still be nudged.
 */
const PAN_FRACTION = 0.6;
const MIN_PAN_LIMIT = 3;

/** The camera tween every command shares (STYLE.md §2: 600 ms eased). */
const TWEEN = { duration: motionTokens.cameraTweenMs, easing: easeOut };

/** Focus control for `studioApi.focus()`: pin the camera to a room or item, or clear the override. */
export function useCameraFocus(): { target: FocusTarget | undefined; focus: (next: FocusTarget | undefined) => void } {
  const target = useFocusTarget();
  return { target, focus: setFocusTarget };
}

/** Rewrites `to` within ±180° of `from`, so a tween takes the short way round. */
function nearestDeg(from: number, to: number): number {
  return from + normalizeDeg(to - from);
}

/** The studio's only camera. */
export function CameraRig() {
  const meta = useMeta();
  const rooms = useRooms();
  const framed = useFramedBox();
  const focus = useFocusTarget();
  const focusToken = useFocusToken();
  // STYLE.md §3: choreography degrades to a cut. A framing command lands on the frame it is asked
  // for; the drag path is already immediate (see `cameraState`).
  const reduced = useReducedMotion();
  const size = useThree((state) => state.size);
  const invalidateRoot = useThree((state) => state.invalidate);
  const cameraRef = useRef<OrthographicCameraImpl>(null);

  const insets = useCanvasInsets();
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const plan = meta.view === "plan";
  const pitchTarget = plan ? PLAN_PITCH : DOLLHOUSE_PITCH;
  const rawAzimuth = plan ? 0 : yawAzimuth(meta.yaw);
  const centre = boxCentre(framed.box);
  // Fit the box to the rect the human can actually see, then grow the frustum back to the full
  // canvas and slide the target so that rect's centre — not the window's — holds the room.
  const viewport = { width: size.width, height: size.height };
  const halfTarget = fitHalfHeight(framed.box, rawAzimuth, pitchTarget, visibleAspect(viewport, insets), PADDING)
    * insetHalfScale(viewport, insets);
  const offsetPx = insetCentreOffsetPx(insets);
  const panLimit = useMemo(() => {
    const box = homeBox(rooms);
    const extent = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]);
    return Math.max(extent * PAN_FRACTION, MIN_PAN_LIMIT);
  }, [rooms]);

  const [spring, springApi] = useSpring(
    () => ({
      azimuth: rawAzimuth,
      pitch: pitchTarget,
      cx: centre[0],
      cy: centre[1],
      cz: centre[2],
      half: halfTarget,
      insetX: offsetPx.x,
      insetY: offsetPx.y,
      config: TWEEN,
    }),
    [],
  );

  // The human's adjustments, following `cameraState`. Same duration and easing as the framing
  // spring above, so when a 45° step changes both the corner and the offset their sum still reads
  // as one 600 ms sweep.
  const [manual, manualApi] = useSpring(() => {
    const camera = getCameraState();
    return {
      orbitAz: camera.orbit.azimuthDeg,
      orbitPitch: camera.orbit.pitchDeg,
      zoom: camera.zoom,
      panX: camera.pan.x,
      panY: camera.pan.y,
      config: TWEEN,
    };
  }, []);

  // Started imperatively so the azimuth can be unwrapped against the live value: a yaw change
  // always takes the short way round (STYLE.md §2: 45° snaps, 600 ms eased).
  useEffect(() => {
    springApi.start({
      azimuth: nearestAngle(spring.azimuth.get(), rawAzimuth),
      pitch: pitchTarget,
      cx: centre[0],
      cy: centre[1],
      cz: centre[2],
      half: halfTarget,
      insetX: offsetPx.x,
      insetY: offsetPx.y,
      config: TWEEN,
      immediate: reduced,
    });
  }, [springApi, spring, rawAzimuth, pitchTarget, centre, halfTarget, offsetPx.x, offsetPx.y, reduced]);

  // The demand frameloop draws nothing on its own, so every camera write has to ask for a frame.
  // Registered from here rather than imported at module scope: the module-level `invalidate` can
  // bind to a different copy of the R3F runtime than the one driving this canvas (see Studio.tsx).
  useEffect(() => {
    setCameraInvalidate(invalidateRoot);
    return () => setCameraInvalidate(undefined);
  }, [invalidateRoot]);

  useEffect(() => {
    setCameraPanLimit(panLimit);
  }, [panLimit]);

  useEffect(() => {
    setCameraPlanView(plan);
  }, [plan]);

  // No React state in the drag path: the store is read imperatively and written to the spring.
  useEffect(
    () => subscribeCamera(() => {
      const camera = getCameraState();
      const orbit = effectiveOrbit();
      const to = {
        orbitAz: nearestDeg(manual.orbitAz.get(), orbit.azimuthDeg),
        orbitPitch: orbit.pitchDeg,
        zoom: camera.zoom,
        panX: camera.pan.x,
        panY: camera.pan.y,
      };
      if (camera.mode === "tween") manualApi.start({ ...to, config: TWEEN });
      else manualApi.set(to);
    }),
    [manual, manualApi],
  );

  // A new framed shot re-homes the camera, by tween, so an agent's `set_view` sweeps rather than
  // pops. The 45° step is the one exception: it writes the corner *and* the offset as one intent.
  useEffect(() => {
    if (consumeFramingSkip()) return;
    resetCamera({ tween: true });
    // `focusToken` counts framing *commands*, not changes: `set_view` with the room the camera is
    // already on, or the switcher re-picking the active room, both mean "put the camera back".
  }, [meta.view, meta.yaw, meta.activeRoomId, focus, focusToken]);

  useFrame(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    // The opening settle enters 15° off the resting yaw and sweeps in (src/scene/intro.ts). Plan
    // view is north-up by definition, so it never inherits the sweep — nor the free orbit.
    const azimuth = spring.azimuth.get()
      + (plan ? 0 : introAzimuthOffset() + manual.orbitAz.get() * DEG);
    const basePitch = spring.pitch.get();
    // Clamped against the base rather than a constant: mid-tween out of plan view the base is still
    // above 75°, and clamping the sum there would snap the shot instead of easing it down.
    const pitch = plan
      ? basePitch
      : clamp(basePitch + manual.orbitPitch.get() * DEG, PITCH_MIN, Math.max(basePitch, PITCH_MAX));
    const half = spring.half.get() / manual.zoom.get();
    const halfWidth = half * aspect;
    const offset = cameraOffset(azimuth, pitch);
    const right = cameraRight(azimuth);
    const up = cameraUp(azimuth, pitch);
    const cx = spring.cx.get();
    const cy = spring.cy.get();
    const cz = spring.cz.get();
    // Panels shift the frame, not the scene: moving the target left makes the room sit right of
    // centre, into the gap between the catalog and the inspector.
    const perPixel = (half * 2) / Math.max(1, size.height);
    // Published so a pan can follow the pointer 1:1 in screen pixels.
    setCameraPixelScale(perPixel);
    const shiftX = manual.panX.get() - spring.insetX.get() * perPixel;
    const shiftY = manual.panY.get() + spring.insetY.get() * perPixel;
    camera.position.set(
      cx + offset[0] * DISTANCE + right[0] * shiftX + up[0] * shiftY,
      cy + offset[1] * DISTANCE + right[1] * shiftX + up[1] * shiftY,
      cz + offset[2] * DISTANCE + right[2] * shiftX + up[2] * shiftY,
    );
    camera.rotation.order = "YXZ";
    camera.rotation.set(-pitch, azimuth, 0);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
  });

  return <OrthographicCamera ref={cameraRef} makeDefault manual near={1} far={DISTANCE * 3} left={-1} right={1} top={1} bottom={-1} />;
}
