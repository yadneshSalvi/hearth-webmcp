"use client";
/**
 * Every camera gesture, in one place. The pointer state machine for furniture lives in
 * Interaction.tsx and hands a press on the empty background over here (`beginCameraDrag`); the
 * wheel, the right/middle drag, two-finger touch and the double-click to re-home are owned here
 * outright. Nothing in this file re-renders React: a gesture writes `src/scene/cameraState.ts` per
 * event and the rig's spring picks it up in `useFrame`.
 *
 * | input | effect |
 * |---|---|
 * | left-drag on empty background | pan, 1:1 with the pointer |
 * | Space held + left-drag anywhere | pan, furniture included (the hand tool) |
 * | right-drag, ⌃-click drag, ⇧ + left-drag | orbit (pan instead in plan view) |
 * | middle-drag | pan |
 * | wheel, trackpad pinch | zoom |
 * | one finger | pan · two fingers | pan by the midpoint, pinch to zoom, twist to turn |
 * | double-click / double-tap on the background | reset to the framed shot |
 */
import { useEffect } from "react";
import type { Furniture } from "../engine/types";
import { pushToast } from "../state/toasts";
import { cameraIsPlan, orbitBy, panByPixels, resetCamera, zoomBy } from "./cameraState";
import { isTyping } from "./interactionCommands";

/** Pointer travel that turns a press into a drag rather than a click (matches Interaction.tsx). */
const DRAG_THRESHOLD_PX = 3;
/** Degrees of azimuth per pixel of horizontal travel — a full turn in about a screen width. */
const ORBIT_DEG_PER_PX = 0.35;
/** Degrees of pitch per pixel of vertical travel; the clamp does the rest. */
const PITCH_DEG_PER_PX = 0.25;
/** Wheel notches to zoom factor, unchanged from the rig's original wheel handler. */
const WHEEL_ZOOM = 0.0016;
/** How close in time and space two taps have to be to mean "re-home". */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 28;
/** Remembers that the pan hint has been shown, once per browser. */
const HINT_KEY = "hearth.camera.hint";

export type CameraDragKind = "pan" | "orbit";

interface ActiveDrag {
  kind: CameraDragKind;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface TwoFinger {
  ids: [number, number];
  midX: number;
  midY: number;
  distance: number;
  angle: number;
}

let active: ActiveDrag | undefined;
let twoFinger: TwoFinger | undefined;
/** The gesture that just ended, so Interaction's pointerup can still ask whether it moved. */
let ended: { pointerId: number; moved: boolean } | undefined;
let element: HTMLElement | undefined;
const touches = new Map<number, { x: number; y: number }>();
let lastTap = { t: 0, x: 0, y: 0 };
/** True while Space is held: the canvas becomes a hand tool and every press pans (see `useCameraGestures`). */
let handTool = false;

/**
 * True while the hand tool is engaged. Interaction.tsx asks before it picks: with Space held the
 * press belongs to the camera wherever it lands, so a room full of furniture can still be panned.
 */
export function panModifierHeld(): boolean {
  return handTool;
}

/** The canvas cursor: `grabbing` mid-gesture, `grab` otherwise — everything here is draggable. */
function applyCursor(): void {
  if (!element) return;
  element.style.cursor = active ? "grabbing" : "grab";
}

/** True while the camera owns the pointer: hover highlighting and selection stay out of the way. */
export function cameraGestureActive(): boolean {
  return active !== undefined || twoFinger !== undefined;
}

/** True when this pointer's camera gesture travelled far enough to be a drag rather than a click. */
export function cameraGestureMoved(pointerId: number): boolean {
  if (active?.pointerId === pointerId) return active.moved;
  return ended?.pointerId === pointerId ? ended.moved : false;
}

/** In plan view there is nothing to orbit, so an orbit gesture pans instead. */
function resolve(kind: CameraDragKind): CameraDragKind {
  return kind === "orbit" && cameraIsPlan() ? "pan" : kind;
}

/**
 * Takes over a press: Interaction calls this when the pointer is on empty floor or background.
 * Safe to call while a two-finger gesture is running — that one wins.
 */
export function beginCameraDrag(event: PointerEvent, kind: CameraDragKind): void {
  if (twoFinger) return;
  active = {
    kind: resolve(kind),
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
  };
  ended = undefined;
  if (element) {
    applyCursor();
    if (!element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId);
  }
}

function endDrag(): void {
  if (!active) return;
  const panned = active.moved && active.kind === "pan";
  ended = { pointerId: active.pointerId, moved: active.moved };
  active = undefined;
  applyCursor();
  if (panned) hint();
}

/**
 * The one-time "here is how this camera works" toast, shown after the first pan of a browser.
 *
 * Fired from `endDrag`, i.e. on pointer-up, and not from the first moved pixel — a toast pushed from
 * inside a captured pointer-move sequence was queued (the queue reported it synchronously) and then
 * lost before it ever painted, so the hint spent its localStorage flag on every first pan and was
 * never once read. It is also simply better: a card does not pop up under a pointer mid-drag.
 */
function hint(): void {
  if (typeof window === "undefined") return;
  // The suite drives dozens of gestures; a toast over the canvas is not what it came to assert.
  if (process.env.NEXT_PUBLIC_HEARTH_E2E === "1") return;
  if (new URLSearchParams(window.location.search).get("e2e") === "1") return;
  try {
    if (window.localStorage.getItem(HINT_KEY) === "1") return;
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Private browsing or a blocked storage partition: show it this once and forget it.
  }
  pushToast({
    tone: "info",
    title: "Hold Space and drag to pan from anywhere",
    // "Shift" spelled out, not ⇧: the arrow is outside the latin subset next/font loads and lands
    // as tofu in body copy. The key caps in the shortcuts sheet keep the glyph.
    detail: "Right-drag or Shift-drag to orbit · scroll to zoom · double-click to reset",
  });
}

function applyDrag(drag: ActiveDrag, x: number, y: number): void {
  const dx = x - drag.lastX;
  const dy = y - drag.lastY;
  drag.lastX = x;
  drag.lastY = y;
  if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > DRAG_THRESHOLD_PX) drag.moved = true;
  if (drag.kind === "pan") panByPixels(dx, dy);
  else orbitBy(-dx * ORBIT_DEG_PER_PX, dy * PITCH_DEG_PER_PX);
}

function startTwoFinger(): void {
  const entries = [...touches.entries()].slice(0, 2);
  if (entries.length < 2) return;
  const [first, second] = entries as [[number, { x: number; y: number }], [number, { x: number; y: number }]];
  endDrag();
  twoFinger = {
    ids: [first[0], second[0]],
    midX: (first[1].x + second[1].x) / 2,
    midY: (first[1].y + second[1].y) / 2,
    distance: Math.hypot(second[1].x - first[1].x, second[1].y - first[1].y),
    angle: Math.atan2(second[1].y - first[1].y, second[1].x - first[1].x),
  };
}

function applyTwoFinger(): void {
  const gesture = twoFinger;
  if (!gesture) return;
  const first = touches.get(gesture.ids[0]);
  const second = touches.get(gesture.ids[1]);
  if (!first || !second) return;
  const midX = (first.x + second.x) / 2;
  const midY = (first.y + second.y) / 2;
  const distance = Math.hypot(second.x - first.x, second.y - first.y);
  const angle = Math.atan2(second.y - first.y, second.x - first.x);
  panByPixels(midX - gesture.midX, midY - gesture.midY);
  if (gesture.distance > 8 && distance > 8) zoomBy(distance / gesture.distance);
  let twist = ((angle - gesture.angle) * 180) / Math.PI;
  if (twist > 180) twist -= 360;
  if (twist < -180) twist += 360;
  orbitBy(-twist, 0);
  gesture.midX = midX;
  gesture.midY = midY;
  gesture.distance = distance;
  gesture.angle = angle;
}

export interface CameraGestureOptions {
  element: HTMLElement;
  /** The same pick the pointer state machine uses, so both agree on what "background" means. */
  itemAt: (clientX: number, clientY: number) => Furniture | undefined;
}

/** Installs the camera gestures on the canvas. Mount once, from Interaction.tsx. */
export function useCameraGestures({ element: canvas, itemAt }: CameraGestureOptions): void {
  useEffect(() => {
    element = canvas;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * WHEEL_ZOOM));
    };
    const onContextMenu = (event: MouseEvent): void => event.preventDefault();

    const onDown = (event: PointerEvent): void => {
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size >= 2) {
          startTwoFinger();
          return;
        }
        // A single finger is a left-drag: Interaction hands it over once it knows what is under it.
        return;
      }
      // Right-drag, and the ⌃-click macOS spells it; the middle button has always panned.
      if (event.button === 2 || (event.button === 0 && event.ctrlKey)) beginCameraDrag(event, "orbit");
      else if (event.button === 1) beginCameraDrag(event, "pan");
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === "touch" && touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (twoFinger) {
        applyTwoFinger();
        return;
      }
      if (active?.pointerId === event.pointerId) applyDrag(active, event.clientX, event.clientY);
    };

    const doubleTapped = (event: PointerEvent): boolean => {
      const now = performance.now();
      const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_PX;
      const quick = now - lastTap.t < DOUBLE_TAP_MS;
      lastTap = { t: now, x: event.clientX, y: event.clientY };
      return near && quick;
    };

    const onUp = (event: PointerEvent): void => {
      const wasDragging = active?.pointerId === event.pointerId;
      const moved = wasDragging ? active?.moved === true : false;
      if (event.pointerType === "touch") {
        touches.delete(event.pointerId);
        if (twoFinger && touches.size < 2) twoFinger = undefined;
        // Chrome does not always synthesise dblclick under `touch-action: none`, so taps count here.
        if (!moved && !twoFinger && doubleTapped(event) && !itemAt(event.clientX, event.clientY)) {
          resetCamera({ tween: true });
        }
      }
      if (wasDragging) endDrag();
    };

    const onCancel = (event: PointerEvent): void => {
      touches.delete(event.pointerId);
      if (twoFinger && touches.size < 2) twoFinger = undefined;
      if (active?.pointerId === event.pointerId) endDrag();
    };

    const onDoubleClick = (event: MouseEvent): void => {
      if (itemAt(event.clientX, event.clientY)) return;
      resetCamera({ tween: true });
    };

    /**
     * Space is the hand tool, the way every drawing app spells it. Only while the studio itself has
     * the focus: on a button or a field, Space belongs to that control (it is how a keyboard
     * activates a button), so the tool stays out of the way and the key is never swallowed.
     */
    const studioHasFocus = (): boolean => {
      const focused = document.activeElement;
      return focused === null || focused === document.body || focused === canvas;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.repeat) return;
      if (isTyping(event.target) || !studioHasFocus()) return;
      // Space would otherwise scroll the page under the full-bleed canvas.
      event.preventDefault();
      if (handTool) return;
      handTool = true;
      applyCursor();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || !handTool) return;
      handTool = false;
      // A drag in hand keeps its `grabbing` cursor and finishes as the pan it started as.
      applyCursor();
    };

    // A held key is lost when the window goes away; the tool must not still be on when it comes back.
    const onBlur = (): void => {
      if (!handTool) return;
      handTool = false;
      applyCursor();
    };

    applyCursor();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("dblclick", onDoubleClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("dblclick", onDoubleClick);
      active = undefined;
      twoFinger = undefined;
      handTool = false;
      touches.clear();
      if (element === canvas) element = undefined;
    };
  }, [canvas, itemAt]);
}
