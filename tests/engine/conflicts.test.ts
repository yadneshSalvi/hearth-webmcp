import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { conflictsForItem, countBySeverity, createCatalog, createTemplate, evaluateHome, evaluateRoom } from "../../src/engine";
import type { Furniture, Opening, Room, Scene } from "../../src/engine/types";
import { emptyHome, furnished2br, loftScene, studioScene, worstCase2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

function room(width = 500, depth = 400): Room {
  return { id: "r", name: "Room", type: "living", poly: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], origin: { x: 0, y: 0 }, floor: "oak" };
}

function item(id: string, catalogId: string, x: number, y: number, rotation: Furniture["rotation"] = 0, status: Furniture["status"] = "placed"): Furniture {
  return { id, catalogId, roomId: "r", pos: { x, y }, rotation, colorway: "oak", status };
}

function scene(furniture: Furniture[] = [], openings: Opening[] = [], targetRoom = room()): Scene {
  return { rooms: [targetRoom], openings, furniture, variants: [], meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "noon", paletteId: "warm-clay", accessibilityMode: false, activeRoomId: "r", selection: {} } };
}

function northDoor(id = "door-1", offset = 0, width = 90): Opening {
  return { id, roomId: "r", wallId: "w0", offset, width, kind: "door", swing: "in", hinge: "right" };
}

function applyMove(input: Scene, fix: string): Scene {
  const match = /^move (\S+) (\d+) cm (north|east|south|west)$/.exec(fix);
  expect(match, `unsupported fix: ${fix}`).not.toBeNull();
  const moved = structuredClone(input);
  const target = moved.furniture.find((entry) => entry.id === match?.[1]);
  expect(target, `missing fix target: ${match?.[1]}`).toBeDefined();
  const cm = Number(match?.[2]);
  const direction = match?.[3];
  if (target && direction === "north") target.pos.y -= cm;
  if (target && direction === "east") target.pos.x += cm;
  if (target && direction === "south") target.pos.y += cm;
  if (target && direction === "west") target.pos.x -= cm;
  return moved;
}

describe("overlap, stacking, and room bounds", () => {
  it("treats exact contact and intersections of at most 4 cm² as non-overlap", () => {
    const touching = scene([item("chair-1", "chair-lars", 100, 100), item("chair-2", "chair-lars", 148, 100)]);
    const tiny = scene([item("chair-1", "chair-lars", 100, 100), item("chair-2", "chair-lars", 147.95, 100)]);
    expect(evaluateRoom(touching, "r", catalog).filter((conflict) => conflict.kind === "overlap")).toEqual([]);
    expect(evaluateRoom(tiny, "r", catalog).filter((conflict) => conflict.kind === "overlap")).toEqual([]);
  });

  it("allows rugs under furniture and beneath other rugs", () => {
    const allowed = scene([item("rug-1", "rug-loop", 250, 200, 90), item("sofa-1", "sofa-endre", 250, 80)]);
    expect(evaluateRoom(allowed, "r", catalog).filter((conflict) => conflict.kind === "overlap")).toEqual([]);
    const doubled = scene([item("rug-1", "rug-flette", 200, 200), item("rug-2", "rug-flette", 250, 200)]);
    expect(evaluateRoom(doubled, "r", catalog).filter((conflict) => conflict.kind === "overlap")).toEqual([]);
  });

  it("allows a lamp fully on a table and rejects one hanging off", () => {
    const table = item("table-1", "table-ake", 250, 200);
    const onTop = scene([table, item("lamp-1", "table-lamp-alva", 250, 200)]);
    const halfOff = scene([table, item("lamp-1", "table-lamp-alva", 340, 200)]);
    expect(evaluateRoom(onTop, "r", catalog).filter((conflict) => conflict.kind === "overlap")).toEqual([]);
    const overlap = evaluateRoom(halfOff, "r", catalog).find((conflict) => conflict.kind === "overlap");
    expect(overlap).toBeDefined();
    expect(overlap?.items).toEqual(["lamp-1", "table-1"]);
    expect(overlap?.detail).toContain("cm²");
    expect(overlap?.fix).toMatch(/^move lamp-1 \d+ cm (north|east|south|west)$/);
  });

  it("checks ghosts only against placed furniture and keeps the ghost id first", () => {
    const input = scene([
      item("sofa-1", "sofa-endre", 250, 100),
      item("preview-1", "sofa-liva", 250, 100, 0, "ghost"),
      item("preview-2", "sofa-liva", 250, 100, 0, "ghost"),
    ]);
    const overlaps = evaluateRoom(input, "r", catalog).filter((conflict) => conflict.kind === "overlap");
    expect(overlaps).toHaveLength(2);
    expect(overlaps.map((conflict) => conflict.items[0]).sort()).toEqual(["preview-1", "preview-2"]);
    expect(overlaps.every((conflict) => conflict.items[1] === "sofa-1")).toBe(true);
    expect(overlaps.every((conflict) => conflict.severity === "warn")).toBe(true);
  });

  it("computes the smallest five-centimetre move for an outside item", () => {
    const input = scene([item("chair-1", "chair-lars", 0, 100)]);
    const outside = evaluateRoom(input, "r", catalog).find((conflict) => conflict.kind === "outside");
    expect(outside).toBeDefined();
    expect(outside?.severity).toBe("error");
    expect(outside?.detail).toContain("25 cm");
    expect(outside?.detail).toContain("west");
    expect(outside?.fix).toBe("move chair-1 25 cm east");
    expect(outside?.zone).toHaveLength(4);
  });

  it("handles an item in the missing corner of an L-shaped room", () => {
    const lRoom = room(400, 300);
    lRoom.poly = [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
    const input = scene([item("chair-1", "chair-lars", 220, 50)], [], lRoom);
    const outside = evaluateRoom(input, "r", catalog).find((conflict) => conflict.kind === "outside");
    expect(outside).toBeDefined();
    expect(outside?.fix).toMatch(/^move chair-1 \d+ cm (south|west)$/);
    expect(outside?.detail.length).toBeLessThanOrEqual(80);
  });
});

describe("clearance and opening zones", () => {
  it("combines all blockers into one partial-clearance warning", () => {
    const input = scene([
      item("desk-1", "desk-aalto", 250, 100),
      item("plant-1", "plant-pilea", 210, 180),
      item("plant-2", "plant-pilea", 270, 180),
    ]);
    const clearances = evaluateRoom(input, "r", catalog).filter((conflict) => conflict.kind === "clearance" && conflict.items[0] === "desk-1");
    expect(clearances).toHaveLength(1);
    expect(clearances[0]?.items).toEqual(["desk-1", "plant-1", "plant-2"]);
    expect(clearances[0]?.severity).toBe("warn");
    expect(clearances[0]?.detail).toContain("90 cm");
    expect(clearances[0]?.zone).toHaveLength(4);
    expect(clearances[0]?.fix).toMatch(/^move (desk-1|plant-[12]) \d+ cm (north|east|south|west)$/);
  });

  it("raises clearance severity at fifty percent obstruction", () => {
    const input = scene([item("desk-1", "desk-aalto", 250, 100), item("table-1", "table-rund", 250, 185)]);
    const clearance = evaluateRoom(input, "r", catalog).find((conflict) => conflict.kind === "clearance" && conflict.items[0] === "desk-1");
    expect(clearance).toBeDefined();
    expect(clearance?.severity).toBe("error");
    expect(clearance?.detail).toMatch(/has \d+ cm clear; needs 90 cm/);
  });

  it("reports one door conflict when both clear and swing zones are hit", () => {
    const input = scene([item("wardrobe-1", "wardrobe-skive", 130, 60)], [northDoor()]);
    const doors = evaluateRoom(input, "r", catalog).filter((conflict) => conflict.kind === "door_swing");
    expect(doors).toHaveLength(1);
    expect(doors[0]?.items).toEqual(["wardrobe-1", "door-1"]);
    expect(doors[0]?.severity).toBe("error");
    expect(doors[0]?.detail).toBe("wardrobe-1 blocks door-1's 90 cm clear zone");
    expect(doors[0]?.fix).toMatch(/^move wardrobe-1 \d+ cm (east|west)$/);
    expect(doors[0]?.zone).toHaveLength(4);
  });

  it("detects an item in a doorway and two independent door leaves", () => {
    const chair = item("chair-1", "chair-ida", 95, 45);
    const input = scene([chair], [northDoor("door-1", 50), northDoor("door-2", 90)]);
    const doors = evaluateRoom(input, "r", catalog).filter((conflict) => conflict.kind === "door_swing");
    expect(doors).toHaveLength(2);
    expect(doors.map((conflict) => conflict.items[1])).toEqual(["door-1", "door-2"]);
    expect(doors.every((conflict) => conflict.detail.includes("blocks"))).toBe(true);
    expect(doors.every((conflict) => conflict.fix.includes("cm"))).toBe(true);
  });

  it("does not treat a rug beneath a door as a swing conflict", () => {
    const input = scene([item("rug-1", "rug-loop", 100, 150)], [northDoor()]);
    expect(evaluateRoom(input, "r", catalog).filter((conflict) => conflict.kind === "door_swing")).toEqual([]);
  });
});

describe("aggregation, fixtures, and budgets", () => {
  it("has no traffic work or crash in a room without doors", () => {
    const conflicts = evaluateRoom(scene([item("sofa-1", "sofa-liva", 250, 50)]), "r", catalog);
    expect(conflicts.some((conflict) => conflict.kind === "traffic")).toBe(false);
    expect(evaluateRoom(scene(), "missing", catalog)).toEqual([]);
  });

  it("measures a bed approach outside its endpoints and gives a working pinch fix", () => {
    const target = room(400, 360);
    target.type = "bedroom";
    const door: Opening = { id: "door", roomId: "r", wallId: "w1", offset: 135, width: 90, kind: "door", swing: "out", hinge: "left" };
    const bed = item("bed", "bed-birk", 100, 180, 270);
    const open = scene([bed], [door], target);
    expect(evaluateRoom(open, "r", catalog, { accessibility: true }).filter((conflict) => conflict.kind === "access_path")).toEqual([]);

    const pinched = scene([bed, item("wardrobe", "wardrobe-hald", 235, 100, 90)], [door], target);
    const conflict = evaluateRoom(pinched, "r", catalog, { accessibility: true }).find((entry) => entry.kind === "access_path");
    expect(conflict).toMatchObject({ detail: "door to bed is 70 cm wide; needs 90 cm", fix: "move wardrobe 10 cm north" });
    const fixed = applyMove(pinched, conflict!.fix);
    expect(evaluateRoom(fixed, "r", catalog, { accessibility: true }).some((entry) => entry.kind === "access_path")).toBe(false);
  });

  it("sorts errors first and exposes severity/item selectors", () => {
    const input = scene([
      item("sofa-1", "sofa-endre", 250, 100),
      item("sofa-2", "sofa-liva", 250, 100, 0, "ghost"),
      item("chair-1", "chair-lars", 0, 300),
    ]);
    const conflicts = evaluateRoom(input, "r", catalog);
    const counts = countBySeverity(conflicts);
    expect(counts.error).toBeGreaterThan(0);
    expect(counts.warn).toBeGreaterThan(0);
    expect(conflicts.findIndex((conflict) => conflict.severity === "warn")).toBeGreaterThan(conflicts.map((conflict) => conflict.severity).lastIndexOf("error"));
    expect(conflictsForItem(conflicts, "sofa-2").every((conflict) => conflict.items.includes("sofa-2"))).toBe(true);
    expect(conflictsForItem(conflicts, "missing")).toEqual([]);
  });

  it("documents the complete worst-case fixture counts", () => {
    const conflicts = evaluateHome(worstCase2br(), catalog, { accessibility: false });
    const count = (kind: string) => conflicts.filter((conflict) => conflict.kind === kind).length;
    expect(conflicts).toHaveLength(44);
    expect(count("overlap")).toBe(6);
    expect(count("outside")).toBe(4);
    expect(count("clearance")).toBe(15);
    expect(count("door_swing")).toBe(6);
    expect(count("traffic")).toBe(13);
    expect(countBySeverity(conflicts)).toEqual({ error: 19, warn: 25 });
  });

  it("keeps the furnished home free of hard standard conflicts and documents access issues", () => {
    const input = furnished2br();
    const standard = evaluateHome(input, catalog, { accessibility: false });
    const accessible = evaluateHome(input, catalog, { accessibility: true });
    expect(standard.filter((conflict) => conflict.severity === "error")).toEqual([]);
    expect(standard.filter((conflict) => conflict.kind === "clearance")).toHaveLength(5);
    expect(standard.filter((conflict) => conflict.kind === "traffic")).toHaveLength(5);
    expect(accessible.filter((conflict) => conflict.kind === "access_path")).toHaveLength(5);
    expect(accessible.filter((conflict) => conflict.kind === "turning_circle")).toHaveLength(3);
    expect(accessible.filter((conflict) => conflict.kind === "reach")).toHaveLength(3);
    expect(accessible.some((conflict) => conflict.items.includes("bed-1"))).toBe(true);
    expect(accessible.some((conflict) => conflict.items.includes("desk-1"))).toBe(true);
  });

  it("gives every canonical furnished access-path conflict a count-reducing fix", () => {
    const input = createTemplate("2br", { furnished: true });
    const conflicts = evaluateHome(input, catalog, { accessibility: true });
    const paths = conflicts.filter((conflict) => conflict.kind === "access_path");
    expect(paths).toHaveLength(1);
    for (const conflict of paths) {
      const fixed = applyMove(input, conflict.fix);
      expect(evaluateHome(fixed, catalog, { accessibility: true }).length).toBeLessThan(conflicts.length);
    }
  });

  it("is deterministic, input-pure, and respects every text budget", () => {
    const fixtures = [emptyHome(), furnished2br(), worstCase2br(), studioScene(), loftScene()];
    for (const input of fixtures) {
      const before = structuredClone(input);
      const first = evaluateHome(input, catalog);
      const second = evaluateHome(input, catalog);
      expect(first).toEqual(second);
      expect(input).toEqual(before);
      for (const conflict of first) {
        expect(conflict.detail.length).toBeLessThanOrEqual(80);
        expect(conflict.fix.length).toBeLessThanOrEqual(80);
        expect(conflict.detail).toMatch(/cm/);
        expect(conflict.fix.length).toBeGreaterThan(0);
      }
    }
  });

  it("evaluates the 2BR fixture within the four-times CI allowance", () => {
    const input = worstCase2br();
    for (let warm = 0; warm < 3; warm += 1) evaluateHome(input, catalog);
    const started = performance.now();
    for (let run = 0; run < 10; run += 1) evaluateHome(input, catalog);
    const averageMs = (performance.now() - started) / 10;
    expect(averageMs).toBeLessThan(120); // measured ~4 ms; generous so parallel builds on a loaded host never flake
  });
});
