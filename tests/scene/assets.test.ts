import { describe, expect, it } from "vitest";
import { M, normalizeTransform, stackElevationCm } from "@/src/scene/math";
import type { Box3Like } from "@/src/scene/math";
import { catalogSource } from "@/data/catalog.source";
import type { CatalogItem, Furniture } from "@/src/engine/types";

/** A synthetic GLB bounding box in arbitrary model units. */
function boxOf(min: [number, number, number], max: [number, number, number]): Box3Like {
  return { min, max };
}

function apply(box: Box3Like, dims: { w: number; d: number; h: number }): Box3Like {
  const { scale, offset } = normalizeTransform(box, dims);
  return {
    min: [box.min[0] * scale + offset[0], box.min[1] * scale + offset[1], box.min[2] * scale + offset[2]],
    max: [box.max[0] * scale + offset[0], box.max[1] * scale + offset[1], box.max[2] * scale + offset[2]],
  };
}

describe("GLB normalisation", () => {
  const dims = { w: 220, d: 95, h: 85 };

  it("scales the bbox width to the catalog width in metres", () => {
    const { scale } = normalizeTransform(boxOf([-1, 0, -0.5], [1, 0.8, 0.5]), dims);
    expect(scale).toBeCloseTo((220 * M) / 2, 6);
    const result = apply(boxOf([-1, 0, -0.5], [1, 0.8, 0.5]), dims);
    expect(result.max[0] - result.min[0]).toBeCloseTo(2.2, 6);
  });

  it("rests the model on the floor whatever its authored origin", () => {
    for (const min of [-3, 0, 4.5]) {
      const result = apply(boxOf([-1, min, -0.5], [1, min + 0.9, 0.5]), dims);
      expect(result.min[1]).toBeCloseTo(0, 6);
    }
  });

  it("centres the footprint on the item origin", () => {
    const result = apply(boxOf([2, 1, -7], [6, 3, -3]), dims);
    expect((result.min[0] + result.max[0]) / 2).toBeCloseTo(0, 6);
    expect((result.min[2] + result.max[2]) / 2).toBeCloseTo(0, 6);
  });

  it("keeps the model's proportions (uniform scale)", () => {
    const box = boxOf([0, 0, 0], [4, 2, 1]);
    const result = apply(box, dims);
    const ratioBefore = (box.max[1] - box.min[1]) / (box.max[0] - box.min[0]);
    const ratioAfter = (result.max[1] - result.min[1]) / (result.max[0] - result.min[0]);
    expect(ratioAfter).toBeCloseTo(ratioBefore, 6);
  });

  it("survives a degenerate bounding box", () => {
    expect(normalizeTransform(boxOf([0, 0, 0], [0, 0, 0]), dims).scale).toBe(1);
  });
});

describe("stacking elevation", () => {
  const byId = (id: string): CatalogItem | undefined => catalogSource.find((item) => item.id === id);
  const desk = byId("desk-soren") as CatalogItem;

  const item = (over: Partial<Furniture> & Pick<Furniture, "id" | "catalogId" | "pos">): Furniture => ({
    roomId: "bed-2",
    rotation: 0,
    colorway: "oak",
    status: "placed",
    ...over,
  });

  it("lifts a table lamp onto the desk beneath it", () => {
    const surface = item({ id: "desk-1", catalogId: "desk-soren", pos: { x: 200, y: 200 } });
    const lamp = item({ id: "table-lamp-1", catalogId: "table-lamp-alva", pos: { x: 200, y: 200 } });
    const scene = { furniture: [surface, lamp] };
    expect(stackElevationCm(lamp, byId("table-lamp-alva") as CatalogItem, scene, byId)).toBe(desk.dims.h);
  });

  it("leaves a lamp on the floor when no surface is under it", () => {
    const lamp = item({ id: "table-lamp-1", catalogId: "table-lamp-alva", pos: { x: 20, y: 20 } });
    const surface = item({ id: "desk-1", catalogId: "desk-soren", pos: { x: 300, y: 300 } });
    expect(stackElevationCm(lamp, byId("table-lamp-alva") as CatalogItem, { furniture: [surface, lamp] }, byId)).toBe(0);
  });

  it("never lifts a non-stackable category", () => {
    const surface = item({ id: "desk-1", catalogId: "desk-soren", pos: { x: 200, y: 200 } });
    const chair = item({ id: "chair-1", catalogId: "chair-finn", pos: { x: 200, y: 200 } });
    expect(stackElevationCm(chair, byId("chair-finn") as CatalogItem, { furniture: [surface, chair] }, byId)).toBe(0);
  });

  it("ignores surfaces in another room and ghost surfaces", () => {
    const other = item({ id: "desk-1", catalogId: "desk-soren", pos: { x: 200, y: 200 }, roomId: "bed-1" });
    const ghost = item({ id: "ghost-1", catalogId: "desk-soren", pos: { x: 200, y: 200 }, status: "ghost" });
    const decorItem = item({ id: "decor-1", catalogId: "decor-vase", pos: { x: 200, y: 200 } });
    expect(stackElevationCm(decorItem, byId("decor-vase") as CatalogItem, { furniture: [other, ghost, decorItem] }, byId)).toBe(0);
  });
});
