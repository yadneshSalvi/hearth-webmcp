import type { Scene } from "../types";
import { item, makeScene, opening, rectangleRoom } from "./shared";

/** Creates the deterministic studio template, optionally with a compact starter layout. */
export function createStudioTemplate(furnished = false): Scene {
  const rooms = [
    rectangleRoom("studio", "Studio", "studio", 520, 440, { x: 0, y: 0 }, "pale-oak"),
    rectangleRoom("bath", "Bathroom", "bath", 220, 200, { x: 520, y: 240 }, "terrazzo"),
  ];
  const openings = [
    opening({ id: "door-studio-bath", roomId: "studio", wallId: "w1", offset: 260, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-studio-north", roomId: "studio", wallId: "w0", offset: 170, width: 180, kind: "window", sillHeight: 90 }),
    opening({ id: "door-bath-studio", roomId: "bath", wallId: "w3", offset: 90, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-bath-south", roomId: "bath", wallId: "w2", offset: 50, width: 120, kind: "window", sillHeight: 90 }),
  ];
  const furniture = furnished ? [
    item({ id: "sofa-1", catalogId: "sofa-liva", roomId: "studio", pos: { x: 170, y: 44 }, rotation: 0, colorway: "sage" }),
    item({ id: "rug-1", catalogId: "rug-flette", roomId: "studio", pos: { x: 190, y: 220 }, rotation: 90, colorway: "plaster" }),
    item({ id: "desk-1", catalogId: "desk-aalto", roomId: "studio", pos: { x: 450, y: 180 }, rotation: 90, colorway: "oak" }),
    item({ id: "chair-1", catalogId: "chair-finn", roomId: "studio", pos: { x: 390, y: 240 }, rotation: 90, colorway: "charcoal" }),
    item({ id: "plant-1", catalogId: "plant-fern", roomId: "studio", pos: { x: 480, y: 395 }, rotation: 0, colorway: "sage" }),
    item({ id: "tv-unit-1", catalogId: "tv-unit-form", roomId: "studio", pos: { x: 200, y: 420 }, rotation: 180, colorway: "plaster" }),
  ] : [];
  return makeScene("studio", "studio", rooms, openings, furniture);
}
