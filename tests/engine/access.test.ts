import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { accessibilityIssues, createCatalog, findTurningCircle, polyArea, polyBBox, reachZone, turningCircleCandidates } from "../../src/engine";
import type { Furniture, Room, Scene } from "../../src/engine/types";
import { furnished2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

function room(width = 600, depth = 500): Room {
  return { id: "r", name: "Room", type: "bedroom", poly: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], origin: { x: 0, y: 0 }, floor: "oak" };
}

function item(id: string, catalogId: string, x: number, y: number, rotation: Furniture["rotation"] = 0): Furniture {
  return { id, catalogId, roomId: "r", pos: { x, y }, rotation, colorway: "oak", status: "placed" };
}

function scene(targetRoom: Room, furniture: Furniture[]): Scene {
  return { rooms: [targetRoom], openings: [], furniture, variants: [], meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "noon", paletteId: "warm-clay", accessibilityMode: true, activeRoomId: "r", selection: {} } };
}

describe("turning circles", () => {
  it("samples both long sides of a bed as deterministic 16-gons", () => {
    const bed = item("bed-1", "bed-ask", 300, 250);
    const input = scene(room(), [bed]);
    const first = turningCircleCandidates(input, "r", bed, catalog);
    const second = turningCircleCandidates(input, "r", bed, catalog);
    expect(first).toEqual(second);
    expect(first).toHaveLength(14);
    expect(first.every((candidate) => candidate.zone.length === 16)).toBe(true);
    expect(first.every((candidate) => candidate.blockers.length === 0)).toBe(true);
    expect(first.every((candidate) => candidate.inside)).toBe(true);
    expect(first.every((candidate) => candidate.fits)).toBe(true);
    expect(first[0]?.center.x).toBe(155);
    expect(first[7]?.center.x).toBe(445);
    for (const candidate of first.slice(0, 4)) {
      expect(polyArea(candidate.zone)).toBeGreaterThan(17_000);
      expect(polyArea(candidate.zone)).toBeLessThan(17_500);
    }
  });

  it("samples the full front of desks and sofas", () => {
    const desk = item("desk-1", "desk-soren", 300, 100);
    const sofa = item("sofa-1", "sofa-endre", 300, 300, 180);
    const deskCandidates = turningCircleCandidates(scene(room(), [desk]), "r", desk, catalog);
    const sofaCandidates = turningCircleCandidates(scene(room(), [sofa]), "r", sofa, catalog);
    expect(deskCandidates).toHaveLength(13);
    expect(sofaCandidates).toHaveLength(23);
    expect(deskCandidates[0]?.center).toEqual({ x: 300, y: 205 });
    expect(sofaCandidates[0]?.center).toEqual({ x: 300, y: 177.5 });
    expect(deskCandidates.some((candidate) => candidate.fits)).toBe(true);
    expect(sofaCandidates.some((candidate) => candidate.fits)).toBe(true);
  });

  it("returns a fitting candidate first and the best blocked candidate otherwise", () => {
    const bed = item("bed-1", "bed-ask", 300, 250);
    const openScene = scene(room(), [bed]);
    const found = findTurningCircle(openScene, "r", bed, catalog);
    expect(found).toBeDefined();
    expect(found?.fits).toBe(true);
    expect(found?.inside).toBe(true);
    expect(found?.blockers).toEqual([]);

    const smallScene = scene(room(280, 280), [{ ...bed, pos: { x: 140, y: 140 } }]);
    const blocked = findTurningCircle(smallScene, "r", smallScene.furniture[0]!, catalog);
    expect(blocked).toBeDefined();
    expect(blocked?.fits).toBe(false);
    expect(blocked?.inside).toBe(false);
    expect(blocked?.zone).toHaveLength(16);
  });

  it("names blocking furniture and ignores rugs, decor, and table lamps", () => {
    const bed = item("bed-1", "bed-ask", 300, 250);
    const wardrobe = item("wardrobe-1", "wardrobe-nord", 145, 250, 90);
    const rug = item("rug-1", "rug-flette", 300, 250);
    const decor = item("decor-1", "decor-basket", 445, 250);
    const lamp = item("lamp-1", "table-lamp-alva", 445, 250);
    const candidates = turningCircleCandidates(scene(room(), [bed, wardrobe, rug, decor, lamp]), "r", bed, catalog);
    expect(candidates.some((candidate) => candidate.blockers.includes("wardrobe-1"))).toBe(true);
    expect(candidates.every((candidate) => !candidate.blockers.includes("rug-1"))).toBe(true);
    expect(candidates.every((candidate) => !candidate.blockers.includes("decor-1"))).toBe(true);
    expect(candidates.every((candidate) => !candidate.blockers.includes("lamp-1"))).toBe(true);
  });

  it("fails closed for unsupported, missing, and mismatched inputs", () => {
    const chair = item("chair-1", "chair-finn", 200, 200);
    const input = scene(room(), [chair]);
    expect(turningCircleCandidates(input, "r", chair, catalog)).toEqual([]);
    expect(turningCircleCandidates(input, "missing", chair, catalog)).toEqual([]);
    expect(turningCircleCandidates(input, "r", { ...chair, catalogId: "missing" }, catalog)).toEqual([]);
    expect(turningCircleCandidates(input, "r", { ...chair, roomId: "other", catalogId: "bed-ask" }, catalog)).toEqual([]);
    expect(findTurningCircle(input, "r", chair, catalog)).toBeUndefined();
  });
});

describe("reach zones and accessibility issues", () => {
  it("builds a 120 cm front reach rectangle for every rotation", () => {
    const cat = catalog.byId("desk-soren")!;
    const expected = {
      0: { w: 120, d: 120, x: 300, y: 340 },
      90: { w: 120, d: 120, x: 210, y: 250 },
      180: { w: 120, d: 120, x: 300, y: 160 },
      270: { w: 120, d: 120, x: 390, y: 250 },
    } as const;
    for (const rotation of [0, 90, 180, 270] as const) {
      const zone = reachZone(item("desk-1", cat.id, 300, 250, rotation), cat);
      const box = polyBBox(zone);
      expect(zone).toHaveLength(4);
      expect(polyArea(zone)).toBe(14_400);
      expect(box.w).toBe(expected[rotation].w);
      expect(box.d).toBe(expected[rotation].d);
      expect((box.minX + box.maxX) / 2).toBe(expected[rotation].x);
      expect((box.minY + box.maxY) / 2).toBe(expected[rotation].y);
    }
  });

  it("returns no reach zone for categories without the rule", () => {
    for (const id of ["bed-ask", "sofa-endre", "chair-finn", "table-ake", "rug-loop", "plant-fern"]) {
      const cat = catalog.byId(id)!;
      expect(reachZone(item("item-1", id, 200, 200), cat)).toEqual([]);
    }
  });

  it("reports blocked reach and missing turning space once per governed item", () => {
    const targetRoom = room(300, 300);
    const desk = item("desk-1", "desk-soren", 250, 150, 270);
    const plant = item("plant-1", "plant-fig", 310, 150);
    const issues = accessibilityIssues(scene(targetRoom, [desk, plant]), "r", catalog);
    expect(issues.map((issue) => issue.kind).sort()).toEqual(["reach", "turning_circle"]);
    expect(issues.every((issue) => issue.item.id === "desk-1")).toBe(true);
    expect(issues.every((issue) => issue.zone.length > 0)).toBe(true);
    expect(issues.find((issue) => issue.kind === "reach")?.blockers).toContain("plant-1");
    expect(issues.find((issue) => issue.kind === "turning_circle")?.outside).toBe(true);
  });

  it("is deterministic, input-pure, and skips unknown rooms", () => {
    const input = furnished2br();
    const before = structuredClone(input);
    const first = accessibilityIssues(input, "bed-2", catalog);
    const second = accessibilityIssues(input, "bed-2", catalog);
    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.some((issue) => issue.kind === "turning_circle")).toBe(true);
    expect(first.some((issue) => issue.kind === "reach")).toBe(true);
    expect(accessibilityIssues(input, "missing", catalog)).toEqual([]);
  });
});
