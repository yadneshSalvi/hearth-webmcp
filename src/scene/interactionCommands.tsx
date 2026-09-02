"use client";
/**
 * Small commands and helpers shared by the pointer, the keyboard and the mini-toolbar: duplicate,
 * keyboard selection traversal, and the `window.__hearth` handle the screenshot harness and
 * Playwright aim with (gated in src/scene/devBridge.ts).
 */
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import type { Camera } from "three";
import { resolveAnchor } from "../engine/anchors";
import type { Catalog } from "../engine/catalog";
import { polyBBox } from "../engine/geometry";
import type { CatalogItem, Furniture, Room, Vec2 } from "../engine/types";
import { hearthStore } from "../state/store";
import { toastSnapshot } from "../state/toasts";
import { devBridgesEnabled } from "./devBridge";
import { getDraggingItemId, getHoveredRoomId } from "./interactionDrag";
import type { Pose } from "./interactionDrag";
import { roomToWorldCm } from "./interactionMath";
import { M } from "./math";
import { productFor } from "../engine/catalog";

/** How long a one-shot pulse cue stays on an item. */
const PULSE_MS = 900;

/** True while focus is in a text field, so the studio's single-letter shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

/** Centre of a room's bounding box, room-local. */
export function roomCentre(room: Room): Vec2 {
  const box = polyBBox(room.poly);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Places a copy of an item just to its right, using the same anchor maths the agent's tools use. */
export function duplicateItem(item: Furniture, product: CatalogItem, catalog: Catalog): void {
  const state = hearthStore.getState();
  if (item.locked === true) {
    state.toast({ tone: "warn", message: `${product.name} is locked. Unlock it to duplicate it.` });
    return;
  }
  const placement = resolveAnchor(
    state.scene,
    item.roomId,
    product,
    { anchor: { next_to: item.id, side: "right", gap_cm: 10 }, rotation: item.rotation },
    catalog,
  );
  if (!placement.ok) {
    state.toast({ tone: "warn", message: `No room beside ${product.name} — ${placement.detail}.` });
    return;
  }
  const placed = state.placeItem("human", {
    catalogId: item.catalogId,
    roomId: item.roomId,
    pos: placement.pos,
    rotation: placement.rotation,
    colorway: item.colorway,
  });
  state.setSelection("human", { itemId: placed.id, roomId: placed.roomId });
  state.pulse([placed.id]);
  // The pulse is a one-shot cue; clear it here rather than making every consumer remember to.
  window.setTimeout(() => {
    const live = hearthStore.getState();
    if (live.ui.pulseIds.includes(placed.id)) live.pulse([]);
  }, PULSE_MS);
}

/**
 * Removes an item, clears the selection first and says so, so the activity log carries the undo.
 * A locked item refuses here as well as in the toolbar: the Delete key must not do what the greyed
 * button will not.
 */
export function deleteItem(item: Furniture, product: CatalogItem): void {
  const state = hearthStore.getState();
  if (item.locked === true) {
    state.toast({ tone: "warn", message: `${product.name} is locked. Unlock it to delete it.` });
    return;
  }
  state.setSelection("human", { itemId: undefined });
  state.removeItem("human", item.id);
  state.toast({ tone: "info", message: `Removed ${product.name}. Undo from the activity log.` });
}

/**
 * Keyboard selection traversal. With nothing selected an arrow key grabs the item nearest the room
 * centre; with something selected `Alt` + arrow walks to the nearest item in that direction.
 */
export function nearestItem(
  furniture: readonly Furniture[],
  room: Room | undefined,
  catalog: Catalog,
  direction: Vec2,
  from: Furniture | undefined,
): Furniture | undefined {
  if (!room) return undefined;
  const origin = from ? from.pos : roomCentre(room);
  const candidates = furniture.filter(
    (entry) => entry.roomId === room.id && entry.status === "placed" && entry.id !== from?.id && productFor(entry, catalog) !== undefined,
  );
  const distance = (entry: Furniture) => Math.hypot(entry.pos.x - origin.x, entry.pos.y - origin.y);
  if (!from) return [...candidates].sort((a, b) => distance(a) - distance(b))[0];
  return candidates
    .map((entry) => ({ entry, along: (entry.pos.x - origin.x) * direction.x + (entry.pos.y - origin.y) * direction.y }))
    .filter((entry) => entry.along > 1)
    .sort((a, b) => distance(a.entry) - distance(b.entry))[0]?.entry;
}

export interface DebugHandleProps {
  camera: Camera;
  canvas: HTMLCanvasElement;
  getPose: () => Pose | undefined;
  /** The same pick the pointer uses, so a test can confirm it is aiming at the right item. */
  pick: (clientX: number, clientY: number) => string | undefined;
}

/** Test-only handle so the screenshot harness and Playwright can read and aim at studio state. */
export function DebugHandle({ camera, canvas, getPose, pick }: DebugHandleProps) {
  const getPoseRef = useRef(getPose);
  const pickRef = useRef(pick);
  useEffect(() => {
    getPoseRef.current = getPose;
    pickRef.current = pick;
  }, [getPose, pick]);
  useEffect(() => {
    if (!devBridgesEnabled()) return;
    const target = window as unknown as { __hearth?: unknown };
    target.__hearth = {
      state: () => hearthStore.getState(),
      item: (id: string) => hearthStore.getState().scene.furniture.find((entry) => entry.id === id),
      selection: () => hearthStore.getState().scene.meta.selection,
      dragging: () => hearthStore.getState().ui.dragging,
      toasts: () => toastSnapshot(),
      pose: () => getPoseRef.current(),
      pick: (clientX: number, clientY: number) => pickRef.current(clientX, clientY),
      hoveredRoom: () => getHoveredRoomId(),
      draggingItem: () => getDraggingItemId(),
      /**
       * Room-local centimetres (optionally at a height, to aim at an item's body rather than the
       * floor under it) → client pixels, so a test can drive real pointer moves.
       */
      project: (roomId: string, pos: Vec2, heightCm = 0) => {
        const room = hearthStore.getState().scene.rooms.find((entry) => entry.id === roomId);
        if (!room) return undefined;
        const world = roomToWorldCm(room, pos);
        const projected = new Vector3(world.x * M, heightCm * M, world.y * M).project(camera);
        const rect = canvas.getBoundingClientRect();
        return {
          x: Math.round(rect.left + ((projected.x + 1) / 2) * rect.width),
          y: Math.round(rect.top + ((1 - projected.y) / 2) * rect.height),
        };
      },
    };
    return () => {
      delete target.__hearth;
    };
  }, [camera, canvas]);
  return null;
}
