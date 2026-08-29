import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import {
  createCatalog,
  createTemplate,
  evaluateHome,
  footprint,
  itemToWallDistance,
  openingClearZone,
  openingSegment,
  pointInPoly,
  polyArea,
  polyInside,
  polysOverlap,
  resolveWall,
  swingZone,
  walls,
} from "../../src/engine";
import type { Opening, Room, Scene, TemplateId, Vec2 } from "../../src/engine/types";
import { TEMPLATE_IDS } from "../../src/engine/types";
import { emptyHome, furnished2br, furnished3br, furnished4br, furnished5br, loftScene, studioScene, worstCase2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);
const bedroomCounts: Record<TemplateId, number> = { studio: 0, "1br": 1, "2br": 2, "3br": 3, "4br": 4, "5br": 5, loft: 0 };

function worldPoint(point: Vec2, room: Room): Vec2 {
  return { x: point.x + room.origin.x, y: point.y + room.origin.y };
}

function worldPoly(room: Room): Vec2[] {
  return room.poly.map((point) => worldPoint(point, room));
}

function worldSpan(scene: Scene, opening: Opening): [Vec2, Vec2] {
  const room = scene.rooms.find((candidate) => candidate.id === opening.roomId)!;
  const segment = openingSegment(opening, room);
  return [worldPoint(segment.a, room), worldPoint(segment.b, room)];
}

function spanKey(scene: Scene, opening: Opening): string {
  const [a, b] = worldSpan(scene, opening);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)].join(":");
}

function sharedDoors(scene: Scene): Map<string, Opening[]> {
  const groups = new Map<string, Opening[]>();
  for (const door of scene.openings.filter((opening) => opening.kind === "door")) {
    const key = spanKey(scene, door);
    groups.set(key, [...(groups.get(key) ?? []), door]);
  }
  return groups;
}

describe("floor-plan templates", () => {
  it("is deterministic and emits independent object graphs", () => {
    for (const id of TEMPLATE_IDS) {
      const first = createTemplate(id, { furnished: true });
      const second = createTemplate(id, { furnished: true });
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first.rooms[0]).not.toBe(second.rooms[0]);
      expect(first.meta.template).toBe(id);
    }
  });

  it("uses the contract defaults", () => {
    for (const id of TEMPLATE_IDS) {
      const scene = createTemplate(id);
      expect(scene.meta.mode).toBe("design");
      expect(scene.meta.view).toBe("dollhouse");
      expect(scene.meta.yaw).toBe("sw");
      expect(scene.meta.timeOfDay).toBe("golden");
      expect(scene.meta.paletteId).toBe("warm-clay");
      expect(scene.meta.accessibilityMode).toBe(false);
      expect(scene.meta.budgetUsd).toBe(3000);
      expect(scene.meta.activeRoomId).toBe(id === "studio" ? "studio" : id === "loft" ? "loft" : "living");
      expect(scene.furniture).toEqual([]);
      expect(scene.variants).toEqual([]);
    }
  });

  it("keeps ids unique and every opening within its derived wall", () => {
    for (const id of TEMPLATE_IDS) {
      const scene = createTemplate(id, { furnished: true });
      expect(new Set(scene.rooms.map((room) => room.id)).size).toBe(scene.rooms.length);
      expect(new Set(scene.openings.map((opening) => opening.id)).size).toBe(scene.openings.length);
      expect(new Set(scene.furniture.map((item) => item.id)).size).toBe(scene.furniture.length);
      for (const room of scene.rooms) {
        expect(scene.openings.some((opening) => opening.roomId === room.id && opening.kind === "door")).toBe(true);
        expect(room.poly.length === 4 || room.poly.length === 6).toBe(true);
      }
      for (const opening of scene.openings) {
        const room = scene.rooms.find((candidate) => candidate.id === opening.roomId)!;
        const wall = resolveWall(room, opening.wallId);
        expect(wall).toBeDefined();
        expect(opening.offset).toBeGreaterThanOrEqual(0);
        expect(opening.width).toBeGreaterThan(0);
        expect(opening.offset + opening.width).toBeLessThanOrEqual(wall!.length);
        if (opening.kind === "window") expect(opening.sillHeight).toBe(90);
      }
    }
  });

  it("aligns every shared door in world space and keeps each door graph connected", () => {
    for (const id of TEMPLATE_IDS) {
      const scene = createTemplate(id);
      const graph = new Map(scene.rooms.map((room) => [room.id, new Set<string>()]));
      for (const [span, doors] of sharedDoors(scene)) {
        expect(doors, `${id}: unmatched door span ${span}`).toHaveLength(2);
        const [left, right] = doors;
        expect(left!.roomId, `${id}: door span ${span} stays in one room`).not.toBe(right!.roomId);
        graph.get(left!.roomId)!.add(right!.roomId);
        graph.get(right!.roomId)!.add(left!.roomId);
      }
      const seen = new Set<string>();
      const pending = [scene.rooms[0]!.id];
      while (pending.length > 0) {
        const roomId = pending.shift()!;
        if (seen.has(roomId)) continue;
        seen.add(roomId);
        pending.push(...graph.get(roomId)!);
      }
      expect(seen.size, `${id}: disconnected door graph`).toBe(scene.rooms.length);
    }
  });

  it("uses exterior-only windows and non-overlapping world-space room footprints", () => {
    for (const id of TEMPLATE_IDS) {
      const scene = createTemplate(id);
      for (let left = 0; left < scene.rooms.length; left += 1) {
        for (let right = left + 1; right < scene.rooms.length; right += 1) {
          expect(polysOverlap(worldPoly(scene.rooms[left]!), worldPoly(scene.rooms[right]!)), `${id}: ${scene.rooms[left]!.id} overlaps ${scene.rooms[right]!.id}`).toBe(false);
        }
      }
      for (const window of scene.openings.filter((opening) => opening.kind === "window")) {
        const [a, b] = worldSpan(scene, window);
        const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
        const host = scene.rooms.find((room) => room.id === window.roomId)!;
        for (const room of scene.rooms.filter((candidate) => candidate.id !== host.id)) {
          expect(samples.some((point) => pointInPoly(point, worldPoly(room))), `${id}: ${window.id} touches ${room.id}`).toBe(false);
        }
      }
    }
  });

  it("matches bedroom counts for every template id", () => {
    for (const id of TEMPLATE_IDS) {
      expect(createTemplate(id).rooms.filter((room) => room.type === "bedroom"), id).toHaveLength(bedroomCounts[id]);
    }
  });

  it("keeps every furnished item inside and pairwise non-overlapping", () => {
    for (const id of TEMPLATE_IDS) {
      const scene = createTemplate(id, { furnished: true });
      for (const item of scene.furniture) {
        const room = scene.rooms.find((candidate) => candidate.id === item.roomId);
        const product = catalog.byId(item.catalogId);
        expect(room).toBeDefined();
        expect(product).toBeDefined();
        expect(polyInside(room!.poly, footprint(item, product!))).toBe(true);
      }
      for (let left = 0; left < scene.furniture.length; left += 1) {
        for (let right = left + 1; right < scene.furniture.length; right += 1) {
          const a = scene.furniture[left]!;
          const b = scene.furniture[right]!;
          if (a.roomId !== b.roomId) continue;
          const aProduct = catalog.byId(a.catalogId)!;
          const bProduct = catalog.byId(b.catalogId)!;
          const aFootprint = footprint(a, aProduct);
          const bFootprint = footprint(b, bProduct);
          const supportedStack = aProduct.category === "rug" && bProduct.category !== "rug"
            || bProduct.category === "rug" && aProduct.category !== "rug"
            || aProduct.category === "table-lamp" && bProduct.category === "table" && polyInside(bFootprint, aFootprint)
            || bProduct.category === "table-lamp" && aProduct.category === "table" && polyInside(aFootprint, bFootprint);
          expect(polysOverlap(aFootprint, bFootprint) && !supportedStack, `${id}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });

  it("ships conflict-free furnished bedroom homes with supported bedside lamps", () => {
    for (const id of ["2br", "3br", "4br", "5br"] as const) {
      const scene = createTemplate(id, { furnished: true });
      expect(evaluateHome(scene, catalog, { accessibility: false })).toEqual([]);

      const lamps = scene.furniture.filter((candidate) => catalog.byId(candidate.catalogId)?.category === "table-lamp");
      const tables = scene.furniture.filter((candidate) => catalog.byId(candidate.catalogId)?.category === "table");
      expect(lamps, id).toHaveLength(2);
      for (const lamp of lamps) {
        const lampFootprint = footprint(lamp, catalog.byId(lamp.catalogId)!);
        expect(tables.some((table) => table.roomId === lamp.roomId
          && polyInside(footprint(table, catalog.byId(table.catalogId)!), lampFootprint)), `${id}: ${lamp.id} is not supported by a table`).toBe(true);
      }
    }

    const accessible = evaluateHome(createTemplate("2br", { furnished: true }), catalog, { accessibility: true });
    // Endpoint-owned zones no longer cap route width; one real pinch and the main-bed side turn remain.
    expect(accessible.map((conflict) => [conflict.kind, conflict.items[0]])).toEqual([
      ["access_path", "bed-2"],
      ["turning_circle", "bed-1"],
    ]);
  });

  it("keeps every other furnished template conflict-free", () => {
    const ranges: Record<Exclude<TemplateId, "2br">, readonly [number, number]> = {
      studio: [6, 14], "1br": [6, 14], "3br": [28, 34], "4br": [34, 42], "5br": [40, 50], loft: [6, 14],
    };
    for (const id of ["studio", "1br", "3br", "4br", "5br", "loft"] as const) {
      const scene = createTemplate(id, { furnished: true });
      expect(scene.furniture.length).toBeGreaterThanOrEqual(ranges[id][0]);
      expect(scene.furniture.length).toBeLessThanOrEqual(ranges[id][1]);
      expect(evaluateHome(scene, catalog, { accessibility: false }), id).toEqual([]);
    }
  });

  it("keeps the larger homes realistic, rectangular and accessible with at most three findings", () => {
    const areaRanges = { "3br": [95, 115], "4br": [120, 145], "5br": [145, 175] } as const;
    for (const id of ["3br", "4br", "5br"] as const) {
      const scene = createTemplate(id, { furnished: true });
      const area = scene.rooms.reduce((sum, room) => sum + polyArea(room.poly) / 10_000, 0);
      expect(area).toBeGreaterThanOrEqual(areaRanges[id][0]);
      expect(area).toBeLessThanOrEqual(areaRanges[id][1]);
      expect(scene.rooms.every((room) => room.poly.length === 4)).toBe(true);
      const hall = scene.rooms.find((room) => room.id === "hall")!;
      expect(Math.min(...walls(hall).map((wall) => wall.length))).toBe(140);
      expect(evaluateHome(scene, catalog, { accessibility: true }).length, id).toBeLessThanOrEqual(3);
      for (const roomType of ["living", "kitchen", "bedroom"] as const) {
        for (const room of scene.rooms.filter((candidate) => candidate.type === roomType)) {
          expect(scene.openings.some((opening) => opening.roomId === room.id && opening.kind === "window"), `${id}: ${room.id} lacks a window`).toBe(true);
        }
      }
    }
  });

  it("keeps the 4BR and 5BR compact, double-loaded and correctly en-suited", () => {
    const expected = {
      "4br": { width: 1280, depth: 1160, area: 139.68, deadGround: 8.8 / 148.48 },
      "5br": { width: 1360, depth: 1200, area: 156.16, deadGround: 7.04 / 163.2 },
    } as const;
    for (const id of ["4br", "5br"] as const) {
      const scene = createTemplate(id);
      const points = scene.rooms.flatMap(worldPoly);
      const minX = Math.min(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxX = Math.max(...points.map((point) => point.x));
      const maxY = Math.max(...points.map((point) => point.y));
      const width = maxX - minX;
      const depth = maxY - minY;
      const area = scene.rooms.reduce((sum, room) => sum + polyArea(room.poly) / 10_000, 0);
      const deadGround = 1 - area / (width * depth / 10_000);
      expect({ width, depth }).toEqual({ width: expected[id].width, depth: expected[id].depth });
      expect(Math.max(width, depth)).toBeLessThanOrEqual(1400);
      expect(area).toBeCloseTo(expected[id].area, 5);
      expect(deadGround).toBeCloseTo(expected[id].deadGround, 5);
      expect(deadGround).toBeLessThanOrEqual(0.15);

      const hall = scene.rooms.find((room) => room.id === "hall")!;
      const hallLeft = hall.origin.x;
      const hallRight = hall.origin.x + Math.max(...hall.poly.map((point) => point.x));
      const loadedRooms = scene.rooms.filter((room) => room.type === "bedroom" || room.type === "bath");
      expect(loadedRooms.some((room) => room.origin.x + Math.max(...room.poly.map((point) => point.x)) <= hallLeft)).toBe(true);
      expect(loadedRooms.some((room) => room.origin.x >= hallRight)).toBe(true);
      for (const corridor of scene.rooms.filter((room) => room.type === "hall")) {
        const lengths = walls(corridor).map((wall) => wall.length);
        expect(Math.min(...lengths)).toBeGreaterThanOrEqual(120);
        expect(Math.min(...lengths)).toBeLessThanOrEqual(160);
        expect(Math.max(...lengths)).toBeLessThanOrEqual(900);
      }

      const neighbours = new Map(scene.rooms.map((room) => [room.id, new Set<string>()]));
      for (const doors of sharedDoors(scene).values()) {
        const [left, right] = doors;
        neighbours.get(left!.roomId)!.add(right!.roomId);
        neighbours.get(right!.roomId)!.add(left!.roomId);
      }
      expect([...neighbours.get("bath-2")!]).toEqual(["bed-1"]);
      expect([...neighbours.get("bath")!]).toEqual(["hall"]);
      expect(neighbours.get("living")!.has("kitchen")).toBe(true);
      expect(neighbours.get("kitchen")!.has("hall")).toBe(true);
    }
  });

  it("keeps larger-template doors off corners with non-overlapping swings", () => {
    for (const id of ["3br", "4br", "5br"] as const) {
      const scene = createTemplate(id);
      for (const room of scene.rooms) {
        const doors = scene.openings.filter((opening) => opening.roomId === room.id && opening.kind === "door");
        for (const door of doors) {
          const wall = resolveWall(room, door.wallId)!;
          expect(door.width).toBe(90);
          expect(door.offset, `${id}: ${door.id} starts at a corner`).toBeGreaterThanOrEqual(10);
          expect(wall.length - door.offset - door.width, `${id}: ${door.id} ends at a corner`).toBeGreaterThanOrEqual(10);
          const before = door.offset;
          const after = wall.length - door.offset - door.width;
          if (before !== after) expect(door.hinge, `${id}: ${door.id} hinge faces its nearest corner`).toBe(before < after ? "right" : "left");
        }
        for (let left = 0; left < doors.length; left += 1) {
          for (let right = left + 1; right < doors.length; right += 1) {
            expect(polysOverlap(swingZone(doors[left]!, room)!, swingZone(doors[right]!, room)!), `${id}: ${doors[left]!.id} swing overlaps ${doors[right]!.id}`).toBe(false);
          }
        }
      }
    }
  });

  it("keeps every wall-backed item against a wall in the larger homes", () => {
    for (const id of ["3br", "4br", "5br"] as const) {
      const scene = createTemplate(id, { furnished: true });
      for (const furniture of scene.furniture) {
        const product = catalog.byId(furniture.catalogId)!;
        if (!product.againstWall) continue;
        const room = scene.rooms.find((candidate) => candidate.id === furniture.roomId)!;
        const nearest = Math.min(...walls(room).map((wall) => itemToWallDistance(furniture, product, wall)));
        expect(nearest, `${id}: ${furniture.id} is not wall-backed`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("evaluates the furnished 5BR in under 80 ms", () => {
    const scene = createTemplate("5br", { furnished: true });
    const started = performance.now();
    expect(evaluateHome(scene, catalog, { accessibility: false })).toEqual([]);
    expect(performance.now() - started).toBeLessThan(80);
  });

  it("keeps all furnished items clear of door swings and access rectangles", () => {
    for (const id of TEMPLATE_IDS) {
      const scene = createTemplate(id, { furnished: true });
      for (const opening of scene.openings) {
        const room = scene.rooms.find((candidate) => candidate.id === opening.roomId)!;
        for (const zone of [swingZone(opening, room), openingClearZone(opening, room)]) {
          if (!zone) continue;
          for (const item of scene.furniture.filter((candidate) => candidate.roomId === room.id)) {
            expect(polysOverlap(zone, footprint(item, catalog.byId(item.catalogId)!)), `${id}: ${item.id} blocks ${opening.id}`).toBe(false);
          }
        }
      }
    }
  });

  it("ships the exact useful 2BR dimensions and golden onboarding composition", () => {
    const scene = createTemplate("2br", { furnished: true });
    const expected = { living: [520, 440], kitchen: [360, 440], "bed-1": [400, 360], "bed-2": [340, 320], bath: [220, 200] } as const;
    for (const [id, dims] of Object.entries(expected)) {
      const room = scene.rooms.find((candidate) => candidate.id === id)!;
      const xs = room.poly.map((point) => point.x);
      const ys = room.poly.map((point) => point.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(dims[0]);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(dims[1]);
    }
    expect(scene.furniture).toHaveLength(24);
    expect(scene.rooms).toHaveLength(6);
    expect(scene.meta.activeRoomId).toBe("living");
    expect(scene.furniture.find((item) => item.id === "sofa-1")).toMatchObject({ catalogId: "sofa-endre", roomId: "living", rotation: 0 });
    expect(scene.furniture.find((item) => item.id === "tv-unit-1")).toMatchObject({ catalogId: "tv-unit-linje", roomId: "living", rotation: 180 });
    expect(scene.furniture.filter((item) => item.roomId === "kitchen" && item.catalogId.startsWith("chair-"))).toHaveLength(4);
    expect(scene.furniture.find((item) => item.id === "bed-1")?.rotation).toBe(270);
    expect(scene.furniture.find((item) => item.id === "desk-1")?.roomId).toBe("bed-2");
  });

  it("uses an L-shaped loft with two north-facing wall edges", () => {
    const loft = createTemplate("loft").rooms.find((room) => room.id === "loft")!;
    expect(loft.poly).toHaveLength(6);
    expect(walls(loft)).toHaveLength(6);
    expect(walls(loft).filter((wall) => wall.side === "north")).toHaveLength(2);
  });

  it("provides fresh empty, furnished and adversarial test fixtures", () => {
    expect(emptyHome().furniture).toHaveLength(0);
    expect(furnished2br().furniture).toHaveLength(23);
    expect(worstCase2br().furniture.length).toBeGreaterThanOrEqual(40);
    expect(furnished3br().meta.template).toBe("3br");
    expect(furnished4br().meta.template).toBe("4br");
    expect(furnished5br().meta.template).toBe("5br");
    expect(studioScene().meta.template).toBe("studio");
    expect(loftScene().meta.template).toBe("loft");
    expect(emptyHome()).not.toBe(emptyHome());
  });
});
