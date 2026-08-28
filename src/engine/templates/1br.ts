import type { Scene } from "../types";
import { item, makeScene, opening, rectangleRoom } from "./shared";

/** Creates the deterministic one-bedroom template with an optional starter layout. */
export function createOneBedroomTemplate(furnished = false): Scene {
  const rooms = [
    rectangleRoom("living", "Living Room", "living", 520, 440, { x: 0, y: 0 }),
    rectangleRoom("kitchen", "Kitchen & Dining", "kitchen", 320, 440, { x: 520, y: 0 }, "stone"),
    rectangleRoom("bed-1", "Bedroom", "bedroom", 400, 360, { x: 0, y: 440 }, "pale-oak"),
    rectangleRoom("hall", "Hall", "hall", 120, 360, { x: 400, y: 440 }, "oak"),
    rectangleRoom("bath", "Bathroom", "bath", 220, 200, { x: 400, y: 800 }, "terrazzo"),
  ];
  const openings = [
    opening({ id: "door-living-hall", roomId: "living", wallId: "w2", offset: 20, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-living-kitchen", roomId: "living", wallId: "w1", offset: 180, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-living-north", roomId: "living", wallId: "w0", offset: 170, width: 180, kind: "window", sillHeight: 90 }),
    opening({ id: "door-kitchen-living", roomId: "kitchen", wallId: "w3", offset: 170, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-kitchen-north", roomId: "kitchen", wallId: "w0", offset: 90, width: 140, kind: "window", sillHeight: 90 }),
    opening({ id: "door-bedroom-hall", roomId: "bed-1", wallId: "w1", offset: 250, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-bedroom-south", roomId: "bed-1", wallId: "w2", offset: 220, width: 140, kind: "window", sillHeight: 90 }),
    opening({ id: "door-hall-living", roomId: "hall", wallId: "w0", offset: 10, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "door-hall-bath", roomId: "hall", wallId: "w2", offset: 15, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-bath-hall", roomId: "bath", wallId: "w0", offset: 15, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-bath-east", roomId: "bath", wallId: "w1", offset: 40, width: 120, kind: "window", sillHeight: 90 }),
  ];
  const furniture = furnished ? [
    item({ id: "sofa-1", catalogId: "sofa-endre", roomId: "living", pos: { x: 260, y: 47.5 }, rotation: 0, colorway: "sage" }),
    item({ id: "tv-unit-1", catalogId: "tv-unit-linje", roomId: "living", pos: { x: 260, y: 420 }, rotation: 180, colorway: "oak" }),
    item({ id: "rug-1", catalogId: "rug-loop", roomId: "living", pos: { x: 260, y: 240 }, rotation: 90, colorway: "terracotta" }),
    item({ id: "bed-1", catalogId: "bed-birk", roomId: "bed-1", pos: { x: 100, y: 180 }, rotation: 270, colorway: "oak" }),
    item({ id: "wardrobe-1", catalogId: "wardrobe-hald", roomId: "bed-1", pos: { x: 300, y: 30 }, rotation: 0, colorway: "oak" }),
    item({ id: "table-1", catalogId: "table-ake", roomId: "kitchen", pos: { x: 200, y: 235 }, rotation: 0, colorway: "oak" }),
  ] : [];
  return makeScene("1br", "living", rooms, openings, furniture);
}
