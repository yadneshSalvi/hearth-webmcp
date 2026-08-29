"use client";
/**
 * The framed volume shared by the camera rig and the wall auto-fade, so both agree on what the
 * viewer is looking at: the focus override if one is set, else the active room, else the home.
 */
import { useMemo } from "react";
import { polyBBox } from "../engine/geometry";
import type { Vec2 } from "../engine/types";
import { homeCentreCm, itemBox, roomBox, wholeHomeBox } from "./math";
import type { Box3Like } from "./math";
import { useFocusTarget } from "./focus";
import type { FocusKind } from "./focus";
import { useMeta, useProductLookup, useRooms, useFurniture } from "./useSceneStore";

export interface Framed {
  box: Box3Like;
  /** Framed centre in world centimetres, used by the wall cut-away test. */
  centreCm: Vec2;
  /** The room being framed, so its walls keep full contrast while neighbours recede. */
  roomId?: string;
  /** What is being framed. The home shot cuts walls by facing only (see `wallOpacity`). */
  kind: FocusKind;
}

/** The volume the camera frames and the wall fade measures against. */
export function useFramedBox(): Framed {
  const rooms = useRooms();
  const furniture = useFurniture();
  const meta = useMeta();
  const override = useFocusTarget();
  const byId = useProductLookup();
  return useMemo(() => {
    // The whole home: every room, walls included, centred on the home's own footprint. No `roomId`,
    // because no single room is the subject — the cut-away treats the home as one volume.
    if (override?.home) {
      return { box: wholeHomeBox(rooms), centreCm: homeCentreCm(rooms), kind: "home" as const };
    }
    const activeId = override?.roomId ?? meta.activeRoomId;
    const item = override?.itemId ? furniture.find((candidate) => candidate.id === override.itemId) : undefined;
    if (item) {
      const room = rooms.find((candidate) => candidate.id === item.roomId);
      const product = byId(item.catalogId);
      if (room && product) {
        return { box: itemBox(room, item, product), centreCm: itemCentre(room.origin, item.pos), roomId: room.id, kind: "item" as const };
      }
    }
    const room = rooms.find((candidate) => candidate.id === activeId) ?? rooms[0];
    if (!room) return { box: wholeHomeBox(rooms), centreCm: homeCentreCm(rooms), kind: "home" as const };
    const bounds = polyBBox(room.poly);
    return {
      box: roomBox(room),
      centreCm: {
        x: room.origin.x + (bounds.minX + bounds.maxX) / 2,
        y: room.origin.y + (bounds.minY + bounds.maxY) / 2,
      },
      roomId: room.id,
      kind: "room" as const,
    };
  }, [rooms, furniture, meta.activeRoomId, override, byId]);
}

function itemCentre(origin: Vec2, pos: Vec2): Vec2 {
  return { x: origin.x + pos.x, y: origin.y + pos.y };
}
