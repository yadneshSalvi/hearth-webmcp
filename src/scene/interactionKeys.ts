"use client";
/**
 * Keyboard direct manipulation. Arrows nudge the selection 1 cm (10 cm with Shift) through the same
 * rules check a drag gets; `Alt` + arrow walks the selection to the neighbouring item, so selecting,
 * rotating, nudging and deleting are all reachable without a mouse. `⌘Z`/`⌃Z` are deliberately
 * untouched — undo belongs to the chrome, and double-binding it would undo twice.
 */
import { useCallback, useEffect } from "react";
import { rotateBy } from "../engine/anchors";
import type { Catalog } from "../engine/catalog";
import type { CatalogItem, Furniture, Room, Rotation, Vec2 } from "../engine/types";
import { hearthStore } from "../state/store";
import { deleteItem, isTyping, nearestItem } from "./interactionCommands";
import { resolvePose } from "./interactionDrag";
import type { PoseRequest } from "./interactionDrag";

/** Invalid-nudge feedback lingers this long before the rose ring settles back. */
const PULSE_MS = 900;

const NUDGE: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Applies an exact pose, or refuses it — a rose pulse and the reason, or a note that it is locked. */
export type CommitPose = (item: Furniture, product: CatalogItem, room: Room, pos: Vec2, rotation: Rotation) => void;

export interface InteractionKeysOptions {
  catalog: Catalog;
  poseRequest: (
    itemId: string,
    product: CatalogItem,
    room: Room,
    pos: Vec2,
    rotation: Rotation,
    colorway: string,
    extra?: Partial<PoseRequest>,
  ) => PoseRequest;
  /** Drops an in-flight pointer drag without committing it (Escape). */
  abandon: () => void;
  /** True while the pointer is carrying an item. */
  isDragging: () => boolean;
}

/** Wires the studio's keyboard gestures and returns the shared exact-pose commit. */
export function useInteractionKeys({ catalog, poseRequest, abandon, isDragging }: InteractionKeysOptions): CommitPose {
  const commit = useCallback<CommitPose>(
    (item, product, room, pos, rotation) => {
      const state = hearthStore.getState();
      if (item.locked === true) {
        state.toast({ tone: "info", message: `${product.name} is locked. Unlock it to move it.` });
        return;
      }
      const pose = resolvePose(poseRequest(item.id, product, room, pos, rotation, item.colorway, { exact: true }));
      if (!pose.valid) {
        state.pulse([item.id]);
        state.setDragging({ itemId: item.id, valid: false, reason: pose.reason });
        state.toast({ tone: "warn", message: `Cannot go there — ${pose.reason ?? "the room rules refuse it"}.` });
        window.setTimeout(() => {
          const live = hearthStore.getState();
          if (live.ui.dragging?.itemId === item.id) live.setDragging(undefined);
          if (live.ui.pulseIds.includes(item.id)) live.pulse([]);
        }, PULSE_MS);
        return;
      }
      state.setDragging(undefined);
      state.moveItem("human", item.id, { pos: pose.pos, rotation: pose.rotation });
    },
    [poseRequest],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey) return;
      const state = hearthStore.getState();
      const selected = state.scene.furniture.find((entry) => entry.id === state.scene.meta.selection.itemId);
      const product = selected ? catalog.byId(selected.catalogId) : undefined;
      const room = selected ? state.scene.rooms.find((entry) => entry.id === selected.roomId) : undefined;
      const ready = selected !== undefined && product !== undefined && room !== undefined;

      if (event.key === "Escape") {
        if (isDragging()) abandon();
        else if (selected) state.setSelection("human", { itemId: undefined });
        return;
      }
      const direction = NUDGE[event.key];
      if (direction) {
        event.preventDefault();
        const scope = ready ? room : state.scene.rooms.find((entry) => entry.id === state.scene.meta.activeRoomId);
        if (!ready || event.altKey) {
          const next = nearestItem(state.scene.furniture, scope, catalog, direction, ready ? selected : undefined);
          if (next) state.setSelection("human", { itemId: next.id, roomId: next.roomId });
          return;
        }
        const step = event.shiftKey ? 10 : 1;
        commit(selected, product, room, { x: selected.pos.x + direction.x * step, y: selected.pos.y + direction.y * step }, selected.rotation);
        return;
      }
      if (!ready) return;
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        commit(selected, product, room, selected.pos, rotateBy(selected, event.shiftKey ? -90 : 90));
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteItem(selected, product);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abandon, catalog, commit, isDragging]);

  return commit;
}
