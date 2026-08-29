import { describe, expect, it } from "vitest";
import { catalogSource } from "@/data/catalog.source";
import { createCatalog } from "@/src/engine/catalog";
import { footprint, polyBBox, rotateDims } from "@/src/engine/geometry";
import { createTemplate } from "@/src/engine/templates";
import type { CatalogItem, Conflict, Furniture, Room, Rotation, Scene, Vec2 } from "@/src/engine/types";
import { snapPose } from "@/src/scene/interactionDrag";
import {
  ALIGN_SNAP_CM, WALL_SNAP_CM, alignToNeighbours, clampCentreInsideRoom, conflictReason, dimensionLines,
  gridSnap, halfExtent, neighbourGap, poseFootprint, rayToPolygon, roomAtWorldCm, roomToWorldCm, snapToWalls,
  stackSurfaceFor, threeToWorldCm, wallLines, worldCmToThree, worldToRoomCm,
} from "@/src/scene/interactionMath";
import type { NeighbourRef } from "@/src/scene/interactionMath";

const catalog = createCatalog(catalogSource);

function product(id: string): CatalogItem {
  const found = catalog.byId(id);
  if (!found) throw new Error(`fixture product ${id} is missing`);
  return found;
}

const SOFA = product("sofa-endre"); // 220 × 95, againstWall
const RUG = product("rug-loop"); // 200 × 300, free-standing
const TABLE = product("table-ake"); // 120 × 80 × 40 surface
const LAMP = product("table-lamp-alva"); // 22 × 22 stackable
const PLANT = product("plant-fern"); // 50 × 50, not stackable

function room(id: string, template: "2br" | "loft" = "2br"): Room {
  const found = createTemplate(template).rooms.find((entry) => entry.id === id);
  if (!found) throw new Error(`fixture room ${id} is missing`);
  return found;
}

const LIVING = room("living"); // 520 × 440 rectangle
const LOFT = room("loft", "loft"); // L: notch cut out of the north-east

function placed(id: string, catalogId: string, pos: Vec2, rotation: Rotation = 0, roomId = "living"): Furniture {
  return { id, catalogId, roomId, pos, rotation, colorway: "oak", status: "placed" };
}

function neighbour(id: string, item: CatalogItem, pos: Vec2, rotation: Rotation = 0): NeighbourRef {
  return { item: placed(id, item.id, pos, rotation), product: item };
}

function snap(pos: Vec2, rotation: Rotation, item = SOFA, allowRotate = true, memory?: Parameters<typeof snapToWalls>[0]["memory"]) {
  return snapToWalls({ room: LIVING, product: item, pos, rotation, allowRotate, memory });
}

describe("frame conversion", () => {
  it("round-trips room-local and world centimetres through the room origin", () => {
    const bed = room("bed-2");
    expect(bed.origin).toEqual({ x: 520, y: 440 });
    expect(roomToWorldCm(bed, { x: 100, y: 70 })).toEqual({ x: 620, y: 510 });
    expect(worldToRoomCm(bed, { x: 620, y: 510 })).toEqual({ x: 100, y: 70 });
  });

  it("maps the renderer's floor plane to world centimetres and back", () => {
    const world = threeToWorldCm({ x: 6.2, z: 5.1 });
    expect(world.x).toBeCloseTo(620, 6);
    expect(world.y).toBeCloseTo(510, 6);
    const metres = worldCmToThree({ x: 620, y: 510 });
    expect(metres[0]).toBeCloseTo(6.2, 9);
    expect(metres[1]).toBe(0);
    expect(metres[2]).toBeCloseTo(5.1, 9);
  });

  it("finds the room under a world point and prefers the room already being dragged in", () => {
    const rooms = createTemplate("2br").rooms;
    expect(roomAtWorldCm(rooms, { x: 260, y: 220 })?.id).toBe("living");
    expect(roomAtWorldCm(rooms, { x: 700, y: 220 })?.id).toBe("kitchen");
    expect(roomAtWorldCm(rooms, { x: 200, y: 600 })?.id).toBe("bed-1");
    expect(roomAtWorldCm(rooms, { x: -40, y: 220 })).toBeUndefined();
    // A point inside exactly one room still resolves when a stale preference is passed.
    expect(roomAtWorldCm(rooms, { x: 260, y: 220 }, "kitchen")?.id).toBe("living");
  });

  it("keeps the whole footprint inside the room's bounding box", () => {
    expect(clampCentreInsideRoom(LIVING, SOFA, { x: -50, y: -50 }, 0)).toEqual({ x: 110, y: 47.5 });
    expect(clampCentreInsideRoom(LIVING, SOFA, { x: 900, y: 900 }, 0)).toEqual({ x: 410, y: 392.5 });
    expect(clampCentreInsideRoom(LIVING, SOFA, { x: 260, y: 220 }, 0)).toEqual({ x: 260, y: 220 });
  });

  it("agrees with the engine on rotated footprints", () => {
    const item = placed("sofa-9", SOFA.id, { x: 260, y: 220 }, 90);
    expect(poseFootprint(SOFA, item.pos, 90)).toEqual(footprint(item, SOFA));
    expect(halfExtent(SOFA, 90)).toEqual({ x: 47.5, y: 110 });
  });
});

describe("wall lines", () => {
  it("labels every wall of a rectangle with its inward axis direction", () => {
    const lines = wallLines(LIVING);
    expect(lines.map((line) => [line.wall.side, line.axis, line.inward, line.line])).toEqual([
      ["north", "y", 1, 0],
      ["east", "x", -1, 520],
      ["south", "y", -1, 440],
      ["west", "x", 1, 0],
    ]);
  });
});

describe("snapToWalls — priority 1, wall flush", () => {
  it("snaps flush and turns the back to the wall on all four sides", () => {
    const north = snap({ x: 260, y: 55 }, 0);
    expect(north.rotation).toBe(0);
    expect(north.pos).toEqual({ x: 260, y: 47.5 });
    expect(north.walls.y).toBe("w0");
    expect(north.rotatedTo).toBe("north");

    const east = snap({ x: 415, y: 220 }, 0);
    expect(east.rotation).toBe(90);
    expect(east.pos).toEqual({ x: 472.5, y: 220 });
    expect(east.walls.x).toBe("w1");

    const south = snap({ x: 260, y: 385 }, 0);
    expect(south.rotation).toBe(180);
    expect(south.pos).toEqual({ x: 260, y: 392.5 });
    expect(south.walls.y).toBe("w2");

    const west = snap({ x: 105, y: 220 }, 0);
    expect(west.rotation).toBe(270);
    expect(west.pos).toEqual({ x: 47.5, y: 220 });
    expect(west.walls.x).toBe("w3");
  });

  it("keeps a wall-flush item flush once it is already rotated", () => {
    // A sofa already facing east, 4 cm off the west wall: the near edge, not the back, triggers.
    const result = snap({ x: 51.5, y: 220 }, 270);
    expect(result.rotation).toBe(270);
    expect(result.pos).toEqual({ x: 47.5, y: 220 });
  });

  it("catches both axes in a corner and rotates to the nearer wall", () => {
    const corner = snap({ x: 105, y: 55 }, 0);
    expect(corner.rotation).toBe(270); // west is 5 cm away, north 7.5 cm
    expect(corner.pos).toEqual({ x: 47.5, y: 110 });
    expect(corner.snapped.sort()).toEqual(["x", "y"]);
  });

  it("holds the rotation when Alt is down, and still snaps flush", () => {
    const held = snap({ x: 105, y: 220 }, 0, SOFA, false);
    expect(held.rotation).toBe(0);
    expect(held.pos).toEqual({ x: 110, y: 220 });
    expect(held.rotatedTo).toBeUndefined();
  });

  it("never rotates a product that does not want a wall", () => {
    const result = snapToWalls({ room: LIVING, product: RUG, pos: { x: 108, y: 220 }, rotation: 0, allowRotate: true });
    expect(result.rotation).toBe(0);
    expect(result.pos).toEqual({ x: 100, y: 220 });
    expect(result.rotatedTo).toBeUndefined();
  });

  it("ignores walls beyond the threshold", () => {
    const result = snap({ x: 260, y: 61 }, 0);
    expect(result.pos).toEqual({ x: 260, y: 61 });
    expect(result.snapped).toEqual([]);
    expect(WALL_SNAP_CM).toBe(12);
  });

  it("holds an engaged snap past the threshold, so the boundary cannot flicker", () => {
    const loose = snap({ x: 260, y: 65 }, 0);
    expect(loose.snapped).toEqual([]);
    const sticky = snap({ x: 260, y: 65 }, 0, SOFA, true, { wallY: "w0" });
    expect(sticky.pos).toEqual({ x: 260, y: 47.5 });
    // Far enough out and even a sticky snap lets go.
    expect(snap({ x: 260, y: 80 }, 0, SOFA, true, { wallY: "w0" }).snapped).toEqual([]);
  });

  it("only considers walls the item actually spans, so an L-room's notch is respected", () => {
    // At x = 250 the north boundary is w0 (y = 0); w2 (y = 260) only spans x 500–800.
    const west = snapToWalls({ room: LOFT, product: SOFA, pos: { x: 250, y: 265 }, rotation: 0, allowRotate: true });
    expect(west.snapped).toEqual([]);
    const notch = snapToWalls({ room: LOFT, product: SOFA, pos: { x: 650, y: 305 }, rotation: 0, allowRotate: true });
    expect(notch.walls.y).toBe("w2");
    expect(notch.pos).toEqual({ x: 650, y: 307.5 });
  });
});

describe("alignToNeighbours — priority 2", () => {
  const rug = neighbour("rug-1", RUG, { x: 260, y: 240 }, 90); // x 110–410, y 140–340

  it("locks an edge onto a neighbour's edge inside the threshold and publishes a guide", () => {
    const result = alignToNeighbours({ product: SOFA, pos: { x: 216, y: 60 }, rotation: 0, neighbours: [rug] });
    expect(result.pos.x).toBe(220); // self min 106 → rug min 110
    const guide = result.guides.find((entry) => entry.axis === "x");
    expect(guide).toMatchObject({ at: 110, itemId: "rug-1", kind: "min" });
    expect(guide?.from).toBeLessThan(guide?.to ?? 0);
    expect(ALIGN_SNAP_CM).toBe(8);
  });

  it("leaves the item alone outside the threshold", () => {
    const result = alignToNeighbours({ product: SOFA, pos: { x: 209, y: 60 }, rotation: 0, neighbours: [rug] });
    expect(result.pos).toEqual({ x: 209, y: 60 });
    expect(result.guides).toEqual([]);
  });

  it("aligns centres as well as edges", () => {
    const result = alignToNeighbours({ product: SOFA, pos: { x: 256, y: 60 }, rotation: 0, neighbours: [rug] });
    expect(result.pos.x).toBe(260);
    expect(result.guides[0]).toMatchObject({ kind: "center", at: 260 });
  });

  it("leaves axes a wall has already claimed untouched", () => {
    const result = alignToNeighbours({
      product: SOFA, pos: { x: 216, y: 60 }, rotation: 0, neighbours: [rug], skip: { x: true },
    });
    expect(result.pos.x).toBe(216);
    expect(result.guides.every((guide) => guide.axis !== "x")).toBe(true);
  });

  it("holds an engaged guide past the threshold", () => {
    const key = "rug-1:x:min:min";
    const loose = alignToNeighbours({ product: SOFA, pos: { x: 229, y: 60 }, rotation: 0, neighbours: [rug] });
    expect(loose.guides).toEqual([]);
    const sticky = alignToNeighbours({ product: SOFA, pos: { x: 229, y: 60 }, rotation: 0, neighbours: [rug], memory: { guideX: key } });
    expect(sticky.pos.x).toBe(220);
    expect(sticky.guides[0]?.key).toBe(key);
  });
});

describe("gridSnap — priority 3", () => {
  it("rounds free axes to 5 cm and leaves claimed axes alone", () => {
    expect(gridSnap({ x: 213, y: 68 })).toEqual({ x: 215, y: 70 });
    expect(gridSnap({ x: 213, y: 68 }, { x: false, y: true })).toEqual({ x: 213, y: 70 });
    expect(gridSnap({ x: 213, y: 68 }, { x: true, y: true }, 10)).toEqual({ x: 210, y: 70 });
  });
});

describe("snapping priority through the drag pipeline", () => {
  function scene(): Scene {
    return createTemplate("2br", { furnished: true });
  }
  const base = { catalog, itemId: "sofa-1", product: SOFA, colorway: "sage", allowRotate: true };

  it("prefers a wall flush over a neighbour alignment on the same axis", () => {
    const result = snapPose({ ...base, scene: scene(), room: LIVING, pos: { x: 106, y: 240 }, rotation: 0 });
    // rug-1's west edge is at x = 110 and would be within 8 cm, but the west wall wins.
    expect(result.rotation).toBe(270);
    expect(result.pos.x).toBe(47.5);
    expect(result.memory.wallX).toBe("w3");
    expect(result.guides.every((guide) => guide.axis !== "x")).toBe(true);
  });

  it("prefers a neighbour alignment over the grid", () => {
    const result = snapPose({ ...base, scene: scene(), room: LIVING, pos: { x: 216, y: 240 }, rotation: 0 });
    expect(result.pos.x).toBe(220); // aligned to rug-1, not rounded to 215
    expect(result.memory.guideX).toContain("rug-1");
  });

  it("falls through to the 5 cm grid when nothing is near", () => {
    const result = snapPose({ ...base, scene: scene(), room: LIVING, pos: { x: 263, y: 78 }, rotation: 90 });
    expect(result.pos.x % 5).toBe(0);
    expect(result.memory.wallX).toBeUndefined();
  });

  it("skips every magnet for an exact keyboard nudge", () => {
    const result = snapPose({ ...base, scene: scene(), room: LIVING, pos: { x: 256, y: 146.5 }, rotation: 0, exact: true });
    expect(result.pos).toEqual({ x: 256, y: 146.5 });
    expect(result.guides).toEqual([]);
    expect(result.memory).toEqual({});
  });
});

describe("dimensionLines", () => {
  it("measures each footprint edge to the wall it faces in a rectangle", () => {
    const foot = poseFootprint(SOFA, { x: 260, y: 120 }, 0);
    const lines = dimensionLines(LIVING, foot);
    const bySide = Object.fromEntries(lines.map((line) => [line.side, line.cm]));
    expect(bySide).toEqual({ north: 73, east: 150, south: 273, west: 150 });
    const north = lines.find((line) => line.side === "north");
    expect(north?.a).toEqual({ x: 260, y: 72.5 });
    expect(north?.b).toEqual({ x: 260, y: 0 });
  });

  it("omits an edge that is already flush", () => {
    const foot = poseFootprint(SOFA, { x: 260, y: 47.5 }, 0);
    expect(dimensionLines(LIVING, foot).map((line) => line.side)).toEqual(["east", "south", "west"]);
  });

  it("measures to the L-room boundary that is actually there", () => {
    // In the notch column the north boundary is w2 at y = 260, not w0 at y = 0.
    const inNotch = dimensionLines(LOFT, poseFootprint(SOFA, { x: 650, y: 400 }, 0));
    expect(inNotch.find((line) => line.side === "north")?.cm).toBe(93);
    expect(inNotch.find((line) => line.side === "east")?.cm).toBe(40);
    const inMain = dimensionLines(LOFT, poseFootprint(SOFA, { x: 250, y: 400 }, 0));
    expect(inMain.find((line) => line.side === "north")?.cm).toBe(353);
  });

  it("returns the nearest positive hit for a ray, and nothing for a miss", () => {
    expect(rayToPolygon({ x: 250, y: 300 }, { x: 0, y: -1 }, LOFT.poly)).toBe(300);
    expect(rayToPolygon({ x: 650, y: 300 }, { x: 0, y: -1 }, LOFT.poly)).toBe(40);
    expect(rayToPolygon({ x: 900, y: 300 }, { x: 1, y: 0 }, LOFT.poly)).toBeUndefined();
  });
});

describe("neighbourGap", () => {
  it("reports the nearest edge-to-edge gap along one axis", () => {
    const rug = neighbour("rug-1", RUG, { x: 260, y: 240 }, 90); // x 110–410
    const gap = neighbourGap(SOFA, { x: 260, y: 40 }, 0, [rug], "y");
    expect(gap).toMatchObject({ itemId: "rug-1", axis: "y", cm: 53 }); // 87.5 → 140
  });

  it("ignores neighbours that do not overlap on the other axis", () => {
    const far = neighbour("shelf-1", TABLE, { x: 500, y: 400 });
    expect(neighbourGap(SOFA, { x: 110, y: 60 }, 0, [far], "y")).toBeUndefined();
  });

  it("ignores neighbours it already overlaps", () => {
    const rug = neighbour("rug-1", RUG, { x: 260, y: 240 }, 90);
    expect(neighbourGap(SOFA, { x: 260, y: 240 }, 0, [rug], "y")).toBeUndefined();
  });
});

describe("stacking validity", () => {
  const table = neighbour("table-1", TABLE, { x: 200, y: 200 }); // x 140–260, y 160–240

  it("accepts a lamp whose footprint sits entirely on a surface", () => {
    const foot = poseFootprint(LAMP, { x: 200, y: 200 }, 0);
    expect(stackSurfaceFor(LAMP, foot, [table])).toEqual({ itemId: "table-1", heightCm: 40 });
  });

  it("refuses a lamp hanging over the edge", () => {
    const foot = poseFootprint(LAMP, { x: 255, y: 200 }, 0);
    expect(stackSurfaceFor(LAMP, foot, [table])).toBeUndefined();
  });

  it("refuses categories that never stack, and surfaces that are not surfaces", () => {
    expect(stackSurfaceFor(PLANT, poseFootprint(PLANT, { x: 200, y: 200 }, 0), [table])).toBeUndefined();
    const rug = neighbour("rug-1", RUG, { x: 200, y: 200 }, 0);
    expect(stackSurfaceFor(LAMP, poseFootprint(LAMP, { x: 200, y: 200 }, 0), [rug])).toBeUndefined();
  });

  it("does not make a fully-supported lamp an overlap error in the rules engine", () => {
    const scene = createTemplate("2br", { furnished: true });
    const lampOnTable = snapPose({
      scene, catalog, itemId: "table-lamp-1", product: LAMP, room: room("bed-1"),
      pos: { x: 45, y: 65 }, rotation: 0, colorway: "ochre", allowRotate: true, exact: true,
    });
    expect(lampOnTable.pos).toEqual({ x: 45, y: 65 });
    const surfaceBox = polyBBox(poseFootprint(product("table-bord"), { x: 45, y: 65 }, 270));
    const lampBox = polyBBox(poseFootprint(LAMP, { x: 45, y: 65 }, 0));
    expect(lampBox.minX).toBeGreaterThanOrEqual(surfaceBox.minX);
    expect(lampBox.maxY).toBeLessThanOrEqual(surfaceBox.maxY);
  });
});

describe("conflictReason", () => {
  function conflict(kind: Conflict["kind"], items: string[]): Conflict {
    return { kind, items, roomId: "living", detail: "d", fix: "f", severity: "error" };
  }

  it("names the other party in ≤ 44 characters", () => {
    const cases: [Conflict["kind"], string[], string][] = [
      ["overlap", ["sofa-1", "rug-1"], "overlaps rug-1"],
      ["outside", ["sofa-1"], "outside the room"],
      ["clearance", ["sofa-1", "table-1"], "blocks table-1's clearance"],
      ["door_swing", ["sofa-1", "door-1"], "blocks door-1's swing"],
      ["traffic", ["sofa-1"], "blocks the walkway"],
      ["access_path", ["sofa-1"], "blocks the accessible path"],
      ["turning_circle", ["sofa-1"], "no turning circle"],
      ["reach", ["sofa-1"], "out of reach"],
    ];
    for (const [kind, items, expected] of cases) {
      const reason = conflictReason(conflict(kind, items), "sofa-1");
      expect(reason).toBe(expected);
      expect(reason.length).toBeLessThanOrEqual(44);
    }
  });

  it("stays readable when the conflict names no other item", () => {
    expect(conflictReason(conflict("overlap", ["sofa-1"]), "sofa-1")).toBe("overlaps another item");
  });
});

describe("rotated extents", () => {
  it("swaps width and depth for quarter turns, matching the engine", () => {
    expect(rotateDims(SOFA.dims, 90)).toEqual({ w: 95, d: 220 });
    expect(rotateDims(SOFA.dims, 180)).toEqual({ w: 220, d: 95 });
  });
});
