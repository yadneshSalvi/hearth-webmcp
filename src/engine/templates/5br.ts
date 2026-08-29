import type { Furniture, Scene } from "../types";
import { familyDiningFurniture, familyLivingFurniture, item, makeScene, opening, rectangleRoom } from "./shared";

function mainBedroomFurniture(): Furniture[] {
  return [
    item({ id: "bed-1", catalogId: "bed-birk", roomId: "bed-1", pos: { x: 230, y: 340 }, rotation: 180, colorway: "oak" }),
    item({ id: "side-table-1", catalogId: "table-bord", roomId: "bed-1", pos: { x: 115, y: 417.5 }, rotation: 180, colorway: "oak" }),
    item({ id: "side-table-2", catalogId: "table-bord", roomId: "bed-1", pos: { x: 345, y: 417.5 }, rotation: 180, colorway: "oak" }),
    item({ id: "table-lamp-1", catalogId: "table-lamp-alva", roomId: "bed-1", pos: { x: 115, y: 417.5 }, rotation: 0, colorway: "ochre" }),
    item({ id: "table-lamp-2", catalogId: "table-lamp-alva", roomId: "bed-1", pos: { x: 345, y: 417.5 }, rotation: 0, colorway: "ochre" }),
    item({ id: "wardrobe-1", catalogId: "wardrobe-hald", roomId: "bed-1", pos: { x: 220, y: 27 }, rotation: 0, colorway: "oak" }),
    item({ id: "decor-main", catalogId: "decor-basket", roomId: "bed-1", pos: { x: 40, y: 300 }, rotation: 0, colorway: "oak" }),
  ];
}

function studyBedroomFurniture(): Furniture[] {
  return [
    item({ id: "bed-2", catalogId: "bed-ask", roomId: "bed-2", pos: { x: 100, y: 100 }, rotation: 0, colorway: "dusty-blue" }),
    item({ id: "wardrobe-2", catalogId: "wardrobe-skive", roomId: "bed-2", pos: { x: 350, y: 30 }, rotation: 0, colorway: "sage" }),
    item({ id: "side-table-3", catalogId: "table-bord", roomId: "bed-2", pos: { x: 420, y: 297.5 }, rotation: 180, colorway: "oak" }),
    item({ id: "desk-1", catalogId: "desk-soren", roomId: "bed-2", pos: { x: 280, y: 290 }, rotation: 180, colorway: "oak" }),
    item({ id: "chair-7", catalogId: "chair-mysa", roomId: "bed-2", pos: { x: 365, y: 220 }, rotation: 180, colorway: "sage" }),
    item({ id: "shelf-2", catalogId: "shelf-lund", roomId: "bed-2", pos: { x: 500, y: 15 }, rotation: 0, colorway: "plaster" }),
  ];
}

function upperBedroomFurniture(): Furniture[] {
  return [
    item({ id: "bed-3", catalogId: "bed-ask", roomId: "bed-3", pos: { x: 90, y: 100 }, rotation: 0, colorway: "dusty-blue" }),
    item({ id: "wardrobe-3", catalogId: "wardrobe-skive", roomId: "bed-3", pos: { x: 340, y: 30 }, rotation: 0, colorway: "sage" }),
    item({ id: "side-table-4", catalogId: "table-bord", roomId: "bed-3", pos: { x: 190, y: 297.5 }, rotation: 180, colorway: "oak" }),
    item({ id: "floor-lamp-3", catalogId: "floor-lamp-lyst", roomId: "bed-3", pos: { x: 380, y: 200 }, rotation: 0, colorway: "plaster" }),
  ];
}

function lowerBedroomFurniture(): Furniture[] {
  return [
    item({ id: "bed-4", catalogId: "bed-lyng", roomId: "bed-4", pos: { x: 100, y: 230 }, rotation: 270, colorway: "ochre" }),
    item({ id: "wardrobe-4", catalogId: "wardrobe-skive", roomId: "bed-4", pos: { x: 275, y: 50 }, rotation: 90, colorway: "plaster" }),
    item({ id: "side-table-5", catalogId: "table-bord", roomId: "bed-4", pos: { x: 22.5, y: 100 }, rotation: 180, colorway: "oak" }),
    item({ id: "decor-fourth", catalogId: "decor-vase", roomId: "bed-4", pos: { x: 75, y: 50 }, rotation: 0, colorway: "plaster" }),
    item({ id: "bed-5", catalogId: "bed-ask", roomId: "bed-5", pos: { x: 205, y: 220 }, rotation: 90, colorway: "dusty-blue" }),
    item({ id: "wardrobe-5", catalogId: "wardrobe-skive", roomId: "bed-5", pos: { x: 30, y: 55 }, rotation: 270, colorway: "sage" }),
    item({ id: "side-table-6", catalogId: "table-bord", roomId: "bed-5", pos: { x: 22.5, y: 150 }, rotation: 0, colorway: "oak" }),
    item({ id: "decor-fifth", catalogId: "decor-vase", roomId: "bed-5", pos: { x: 150, y: 120 }, rotation: 0, colorway: "plaster" }),
  ];
}

function furnishedLayout(): Furniture[] {
  return [
    ...familyLivingFurniture(),
    ...familyDiningFurniture(6),
    ...mainBedroomFurniture(),
    ...studyBedroomFurniture(),
    ...upperBedroomFurniture(),
    ...lowerBedroomFurniture(),
  ];
}

/** Creates the deterministic 156.16 m² compact five-bedroom family template. */
export function createFiveBedroomTemplate(furnished = false): Scene {
  const rooms = [
    rectangleRoom("living", "Living Room", "living", 520, 440, { x: 0, y: 0 }),
    rectangleRoom("kitchen", "Kitchen & Dining", "kitchen", 680, 440, { x: 520, y: 0 }, "stone"),
    rectangleRoom("bed-2", "Study Bedroom", "bedroom", 610, 320, { x: 0, y: 440 }, "pale-oak", "blue-tint"),
    rectangleRoom("hall", "Hall", "hall", 140, 760, { x: 610, y: 440 }),
    rectangleRoom("bath", "Family Bathroom", "bath", 200, 320, { x: 750, y: 440 }, "terrazzo"),
    rectangleRoom("bed-3", "Third Bedroom", "bedroom", 410, 320, { x: 950, y: 440 }, "pale-oak", "sage-tint"),
    rectangleRoom("bath-2", "Ensuite", "bath", 210, 440, { x: 0, y: 760 }, "terrazzo"),
    rectangleRoom("bed-1", "Main Bedroom", "bedroom", 400, 440, { x: 210, y: 760 }, "pale-oak"),
    rectangleRoom("hall-2", "Bedroom Hall", "hall", 610, 120, { x: 750, y: 760 }),
    rectangleRoom("bed-4", "Guest Bedroom", "bedroom", 305, 320, { x: 750, y: 880 }, "pale-oak", "plum-tint"),
    rectangleRoom("bed-5", "Kids' Bedroom", "bedroom", 305, 320, { x: 1055, y: 880 }, "pale-oak", "ochre-tint"),
  ];
  const openings = [
    opening({ id: "door-living-kitchen", roomId: "living", wallId: "w1", offset: 175, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-living-north", roomId: "living", wallId: "w0", offset: 20, width: 160, kind: "window", sillHeight: 90 }),
    opening({ id: "door-kitchen-living", roomId: "kitchen", wallId: "w3", offset: 175, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-kitchen-hall", roomId: "kitchen", wallId: "w2", offset: 475, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-kitchen-north", roomId: "kitchen", wallId: "w0", offset: 300, width: 160, kind: "window", sillHeight: 90 }),

    opening({ id: "door-second-hall", roomId: "bed-2", wallId: "w1", offset: 220, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-second-west", roomId: "bed-2", wallId: "w3", offset: 120, width: 120, kind: "window", sillHeight: 90 }),
    opening({ id: "door-main-hall", roomId: "bed-1", wallId: "w1", offset: 140, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-main-ensuite", roomId: "bed-1", wallId: "w3", offset: 210, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-main-south", roomId: "bed-1", wallId: "w2", offset: 260, width: 120, kind: "window", sillHeight: 90 }),
    opening({ id: "door-ensuite-main", roomId: "bath-2", wallId: "w1", offset: 140, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-bath-hall", roomId: "bath", wallId: "w3", offset: 120, width: 90, kind: "door", swing: "in", hinge: "left" }),

    opening({ id: "door-hall-kitchen", roomId: "hall", wallId: "w0", offset: 25, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-bath", roomId: "hall", wallId: "w1", offset: 110, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-bedroom-hall", roomId: "hall", wallId: "w1", offset: 335, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "door-hall-main", roomId: "hall", wallId: "w3", offset: 210, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-second", roomId: "hall", wallId: "w3", offset: 450, width: 90, kind: "door", swing: "in", hinge: "left" }),

    opening({ id: "door-bedroom-hall-main-hall", roomId: "hall-2", wallId: "w3", offset: 15, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-bedroom-hall-third", roomId: "hall-2", wallId: "w0", offset: 210, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-bedroom-hall-fourth", roomId: "hall-2", wallId: "w2", offset: 415, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "door-bedroom-hall-fifth", roomId: "hall-2", wallId: "w2", offset: 10, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-third-bedroom-hall", roomId: "bed-3", wallId: "w2", offset: 310, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-third-east", roomId: "bed-3", wallId: "w1", offset: 80, width: 140, kind: "window", sillHeight: 90 }),
    opening({ id: "door-fourth-bedroom-hall", roomId: "bed-4", wallId: "w0", offset: 105, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-fourth-south", roomId: "bed-4", wallId: "w2", offset: 10, width: 120, kind: "window", sillHeight: 90 }),
    opening({ id: "door-fifth-bedroom-hall", roomId: "bed-5", wallId: "w0", offset: 205, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-fifth-south", roomId: "bed-5", wallId: "w2", offset: 175, width: 120, kind: "window", sillHeight: 90 }),
  ];
  return makeScene("5br", "living", rooms, openings, furnished ? furnishedLayout() : []);
}
