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
    budgetUsd: 3000,
    selection: {},
    template,
  };
}

/** Assembles a fresh deterministic scene from template records. */
export function makeScene(template: TemplateId, activeRoomId: string, rooms: Room[], openings: Opening[], furniture: Furniture[] = []): Scene {
  return { rooms, openings, furniture, variants: [], meta: sceneMeta(template, activeRoomId) };
}

/** Seven-piece living layout shared by the larger bedroom templates. */
export function familyLivingFurniture(): Furniture[] {
  return [
    item({ id: "sofa-1", catalogId: "sofa-endre", roomId: "living", pos: { x: 255, y: 47.5 }, rotation: 0, colorway: "sage" }),
    item({ id: "tv-unit-1", catalogId: "tv-unit-linje", roomId: "living", pos: { x: 260, y: 420 }, rotation: 180, colorway: "oak" }),
    item({ id: "rug-1", catalogId: "rug-loop", roomId: "living", pos: { x: 260, y: 240 }, rotation: 90, colorway: "terracotta" }),
    item({ id: "armchair-1", catalogId: "armchair-nook", roomId: "living", pos: { x: 41, y: 245 }, rotation: 270, colorway: "terracotta" }),
    item({ id: "floor-lamp-1", catalogId: "lamp-glow", roomId: "living", pos: { x: 400, y: 195 }, rotation: 0, colorway: "ochre" }),
    item({ id: "plant-1", catalogId: "plant-fern", roomId: "living", pos: { x: 40, y: 120 }, rotation: 0, colorway: "sage" }),
    item({ id: "shelf-1", catalogId: "shelf-kant", roomId: "living", pos: { x: 502.5, y: 125 }, rotation: 90, colorway: "oak" }),
  ];
}

/** Four- or six-seat dining layout for a 480 cm-wide kitchen. */
export function familyDiningFurniture(chairCount: 4 | 6): Furniture[] {
  const chairXs = chairCount === 6 ? [158, 240, 322] : [198, 282];
  const chairs = chairXs.flatMap((x, index) => [
    item({ id: `chair-${index + 1}`, catalogId: index % 2 === 0 ? "chair-finn" : "chair-ida", roomId: "kitchen", pos: { x, y: 165 }, rotation: 0, colorway: index % 2 === 0 ? "sage" : "dusty-blue" }),
    item({ id: `chair-${index + chairXs.length + 1}`, catalogId: index % 2 === 0 ? "chair-ida" : "chair-finn", roomId: "kitchen", pos: { x, y: 315 }, rotation: 180, colorway: index % 2 === 0 ? "dusty-blue" : "sage" }),
  ]);
  return [
    item({ id: "table-1", catalogId: "table-ake", roomId: "kitchen", pos: { x: 240, y: 240 }, rotation: 0, colorway: "oak" }),
    ...chairs,
    item({ id: "plant-2", catalogId: "plant-pilea", roomId: "kitchen", pos: { x: 440, y: 390 }, rotation: 0, colorway: "sage" }),
  ];
}

/** Main-bedroom layout with supported lamps on two bedside tables. */
export function familyMainBedroomFurniture(): Furniture[] {
  return [
    item({ id: "bed-1", catalogId: "bed-birk", roomId: "bed-1", pos: { x: 100, y: 180 }, rotation: 270, colorway: "oak" }),
    item({ id: "side-table-1", catalogId: "table-bord", roomId: "bed-1", pos: { x: 45, y: 65 }, rotation: 270, colorway: "oak" }),
    item({ id: "side-table-2", catalogId: "table-bord", roomId: "bed-1", pos: { x: 45, y: 295 }, rotation: 270, colorway: "oak" }),
    item({ id: "table-lamp-1", catalogId: "table-lamp-alva", roomId: "bed-1", pos: { x: 45, y: 65 }, rotation: 0, colorway: "ochre" }),
    item({ id: "table-lamp-2", catalogId: "table-lamp-alva", roomId: "bed-1", pos: { x: 45, y: 295 }, rotation: 0, colorway: "ochre" }),
    item({ id: "wardrobe-1", catalogId: "wardrobe-hald", roomId: "bed-1", pos: { x: 320, y: 27 }, rotation: 0, colorway: "oak" }),
    item({ id: "plant-3", catalogId: "plant-pilea", roomId: "bed-1", pos: { x: 220, y: 20 }, rotation: 0, colorway: "sage" }),
  ];
}

/** Bed, wardrobe, side table and lamp for a 460×320 cm secondary bedroom. */
export function familySecondaryBedroomFurniture(
  index: 2 | 4 | 5,
  bed: "bed-ask" | "bed-lyng" | "bed-viggo",
  colorway: ColorwayId,
): Furniture[] {
  return [
    item({ id: `bed-${index}`, catalogId: bed, roomId: `bed-${index}`, pos: { x: 230, y: 220 }, rotation: 180, colorway }),
    item({ id: `wardrobe-${index}`, catalogId: "wardrobe-skive", roomId: `bed-${index}`, pos: { x: 400, y: 30 }, rotation: 0, colorway: "plaster" }),
    item({ id: `side-table-${index + 1}`, catalogId: "table-bord", roomId: `bed-${index}`, pos: { x: 70, y: 297.5 }, rotation: 180, colorway: "oak" }),
    item({ id: `floor-lamp-${index}`, catalogId: "floor-lamp-lyst", roomId: `bed-${index}`, pos: { x: 50, y: 50 }, rotation: 0, colorway: "plaster" }),
  ];
}

/** Combined bedroom and study layout for a 460×320 cm room. */
export function familyStudyBedroomFurniture(): Furniture[] {
  return [
    item({ id: "bed-3", catalogId: "bed-ask", roomId: "bed-3", pos: { x: 100, y: 100 }, rotation: 0, colorway: "dusty-blue" }),
    item({ id: "wardrobe-3", catalogId: "wardrobe-skive", roomId: "bed-3", pos: { x: 400, y: 290 }, rotation: 180, colorway: "sage" }),
    item({ id: "desk-1", catalogId: "desk-soren", roomId: "bed-3", pos: { x: 430, y: 80 }, rotation: 90, colorway: "oak" }),
    item({ id: "chair-7", catalogId: "chair-mysa", roomId: "bed-3", pos: { x: 300, y: 230 }, rotation: 270, colorway: "sage" }),
    item({ id: "shelf-2", catalogId: "shelf-lund", roomId: "bed-3", pos: { x: 220, y: 305 }, rotation: 180, colorway: "plaster" }),
  ];
}
