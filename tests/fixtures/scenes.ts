import { createTemplate } from "../../src/engine/templates";
import type { Furniture, Scene } from "../../src/engine/types";

/** Returns a fresh unfurnished canonical 2BR. */
export function emptyHome(): Scene {
  return createTemplate("2br");
}

function move(scene: Scene, id: string, x: number, y: number, rotation?: Furniture["rotation"]): void {
  const entry = scene.furniture.find((candidate) => candidate.id === id);
  if (entry) {
    entry.pos = { x, y };
    if (rotation !== undefined) entry.rotation = rotation;
  }
}

/** Returns the historical warning-heavy 23-item scene retained by engine regression tests. */
export function furnished2br(): Scene {
  const scene = createTemplate("2br", { furnished: true });
  scene.furniture = scene.furniture.filter((entry) => !entry.id.startsWith("side-table-"));
  move(scene, "sofa-1", 260, 47.5);
  move(scene, "floor-lamp-1", 440, 120);
  move(scene, "table-1", 210, 240);
  move(scene, "chair-1", 210, 165);
  move(scene, "chair-2", 210, 315);
  move(scene, "chair-3", 124, 240);
  move(scene, "chair-4", 296, 240);
  move(scene, "table-lamp-1", 215, 80);
  move(scene, "table-lamp-2", 215, 280);
  move(scene, "plant-3", 270, 170);
  move(scene, "bed-2", 100, 160);
  move(scene, "desk-1", 310, 80);
  move(scene, "chair-5", 250, 80, 90);
  move(scene, "shelf-2", 260, 305, 180);
  scene.furniture.push({ id: "plant-4", catalogId: "plant-ivy", roomId: "hall", pos: { x: 60, y: 175 }, rotation: 0, colorway: "sage", status: "placed" });
  const secondWindow = scene.openings.find((entry) => entry.id === "window-second-east");
  if (secondWindow) secondWindow.offset = 20;
  return scene;
}

/** Returns a broken 40-item scene with 45 conflicts: 6 overlap, 4 outside, 16 clearance, 6 door, and 13 traffic. */
export function worstCase2br(): Scene {
  const scene = furnished2br();
  const extra: Furniture[] = [
    // Overlaps sofa-1 in the living room.
    { id: "sofa-2", catalogId: "sofa-liva", roomId: "living", pos: { x: 260, y: 55 }, rotation: 0, colorway: "ochre", status: "placed" },
    // Sits partly outside the living room's west edge.
    { id: "chair-6", catalogId: "chair-lars", roomId: "living", pos: { x: -10, y: 100 }, rotation: 0, colorway: "terracotta", status: "placed" },
    // Blocks the living-to-hall door clear zone.
    { id: "chair-7", catalogId: "chair-ida", roomId: "living", pos: { x: 455, y: 395 }, rotation: 0, colorway: "dusty-blue", status: "placed" },
    // Overlaps rug-1 and pinches the living walkway.
    { id: "table-2", catalogId: "table-rund", roomId: "living", pos: { x: 260, y: 240 }, rotation: 0, colorway: "oak", status: "placed" },
    // Blocks the east-wall arch to the kitchen.
    { id: "armchair-2", catalogId: "armchair-elsa", roomId: "living", pos: { x: 490, y: 250 }, rotation: 90, colorway: "plaster", status: "placed" },
    // Extends beyond the kitchen's north edge.
    { id: "table-3", catalogId: "table-ake", roomId: "kitchen", pos: { x: 180, y: 10 }, rotation: 0, colorway: "oak", status: "placed" },
    // Overlaps the dining table and two chairs.
    { id: "chair-8", catalogId: "chair-finn", roomId: "kitchen", pos: { x: 210, y: 240 }, rotation: 0, colorway: "sage", status: "placed" },
    // Blocks the kitchen entry door's swing and clear zone.
    { id: "plant-5", catalogId: "plant-fig", roomId: "kitchen", pos: { x: 300, y: 405 }, rotation: 0, colorway: "sage", status: "placed" },
    // Overlaps the main bed footprint.
    { id: "bed-3", catalogId: "bed-ask", roomId: "bed-1", pos: { x: 100, y: 180 }, rotation: 270, colorway: "plaster", status: "placed" },
    // Falls outside the main bedroom's south boundary.
    { id: "decor-1", catalogId: "decor-basket", roomId: "bed-1", pos: { x: 120, y: 370 }, rotation: 0, colorway: "oak", status: "placed" },
    // Blocks the main-bedroom door swing.
    { id: "chair-9", catalogId: "chair-mysa", roomId: "bed-1", pos: { x: 365, y: 295 }, rotation: 90, colorway: "sage", status: "placed" },
    // Removes useful front clearance from wardrobe-1.
    { id: "decor-2", catalogId: "decor-basket", roomId: "bed-1", pos: { x: 320, y: 80 }, rotation: 0, colorway: "terracotta", status: "placed" },
    // Overlaps bed-2 exactly.
    { id: "bed-4", catalogId: "bed-lyng", roomId: "bed-2", pos: { x: 100, y: 160 }, rotation: 270, colorway: "sage", status: "placed" },
    // Blocks the second-bedroom doorway.
    { id: "chair-10", catalogId: "chair-olve", roomId: "bed-2", pos: { x: 45, y: 270 }, rotation: 0, colorway: "ochre", status: "placed" },
    // Crowds the desk's 90 cm working clearance.
    { id: "plant-6", catalogId: "plant-palm", roomId: "bed-2", pos: { x: 240, y: 80 }, rotation: 0, colorway: "sage", status: "placed" },
    // Obstructs the narrow hall and overlaps plant-4.
    { id: "decor-3", catalogId: "decor-basket", roomId: "hall", pos: { x: 60, y: 175 }, rotation: 0, colorway: "oak", status: "placed" },
    // Blocks the bathroom door immediately inside the room.
    { id: "plant-7", catalogId: "plant-fern", roomId: "bath", pos: { x: 60, y: 45 }, rotation: 0, colorway: "sage", status: "placed" },
  ];
  scene.furniture.push(...extra);
  return scene;
}

/** Returns the furnished compact studio fixture. */
export function studioScene(): Scene {
  return createTemplate("studio", { furnished: true });
}

/** Returns the furnished L-shaped loft fixture. */
export function loftScene(): Scene {
  return createTemplate("loft", { furnished: true });
}
