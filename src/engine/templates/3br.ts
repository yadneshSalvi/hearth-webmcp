import type { Furniture, Scene } from "../types";
import {
  familyDiningFurniture,
  familyLivingFurniture,
  familyMainBedroomFurniture,
  familySecondaryBedroomFurniture,
  familyStudyBedroomFurniture,
  item,
  makeScene,
  opening,
  rectangleRoom,
} from "./shared";

function furnishedLayout(): Furniture[] {
  return [
    ...familyLivingFurniture(),
    ...familyDiningFurniture(4),
    ...familyMainBedroomFurniture(),
    ...familySecondaryBedroomFurniture(2, "bed-lyng", "sage"),
    ...familyStudyBedroomFurniture(),
    item({ id: "plant-hall", catalogId: "plant-pilea", roomId: "hall", pos: { x: 25, y: 610 }, rotation: 0, colorway: "sage" }),
  ];
}

/** Creates the deterministic 100.8 m² three-bedroom family template. */
export function createThreeBedroomTemplate(furnished = false): Scene {
  const rooms = [
    rectangleRoom("living", "Living Room", "living", 520, 440, { x: 0, y: 0 }),
    rectangleRoom("kitchen", "Kitchen & Dining", "kitchen", 480, 440, { x: 520, y: 0 }, "stone"),
    rectangleRoom("bed-1", "Main Bedroom", "bedroom", 400, 360, { x: 0, y: 440 }, "pale-oak"),
    rectangleRoom("hall", "Hall", "hall", 140, 640, { x: 400, y: 440 }),
    rectangleRoom("bed-2", "Second Bedroom", "bedroom", 460, 320, { x: 540, y: 440 }, "pale-oak", "blue-tint"),
    rectangleRoom("bed-3", "Study Bedroom", "bedroom", 460, 320, { x: 540, y: 760 }, "pale-oak", "sage-tint"),
    rectangleRoom("bath", "Bathroom", "bath", 200, 200, { x: 200, y: 800 }, "terrazzo"),
  ];
  const openings = [
    opening({ id: "door-living-hall", roomId: "living", wallId: "w2", offset: 20, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-living-kitchen", roomId: "living", wallId: "w1", offset: 175, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-living-north", roomId: "living", wallId: "w0", offset: 20, width: 160, kind: "window", sillHeight: 90 }),

    opening({ id: "door-kitchen-living", roomId: "kitchen", wallId: "w3", offset: 175, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-kitchen-north", roomId: "kitchen", wallId: "w0", offset: 160, width: 160, kind: "window", sillHeight: 90 }),

    opening({ id: "door-main-hall", roomId: "bed-1", wallId: "w1", offset: 250, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-main-south", roomId: "bed-1", wallId: "w2", offset: 220, width: 160, kind: "window", sillHeight: 90 }),

    opening({ id: "door-second-hall", roomId: "bed-2", wallId: "w3", offset: 120, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "window-second-east", roomId: "bed-2", wallId: "w1", offset: 160, width: 120, kind: "window", sillHeight: 90 }),

    opening({ id: "door-third-hall", roomId: "bed-3", wallId: "w3", offset: 20, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-third-east", roomId: "bed-3", wallId: "w1", offset: 140, width: 120, kind: "window", sillHeight: 90 }),

    opening({ id: "door-hall-living", roomId: "hall", wallId: "w0", offset: 10, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-second", roomId: "hall", wallId: "w1", offset: 110, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-main", roomId: "hall", wallId: "w3", offset: 300, width: 90, kind: "door", swing: "in", hinge: "left" }),
    opening({ id: "door-hall-bath", roomId: "hall", wallId: "w3", offset: 170, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "door-hall-third", roomId: "hall", wallId: "w1", offset: 530, width: 90, kind: "door", swing: "in", hinge: "left" }),

    opening({ id: "door-bath-hall", roomId: "bath", wallId: "w1", offset: 20, width: 90, kind: "door", swing: "in", hinge: "right" }),
    opening({ id: "window-bath-west", roomId: "bath", wallId: "w3", offset: 55, width: 90, kind: "window", sillHeight: 90 }),
  ];
  return makeScene("3br", "living", rooms, openings, furnished ? furnishedLayout() : []);
}
