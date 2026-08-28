import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import {
  backAgainstWall, clampInsideRoom, createCatalog, distancePointSegment, footprint, freeSpans, gapBetween, itemToWallDistance,
  overlapArea, pointInPoly, polyArea, polyBBox, polyInside, polysOverlap, rectPoly, resolveWall, roomArea, roomAreaM2,
  roomSize, roomToWorld, rotateDims, rotationForWall, snap, wallById, wallBySide, walls, worldToRoom,
} from "../../src/engine";
import type { Furniture, Room, Scene } from "../../src/engine/types";

const catalog = createCatalog(catalogSource);

function room(width = 520, depth = 440): Room {
  return { id: "living", name: "Living Room", type: "living", poly: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], origin: { x: 100, y: 200 }, floor: "oak" };
}

function emptyScene(r = room()): Scene {
  return { rooms: [r], openings: [], furniture: [], variants: [], meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "golden", paletteId: "warm-clay", accessibilityMode: false, activeRoomId: r.id, selection: {} } };
}

function furniture(id: string, catalogId: string, pos: { x: number; y: number }, rotation: 0 | 90 | 180 | 270 = 0): Furniture {
  return { id, catalogId, roomId: "living", pos, rotation, colorway: "oak", status: "placed" };
}

describe("walls and room metrics", () => {
  it("derives clockwise rectangular wall ids, sides and lengths", () => {
    const result = walls(room());
    expect(result).toHaveLength(4);
    expect(result.map((wall) => wall.id)).toEqual(["w0", "w1", "w2", "w3"]);
    expect(result.map((wall) => wall.side)).toEqual(["north", "east", "south", "west"]);
    expect(result.map((wall) => wall.length)).toEqual([520, 440, 520, 440]);
    expect(result[0]?.a).toEqual({ x: 0, y: 0 });
    expect(result[0]?.b).toEqual({ x: 520, y: 0 });
    expect(wallById(room(), "W2")?.side).toBe("south");
    expect(wallById(room(), "missing")).toBeUndefined();
    expect(resolveWall(room(), " EAST ")?.id).toBe("w1");
    expect(resolveWall(room(), "w3")?.side).toBe("west");
  });

  it("labels repeated L-room sides and chooses the longest", () => {
    const lRoom: Room = { ...room(400, 300), poly: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 0, y: 300 }] };
    const result = walls(lRoom);
    expect(result).toHaveLength(6);
    expect(result.map((wall) => wall.side)).toEqual(["north", "east", "north", "east", "south", "west"]);
    expect(result.filter((wall) => wall.side === "north")).toHaveLength(2);
    expect(wallBySide(lRoom, "north")?.id).toBe("w2");
    expect(wallBySide(lRoom, "north")?.length).toBe(250);
    expect(wallBySide(lRoom, "south")?.length).toBe(400);
  });

  it("computes area, bbox, size and world transforms", () => {
    const r = room();
    expect(roomArea(r)).toBe(228_800);
    expect(roomAreaM2(r)).toBe(22.9);
    expect(roomSize(r)).toBe("520x440");
    expect(polyBBox(r.poly)).toEqual({ minX: 0, minY: 0, maxX: 520, maxY: 440, w: 520, d: 440 });
    expect(worldToRoom(r, { x: 140, y: 250 })).toEqual({ x: 40, y: 50 });
    expect(roomToWorld(r, { x: 40, y: 50 })).toEqual({ x: 140, y: 250 });
  });
});

describe("footprints and polygons", () => {
  it("rotates rectangular footprint extents for every supported rotation", () => {
    const cat = catalog.byId("sofa-endre")!;
    for (const rotation of [0, 90, 180, 270] as const) {
      const item = furniture(`sofa-${rotation}`, cat.id, { x: 300, y: 200 }, rotation);
      const box = polyBBox(footprint(item, cat));
      expect(box.w).toBe(rotation === 90 || rotation === 270 ? 95 : 220);
      expect(box.d).toBe(rotation === 90 || rotation === 270 ? 220 : 95);
      expect(polyArea(footprint(item, cat))).toBe(20_900);
      expect(footprint(item, cat)).toHaveLength(4);
    }
    expect(rotateDims({ w: 30, d: 60 }, 0)).toEqual({ w: 30, d: 60 });
    expect(rotateDims({ w: 30, d: 60 }, 90)).toEqual({ w: 60, d: 30 });
  });

  it("handles containment, boundaries, crossings and touching", () => {
    const outer = rectPoly({ x: 50, y: 50 }, 100, 100);
    const inside = rectPoly({ x: 50, y: 50 }, 30, 40);
    const touching = rectPoly({ x: 10, y: 50 }, 20, 20);
    const crossing = rectPoly({ x: 95, y: 50 }, 20, 20);
    expect(pointInPoly({ x: 50, y: 50 }, outer)).toBe(true);
    expect(pointInPoly({ x: 0, y: 20 }, outer)).toBe(true);
    expect(pointInPoly({ x: -0.01, y: 20 }, outer)).toBe(false);
    expect(polyInside(outer, inside)).toBe(true);
    expect(polyInside(outer, touching)).toBe(true);
    expect(polyInside(outer, crossing)).toBe(false);
    expect(polysOverlap(inside, touching)).toBe(false);
    expect(polysOverlap(rectPoly({ x: 10, y: 10 }, 20, 20), rectPoly({ x: 30, y: 10 }, 20, 20))).toBe(false);
    expect(polysOverlap(rectPoly({ x: 10, y: 10 }, 20, 20), rectPoly({ x: 29, y: 10 }, 20, 20))).toBe(true);
    expect(polysOverlap([], inside)).toBe(false);
    expect(overlapArea(rectPoly({ x: 10, y: 10 }, 20, 20), rectPoly({ x: 15, y: 15 }, 20, 20))).toBe(225);
    expect(overlapArea(rectPoly({ x: 10, y: 10 }, 20, 20), rectPoly({ x: 30, y: 10 }, 20, 20))).toBe(0);
  });

  it("detects overlap against either leg of an L polygon", () => {
    const lPoly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
    expect(polyArea(lPoly)).toBe(30_000);
    expect(polysOverlap(lPoly, rectPoly({ x: 50, y: 50 }, 20, 20))).toBe(true);
    expect(polysOverlap(lPoly, rectPoly({ x: 150, y: 150 }, 20, 20))).toBe(true);
    expect(polysOverlap(lPoly, rectPoly({ x: 150, y: 50 }, 20, 20))).toBe(false);
    expect(polysOverlap(lPoly, rectPoly({ x: 110, y: 50 }, 20, 20))).toBe(false);
  });
});

describe("wall spans and measurements", () => {
  it("subtracts, clips and merges openings", () => {
    const r = room(500, 400);
    const scene = emptyScene(r);
    const north = wallBySide(r, "north")!;
    expect(freeSpans(r, north, scene, catalog)).toEqual([{ start: 0, end: 500 }]);
    scene.openings.push({ id: "window-1", roomId: r.id, wallId: north.id, offset: 100, width: 90, kind: "window" });
    expect(freeSpans(r, north, scene, catalog)).toEqual([{ start: 0, end: 100 }, { start: 190, end: 500 }]);
    scene.openings.push({ id: "window-2", roomId: r.id, wallId: north.id, offset: 180, width: 100, kind: "window" });
    expect(freeSpans(r, north, scene, catalog)).toEqual([{ start: 0, end: 100 }, { start: 280, end: 500 }]);
    scene.openings.push({ id: "window-3", roomId: r.id, wallId: north.id, offset: -20, width: 30, kind: "window" });
    scene.openings.push({ id: "window-4", roomId: r.id, wallId: north.id, offset: 490, width: 40, kind: "window" });
    expect(freeSpans(r, north, scene, catalog, { minLength: 0 })).toEqual([{ start: 10, end: 100 }, { start: 280, end: 490 }]);
  });

  it("subtracts flush wall-hugging items and honors ignore/minLength", () => {
    const r = room(500, 400);
    const scene = emptyScene(r);
    const north = wallBySide(r, "north")!;
    scene.furniture.push(furniture("sofa-1", "sofa-endre", { x: 250, y: 47.5 }));
    expect(freeSpans(r, north, scene, catalog)).toEqual([{ start: 0, end: 140 }, { start: 360, end: 500 }]);
    expect(freeSpans(r, north, scene, catalog, { ignoreItemIds: ["sofa-1"] })).toEqual([{ start: 0, end: 500 }]);
    expect(freeSpans(r, north, scene, catalog, { minLength: 150 })).toEqual([]);
    scene.furniture[0]!.pos.y = 53;
    expect(freeSpans(r, north, scene, catalog)).toEqual([{ start: 0, end: 500 }]);
  });

  it("measures point, item-wall and item-item distances", () => {
    expect(distancePointSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distancePointSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distancePointSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
    const cat = catalog.byId("sofa-endre")!;
    const sofa = furniture("sofa-1", cat.id, { x: 250, y: 47.5 });
    expect(itemToWallDistance(sofa, cat, wallBySide(room(500, 400), "north")!)).toBe(0);
    sofa.pos.y = 57.5;
    expect(itemToWallDistance(sofa, cat, wallBySide(room(500, 400), "north")!)).toBe(10);
    const other = furniture("sofa-2", cat.id, { x: 480, y: 57.5 });
    expect(gapBetween(sofa, other, catalog)).toEqual({ gap_cm: 10, direction: "east" });
    other.pos.x = 450;
    expect(gapBetween(sofa, other, catalog)).toEqual({ gap_cm: -20, direction: "east" });
  });
});

describe("placement helpers", () => {
  it("snaps, clamps, rotates and places backs against every wall", () => {
    expect(snap(12)).toBe(10);
    expect(snap(13)).toBe(15);
    expect(snap(13, 10)).toBe(10);
    expect(snap(13, 0)).toBe(13);
    expect(rotationForWall("north")).toBe(0);
    expect(rotationForWall("east")).toBe(90);
    expect(rotationForWall("south")).toBe(180);
    expect(rotationForWall("west")).toBe(270);
    const r = room(500, 400);
    const cat = catalog.byId("sofa-endre")!;
    for (const side of ["north", "east", "south", "west"] as const) {
      const wall = wallBySide(r, side)!;
      const rotation = rotationForWall(side);
      const pos = backAgainstWall(wall, wall.length / 2, cat, rotation);
      const placed = furniture("sofa-1", cat.id, pos, rotation);
      expect(itemToWallDistance(placed, cat, wall)).toBeCloseTo(0, 6);
      expect(polyInside(r.poly, footprint(placed, cat))).toBe(true);
    }
    const outside = rectPoly({ x: -10, y: 50 }, 40, 40);
    const clamped = clampInsideRoom(r, outside);
    expect(polyInside(r.poly, clamped)).toBe(true);
    expect(polyBBox(clamped).minX).toBe(0);
  });
});
