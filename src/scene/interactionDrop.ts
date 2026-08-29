"use client";
/**
 * Catalog drag-and-drop onto the canvas. `dataTransfer` is unreadable during `dragover` (the drag
 * data store is in protected mode), so the payload is captured from the bubbling `dragstart` and
 * used to drive a live store ghost with the same snapping and validity as a pointer drag; `drop`
 * re-reads it authoritatively. Ghost updates are `quiet`, so a drag-over never touches undo.
 */
import { useEffect } from "react";
import { resolveColorway } from "../engine/catalog";
import type { Catalog } from "../engine/catalog";
import type { CatalogItem, Furniture, Room, Rotation, Vec2 } from "../engine/types";
import { hearthStore } from "../state/store";
import { DROP_ID, judgePose, samePose, snapPose } from "./interactionDrag";
import type { Pose, PoseRequest } from "./interactionDrag";
import { roomAtWorldCm, worldToRoomCm } from "./interactionMath";

/** The MIME type the catalog panel puts on its drag payload (`{ catalogId, colorway }`). */
export const DROP_MIME = "application/x-hearth-catalog";

interface DropPayload {
  catalogId: string;
  colorway?: string;
}

/** Normalises a payload colorway against what the product actually offers. */
function colorwayFor(product: CatalogItem, requested: string | undefined): string {
  const resolved = requested ? resolveColorway(product, requested) : undefined;
  return resolved?.id ?? product.colorways[0]?.id ?? "oak";
}

function parsePayload(raw: string | undefined | null): DropPayload | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as DropPayload;
    return typeof parsed?.catalogId === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** What the canvas should draw while a catalog card hovers over it. */
export interface DropPreview {
  pose: Pose;
  product: CatalogItem;
}

export interface CatalogDropOptions {
  catalog: Catalog;
  floorAt: (clientX: number, clientY: number, planeY?: number) => Vec2 | undefined;
  poseRequest: (
    itemId: string,
    product: CatalogItem,
    room: Room,
    pos: Vec2,
    rotation: Rotation,
    colorway: string,
    extra?: Partial<PoseRequest>,
  ) => PoseRequest;
  /** Publishes the live drop pose so the measured-drawing overlay follows the ghost. */
  onPreview: (preview: DropPreview | undefined) => void;
}

/** Wires window-level drag-and-drop for the studio canvas. */
export function useCatalogDrop({ catalog, floorAt, poseRequest, onPreview }: CatalogDropOptions): void {
  useEffect(() => {
    const held: { payload?: DropPayload; pose?: Pose } = {};

    const dropGhost = () => {
      held.pose = undefined;
      onPreview(undefined);
      const state = hearthStore.getState();
      if (state.scene.furniture.some((item) => item.status === "ghost")) state.clearGhost("human", { quiet: true });
    };

    const resolveAt = (clientX: number, clientY: number): Pose | undefined => {
      const product = held.payload ? catalog.byId(held.payload.catalogId) : undefined;
      if (!held.payload || !product) return undefined;
      const state = hearthStore.getState();
      const point = floorAt(clientX, clientY);
      const room = point ? roomAtWorldCm(state.scene.rooms, point) : undefined;
      if (!point || !room) return undefined;
      const colorway = colorwayFor(product, held.payload.colorway);
      const request = poseRequest(DROP_ID, product, room, worldToRoomCm(room, point), held.pose?.rotation ?? 0, colorway, {
        memory: held.pose?.memory,
      });
      const snap = snapPose(request);
      if (samePose(held.pose, snap)) return held.pose;
      const pose = judgePose(request, snap);
      held.pose = pose;
      onPreview({ pose, product });
      hearthStore.getState().setGhost(
        "human",
        {
          id: "ghost-1",
          catalogId: product.id,
          roomId: room.id,
          pos: pose.pos,
          rotation: pose.rotation,
          colorway: colorway as Furniture["colorway"],
          status: "ghost",
        },
        { quiet: true },
      );
      return pose;
    };

    const onDragStart = (event: DragEvent) => {
      held.payload = parsePayload(event.dataTransfer?.getData(DROP_MIME));
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DROP_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      // A malformed payload is the catalog's problem, never an exception on the canvas.
      try {
        resolveAt(event.clientX, event.clientY);
      } catch {
        held.payload = undefined;
        dropGhost();
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DROP_MIME)) return;
      event.preventDefault();
      held.payload = parsePayload(event.dataTransfer.getData(DROP_MIME)) ?? held.payload;
      let pose: Pose | undefined;
      try {
        pose = resolveAt(event.clientX, event.clientY);
      } catch {
        pose = undefined;
      }
      const product = held.payload ? catalog.byId(held.payload.catalogId) : undefined;
      const colorway = held.payload?.colorway;
      dropGhost();
      const state = hearthStore.getState();
      if (!pose || !product) {
        state.toast({ tone: "warn", message: "Drop it inside a room to place it." });
        return;
      }
      if (!pose.valid) {
        state.toast({ tone: "warn", message: `No room there — ${pose.reason ?? "the rules refuse it"}.` });
        return;
      }
      try {
        const placed = state.placeItem("human", {
          catalogId: product.id,
          roomId: pose.roomId,
          pos: pose.pos,
          rotation: pose.rotation,
          colorway: colorwayFor(product, colorway),
        });
        state.setSelection("human", { itemId: placed.id, roomId: placed.roomId });
      } catch {
        state.toast({ tone: "warn", message: `${product.name} could not be placed there.` });
      }
    };

    const onDragEnd = () => {
      held.payload = undefined;
      dropGhost();
    };

    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      dropGhost();
    };

    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("dragleave", onDragLeave);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("dragleave", onDragLeave);
      dropGhost();
    };
  }, [catalog, floorAt, onPreview, poseRequest]);
}
