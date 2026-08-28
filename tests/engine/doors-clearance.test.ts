import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { clearanceZone, createCatalog, openingClearZone, openingSegment, openingsOnWall, pointInPoly, polyArea, polyBBox, sideClearance, swingZone, turningCircleDiameter, walkwayMin, walls } from "../../src/engine";
import type { Furniture, Opening, Room, Scene } from "../../src/engine/types";

const catalog = createCatalog(catalogSource);
const room: Room = { id: "r", name: "Room", type: "living", poly: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], origin: { x: 0, y: 0 }, floor: "oak" };

function door(wallId: string, hinge: "left" | "right", swing: "in" | "out" = "in"): Opening {
  return { id: `door-${wallId}-${hinge}`, roomId: room.id, wallId, offset: 50, width: 90, kind: "door", swing, hinge };
}

describe("opening geometry", () => {
  it("resolves opening endpoints along every wall", () => {
    for (const wall of walls(room)) {
      const opening = door(wall.id, "left");
      const segment = openingSegment(opening, room);
      expect(segment.wall.id).toBe(wall.id);
      expect(Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y)).toBeCloseTo(90, 8);
      expect(Math.hypot(segment.a.x - wall.a.x, segment.a.y - wall.a.y)).toBeCloseTo(50, 8);
    }
  });

  it("orders only the requested wall's openings", () => {
    const scene: Scene = { rooms: [room], openings: [
      { ...door("w0", "left"), id: "door-2", offset: 200 },
      { ...door("w1", "left"), id: "door-3", offset: 20 },
      { ...door("w0", "right"), id: "door-1", offset: 10 },
    ], furniture: [], variants: [], meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "noon", paletteId: "warm-clay", accessibilityMode: false, activeRoomId: room.id, selection: {} } };
    expect(openingsOnWall(scene, room.id, "w0").map((opening) => opening.id)).toEqual(["door-1", "door-2"]);
    expect(openingsOnWall(scene, room.id, "W1").map((opening) => opening.id)).toEqual(["door-3"]);
    expect(openingsOnWall(scene, "missing", "w0")).toEqual([]);
  });

  it("builds inward quarter-disc swings for every side and hinge", () => {
    for (const wall of walls(room)) {
      for (const hinge of ["left", "right"] as const) {
        const opening = door(wall.id, hinge);
        const segment = openingSegment(opening, room);
        const zone = swingZone(opening, room)!;
        expect(zone).toHaveLength(10);
        expect(zone[0]).toEqual(hinge === "left" ? segment.a : segment.b);
        expect(zone.every((point) => pointInPoly(point, room.poly))).toBe(true);
        expect(polyArea(zone)).toBeGreaterThan(6_000);
        expect(polyArea(zone)).toBeLessThan(6_400);
        const far = zone.at(-1)!;
        expect(Math.hypot(far.x - zone[0]!.x, far.y - zone[0]!.y)).toBeCloseTo(90, 8);
      }
    }
  });

  it("returns null for non-inward door cases", () => {
    expect(swingZone(door("w0", "left", "out"), room)).toBeNull();
    expect(swingZone({ ...door("w0", "left"), kind: "arch" }, room)).toBeNull();
    expect(swingZone({ ...door("w0", "left"), kind: "window" }, room)).toBeNull();
  });

  it("creates 90 cm clear zones for doors and arches only", () => {
    for (const wall of walls(room)) {
      const opening = door(wall.id, "left");
      const zone = openingClearZone(opening, room)!;
      expect(zone).toHaveLength(4);
      expect(polyArea(zone)).toBe(8_100);
      expect(zone.every((point) => pointInPoly(point, room.poly))).toBe(true);
      expect(polyBBox(zone).w === 90 || polyBBox(zone).d === 90).toBe(true);
      expect(polyArea(openingClearZone({ ...opening, kind: "arch" }, room)!)).toBe(8_100);
    }
    expect(openingClearZone({ ...door("w0", "left"), kind: "window" }, room)).toBeNull();
  });
});

describe("furniture clearance", () => {
  it("places clearance in front for every rotation", () => {
    const cat = catalog.byId("desk-aalto")!;
    const expectedCenters = {
      0: { x: 200, y: 200 + cat.dims.d / 2 + 45 },
      90: { x: 200 - cat.dims.d / 2 - 45, y: 200 },
      180: { x: 200, y: 200 - cat.dims.d / 2 - 45 },
      270: { x: 200 + cat.dims.d / 2 + 45, y: 200 },
    } as const;
    for (const rotation of [0, 90, 180, 270] as const) {
      const item: Furniture = { id: "desk-1", catalogId: cat.id, roomId: room.id, pos: { x: 200, y: 200 }, rotation, colorway: "oak", status: "placed" };
      const zone = clearanceZone(item, cat);
      const box = polyBBox(zone);
      expect(zone).toHaveLength(4);
      expect(polyArea(zone)).toBe(cat.dims.w * cat.clearanceFront);
      expect((box.minX + box.maxX) / 2).toBeCloseTo(expectedCenters[rotation].x, 8);
      expect((box.minY + box.maxY) / 2).toBeCloseTo(expectedCenters[rotation].y, 8);
    }
  });

  it("returns no polygon when a category has no front clearance", () => {
    const cat = catalog.byId("plant-fern")!;
    const item: Furniture = { id: "plant-1", catalogId: cat.id, roomId: room.id, pos: { x: 200, y: 200 }, rotation: 0, colorway: "sage", status: "placed" };
    expect(clearanceZone(item, cat)).toEqual([]);
  });

  it("exposes accessibility constants and category side rules", () => {
    expect(walkwayMin(false)).toBe(60);
    expect(walkwayMin(true)).toBe(90);
    expect(turningCircleDiameter).toBe(150);
    expect(sideClearance("bed")).toBe(60);
    expect(sideClearance("desk")).toBe(90);
    expect(sideClearance("sofa")).toBe(0);
    expect(sideClearance("rug")).toBe(0);
  });
});
