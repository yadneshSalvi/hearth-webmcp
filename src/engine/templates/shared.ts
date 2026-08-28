import type { ColorwayId, Floor, WallColor } from "../../tokens";
import type { Furniture, Opening, Room, RoomType, Scene, SceneMeta, TemplateId, Vec2 } from "../types";

type ItemInput = Omit<Furniture, "status" | "colorway"> & { colorway?: ColorwayId };

/** Creates a clockwise rectangular room in centimetres. */
export function rectangleRoom(
  id: string,
  name: string,
  type: RoomType,
  width: number,
  depth: number,
  origin: Vec2,
  floor: Floor = "oak",
  wallColor: WallColor = "plaster",
): Room {
  return { id, name, type, poly: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], origin, floor, wallColor };
}

/** Copies an opening so template inputs never share identity. */
export function opening(input: Opening): Opening {
  return { ...input };
}

/** Creates a placed template furniture record with a stable default colorway. */
export function item(input: ItemInput): Furniture {
  return { ...input, colorway: input.colorway ?? "oak", status: "placed" };
}

/** Creates the default golden-hour scene metadata for a template. */
export function sceneMeta(template: TemplateId, activeRoomId: string): SceneMeta {
  return {
    mode: "design",
    view: "dollhouse",
    yaw: "sw",
    timeOfDay: "golden",
    paletteId: "warm-clay",
    accessibilityMode: false,
    activeRoomId,
    selection: {},
    template,
  };
}

/** Assembles a fresh deterministic scene from template records. */
export function makeScene(template: TemplateId, activeRoomId: string, rooms: Room[], openings: Opening[], furniture: Furniture[] = []): Scene {
  return { rooms, openings, furniture, variants: [], meta: sceneMeta(template, activeRoomId) };
}
