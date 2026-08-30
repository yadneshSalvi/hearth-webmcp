"use client";
/**
 * The cut-away for furniture: the twin of the wall cut-away in src/scene/Rooms.tsx.
 *
 * The walls standing between the camera and the framed room fade away — that is the dollhouse
 * convention, and it is what lets you see into a room at all. It is also what exposes the
 * *neighbour's* wardrobe standing right behind that wall: at a low pitch or a face-on angle it
 * plants itself in the middle of the room the human is looking at, and before this it swallowed the
 * clicks and the pans meant for the floor under it. So: the same test, on the same edges, for the
 * body as well as for the wall.
 */
import { useOrbitQuantized } from "./cameraState";
import { DOLLHOUSE_PITCH, PLAN_PITCH, furnitureOpacity, yawAzimuth } from "./math";
import type { Framed } from "./framing";
import type { Furniture, Room, SceneMeta } from "../engine/types";

/** Sampled on the walls' own 4° grid: a wall and the body behind it have to leave together. */
export const FOREGROUND_STEP_DEG = 4;
/** The walls' own 300 ms fade (`FADE_TWEEN` in src/scene/Rooms.tsx). */
export const FOREGROUND_FADE_MS = 300;
/** Below this a body is switched off outright: no draw call, and no pick either. */
export const FOREGROUND_OFF = 0.02;

const DEG = Math.PI / 180;

/** What the rule needs to know about one piece: where it stands and how big its footprint is. */
export interface ForegroundPiece {
  item: Furniture;
  room: Room;
  /** Axis-aligned footprint of the rotated item, in metres. */
  footprintM: { w: number; d: number };
}

/**
 * How visible each piece is, 0–1, measured against the camera the human is actually looking through.
 *
 * Only a *neighbour's* furniture can be in the way, so the framed room's own items are never
 * touched; nor is a ghost (it is under someone's pointer) or the selection (it is what the human is
 * working on). Framing the whole home turns the test off entirely, exactly as it does for the walls:
 * every piece in the southern half of a 15 m home stands in front of the home's centre.
 */
export function useForegroundOpacity(framed: Framed, meta: SceneMeta): (piece: ForegroundPiece) => number {
  const orbit = useOrbitQuantized(FOREGROUND_STEP_DEG);
  const plan = meta.view === "plan";
  const azimuth = plan ? 0 : yawAzimuth(meta.yaw) + orbit.azimuthDeg * DEG;
  const pitch = plan ? PLAN_PITCH : DOLLHOUSE_PITCH + orbit.pitchDeg * DEG;
  const cutInFront = !plan && framed.kind !== "home";
  const focusRoomId = framed.roomId ?? meta.activeRoomId;

  return (piece) => {
    if (!cutInFront) return 1;
    if (piece.item.roomId === focusRoomId) return 1;
    if (piece.item.status === "ghost" || meta.selection.itemId === piece.item.id) return 1;
    return furnitureOpacity(
      { x: piece.room.origin.x + piece.item.pos.x, y: piece.room.origin.y + piece.item.pos.y },
      { x: piece.footprintM.w / 2, z: piece.footprintM.d / 2 },
      framed.centreCm,
      azimuth,
      pitch,
      { cutInFront },
    );
  };
}
