import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog, pointInPoly, trafficPaths } from "../../src/engine";
import type { Furniture, Opening, Room, Scene } from "../../src/engine/types";
import { worstCase2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

function room(poly: Room["poly"] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]): Room {
  return { id: "r", name: "Room", type: "living", poly, origin: { x: 0, y: 0 }, floor: "oak" };
}

function opening(id: string, wallId: string, offset: number, width = 90): Opening {
  return { id, roomId: "r", wallId, offset, width, kind: "door", swing: "in", hinge: "left" };
}

function item(id: string, catalogId: string, x: number, y: number, rotation: Furniture["rotation"] = 0): Furniture {
  return { id, catalogId, roomId: "r", pos: { x, y }, rotation, colorway: "oak", status: "placed" };
}

function scene(openings: Opening[] = [], furniture: Furniture[] = [], targetRoom = room()): Scene {
  return { rooms: [targetRoom], openings, furniture, variants: [], meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "noon", paletteId: "warm-clay", accessibilityMode: false, activeRoomId: "r", selection: {} } };
}

describe("traffic grid and required routes", () => {
  it("routes between two clear doors with deterministic width and endpoints", () => {
    const input = scene([opening("door-n", "w0", 50), opening("door-s", "w2", 50)]);
    const first = trafficPaths(input, "r", catalog, { clearanceCost: false });
    const second = trafficPaths(input, "r", catalog, { clearanceCost: false });
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]?.from).toBe("door-n");
    expect(first[0]?.to).toBe("door-s");
    expect(first[0]?.ok).toBe(true);
    expect(first[0]?.minWidthCm).toBe(190);
    expect(first[0]?.pinch).toBeDefined();
    expect(first[0]?.points.length).toBeGreaterThanOrEqual(2);
    expect(first[0]?.points.every((point) => pointInPoly(point, input.rooms[0]!.poly))).toBe(true);
  });

  it("adds primary-door routes to sofa, armchair, bed, and desk use points", () => {
    const input = scene(
      [opening("door-n", "w0", 155), opening("door-s", "w2", 155)],
      [
        item("sofa-1", "sofa-liva", 90, 50),
        item("armchair-1", "armchair-elsa", 330, 60),
        item("bed-1", "bed-ask", 100, 190, 90),
        item("desk-1", "desk-soren", 330, 170, 90),
        item("chair-1", "chair-finn", 300, 250),
      ],
    );
    const paths = trafficPaths(input, "r", catalog);
    expect(paths).toHaveLength(5);
    expect(paths.map((path) => path.to)).toEqual(["door-s", "armchair-1", "bed-1", "desk-1", "sofa-1"]);
    expect(paths.some((path) => path.to === "chair-1")).toBe(false);
    for (const path of paths) {
      expect(path.from).toBe("door-n");
      expect(path.minWidthCm).toBeGreaterThanOrEqual(0);
      expect(typeof path.ok).toBe("boolean");
    }
  });

  it("finds a route around the re-entrant corner of an L room", () => {
    const lRoom = room([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 0, y: 300 }]);
    const input = scene([opening("door-n", "w0", 20, 80), opening("door-e", "w3", 60, 80)], [], lRoom);
    const paths = trafficPaths(input, "r", catalog, { clearanceCost: false });
    expect(paths).toHaveLength(1);
    expect(paths[0]?.points.length).toBeGreaterThan(2);
    expect(paths[0]?.points.every((point) => pointInPoly(point, lRoom.poly))).toBe(true);
    expect(paths[0]?.points.some((point) => point.y >= 100)).toBe(true);
    expect(paths[0]?.minWidthCm).toBeGreaterThan(0);
  });

  it("reports a narrow but existing route and a pinch point", () => {
    const input = scene(
      [opening("door-n", "w0", 155), opening("door-s", "w2", 155)],
      [item("table-1", "table-elm", 75, 150), item("table-2", "table-elm", 325, 150)],
    );
    const paths = trafficPaths(input, "r", catalog, { clearanceCost: false });
    expect(paths).toHaveLength(1);
    expect(paths[0]?.points.length).toBeGreaterThan(0);
    expect(paths[0]?.ok).toBe(false);
    expect(paths[0]?.minWidthCm).toBeLessThan(60);
    expect(paths[0]?.minWidthCm).toBeGreaterThan(0);
    expect(paths[0]?.pinch).toBeDefined();
  });

  it("takes a compliant detour instead of reporting a shorter narrow gap", () => {
    const target = room([{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }]);
    const input = scene(
      [opening("door-n", "w0", 5), opening("door-s", "w2", 505)],
      [
        item("wardrobe-1", "wardrobe-nord", 150, 200),
        item("wardrobe-2", "wardrobe-nord", 350, 200),
      ],
      target,
    );
    const path = trafficPaths(input, "r", catalog, { clearanceCost: false })[0];
    expect(path).toBeDefined();
    expect(path?.ok).toBe(true);
    expect(path?.minWidthCm).toBeGreaterThanOrEqual(60);
    expect(path?.points.some((point) => point.x > 450)).toBe(true);
  });

  it("returns an explicit missing route when furniture seals the room", () => {
    const input = scene(
      [opening("door-n", "w0", 155), opening("door-s", "w2", 155)],
      [item("table-1", "table-elm", 100, 150), item("table-2", "table-elm", 300, 150)],
    );
    const path = trafficPaths(input, "r", catalog, { clearanceCost: false })[0];
    expect(path).toBeDefined();
    expect(path?.ok).toBe(false);
    expect(path?.points).toEqual([]);
    expect(path?.minWidthCm).toBe(0);
    expect(path?.pinch).toBeUndefined();
  });

  it("uses the accessibility threshold without changing deterministic endpoints", () => {
    const input = scene([opening("door-n", "w0", 50), opening("door-s", "w2", 50)]);
    const standard = trafficPaths(input, "r", catalog, { accessibility: false });
    const accessible = trafficPaths(input, "r", catalog, { accessibility: true });
    expect(standard[0]?.minWidthCm).toBe(190);
    expect(standard[0]?.ok).toBe(true);
    expect(accessible[0]?.minWidthCm).toBe(190);
    expect(accessible[0]?.ok).toBe(true);
    expect(accessible[0]?.from).toBe(standard[0]?.from);
    expect(accessible[0]?.to).toBe(standard[0]?.to);
  });

  it("handles rooms without usable openings and invalid rooms", () => {
    expect(trafficPaths(scene(), "r", catalog)).toEqual([]);
    expect(trafficPaths(scene([opening("zero", "w0", 50, 0)]), "r", catalog)).toEqual([]);
    expect(trafficPaths(scene(), "missing", catalog)).toEqual([]);
    const degenerate = room([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(trafficPaths(scene([opening("zero-room", "w0", 0)], [], degenerate), "r", catalog)).toEqual([]);
  });

  it("stays within the four-times CI performance allowance", () => {
    const input = worstCase2br();
    for (let warm = 0; warm < 3; warm += 1) trafficPaths(input, "living", catalog);
    const started = performance.now();
    for (let run = 0; run < 20; run += 1) trafficPaths(input, "living", catalog);
    const averageMs = (performance.now() - started) / 20;
    expect(averageMs).toBeLessThan(50); // measured ~0.6 ms; generous so a loaded host never flakes
  });
});
