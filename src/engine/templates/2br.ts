import type { Furniture, Scene } from "../types";
import { item, makeScene, opening, rectangleRoom } from "./shared";

function goldenFurniture(): Furniture[] {
  return [
    item({ id: "sofa-1", catalogId: "sofa-endre", roomId: "living", pos: { x: 255, y: 47.5 }, rotation: 0, colorway: "sage" }),
    item({ id: "tv-unit-1", catalogId: "tv-unit-linje", roomId: "living", pos: { x: 260, y: 420 }, rotation: 180, colorway: "oak" }),
    item({ id: "rug-1", catalogId: "rug-loop", roomId: "living", pos: { x: 260, y: 240 }, rotation: 90, colorway: "terracotta" }),
    item({ id: "armchair-1", catalogId: "armchair-nook", roomId: "living", pos: { x: 41, y: 245 }, rotation: 270, colorway: "terracotta" }),
    item({ id: "floor-lamp-1", catalogId: "lamp-glow", roomId: "living", pos: { x: 400, y: 195 }, rotation: 0, colorway: "ochre" }),
    item({ id: "plant-1", catalogId: "plant-fern", roomId: "living", pos: { x: 40, y: 120 }, rotation: 0, colorway: "sage" }),
    item({ id: "shelf-1", catalogId: "shelf-kant", roomId: "living", pos: { x: 502.5, y: 125 }, rotation: 90, colorway: "oak" }),

    item({ id: "table-1", catalogId: "table-ake", roomId: "kitchen", pos: { x: 202, y: 240 }, rotation: 0, colorway: "oak" }),
    item({ id: "chair-1", catalogId: "chair-finn", roomId: "kitchen", pos: { x: 202, y: 165 }, rotation: 0, colorway: "sage" }),
    item({ id: "chair-2", catalogId: "chair-finn", roomId: "kitchen", pos: { x: 202, y: 315 }, rotation: 180, colorway: "sage" }),
    item({ id: "chair-3", catalogId: "chair-ida", roomId: "kitchen", pos: { x: 116, y: 240 }, rotation: 90, colorway: "dusty-blue" }),
    item({ id: "chair-4", catalogId: "chair-ida", roomId: "kitchen", pos: { x: 288, y: 240 }, rotation: 270, colorway: "dusty-blue" }),
    item({ id: "plant-2", catalogId: "plant-pilea", roomId: "kitchen", pos: { x: 50, y: 360 }, rotation: 0, colorway: "sage" }),

    item({ id: "bed-1", catalogId: "bed-birk", roomId: "bed-1", pos: { x: 100, y: 180 }, rotation: 270, colorway: "oak" }),
    item({ id: "side-table-1", catalogId: "table-bord", roomId: "bed-1", pos: { x: 45, y: 65 }, rotation: 270, colorway: "oak" }),
    item({ id: "side-table-2", catalogId: "table-bord", roomId: "bed-1", pos: { x: 45, y: 295 }, rotation: 270, colorway: "oak" }),
    item({ id: "table-lamp-1", catalogId: "table-lamp-alva", roomId: "bed-1", pos: { x: 45, y: 65 }, rotation: 0, colorway: "ochre" }),
    item({ id: "table-lamp-2", catalogId: "table-lamp-alva", roomId: "bed-1", pos: { x: 45, y: 295 }, rotation: 0, colorway: "ochre" }),
    item({ id: "wardrobe-1", catalogId: "wardrobe-hald", roomId: "bed-1", pos: { x: 320, y: 30 }, rotation: 0, colorway: "oak" }),
    item({ id: "plant-3", catalogId: "plant-pilea", roomId: "bed-1", pos: { x: 220, y: 20 }, rotation: 0, colorway: "sage" }),

    item({ id: "bed-2", catalogId: "bed-ask", roomId: "bed-2", pos: { x: 100, y: 70 }, rotation: 270, colorway: "dusty-blue" }),
    item({ id: "desk-1", catalogId: "desk-soren", roomId: "bed-2", pos: { x: 310, y: 240 }, rotation: 90, colorway: "oak" }),
    item({ id: "chair-5", catalogId: "chair-mysa", roomId: "bed-2", pos: { x: 287, y: 155 }, rotation: 0, colorway: "sage" }),
    item({ id: "shelf-2", catalogId: "shelf-lund", roomId: "bed-2", pos: { x: 15, y: 185 }, rotation: 270, colorway: "plaster" }),
  ];
}

/** Creates the canonical deterministic 2BR, including the 24-item onboarding scene when furnished. */
export function createTwoBedroomTemplate(furnished = false): Scene {
  const rooms = [
    rectangleRoom("living", "Living Room", "living", 520, 440, { x: 0, y: 0 }),
    rectangleRoom("kitchen", "Kitchen & Dining", "kitchen", 360, 440, { x: 520, y: 0 }, "stone"),
    rectangleRoom("bed-1", "Main Bedroom", "bedroom", 400, 360, { x: 0, y: 440 }, "pale-oak"),
    rectangleRoom("hall", "Hall", "hall", 120, 360, { x: 400, y: 440 }),
    rectangleRoom("bed-2", "Second Bedroom", "bedroom", 340, 320, { x: 520, y: 440 }, "pale-oak"),
    rectangleRoom("bath", "Bathroom", "bath", 220, 200, { x: 400, y: 800 }, "terrazzo"),
  ];
  const openings = [
    opening({ id: "door-living-hall", roomId: "living", wallId: "w2", offset: 20, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-living-kitchen", roomId: "living", wallId: "w1", offset: 180, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-living-north", roomId: "living", wallId: "w0", offset: 340, width: 160, kind: "window", sillHeight: 90 }),
    opening({ id: "window-living-west", roomId: "living", wallId: "w3", offset: 40, width: 140, kind: "window", sillHeight: 90 }),

    opening({ id: "door-kitchen-living", roomId: "kitchen", wallId: "w3", offset: 170, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-kitchen-north", roomId: "kitchen", wallId: "w0", offset: 100, width: 160, kind: "window", sillHeight: 90 }),

    opening({ id: "door-main-hall", roomId: "bed-1", wallId: "w1", offset: 250, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-main-south", roomId: "bed-1", wallId: "w2", offset: 220, width: 140, kind: "window", sillHeight: 90 }),

    opening({ id: "door-second-hall", roomId: "bed-2", wallId: "w3", offset: 0, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-second-east", roomId: "bed-2", wallId: "w1", offset: 180, width: 120, kind: "window", sillHeight: 90 }),

    opening({ id: "door-hall-living", roomId: "hall", wallId: "w0", offset: 10, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "door-hall-main", roomId: "hall", wallId: "w3", offset: 20, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-second", roomId: "hall", wallId: "w1", offset: 230, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "door-hall-bath", roomId: "hall", wallId: "w2", offset: 15, width: 90, kind: "door", swing: "in", hinge: "right" }),

    opening({ id: "door-bath-hall", roomId: "bath", wallId: "w0", offset: 15, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-bath-east", roomId: "bath", wallId: "w1", offset: 40, width: 120, kind: "window", sillHeight: 90 }),
  ];
  return makeScene("2br", "living", rooms, openings, furnished ? goldenFurniture() : []);
}
