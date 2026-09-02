"use client";
/**
 * Direct-manipulation engine: the transient state of a gesture in progress, plus the snap →
 * validity pipeline that pointer drags, keyboard nudges and catalog drops all share.
 *
 * A gesture lives outside the store on purpose. `moveItem` and `setSelection` are undoable and
 * write the activity feed, so a drag that called them sixty times a second would bury both. The
 * store learns the outcome exactly once, when the pointer is released (see Interaction.tsx).
 */
import { useSyncExternalStore } from "react";
import type { Catalog } from "../engine/catalog";
import { evaluateRoom } from "../engine/conflicts";
import type { CatalogItem, Furniture, Room, Rotation, Scene, Side, Vec2 } from "../engine/types";
import {
  alignToNeighbours, clampCentreInsideRoom, conflictReason, dimensionLines, gridSnap,
  neighbourGap, poseFootprint, snapToWalls, stackSurfaceFor,
} from "./interactionMath";
import type { AlignGuide, Axis, DimensionLine, NeighbourGap, NeighbourRef, SnapMemory, StackTarget } from "./interactionMath";
import { productFor } from "../engine/catalog";

/** The id a not-yet-placed catalog drop carries while the engine validates it. */
export const DROP_ID = "__drop__";

let draggingItemId: string | undefined;
let hoveredRoomId: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks the item the pointer is carrying: the furniture layer hides it, Interaction draws it. */
export function setDraggingItemId(id: string | undefined): void {
  if (draggingItemId === id) return;
  draggingItemId = id;
  emit();
}

/** The item the pointer is carrying, read outside React. */
export function getDraggingItemId(): string | undefined {
  return draggingItemId;
}

/** The item the pointer is carrying; `undefined` when no drag is in flight. */
export function useDraggingItemId(): string | undefined {
  return useSyncExternalStore(subscribe, () => draggingItemId, () => undefined);
}

/** Marks the room under the pointer so its plan-view label can lift. */
export function setHoveredRoomId(id: string | undefined): void {
  if (hoveredRoomId === id) return;
  hoveredRoomId = id;
  emit();
}

/** The room under the pointer, read outside React. */
export function getHoveredRoomId(): string | undefined {
  return hoveredRoomId;
}

/** The room under the pointer, for the plan-view label lift. */
export function useHoveredRoomId(): string | undefined {
  return useSyncExternalStore(subscribe, () => hoveredRoomId, () => undefined);
}

export interface PoseRequest {
  scene: Scene;
  catalog: Catalog;
  /** The item being moved, or `DROP_ID` for a catalog drop that is not in the scene yet. */
  itemId: string;
  product: CatalogItem;
  room: Room;
  /** Desired footprint centre, room-local centimetres. */
  pos: Vec2;
  rotation: Rotation;
  colorway: string;
  /** false while Alt is held: keeps the rotation the person chose. */
  allowRotate: boolean;
  /** Which snaps were engaged last frame, so they release with hysteresis. */
  memory?: SnapMemory;
  /** Axis the hand is travelling along, used for the neighbour-gap readout. */
  dragAxis?: Axis;
  /** true for keyboard nudges: exact centimetres, no magnets. */
  exact?: boolean;
}

/** Everything the overlay needs to draw a pose. Cheap: pure geometry, no rules. */
export interface Measurement {
  roomId: string;
  pos: Vec2;
  rotation: Rotation;
  guides: AlignGuide[];
  dims: DimensionLine[];
  gap?: NeighbourGap;
  memory: SnapMemory;
  stack?: StackTarget;
  /** The wall the item turned its back to, when a flush snap rotated it. */
  wallSide?: Side;
}

/** The rules engine's verdict on a pose. */
export interface Verdict {
  valid: boolean;
  /** ≤ 44 chars, why this position is refused. */
  reason?: string;
}

export type Pose = Measurement & Verdict;

/** Every other placed item in the room, paired with its product. */
export function roomNeighbours(scene: Scene, catalog: Catalog, roomId: string, exclude: string): NeighbourRef[] {
  const refs: NeighbourRef[] = [];
  for (const item of scene.furniture) {
    if (item.roomId !== roomId || item.id === exclude || item.status === "ghost") continue;
    const product = productFor(item, catalog);
    if (product) refs.push({ item, product });
  }
  return refs;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The cheap half of the pipeline: where the magnets put the item, with no rules run. */
export interface SnapResult {
  roomId: string;
  pos: Vec2;
  rotation: Rotation;
  guides: AlignGuide[];
  memory: SnapMemory;
  wallSide?: Side;
}

/**
 * Magnetic snapping in the STYLE.md order: wall flush (rotating `againstWall` products to face
 * away from the wall) → neighbour edge/centre alignment → the 5 cm grid. Pure geometry, ~0.1 ms,
 * so a drag can run it every frame and only pay for the rules engine when the result moves.
 */
export function snapPose(request: PoseRequest): SnapResult {
  const { scene, catalog, room, product, itemId } = request;
  const neighbours = roomNeighbours(scene, catalog, room.id, itemId);
  let rotation = request.rotation;
  let pos = clampCentreInsideRoom(room, product, request.pos, rotation);
  const guides: AlignGuide[] = [];
  const memory: SnapMemory = {};
  let wallSide: Side | undefined;

  if (!request.exact) {
    const wall = snapToWalls({
      room,
      product,
      pos,
      rotation,
      allowRotate: request.allowRotate,
      memory: request.memory,
    });
    pos = wall.pos;
    rotation = wall.rotation;
    wallSide = wall.rotatedTo;
    memory.wallX = wall.walls.x;
    memory.wallY = wall.walls.y;

    const aligned = alignToNeighbours({
      product,
      pos,
      rotation,
      neighbours,
      skip: { x: wall.walls.x !== undefined, y: wall.walls.y !== undefined },
      memory: request.memory,
    });
    pos = aligned.pos;
    guides.push(...aligned.guides);
    for (const guide of aligned.guides) memory[guide.axis === "x" ? "guideX" : "guideY"] = guide.key;

    pos = gridSnap(pos, {
      x: memory.wallX === undefined && memory.guideX === undefined,
      y: memory.wallY === undefined && memory.guideY === undefined,
    });
    pos = clampCentreInsideRoom(room, product, pos, rotation);
  }
  return { roomId: room.id, pos: { x: round(pos.x), y: round(pos.y) }, rotation, guides, memory, wallSide };
}

/**
 * The measured drawing for a snapped pose: dimension lines to the walls it faces, the gap to the
 * nearest neighbour and any surface it is resting on. ~0.1 ms, so this runs every frame of a drag.
 */
export function measurePose(request: PoseRequest, snap: SnapResult): Measurement {
  const { scene, catalog, room, product, itemId } = request;
  const { pos, rotation } = snap;
  const neighbours = roomNeighbours(scene, catalog, room.id, itemId);
  const foot = poseFootprint(product, pos, rotation);
  return {
    roomId: room.id,
    pos,
    rotation,
    guides: snap.guides,
    dims: dimensionLines(room, foot),
    gap: neighbourGap(product, pos, rotation, neighbours, request.dragAxis ?? "x"),
    memory: snap.memory,
    stack: stackSurfaceFor(product, foot, neighbours),
    wallSide: snap.wallSide,
  };
}

/**
 * The verdict: `evaluateRoom` on a trial scene holding the item at the snapped pose, so a person's
 * drag is judged by exactly the rules the agent's tools obey. This is the expensive half — the room
 * traffic solver runs inside it — so a drag throttles it (see JUDGE_INTERVAL_MS in Interaction.tsx)
 * rather than paying for it on every frame.
 */
export function validatePose(request: PoseRequest, snap: { pos: Vec2; rotation: Rotation }): Verdict {
  const { scene, catalog, room, product, itemId } = request;
  const trial: Furniture = {
    id: itemId,
    catalogId: product.id,
    roomId: room.id,
    pos: snap.pos,
    rotation: snap.rotation,
    colorway: request.colorway as Furniture["colorway"],
    status: "placed",
  };
  const trialScene: Scene = {
    ...scene,
    furniture: [...scene.furniture.filter((item) => item.id !== itemId && item.status !== "ghost"), trial],
  };
  const blocking = evaluateRoom(trialScene, room.id, catalog).find(
    (conflict) => conflict.severity === "error" && conflict.items.includes(itemId),
  );
  // Openings keep their ids (door-1 reads fine); furniture gets its catalog name.
  const nameOf = (id: string): string => {
    const other = scene.furniture.find((entry) => entry.id === id);
    return (other && productFor(other, catalog)?.name) ?? id;
  };
  return { valid: blocking === undefined, reason: blocking ? conflictReason(blocking, itemId, nameOf) : undefined };
}

/** Measure and validate one snapped pose. */
export function judgePose(request: PoseRequest, snap: SnapResult): Pose {
  return { ...measurePose(request, snap), ...validatePose(request, snap) };
}

/** Snap and judge in one call, for gestures that resolve once (nudge, rotate, drop, duplicate). */
export function resolvePose(request: PoseRequest): Pose {
  return judgePose(request, snapPose(request));
}

/** True when a snap lands on the same commit as the pose already on screen. */
export function samePose(pose: Measurement | undefined, snap: SnapResult): boolean {
  return pose !== undefined
    && pose.roomId === snap.roomId
    && pose.pos.x === snap.pos.x
    && pose.pos.y === snap.pos.y
    && pose.rotation === snap.rotation;
}
