"use client";
/**
 * Direct manipulation on the canvas: hover, select, drag with magnetic snapping and live dimension
 * lines, quarter-turn rotation, keyboard nudging, a floating mini-toolbar and catalog drag-and-drop.
 *
 * Every gesture is resolved against the same engine the WebMCP tools use (`snapPose` → `measurePose`
 * → `validatePose` → `evaluateRoom`), so a person dragging a sofa and an agent calling
 * `move_furniture` get the same verdict — and the store records one undoable action per gesture,
 * never one per frame.
 *
 * Screen-to-scene picking lives in interactionPicking.ts, the pose pipeline in interactionDrag.ts,
 * keyboard gestures in interactionKeys.ts, catalog drops in interactionDrop.ts and every drawn
 * diagram in InteractionOverlay.tsx. This file owns the pointer state machine that drives them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { rotateBy } from "../engine/anchors";
import { createCatalog } from "../engine/catalog";
import type { CatalogItem, Room, Rotation, Vec2 } from "../engine/types";
import { hearthStore, useHearthStore } from "../state/store";
import { beginCameraDrag, cameraGestureActive, cameraGestureMoved, useCameraGestures } from "./cameraGestures";
import { setPointerHover } from "./hover";
import { useReducedMotion } from "./idle";
import { DebugHandle, deleteItem, duplicateItem } from "./interactionCommands";
import { measurePose, resolvePose, samePose, setDraggingItemId, setHoveredRoomId, snapPose, validatePose } from "./interactionDrag";
import type { Pose, PoseRequest } from "./interactionDrag";
import { useCatalogDrop } from "./interactionDrop";
import type { DropPreview } from "./interactionDrop";
import { useInteractionKeys } from "./interactionKeys";
import { roomAtWorldCm, roomToWorldCm, worldToRoomCm } from "./interactionMath";
import { usePicking } from "./interactionPicking";
import { DimensionOverlay, DragProxy, DropPreviewOverlay, GapOverlay, GuideOverlay, MiniToolbar } from "./InteractionOverlay";
import { M, stackElevationCm } from "./math";

/** Pointer travel that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;
/** How far the item in hand floats off the floor, in metres. */
const DRAG_LIFT = 0.05;
/** How long the refused-release spring-back keeps the proxy on screen. */
const REJECT_HOLD_MS = 320;
const HOVER_THROTTLE_MS = 50;
/** Minimum gap between rules-engine passes during a drag; the geometry still updates every frame. */
const JUDGE_INTERVAL_MS = 40;

interface Gesture {
  itemId: string;
  product: CatalogItem;
  colorway: string;
  pose: Pose;
  /** Where the gesture started, for the refused-release spring-back. */
  from: { roomId: string; pos: Vec2; rotation: Rotation };
  rejected: boolean;
}

interface Press {
  pointerId: number;
  itemId?: string;
  clientX: number;
  clientY: number;
  /** Item centre minus the pointer's floor point at press time, world centimetres. */
  grab: Vec2;
  /** The item's room-local centre at press time, for the dominant-drag-axis readout. */
  startLocal: Vec2;
  /** Height of the plane the pointer is tracked against, in metres (a lamp on a table is raised). */
  planeY: number;
  dragging: boolean;
  roomId: string;
}

/** Pointer, keyboard and drag-and-drop interaction for the whole studio. Mount inside the Canvas. */
export function Interaction() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const { floorAt, itemAt } = usePicking();
  const rooms = useHearthStore((state) => state.scene.rooms);
  const allFurniture = useHearthStore((state) => state.scene.furniture);
  const selectedId = useHearthStore((state) => state.scene.meta.selection.itemId);
  const catalogItems = useHearthStore((state) => state.catalog);
  const reduced = useReducedMotion();
  const catalog = useMemo(() => createCatalog(catalogItems), [catalogItems]);

  const [gesture, setGesture] = useState<Gesture | undefined>(undefined);
  const [drop, setDrop] = useState<DropPreview | undefined>(undefined);
  const dropRef = useRef<DropPreview | undefined>(undefined);
  const gestureRef = useRef<Gesture | undefined>(undefined);
  const getPose = useCallback(() => gestureRef.current?.pose ?? dropRef.current?.pose, []);
  const pressRef = useRef<Press | undefined>(undefined);
  const pointerRef = useRef({ x: 0, y: 0 });
  const altRef = useRef(false);
  const hoverAtRef = useRef(0);
  const judgedAtRef = useRef(0);
  /** True when the displayed verdict predates the displayed position; release re-checks it. */
  const staleRef = useRef(false);
  gestureRef.current = gesture;
  dropRef.current = drop;

  const pick = useCallback((clientX: number, clientY: number) => itemAt(clientX, clientY)?.id, [itemAt]);

  /** Builds a pose request for one item at a desired room-local centre. */
  const poseRequest = useCallback(
    (
      itemId: string,
      product: CatalogItem,
      room: Room,
      pos: Vec2,
      rotation: Rotation,
      colorway: string,
      extra: Partial<PoseRequest> = {},
    ): PoseRequest => ({
      scene: hearthStore.getState().scene,
      catalog,
      itemId,
      product,
      room,
      pos,
      rotation,
      colorway,
      allowRotate: !altRef.current,
      ...extra,
    }),
    [catalog],
  );

  // One rAF tick per frame resolves the magnets from the last pointer position and — only when the
  // snapped pose actually moves — runs the rules engine and re-renders. Snapping is ~0.1 ms and
  // `evaluateRoom` on the canonical living room is ~1.4 ms, well inside a frame.
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      const press = pressRef.current;
      const current = gestureRef.current;
      if (!press?.dragging || !current || current.rejected) return;
      const state = hearthStore.getState();
      const point = floorAt(pointerRef.current.x, pointerRef.current.y, press.planeY);
      if (!point) return;
      const room = roomAtWorldCm(state.scene.rooms, point, press.roomId) ?? state.scene.rooms.find((entry) => entry.id === press.roomId);
      if (!room) return;
      press.roomId = room.id;
      const desired = worldToRoomCm(room, { x: point.x + press.grab.x, y: point.y + press.grab.y });
      const travelled = { x: Math.abs(desired.x - press.startLocal.x), y: Math.abs(desired.y - press.startLocal.y) };
      const request = poseRequest(current.itemId, current.product, room, desired, current.pose.rotation, current.colorway, {
        memory: current.pose.memory,
        dragAxis: travelled.x >= travelled.y ? "x" : "y",
      });
      const snap = snapPose(request);
      if (samePose(current.pose, snap)) return;
      const measured = measurePose(request, snap);
      const now = performance.now();
      // The rules engine costs ~3 ms in the browser (its traffic solver dominates), so the geometry
      // updates every frame while the verdict refreshes at ~25 Hz — and again, always, on release.
      const due = now - judgedAtRef.current >= JUDGE_INTERVAL_MS || measured.roomId !== current.pose.roomId;
      const verdict = due ? validatePose(request, snap) : { valid: current.pose.valid, reason: current.pose.reason };
      if (due) judgedAtRef.current = now;
      staleRef.current = !due;
      const pose = { ...measured, ...verdict };
      setGesture({ ...current, pose });
      const live = hearthStore.getState();
      if (live.ui.dragging?.valid !== pose.valid || live.ui.dragging?.reason !== pose.reason) {
        live.setDragging({ itemId: current.itemId, valid: pose.valid, reason: pose.reason });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [floorAt, poseRequest]);

  /** Ends a drag: commits a valid pose once, or springs back with a shake and says why. */
  const release = useCallback(() => {
    const current = gestureRef.current;
    setDraggingItemId(undefined);
    hearthStore.getState().setDragging(undefined);
    if (!current) {
      setGesture(undefined);
      return;
    }
    const { from, itemId } = current;
    // The throttled verdict may be one position behind; the commit is never a guess.
    const room = hearthStore.getState().scene.rooms.find((entry) => entry.id === current.pose.roomId);
    const verdict = staleRef.current && room
      ? validatePose(poseRequest(itemId, current.product, room, current.pose.pos, current.pose.rotation, current.colorway, { exact: true }), current.pose)
      : { valid: current.pose.valid, reason: current.pose.reason };
    staleRef.current = false;
    const pose = { ...current.pose, ...verdict };
    if (!pose.valid) {
      setGesture({ ...current, rejected: true, pose: { ...pose, ...from, guides: [], dims: [], gap: undefined } });
      hearthStore.getState().toast({ tone: "warn", message: `Cannot go there — ${pose.reason ?? "the room rules refuse it"}.` });
      window.setTimeout(() => setGesture(undefined), REJECT_HOLD_MS);
      return;
    }
    const moved = pose.pos.x !== from.pos.x || pose.pos.y !== from.pos.y || pose.rotation !== from.rotation || pose.roomId !== from.roomId;
    if (moved) {
      hearthStore.getState().moveItem("human", itemId, {
        pos: pose.pos,
        rotation: pose.rotation,
        ...(pose.roomId === from.roomId ? {} : { roomId: pose.roomId }),
      });
    }
    setGesture(undefined);
  }, [poseRequest]);

  /** Drops a gesture on the floor without committing it (Escape, pointer cancel). */
  const abandon = useCallback(() => {
    pressRef.current = undefined;
    setDraggingItemId(undefined);
    hearthStore.getState().setDragging(undefined);
    setGesture(undefined);
    gl.domElement.style.cursor = "";
  }, [gl]);

  useEffect(() => {
    const element = gl.domElement;

    /** Promotes a press into a live drag: the furniture layer hides the item, this layer lifts it. */
    const startDrag = (press: Press) => {
      const state = hearthStore.getState();
      const found = state.scene.furniture.find((entry) => entry.id === press.itemId);
      const product = found ? catalog.byId(found.catalogId) : undefined;
      const room = found ? state.scene.rooms.find((entry) => entry.id === found.roomId) : undefined;
      if (!found || !product || !room) return;
      if (found.locked) {
        state.toast({ tone: "info", message: `${product.name} is locked. Unlock it to move it.` });
        press.itemId = undefined;
        return;
      }
      press.dragging = true;
      element.style.cursor = "grabbing";
      setDraggingItemId(found.id);
      setGesture({
        itemId: found.id,
        product,
        colorway: found.colorway,
        pose: resolvePose(poseRequest(found.id, product, room, found.pos, found.rotation, found.colorway, { exact: true })),
        from: { roomId: room.id, pos: { ...found.pos }, rotation: found.rotation },
        rejected: false,
      });
    };

    const onDown = (event: PointerEvent) => {
      altRef.current = event.altKey;
      if (event.button !== 0 || event.ctrlKey) return;
      const state = hearthStore.getState();
      const found = itemAt(event.clientX, event.clientY);
      const room = found ? state.scene.rooms.find((entry) => entry.id === found.roomId) : undefined;
      const product = found ? catalog.byId(found.catalogId) : undefined;
      let grab: Vec2 = { x: 0, y: 0 };
      let planeY = 0;
      if (found && room && product) {
        planeY = stackElevationCm(found, product, state.scene, (id) => catalog.byId(id)) * M;
        const point = floorAt(event.clientX, event.clientY, planeY);
        const centre = roomToWorldCm(room, found.pos);
        if (point) grab = { x: centre.x - point.x, y: centre.y - point.y };
      }
      // Nothing under the pointer: this press belongs to the camera — a pan, or an orbit with
      // Shift held (src/scene/cameraGestures.ts). The click that activates the room is still
      // recorded below; a camera gesture only takes the press over once it actually moves.
      if (!found && !event.altKey) beginCameraDrag(event, event.shiftKey ? "orbit" : "pan");
      pressRef.current = {
        pointerId: event.pointerId,
        itemId: found?.id,
        clientX: event.clientX,
        clientY: event.clientY,
        grab,
        startLocal: found ? { ...found.pos } : { x: 0, y: 0 },
        planeY,
        dragging: false,
        roomId: found?.roomId ?? state.scene.meta.activeRoomId,
      };
      pointerRef.current = { x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };

    const onMove = (event: PointerEvent) => {
      altRef.current = event.altKey;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const press = pressRef.current;
      if (press?.pointerId === event.pointerId && !press.dragging && press.itemId) {
        if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > DRAG_THRESHOLD_PX) startDrag(press);
      }
      if (pressRef.current?.dragging) return;
      // The camera owns the pointer: highlighting items under a scene that is sliding would flicker.
      if (cameraGestureActive()) return;
      const now = performance.now();
      if (now - hoverAtRef.current < HOVER_THROTTLE_MS) return;
      hoverAtRef.current = now;
      const found = itemAt(event.clientX, event.clientY);
      setPointerHover(found?.id);
      const point = floorAt(event.clientX, event.clientY);
      setHoveredRoomId(point ? roomAtWorldCm(hearthStore.getState().scene.rooms, point)?.id : undefined);
      element.style.cursor = found ? "grab" : "";
    };

    const onUp = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      pressRef.current = undefined;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      element.style.cursor = "";
      if (press.dragging) {
        release();
        return;
      }
      // A background drag panned or orbited the camera; it must not also select or activate.
      if (cameraGestureMoved(event.pointerId)) return;
      if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > DRAG_THRESHOLD_PX * 2) return;
      const state = hearthStore.getState();
      if (press.itemId) {
        if (state.scene.meta.selection.itemId !== press.itemId) {
          const found = state.scene.furniture.find((entry) => entry.id === press.itemId);
          if (found) state.setSelection("human", { itemId: found.id, roomId: found.roomId });
        }
        return;
      }
      const point = floorAt(event.clientX, event.clientY);
      const room = point ? roomAtWorldCm(state.scene.rooms, point) : undefined;
      if (!room) return;
      if (state.scene.meta.activeRoomId !== room.id) state.setActiveRoom("human", room.id);
      if (state.scene.meta.selection.itemId || state.scene.meta.selection.roomId !== room.id) {
        state.setSelection("human", { itemId: undefined, roomId: room.id });
      }
    };

    const onCancel = (event: PointerEvent) => {
      if (pressRef.current?.pointerId === event.pointerId) abandon();
    };

    const onLeave = () => {
      if (pressRef.current?.dragging || cameraGestureActive()) return;
      setPointerHover(undefined);
      setHoveredRoomId(undefined);
      element.style.cursor = "";
    };

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [abandon, catalog, floorAt, gl, itemAt, poseRequest, release]);

  // Every camera gesture — the handed-over background drag plus the wheel, the right/middle drag,
  // two-finger touch and the double-click that re-homes the shot — lives in one module.
  useCameraGestures({ element: gl.domElement, itemAt });

  const commit = useInteractionKeys({
    catalog,
    poseRequest,
    abandon,
    isDragging: () => pressRef.current?.dragging === true,
  });

  useCatalogDrop({ catalog, floorAt, poseRequest, onPreview: setDrop });

  const gestureRoom = gesture ? rooms.find((entry) => entry.id === gesture.pose.roomId) : undefined;
  const world = gesture && gestureRoom ? roomToWorldCm(gestureRoom, gesture.pose.pos) : undefined;
  const dropRoom = drop ? rooms.find((entry) => entry.id === drop.pose.roomId) : undefined;
  const selected = useHearthStore((state) => state.scene.furniture.find((entry) => entry.id === state.scene.meta.selection.itemId));
  const selectedProduct = selected ? catalog.byId(selected.catalogId) : undefined;
  const selectedRoom = selected ? rooms.find((entry) => entry.id === selected.roomId) : undefined;
  const toolbar = selected && selectedRoom ? roomToWorldCm(selectedRoom, selected.pos) : undefined;
  // The pill sits above the item as it is actually standing: a lamp on a table is 75 cm up, so
  // measuring from the floor would bury its toolbar inside the table (SCENE_SCHEMA.md — stacking).
  const toolbarElevation = selected && selectedProduct
    ? stackElevationCm(selected, selectedProduct, { furniture: allFurniture }, (id) => catalog.byId(id))
    : 0;

  useEffect(() => {
    if (!selectedId) setPointerHover(undefined);
  }, [selectedId]);

  return (
    <group name="interaction">
      {gesture && gestureRoom && world ? (
        <>
          <DragProxy
            product={gesture.product}
            colorway={gesture.colorway}
            valid={gesture.pose.valid}
            world={world}
            elevation={gesture.pose.stack ? gesture.pose.stack.heightCm * M : 0}
            lift={gesture.rejected ? 0 : DRAG_LIFT}
            rotation={gesture.pose.rotation}
            rejected={gesture.rejected}
            reduced={reduced}
            reason={gesture.pose.reason}
          />
          <DimensionOverlay room={gestureRoom} dims={gesture.pose.dims} />
          <GuideOverlay room={gestureRoom} guides={gesture.pose.guides} />
          {gesture.pose.gap ? <GapOverlay room={gestureRoom} gap={gesture.pose.gap} /> : null}
        </>
      ) : null}
      {drop && dropRoom && !gesture ? <DropPreviewOverlay preview={drop} room={dropRoom} /> : null}
      {selected && selectedProduct && selectedRoom && toolbar && !gesture ? (
        <MiniToolbar
          position={[toolbar.x * M, (toolbarElevation + selectedProduct.dims.h) * M + 0.3, toolbar.y * M]}
          locked={selected.locked === true}
          onRotate={() => commit(selected, selectedProduct, selectedRoom, selected.pos, rotateBy(selected, 90))}
          onToggleLock={() => hearthStore.getState().setLocked("human", selected.id, selected.locked !== true)}
          onDuplicate={() => duplicateItem(selected, selectedProduct, catalog)}
          onDelete={() => deleteItem(selected, selectedProduct)}
        />
      ) : null}
      <DebugHandle camera={camera} canvas={gl.domElement} getPose={getPose} pick={pick} />
    </group>
  );
}

export default Interaction;
