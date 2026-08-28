import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { arrangeRoom } from "../../src/engine/arrange";
import { createCatalog } from "../../src/engine/catalog";
import { openingClearZone, swingZone } from "../../src/engine/doors";
import { footprint, itemToWallDistance, polyInside, polysOverlap, walls } from "../../src/engine/geometry";
import type { Furniture, Rotation, Scene, Vec2 } from "../../src/engine/types";
import { createTemplate } from "../../src/engine/templates";
import { emptyHome, furnished2br, loftScene, studioScene } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);
const styles = ["conversation", "media", "open", "work"] as const;
const stackable = new Set(["table-lamp", "decor"]);
const surfaces = new Set(["table", "desk", "shelf", "tv-unit"]);

function allowedOverlap(a: Furniture, b: Furniture): boolean {
  const catA = catalog.byId(a.catalogId)!; const catB = catalog.byId(b.catalogId)!;
  if (catA.category === "rug" || catB.category === "rug") return true;
  const polyA = footprint(a, catA); const polyB = footprint(b, catB);
  if (stackable.has(catA.category) && surfaces.has(catB.category)) return polyInside(polyB, polyA);
  if (stackable.has(catB.category) && surfaces.has(catA.category)) return polyInside(polyA, polyB);
  return false;
}

function assertValid(source: Scene, roomId: string, result: ReturnType<typeof arrangeRoom>): void {
  const room = source.rooms.find((entry) => entry.id === roomId)!;
  const beforeIds = source.furniture.map((item) => item.id);
  const items = result.furniture.filter((item) => item.roomId === roomId);
  expect(result.furniture.map((item) => item.id)).toEqual(beforeIds);
  expect(items.map((item) => item.id).sort()).toEqual(source.furniture.filter((item) => item.roomId === roomId).map((item) => item.id).sort());
  expect(new Set(result.furniture.map((item) => item.id)).size).toBe(result.furniture.length);
  for (const item of items) {
    const cat = catalog.byId(item.catalogId);
    expect(cat, item.id).toBeDefined();
    expect(polyInside(room.poly, footprint(item, cat!)), `${item.id} outside ${roomId}`).toBe(true);
    expect([0, 90, 180, 270]).toContain(item.rotation);
    for (const opening of source.openings.filter((entry) => entry.roomId === roomId)) {
      for (const zone of [swingZone(opening, room), openingClearZone(opening, room)]) {
        if (zone) expect(polysOverlap(zone, footprint(item, cat!)), `${item.id} blocks ${opening.id}`).toBe(false);
      }
    }
  }
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const a = items[left]!; const b = items[right]!;
      const overlap = polysOverlap(footprint(a, catalog.byId(a.catalogId)!), footprint(b, catalog.byId(b.catalogId)!));
      if (overlap) expect(allowedOverlap(a, b), `${a.id} overlaps ${b.id}`).toBe(true);
      else expect(overlap).toBe(false);
    }
  }
  const movedById = new Map(result.moved.map((entry) => [entry.id, entry]));
  for (const original of source.furniture.filter((item) => item.roomId === roomId)) {
    const arranged = result.furniture.find((item) => item.id === original.id)!;
    const changed = original.pos.x !== arranged.pos.x || original.pos.y !== arranged.pos.y || original.rotation !== arranged.rotation;
    expect(movedById.has(original.id)).toBe(changed);
    if (changed) {
      expect(movedById.get(original.id)?.from).toEqual(original.pos);
      expect(movedById.get(original.id)?.to).toEqual(arranged.pos);
      expect(movedById.get(original.id)?.rotation).toBe(arranged.rotation);
    } else expect(result.kept).toContain(original.id);
  }
  for (const outside of source.furniture.filter((item) => item.roomId !== roomId)) {
    expect(result.furniture.find((item) => item.id === outside.id)).toEqual(outside);
  }
}

function front(rotation: Rotation): Vec2 {
  return ({ 0: { x: 0, y: 1 }, 90: { x: -1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: 1, y: 0 } } as const)[rotation];
}

function expectFaces(item: Furniture, target: Vec2): void {
  const vector = front(item.rotation);
  expect((target.x - item.pos.x) * vector.x + (target.y - item.pos.y) * vector.y).toBeGreaterThan(0);
}

describe("arrangeRoom guarantees", () => {
  it("keeps every fixture valid across all four styles and is idempotent", () => {
    const cases: { scene: Scene; rooms: string[] }[] = [
      { scene: furnished2br(), rooms: ["living", "bed-1", "bed-2"] },
      { scene: loftScene(), rooms: ["loft"] },
      { scene: studioScene(), rooms: ["studio"] },
    ];
    for (const current of cases) {
      for (const roomId of current.rooms) {
        for (const style of styles) {
          const snapshot = structuredClone(current.scene);
          const first = arrangeRoom(current.scene, roomId, style, catalog, { seed: 47 });
          expect(current.scene).toEqual(snapshot);
          expect(first.note).toContain(style);
          expect(first.moved.length).toBeGreaterThan(0);
          assertValid(current.scene, roomId, first);
          const arrangedScene = { ...current.scene, furniture: first.furniture };
          const second = arrangeRoom(arrangedScene, roomId, style, catalog, { seed: 47 });
          expect(second.moved).toEqual([]);
          expect(second.furniture).toEqual(first.furniture);
          expect(second.kept.sort()).toEqual(first.furniture.filter((item) => item.roomId === roomId).map((item) => item.id).sort());
        }
      }
    }
  });

  it("keeps locked items exactly fixed by default", () => {
    const current = furnished2br();
    const sofa = current.furniture.find((item) => item.id === "sofa-1")!;
    sofa.locked = true;
    const original = structuredClone(sofa);
    for (const style of styles) {
      const result = arrangeRoom(current, "living", style, catalog);
      expect(result.furniture.find((item) => item.id === sofa.id)).toEqual(original);
      expect(result.kept).toContain(sofa.id);
      expect(result.moved.some((entry) => entry.id === sofa.id)).toBe(false);
      assertValid(current, "living", result);
    }
  });

  it("preserves ids and constraints when locked items are eligible to move", () => {
    const current = furnished2br();
    current.furniture.find((item) => item.id === "sofa-1")!.locked = true;
    const result = arrangeRoom(current, "living", "open", catalog, { keepLocked: false, seed: 9 });
    assertValid(current, "living", result);
    expect(result.furniture.find((item) => item.id === "sofa-1")?.locked).toBe(true);
    expect(result.note).toContain("open");
  });

  it("returns safe no-ops for an empty room, rug-only room and unknown room", () => {
    const empty = emptyHome();
    const noOp = arrangeRoom(empty, "living", "conversation", catalog);
    expect(noOp.furniture).toEqual(empty.furniture);
    expect(noOp.moved).toEqual([]);
    expect(noOp.kept).toEqual([]);
    expect(noOp.note).toContain("empty");

    const rugOnly = emptyHome();
    rugOnly.furniture.push({ id: "rug-1", catalogId: "rug-flette", roomId: "living", pos: { x: 260, y: 220 }, rotation: 90, colorway: "plaster", status: "placed" });
    const rugResult = arrangeRoom(rugOnly, "living", "open", catalog);
    expect(rugResult.furniture).toEqual(rugOnly.furniture);
    expect(rugResult.moved).toEqual([]);
    expect(rugResult.kept).toEqual(["rug-1"]);
    expect(rugResult.note).toContain("only has a rug");

    const missing = arrangeRoom(rugOnly, "missing", "media", catalog);
    expect(missing.furniture).toEqual(rugOnly.furniture);
    expect(missing.moved).toEqual([]);
    expect(missing.note).toContain("not found");
  });
});

describe("style choreography", () => {
  it("orients media seating toward the TV", () => {
    const current = furnished2br();
    const result = arrangeRoom(current, "living", "media", catalog);
    const sofa = result.furniture.find((item) => item.id === "sofa-1")!;
    const tv = result.furniture.find((item) => item.id === "tv-unit-1")!;
    expectFaces(sofa, tv.pos);
    expect(Math.abs(sofa.pos.y - tv.pos.y)).toBeGreaterThan(250);
    expect(result.moved.map((entry) => entry.id)).toContain("sofa-1");
    expect(result.moved.map((entry) => entry.id)).toContain("tv-unit-1");
  });

  it("uses the largest window as the conversation focal point", () => {
    const current = furnished2br();
    const result = arrangeRoom(current, "living", "conversation", catalog);
    const sofa = result.furniture.find((item) => item.id === "sofa-1")!;
    const window = current.openings.find((entry) => entry.id === "window-living-north")!;
    const target = { x: window.offset + window.width / 2, y: 0 };
    expectFaces(sofa, target);
    expect(sofa.rotation).toBe(180);
    expect(sofa.pos.y).toBeGreaterThan(350);
  });

  it("keeps an explicit focus item and turns seating toward it", () => {
    const current = furnished2br();
    const originalTv = structuredClone(current.furniture.find((item) => item.id === "tv-unit-1")!);
    const result = arrangeRoom(current, "living", "conversation", catalog, { focus: "Linje TV Unit" });
    const sofa = result.furniture.find((item) => item.id === "sofa-1")!;
    const tv = result.furniture.find((item) => item.id === "tv-unit-1")!;
    expect(tv).toEqual(originalTv);
    expect(result.kept).toContain(tv.id);
    expectFaces(sofa, tv.pos);
    expect(sofa.rotation).toBe(0);
  });

  it("puts the work desk under the largest window and its chair in front", () => {
    const current = furnished2br();
    const result = arrangeRoom(current, "bed-2", "work", catalog);
    const room = current.rooms.find((entry) => entry.id === "bed-2")!;
    const desk = result.furniture.find((item) => item.id === "desk-1")!;
    const chair = result.furniture.find((item) => item.id === "chair-5")!;
    const east = walls(room).find((wall) => wall.side === "east")!;
    expect(itemToWallDistance(desk, catalog.byId(desk.catalogId)!, east)).toBeCloseTo(0, 6);
    expect(desk.rotation).toBe(90);
    expect(desk.pos.y).toBe(80);
    expect(chair.pos.x).toBeLessThan(desk.pos.x);
    expectFaces(chair, desk.pos);
    expect(chair.rotation).toBe(270);
  });

  it("moves open layouts to walls while leaving the rug central", () => {
    const current = furnished2br();
    const result = arrangeRoom(current, "living", "open", catalog);
    const room = current.rooms.find((entry) => entry.id === "living")!;
    for (const item of result.furniture.filter((entry) => entry.roomId === room.id)) {
      const cat = catalog.byId(item.catalogId)!;
      const nearest = Math.min(...walls(room).map((wall) => itemToWallDistance(item, cat, wall)));
      if (cat.category === "rug") expect(nearest).toBeGreaterThan(80);
      else expect(nearest, item.id).toBeLessThanOrEqual(10);
    }
  });
});

describe("performance", () => {
  it("arranges the furnished living room and main bedroom within 50 ms", () => {
    const current = createTemplate("2br", { furnished: true });
    arrangeRoom(current, "living", "open", catalog, { seed: 3 });
    for (const roomId of ["living", "bed-1"] as const) {
      for (const style of styles) {
        const start = performance.now();
        const result = arrangeRoom(current, roomId, style, catalog, { seed: 3 });
        const elapsed = performance.now() - start;
        expect(result.furniture).toHaveLength(current.furniture.length);
        expect(elapsed, `${roomId}/${style}: ${elapsed.toFixed(2)} ms`).toBeLessThan(50);
      }
    }
  });
});
