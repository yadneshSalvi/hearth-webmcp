"use client";
/**
 * Orthographic camera rig. Two views only (STYLE.md §2): dollhouse at an isometric 35.264° pitch
 * with yaw snapped to 45° corners, and plan top-down with north up. View, yaw and focus changes
 * tween over 600 ms; the wheel zooms and a right-drag (or two-finger drag) pans. No free orbit.
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
import { setFocusTarget, useFocusTarget } from "./focus";
import type { FocusTarget } from "./focus";
import { useFramedBox } from "./framing";
import { insetCentreOffsetPx, insetHalfScale, useCanvasInsets, visibleAspect } from "./insets";
import {
  DOLLHOUSE_PITCH,
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
  yawAzimuth,
} from "./math";
import { useMeta, useRooms } from "./useSceneStore";

const PADDING = 0.12;
const DISTANCE = 60;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const PAN_FRACTION = 0.3;

/** Focus control for `studioApi.focus()`: pin the camera to a room or item, or clear the override. */
export function useCameraFocus(): { target: FocusTarget | undefined; focus: (next: FocusTarget | undefined) => void } {
  const target = useFocusTarget();
  return { target, focus: setFocusTarget };
}

/** The studio's only camera. */
export function CameraRig() {
  const meta = useMeta();
  const rooms = useRooms();
  const framed = useFramedBox();
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const cameraRef = useRef<OrthographicCameraImpl>(null);
  const zoom = useRef(1);
  const pan = useRef({ x: 0, y: 0 });

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
    return Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]) * PAN_FRACTION;
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
      config: { duration: motionTokens.cameraTweenMs, easing: easeOut },
    }),
    [],
  );

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
      config: { duration: motionTokens.cameraTweenMs, easing: easeOut },
    });
  }, [springApi, spring, rawAzimuth, pitchTarget, centre, halfTarget, offsetPx.x, offsetPx.y]);

  // A new focus or view resets the manual zoom/pan so every framed shot is reproducible.
  useEffect(() => {
    zoom.current = 1;
    pan.current = { x: 0, y: 0 };
  }, [meta.view, meta.yaw, meta.activeRoomId]);

  useEffect(() => {
    const element = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom.current = clamp(zoom.current * Math.exp(-event.deltaY * 0.0016), ZOOM_MIN, ZOOM_MAX);
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    let dragging = false;
    const pointers = new Map<number, { x: number; y: number }>();
    const onDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (event.button === 2 || event.button === 1 || pointers.size === 2) {
        dragging = true;
        element.setPointerCapture(event.pointerId);
      }
    };
    const onMove = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!dragging || !last) return;
      const perPixel = (spring.half.get() * 2) / Math.max(1, size.height) / zoom.current;
      pan.current = {
        x: clamp(pan.current.x - (event.clientX - last.x) * perPixel, -panLimit, panLimit),
        y: clamp(pan.current.y + (event.clientY - last.y) * perPixel, -panLimit, panLimit),
      };
    };
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size === 0) dragging = false;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("contextmenu", onContextMenu);
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenu);
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
    };
  }, [gl, panLimit, size.height, spring.half]);

  useFrame(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const azimuth = spring.azimuth.get();
    const pitch = spring.pitch.get();
    const half = spring.half.get() / zoom.current;
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
    const shiftX = pan.current.x - spring.insetX.get() * perPixel;
    const shiftY = pan.current.y + spring.insetY.get() * perPixel;
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
