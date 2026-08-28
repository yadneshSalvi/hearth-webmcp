import type { Room, Scene } from "../types";
import { item, makeScene, opening, rectangleRoom } from "./shared";

/** Creates the deterministic L-shaped loft and its bathroom, optionally furnished. */
export function createLoftTemplate(furnished = false): Scene {
  const loft: Room = {
    id: "loft",
    name: "Open-plan Loft",
    type: "studio",
    poly: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 260 }, { x: 800, y: 260 }, { x: 800, y: 600 }, { x: 0, y: 600 }],
    origin: { x: 0, y: 0 },
    floor: "oak",
    wallColor: "plaster",
  };
  const rooms = [loft, rectangleRoom("bath", "Bathroom", "bath", 220, 200, { x: 500, y: 30 }, "terrazzo")];
  const openings = [
    opening({ id: "door-loft-bath", roomId: "loft", wallId: "w1", offset: 40, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-loft-north-a", roomId: "loft", wallId: "w0", offset: 120, width: 180, kind: "window", sillHeight: 90 }),
    opening({ id: "window-loft-north-b", roomId: "loft", wallId: "w2", offset: 70, width: 160, kind: "window", sillHeight: 90 }),
    opening({ id: "window-loft-west", roomId: "loft", wallId: "w5", offset: 180, width: 180, kind: "window", sillHeight: 90 }),
    opening({ id: "door-bath-loft", roomId: "bath", wallId: "w3", offset: 70, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-bath-north", roomId: "bath", wallId: "w0", offset: 50, width: 120, kind: "window", sillHeight: 90 }),
  ];
  const furniture = furnished ? [
    item({ id: "sofa-1", catalogId: "sofa-fjord", roomId: "loft", pos: { x: 250, y: 50 }, rotation: 0, colorway: "plaster" }),
    item({ id: "rug-1", catalogId: "rug-mark", roomId: "loft", pos: { x: 280, y: 260 }, rotation: 90, colorway: "ochre" }),
    item({ id: "tv-unit-1", catalogId: "tv-unit-nova", roomId: "loft", pos: { x: 250, y: 579 }, rotation: 180, colorway: "charcoal" }),
    item({ id: "table-1", catalogId: "table-rove", roomId: "loft", pos: { x: 650, y: 420 }, rotation: 90, colorway: "oak" }),
    item({ id: "plant-1", catalogId: "plant-fig", roomId: "loft", pos: { x: 750, y: 550 }, rotation: 0, colorway: "sage" }),
    item({ id: "floor-lamp-1", catalogId: "floor-lamp-sol", roomId: "loft", pos: { x: 75, y: 125 }, rotation: 0, colorway: "ochre" }),
  ] : [];
  return makeScene("loft", "loft", rooms, openings, furniture);
}
