import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog, createTemplate, footprint, openingClearZone, polyInside, polysOverlap, resolveWall, swingZone, walls } from "../../src/engine";
import { TEMPLATE_IDS } from "../../src/engine/types";
import { emptyHome, furnished2br, loftScene, studioScene, worstCase2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

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
          expect(polysOverlap(footprint(a, catalog.byId(a.catalogId)!), footprint(b, catalog.byId(b.catalogId)!)), `${id}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
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
    expect(scene.furniture).toHaveLength(23);
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
    expect(studioScene().meta.template).toBe("studio");
    expect(loftScene().meta.template).toBe("loft");
    expect(emptyHome()).not.toBe(emptyHome());
  });
});
